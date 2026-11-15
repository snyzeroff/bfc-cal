import "server-only";
import { and, eq, isNull, or, sql as dsql } from "drizzle-orm";
import { db } from "@/db";
import { categories, eventProposals, events, feedTokens, speakers, tasks, users } from "@/db/schema";
import { appUrl } from "@/lib/app-url";
import { audit } from "@/lib/audit";
import { hashToken, newToken } from "@/lib/auth/crypto";
import { AppError } from "@/lib/errors";
import { buildCalendar, type IcsEvent } from "@/lib/ics";
import { listPublicEvents } from "@/lib/public";
import { readSetting } from "@/lib/settings";
import { STATUS_META } from "@/lib/appearance";
import { addDays, eventDays, parisToInstant } from "@/lib/time";

export { appUrl };
const UID_DOMAIN = "bfc-calendar";

function allDayBounds(start: Date, end: Date) {
  const d = eventDays(start, end);
  return { startDay: d.start, endDayExclusive: addDays(d.end, 1) };
}

/* ------------------------------------------------------------ public feed */

export async function buildPublicFeed(): Promise<string> {
  const [feed, appearance, rows] = await Promise.all([
    readSetting("feed"),
    readSetting("appearance"),
    listPublicEvents(),
  ]);
  const cutoff = Date.now() - feed.cancelledRetentionDays * 86_400_000;
  const list: IcsEvent[] = [];
  for (const e of rows) {
    const cancelled = e.status === "cancelled";
    // After the retention window the cancelled event leaves the feed entirely.
    if (cancelled && (e.cancelledAt ?? e.updatedAt).getTime() < cutoff) continue;
    const speaker = e.speakerName
      ? `Speaker: ${e.speakerName}${e.speakerPosition ? `, ${e.speakerPosition}` : ""}${e.speakerOrganization ? ` (${e.speakerOrganization})` : ""}`
      : "";
    const details = [
      e.status === "postponed" ? "POSTPONED — a new date will be announced." : "",
      speaker,
      e.description,
      e.registrationUrl ? `Registration: ${e.registrationUrl}` : "",
      e.onlineUrl ? `Online: ${e.onlineUrl}` : "",
      `Details: ${appUrl()}/events/${e.id}`,
    ].filter(Boolean);
    list.push({
      uid: `event-${e.id}@${UID_DOMAIN}`,
      title: e.status === "postponed" ? `Postponed: ${e.title}` : e.title,
      description: details.join("\n\n"),
      location: e.location,
      url: `${appUrl()}/events/${e.id}`,
      start: e.startAt,
      end: e.endAt,
      allDay: e.allDay,
      ...(e.allDay ? allDayBounds(e.startAt, e.endAt) : {}),
      status: cancelled ? "CANCELLED" : e.status === "postponed" ? "TENTATIVE" : "CONFIRMED",
      sequence: e.sequence,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      categories: [e.categoryName],
      transparent: e.status === "postponed",
    });
  }
  return buildCalendar({
    name: `${appearance.shortName} — Conferences & events`,
    description: `Public events of the ${appearance.orgName}.`,
    refreshMinutes: feed.refreshMinutes,
    color: appearance.brand.primary,
    events: list,
  });
}

/* ------------------------------------------------------------- board feed */

export type FeedAuth = { tokenId: string; userId: string; includeTentative: boolean; includeDeadlines: boolean };

/** Resolves a private feed token. Access is re-checked against the user on every request. */
export async function authenticateFeed(token: string): Promise<FeedAuth | null> {
  if (!/^[A-Za-z0-9_-]{30,64}$/.test(token)) return null;
  const [row] = await db
    .select({
      tokenId: feedTokens.id,
      userId: users.id,
      active: users.active,
      includeTentative: feedTokens.includeTentative,
      includeDeadlines: feedTokens.includeDeadlines,
    })
    .from(feedTokens)
    .innerJoin(users, eq(users.id, feedTokens.userId))
    .where(and(eq(feedTokens.tokenHash, hashToken(token)), isNull(feedTokens.revokedAt)));
  if (!row || !row.active) return null;
  await db.update(feedTokens).set({ lastUsedAt: new Date() }).where(eq(feedTokens.id, row.tokenId));
  return row;
}

export async function buildBoardFeed(auth: FeedAuth): Promise<string> {
  const [feed, appearance] = await Promise.all([readSetting("feed"), readSetting("appearance")]);
  const cutoff = new Date(Date.now() - feed.cancelledRetentionDays * 86_400_000);
  const rows = await db
    .select({ e: events, category: categories.name, speaker: speakers.name, org: speakers.organization })
    .from(events)
    .innerJoin(categories, eq(categories.id, events.categoryId))
    .leftJoin(speakers, eq(speakers.id, events.speakerId))
    .where(
      and(
        isNull(events.archivedAt),
        dsql`${events.startAt} is not null`,
        or(dsql`${events.status} <> 'cancelled'`, dsql`coalesce(${events.cancelledAt}, ${events.updatedAt}) >= ${cutoff.toISOString()}::timestamptz`),
      ),
    );

  const list: IcsEvent[] = [];
  for (const { e, category, speaker, org } of rows) {
    const label = STATUS_META[e.status].label;
    const firm = ["confirmed", "published", "completed"].includes(e.status);
    list.push({
      uid: `event-${e.id}@${UID_DOMAIN}`,
      title: firm || e.status === "cancelled" ? e.title : `[${label}] ${e.title}`,
      description: [
        `Status: ${label}${e.isPublic ? " · public" : " · board only"}`,
        speaker ? `Speaker: ${speaker}${org ? ` (${org})` : ""}` : "",
        e.description,
        `Open in BFC Calendar: ${appUrl()}/board/events/${e.id}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      location: e.location,
      url: `${appUrl()}/board/events/${e.id}`,
      start: e.startAt!,
      end: e.endAt ?? e.startAt!,
      allDay: e.allDay,
      ...(e.allDay ? allDayBounds(e.startAt!, e.endAt ?? e.startAt!) : {}),
      status: e.status === "cancelled" ? "CANCELLED" : firm ? "CONFIRMED" : "TENTATIVE",
      sequence: e.sequence,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      categories: [category],
      transparent: !firm,
    });
  }

  if (auth.includeTentative) {
    const props = await db
      .select({ p: eventProposals, title: events.title, status: events.status })
      .from(eventProposals)
      .innerJoin(events, eq(events.id, eventProposals.eventId))
      .where(and(eq(eventProposals.state, "active"), isNull(events.archivedAt), dsql`${events.status} <> 'cancelled'`));
    for (const { p, title } of props) {
      list.push({
        uid: `proposal-${p.id}@${UID_DOMAIN}`,
        title: `[Option] ${title}`,
        description: [
          "Proposed date — not confirmed.",
          `Speaker availability: ${p.availability === "unknown" ? "not confirmed yet" : p.availability}`,
          p.note,
          `Open in BFC Calendar: ${appUrl()}/board/events/${p.eventId}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
        url: `${appUrl()}/board/events/${p.eventId}`,
        start: p.startAt,
        end: p.endAt,
        status: "TENTATIVE",
        sequence: 0,
        createdAt: p.createdAt,
        updatedAt: p.createdAt,
        categories: ["Proposed date"],
        transparent: true,
      });
    }
  }

  if (auth.includeDeadlines) {
    const open = await db
      .select({ t: tasks, eventTitle: events.title, archived: events.archivedAt })
      .from(tasks)
      .leftJoin(events, eq(events.id, tasks.eventId))
      .where(and(isNull(tasks.doneAt), dsql`${tasks.dueDate} is not null`));
    for (const { t, eventTitle, archived } of open) {
      if (archived) continue;
      const start = parisToInstant(t.dueDate!);
      list.push({
        uid: `task-${t.id}@${UID_DOMAIN}`,
        title: `Deadline: ${t.title}`,
        description: [eventTitle ? `For: ${eventTitle}` : "", t.notes, `Open in BFC Calendar: ${appUrl()}/board/tasks`].filter(Boolean).join("\n\n"),
        start,
        end: start,
        allDay: true,
        startDay: t.dueDate!,
        endDayExclusive: addDays(t.dueDate!, 1),
        status: "CONFIRMED",
        sequence: 0,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        categories: ["Deadline"],
        transparent: true,
      });
    }
  }

  list.sort((a, b) => a.start.getTime() - b.start.getTime() || a.uid.localeCompare(b.uid));
  return buildCalendar({
    name: `${appearance.shortName} — Board`,
    description: `Private planning calendar of the ${appearance.orgName} board. Do not share this subscription.`,
    refreshMinutes: feed.refreshMinutes,
    color: appearance.brand.deep,
    events: list,
  });
}

/* ------------------------------------------------------ token management */

export async function createFeedToken(
  actor: { id: string; name: string },
  opts: { label?: string; includeTentative?: boolean; includeDeadlines?: boolean } = {},
) {
  const token = newToken();
  const [row] = await db
    .insert(feedTokens)
    .values({
      userId: actor.id,
      tokenHash: hashToken(token),
      label: opts.label?.trim() || "Board calendar",
      includeTentative: opts.includeTentative ?? true,
      includeDeadlines: opts.includeDeadlines ?? true,
    })
    .returning();
  await audit({ actor, action: "feed.create", entityType: "feed_token", entityId: row.id, summary: `Created private feed “${row.label}”` });
  // The secret is returned once and never stored in clear text.
  return { id: row.id, token, url: `${appUrl()}/feeds/board/${token}.ics` };
}

export async function revokeFeedToken(actor: { id: string; name: string; role: string }, tokenId: string) {
  const [row] = await db.select().from(feedTokens).where(eq(feedTokens.id, tokenId));
  if (!row) throw new AppError("not_found", "This subscription no longer exists.");
  if (row.userId !== actor.id && actor.role !== "super_admin") {
    throw new AppError("forbidden", "You can only revoke your own subscriptions.");
  }
  await db.update(feedTokens).set({ revokedAt: new Date() }).where(eq(feedTokens.id, tokenId));
  await audit({ actor, action: "feed.revoke", entityType: "feed_token", entityId: tokenId, summary: `Revoked private feed “${row.label}”` });
}

/** Revokes the old secret and issues a new one with the same options. */
export async function rotateFeedToken(actor: { id: string; name: string; role: string }, tokenId: string) {
  const [row] = await db.select().from(feedTokens).where(eq(feedTokens.id, tokenId));
  if (!row || row.revokedAt) throw new AppError("not_found", "This subscription no longer exists.");
  if (row.userId !== actor.id) throw new AppError("forbidden", "You can only rotate your own subscriptions.");
  await revokeFeedToken(actor, tokenId);
  return createFeedToken(actor, { label: row.label, includeTentative: row.includeTentative, includeDeadlines: row.includeDeadlines });
}

export async function revokeAllFeedTokens(userId: string) {
  await db.update(feedTokens).set({ revokedAt: new Date() }).where(and(eq(feedTokens.userId, userId), isNull(feedTokens.revokedAt)));
}

