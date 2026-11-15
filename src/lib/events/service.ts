import "server-only";
import { and, eq, inArray, isNull, lte, ne, sql as dsql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import {
  attachments,
  categories,
  comments,
  eventOrganizers,
  eventProposals,
  events,
  PUBLIC_STATUSES,
  tasks,
  templates,
  users,
  type EventRow,
  type EventStatus,
} from "@/db/schema";
import { audit, diff } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import {
  canArchiveEvent,
  canDeleteEvent,
  canEditEvent,
  canOverrideRestriction,
  canPublish,
  isAdmin,
  type Actor,
} from "@/lib/permissions";
import { loadPlanningContext } from "@/lib/planning";
import { findViolations, hardViolations, softViolations, type Violation } from "@/lib/restrictions";
import { addDays, eventDays, parisParts, parisToInstant } from "@/lib/time";

export type ActorUser = Actor & { name: string };

/** Fields whose change calendar subscribers must be told about (bumps SEQUENCE). */
const FEED_FIELDS = [
  "title",
  "description",
  "startAt",
  "endAt",
  "allDay",
  "location",
  "onlineUrl",
  "registrationUrl",
  "status",
  "speakerId",
  "categoryId",
  "isPublic",
] as const;

/** Everything the members site or feed shows: on a published event, only admins may change these. */
const PUBLIC_FIELDS = [...FEED_FIELDS, "embedUrl", "color", "audience"] as const;
const MEMBERS_SEE = "This event is published. Ask a Board Admin to change what members see.";

const NEEDS_DATE: EventStatus[] = ["confirmed", "published", "completed"];
/** Statuses in which a dated event does not occupy the calendar any more. */
const INACTIVE: EventStatus[] = ["cancelled", "postponed", "completed"];

export type EventPatch = Partial<
  Pick<
    EventRow,
    | "title"
    | "description"
    | "internalNotes"
    | "categoryId"
    | "speakerId"
    | "status"
    | "startAt"
    | "endAt"
    | "allDay"
    | "location"
    | "onlineUrl"
    | "registrationUrl"
    | "embedUrl"
    | "featured"
    | "color"
    | "audience"
    | "scheduledPublishAt"
  >
> & { organizerIds?: string[] };

export type MutationOptions = {
  /** Version the editor loaded; a mismatch means someone else saved in between. */
  expectedVersion?: number;
  /** Super Admin justification for scheduling inside a hard-restricted period. */
  overrideReason?: string;
};

export type MutationResult = { event: EventRow; warnings: Violation[] };

async function loadEvent(id: string, tx: Tx | typeof db = db) {
  const [row] = await tx
    .select({ event: events, kind: categories.kind })
    .from(events)
    .innerJoin(categories, eq(categories.id, events.categoryId))
    .where(eq(events.id, id));
  if (!row) throw new AppError("not_found", "This event no longer exists.");
  const orgs = await tx.select().from(eventOrganizers).where(eq(eventOrganizers.eventId, id));
  return { ...row, organizerIds: orgs.map((o) => o.userId) };
}

function assertEditable(actor: ActorUser, ev: { event: EventRow; organizerIds: string[] }) {
  if (!canEditEvent(actor, { createdBy: ev.event.createdBy, organizerIds: ev.organizerIds })) {
    throw new AppError("forbidden", "You can only edit events you created or organise.");
  }
}

/**
 * Enforces hard restrictions for a date span. Returns the soft warnings and,
 * when a Super Admin overrides, the reason to store on the event.
 */
export async function enforceRestrictions(
  actor: ActorUser,
  kind: string,
  startAt: Date,
  endAt: Date | null,
  overrideReason?: string,
): Promise<{ warnings: Violation[]; hard: Violation[]; override: string | null }> {
  const ctx = await loadPlanningContext();
  const days = eventDays(startAt, endAt);
  const found = findViolations(ctx.windows, kind, days.start, days.end);
  const hard = hardViolations(found);
  if (hard.length === 0) return { warnings: softViolations(found), hard, override: null };

  const reason = overrideReason?.trim() ?? "";
  if (canOverrideRestriction(actor) && reason.length >= 5) {
    return { warnings: softViolations(found), hard, override: reason };
  }
  throw new AppError("restricted", hard[0].message, {
    violations: hard.map((v) => ({ title: v.title, message: v.message, start: v.start, end: v.end, type: v.type })),
    canOverride: canOverrideRestriction(actor),
  });
}

function validateTimes(startAt: Date | null, endAt: Date | null) {
  if (startAt && !endAt) throw new AppError("invalid", "An end time is required.");
  if (!startAt && endAt) throw new AppError("invalid", "A start time is required.");
  if (startAt && endAt && endAt.getTime() <= startAt.getTime()) {
    throw new AppError("invalid", "The event must end after it starts.");
  }
}

async function setOrganizers(tx: Tx, eventId: string, ids: string[]) {
  await tx.delete(eventOrganizers).where(eq(eventOrganizers.eventId, eventId));
  const unique = [...new Set(ids)];
  if (unique.length) {
    const valid = await tx.select({ id: users.id }).from(users).where(inArray(users.id, unique));
    if (valid.length) await tx.insert(eventOrganizers).values(valid.map((u) => ({ eventId, userId: u.id })));
  }
}

/* ------------------------------------------------------------------ create */

export type CreateInput = EventPatch & {
  title: string;
  categoryId: string;
  proposals?: { startAt: Date; endAt: Date; note?: string }[];
  templateId?: string;
};

export async function createEvent(actor: ActorUser, input: CreateInput, opts: MutationOptions = {}): Promise<MutationResult> {
  if (!actor.active) throw new AppError("forbidden", "Your account is disabled.");
  const [category] = await db.select().from(categories).where(eq(categories.id, input.categoryId));
  if (!category) throw new AppError("invalid", "Unknown category.");

  const startAt = input.startAt ?? null;
  const endAt = input.endAt ?? null;
  validateTimes(startAt, endAt);
  let status: EventStatus = input.status ?? "idea";
  if (status === "published") throw new AppError("invalid", "Create the event first, then publish it.");
  if (NEEDS_DATE.includes(status) && !startAt) throw new AppError("invalid", "A confirmed event needs a date.");
  // Meetings and deadlines have no negotiation phase: a dated one is simply confirmed.
  if (!input.status && startAt && category.kind !== "conference") status = "confirmed";

  let warnings: Violation[] = [];
  let override: string | null = null;
  if (startAt && !INACTIVE.includes(status)) {
    const r = await enforceRestrictions(actor, category.kind, startAt, endAt, opts.overrideReason);
    warnings = r.warnings;
    override = r.override;
  }
  for (const p of input.proposals ?? []) {
    validateTimes(p.startAt, p.endAt);
    await enforceRestrictions(actor, category.kind, p.startAt, p.endAt, opts.overrideReason);
  }

  const template = input.templateId
    ? (await db.select().from(templates).where(eq(templates.id, input.templateId)))[0]
    : undefined;

  const event = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(events)
      .values({
        title: input.title.trim(),
        description: input.description ?? template?.data.description ?? "",
        internalNotes: input.internalNotes ?? "",
        categoryId: input.categoryId,
        speakerId: input.speakerId ?? null,
        status,
        startAt,
        endAt,
        allDay: input.allDay ?? false,
        location: input.location ?? template?.data.location ?? "",
        onlineUrl: input.onlineUrl ?? "",
        registrationUrl: input.registrationUrl ?? "",
        embedUrl: input.embedUrl ?? "",
        featured: canPublish(actor) ? (input.featured ?? false) : false,
        color: input.color ?? null,
        audience: input.audience ?? [],
        overrideReason: override,
        overrideBy: override ? actor.id : null,
        createdBy: actor.id,
        updatedBy: actor.id,
      })
      .returning();
    await setOrganizers(tx, row.id, input.organizerIds ?? [actor.id]);
    if (input.proposals?.length) {
      await tx.insert(eventProposals).values(
        input.proposals.map((p) => ({ eventId: row.id, startAt: p.startAt, endAt: p.endAt, note: p.note ?? "", createdBy: actor.id })),
      );
    }
    if (template?.data.tasks.length) {
      const anchor = startAt ? parisParts(startAt).date : null;
      await tx.insert(tasks).values(
        template.data.tasks.map((t, i) => ({
          eventId: row.id,
          title: t.title,
          dueDate: anchor ? addDays(anchor, t.offsetDays) : null,
          sortOrder: i,
          createdBy: actor.id,
        })),
      );
    }
    await audit({ actor, action: "event.create", entityType: "event", entityId: row.id, summary: `Created “${row.title}”` }, tx);
    if (override) {
      await audit(
        { actor, action: "restriction.override", entityType: "event", entityId: row.id, summary: `Scheduled “${row.title}” inside a restricted period`, reason: override },
        tx,
      );
    }
    return row;
  });
  return { event, warnings };
}

/* ------------------------------------------------------------------ update */

export async function updateEvent(
  actor: ActorUser,
  id: string,
  patch: EventPatch,
  opts: MutationOptions = {},
): Promise<MutationResult> {
  const current = await loadEvent(id);
  assertEditable(actor, current);
  const ev = current.event;

  if (opts.expectedVersion !== undefined && opts.expectedVersion !== ev.version) {
    throw await conflictError(ev);
  }

  const { organizerIds, ...fields } = patch;
  const next = { ...ev, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) } as EventRow;
  validateTimes(next.startAt, next.endAt);
  if (!next.title.trim()) throw new AppError("invalid", "A title is required.");

  let kind = current.kind;
  if (next.categoryId !== ev.categoryId) {
    const [cat] = await db.select().from(categories).where(eq(categories.id, next.categoryId));
    if (!cat) throw new AppError("invalid", "Unknown category.");
    kind = cat.kind;
  }

  /* --- status rules --- */
  const set: Partial<EventRow> = { ...fields };
  if (next.status !== ev.status) {
    if (next.status === "published" && !ev.isPublic) {
      throw new AppError("invalid", "Publishing is a separate step: use “Publish” once the event is confirmed.");
    }
    if (ev.isPublic && !canPublish(actor)) {
      throw new AppError("forbidden", "Only a Board Admin can change the status of a published event.");
    }
    if (ev.isPublic && !PUBLIC_STATUSES.includes(next.status)) {
      // Moving a public event back to a planning status takes it off the members calendar.
      set.isPublic = false;
      next.isPublic = false;
    }
    set.cancelledAt = next.status === "cancelled" ? new Date() : null;
  }
  if (NEEDS_DATE.includes(next.status) && !next.startAt) {
    throw new AppError("invalid", "A confirmed event needs a date. Change its status first.");
  }
  if (ev.isPublic && !next.startAt) {
    throw new AppError("invalid", "A published event needs a date. Unpublish it first.");
  }
  if (fields.featured !== undefined && fields.featured !== ev.featured && !canPublish(actor)) {
    throw new AppError("forbidden", "Only a Board Admin can feature an event at the top of the members site.");
  }
  if (fields.scheduledPublishAt && fields.scheduledPublishAt.getTime() !== ev.scheduledPublishAt?.getTime() && !canPublish(actor)) {
    throw new AppError("forbidden", "Only a Board Admin can schedule publication.");
  }

  /* --- restrictions: checked whenever the scheduling itself changes --- */
  const scheduleChanged =
    next.startAt?.getTime() !== ev.startAt?.getTime() ||
    next.endAt?.getTime() !== ev.endAt?.getTime() ||
    next.categoryId !== ev.categoryId ||
    (INACTIVE.includes(ev.status) && !INACTIVE.includes(next.status));
  let warnings: Violation[] = [];
  let override: string | null = null;
  if (next.startAt && scheduleChanged && !INACTIVE.includes(next.status)) {
    const r = await enforceRestrictions(actor, kind, next.startAt, next.endAt, opts.overrideReason);
    warnings = r.warnings;
    override = r.override;
    set.overrideReason = override;
    set.overrideBy = override ? actor.id : null;
  }

  const changes = diff(ev as unknown as Record<string, unknown>, set as Record<string, unknown>, ["overrideBy", "cancelledAt"]);
  const feedChanged = FEED_FIELDS.some((f) => f in changes);
  if (ev.isPublic && !canPublish(actor) && PUBLIC_FIELDS.some((f) => f in changes)) {
    throw new AppError("forbidden", MEMBERS_SEE);
  }

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(events)
      .set({
        ...set,
        title: next.title.trim(),
        sequence: feedChanged ? ev.sequence + 1 : ev.sequence,
        version: ev.version + 1,
        updatedBy: actor.id,
        updatedAt: new Date(),
      })
      .where(and(eq(events.id, id), eq(events.version, ev.version)))
      .returning();
    if (!row) throw await conflictError(ev);
    if (organizerIds) {
      const before = [...current.organizerIds].sort().join(",");
      const after = [...new Set(organizerIds)].sort().join(",");
      if (before !== after) {
        await setOrganizers(tx, id, organizerIds);
        changes.organizers = [current.organizerIds.length, new Set(organizerIds).size];
      }
    }
    if (Object.keys(changes).length) {
      await audit(
        { actor, action: changes.status ? "event.status" : "event.update", entityType: "event", entityId: id, summary: summarize(row.title, changes), changes },
        tx,
      );
    }
    if (override) {
      await audit(
        { actor, action: "restriction.override", entityType: "event", entityId: id, summary: `Scheduled “${row.title}” inside a restricted period`, reason: override },
        tx,
      );
    }
    return row;
  });
  return { event: updated, warnings };
}

async function conflictError(ev: EventRow) {
  const [fresh] = await db
    .select({ version: events.version, updatedAt: events.updatedAt, name: users.name })
    .from(events)
    .leftJoin(users, eq(users.id, events.updatedBy))
    .where(eq(events.id, ev.id));
  return new AppError(
    "conflict",
    `${fresh?.name ?? "Someone"} saved changes to this event while you were editing. Reload to see the latest version before saving again.`,
    { currentVersion: fresh?.version },
  );
}

function summarize(title: string, changes: Record<string, [unknown, unknown]>): string {
  if (changes.status) return `“${title}”: status ${changes.status[0]} → ${changes.status[1]}`;
  if (changes.startAt || changes.endAt) return `Rescheduled “${title}”`;
  return `Updated “${title}” (${Object.keys(changes).join(", ")})`;
}

/* ------------------------------------------------------ publish / unpublish */

export async function publishEvent(actor: ActorUser, id: string, opts: MutationOptions = {}): Promise<EventRow> {
  if (!canPublish(actor)) throw new AppError("forbidden", "Only a Board Admin can publish events.");
  return publishInternal(actor, id, opts);
}

async function publishInternal(actor: ActorUser | null, id: string, opts: MutationOptions = {}): Promise<EventRow> {
  const { event: ev } = await loadEvent(id);
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== ev.version) throw await conflictError(ev);
  if (ev.archivedAt) throw new AppError("invalid", "Restore this event from the archive before publishing it.");
  if (!ev.startAt || !ev.endAt) throw new AppError("invalid", "Confirm a date before publishing.");
  if (!["confirmed", ...PUBLIC_STATUSES].includes(ev.status)) {
    throw new AppError("invalid", "Only confirmed events can be published. Confirm the date first.");
  }
  if (ev.isPublic) return ev;
  const status: EventStatus = ev.status === "confirmed" ? "published" : ev.status;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(events)
      .set({
        isPublic: true,
        status,
        publishedAt: new Date(),
        scheduledPublishAt: null,
        sequence: ev.sequence + 1,
        version: ev.version + 1,
        updatedBy: actor?.id ?? ev.updatedBy,
        updatedAt: new Date(),
      })
      .where(and(eq(events.id, id), eq(events.version, ev.version)))
      .returning();
    if (!row) throw await conflictError(ev);
    await audit(
      { actor, action: "event.publish", entityType: "event", entityId: id, summary: `Published “${ev.title}” on the members calendar${actor ? "" : " (scheduled)"}` },
      tx,
    );
    return row;
  });
}

export async function unpublishEvent(actor: ActorUser, id: string, opts: MutationOptions = {}): Promise<EventRow> {
  if (!canPublish(actor)) throw new AppError("forbidden", "Only a Board Admin can unpublish events.");
  const { event: ev } = await loadEvent(id);
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== ev.version) throw await conflictError(ev);
  if (!ev.isPublic) return ev;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(events)
      .set({
        isPublic: false,
        status: ev.status === "published" ? "confirmed" : ev.status,
        sequence: ev.sequence + 1,
        version: ev.version + 1,
        updatedBy: actor.id,
        updatedAt: new Date(),
      })
      .where(and(eq(events.id, id), eq(events.version, ev.version)))
      .returning();
    if (!row) throw await conflictError(ev);
    await audit({ actor, action: "event.unpublish", entityType: "event", entityId: id, summary: `Removed “${ev.title}” from the members calendar` }, tx);
    return row;
  });
}

/** Publishes events whose scheduled publication time has passed. Safe to call often. */
export async function publishDueEvents(now = new Date()): Promise<number> {
  const due = await db
    .select({ id: events.id })
    .from(events)
    .where(and(lte(events.scheduledPublishAt, now), eq(events.isPublic, false), isNull(events.archivedAt)));
  let n = 0;
  for (const { id } of due) {
    try {
      await publishInternal(null, id);
      n++;
    } catch (e) {
      // Not publishable any more (e.g. date removed): drop the schedule. Anything else is retried next run.
      if (e instanceof AppError) await db.update(events).set({ scheduledPublishAt: null }).where(eq(events.id, id));
    }
  }
  return n;
}

/* ---------------------------------------------------------------- proposals */

export async function addProposal(
  actor: ActorUser,
  eventId: string,
  input: { startAt: Date; endAt: Date; note?: string },
  opts: MutationOptions = {},
) {
  const current = await loadEvent(eventId);
  assertEditable(actor, current);
  validateTimes(input.startAt, input.endAt);
  const r = await enforceRestrictions(actor, current.kind, input.startAt, input.endAt, opts.overrideReason);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(eventProposals)
      .values({ eventId, startAt: input.startAt, endAt: input.endAt, note: input.note ?? "", createdBy: actor.id })
      .returning();
    // An idea with candidate dates has become a proposal.
    if (current.event.status === "idea") {
      await tx.update(events).set({ status: "proposed", version: dsql`${events.version} + 1`, updatedAt: new Date(), updatedBy: actor.id }).where(eq(events.id, eventId));
    }
    await audit(
      { actor, action: "proposal.add", entityType: "event", entityId: eventId, summary: `Proposed a date for “${current.event.title}”`, changes: { proposal: [null, input.startAt.toISOString()] }, reason: r.override },
      tx,
    );
    return { proposal: row, warnings: r.warnings };
  });
}

export async function updateProposal(
  actor: ActorUser,
  proposalId: string,
  patch: { availability?: "unknown" | "available" | "unavailable"; note?: string },
) {
  const [p] = await db.select().from(eventProposals).where(eq(eventProposals.id, proposalId));
  if (!p) throw new AppError("not_found", "This proposed date no longer exists.");
  const current = await loadEvent(p.eventId);
  assertEditable(actor, current);
  const changes = diff(p as unknown as Record<string, unknown>, patch);
  if (!Object.keys(changes).length) return p;
  const [row] = await db.update(eventProposals).set(patch).where(eq(eventProposals.id, proposalId)).returning();
  await audit({ actor, action: "proposal.update", entityType: "event", entityId: p.eventId, summary: `Updated speaker availability for “${current.event.title}”`, changes });
  return row;
}

/** Withdraws a candidate date. The row is kept (state `declined`) for history. */
export async function declineProposal(actor: ActorUser, proposalId: string) {
  const [p] = await db.select().from(eventProposals).where(eq(eventProposals.id, proposalId));
  if (!p) throw new AppError("not_found", "This proposed date no longer exists.");
  const current = await loadEvent(p.eventId);
  assertEditable(actor, current);
  if (p.state !== "active") throw new AppError("invalid", "Only active proposals can be withdrawn.");
  await db.update(eventProposals).set({ state: "declined", resolvedAt: new Date() }).where(eq(eventProposals.id, proposalId));
  await audit({ actor, action: "proposal.decline", entityType: "event", entityId: p.eventId, summary: `Withdrew a proposed date for “${current.event.title}”` });
}

/**
 * Confirms one candidate date: it becomes the event's date, the event becomes
 * `confirmed`, and every other active proposal is released (kept for history).
 * Publication remains a separate step.
 */
export async function confirmProposal(actor: ActorUser, proposalId: string, opts: MutationOptions = {}): Promise<MutationResult> {
  const [p] = await db.select().from(eventProposals).where(eq(eventProposals.id, proposalId));
  if (!p) throw new AppError("not_found", "This proposed date no longer exists.");
  const current = await loadEvent(p.eventId);
  assertEditable(actor, current);
  const ev = current.event;
  if (ev.isPublic && !canPublish(actor)) throw new AppError("forbidden", MEMBERS_SEE);
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== ev.version) throw await conflictError(ev);
  if (p.state !== "active") throw new AppError("invalid", "This date is no longer an active proposal.");
  if (p.availability === "unavailable") {
    throw new AppError("invalid", "The speaker is marked unavailable on this date. Update the availability first.");
  }
  const r = await enforceRestrictions(actor, current.kind, p.startAt, p.endAt, opts.overrideReason);

  const updated = await db.transaction(async (tx) => {
    const now = new Date();
    await tx
      .update(eventProposals)
      .set({ state: "released", resolvedAt: now })
      .where(and(eq(eventProposals.eventId, ev.id), ne(eventProposals.id, p.id), inArray(eventProposals.state, ["active", "confirmed"])));
    await tx.update(eventProposals).set({ state: "confirmed", resolvedAt: now }).where(eq(eventProposals.id, p.id));
    const keepStatus = ev.isPublic && PUBLIC_STATUSES.includes(ev.status) && ev.status !== "postponed";
    const [row] = await tx
      .update(events)
      .set({
        startAt: p.startAt,
        endAt: p.endAt,
        allDay: false,
        status: keepStatus ? ev.status : ev.isPublic ? "published" : "confirmed",
        cancelledAt: null,
        overrideReason: r.override,
        overrideBy: r.override ? actor.id : null,
        sequence: ev.sequence + 1,
        version: ev.version + 1,
        updatedBy: actor.id,
        updatedAt: now,
      })
      .where(and(eq(events.id, ev.id), eq(events.version, ev.version)))
      .returning();
    if (!row) throw await conflictError(ev);
    await audit(
      {
        actor,
        action: "proposal.confirm",
        entityType: "event",
        entityId: ev.id,
        summary: `Confirmed the date of “${ev.title}”; other proposed dates were released`,
        changes: { startAt: [ev.startAt?.toISOString() ?? null, p.startAt.toISOString()], status: [ev.status, row.status] },
      },
      tx,
    );
    if (r.override) {
      await audit({ actor, action: "restriction.override", entityType: "event", entityId: ev.id, summary: `Confirmed “${ev.title}” inside a restricted period`, reason: r.override }, tx);
    }
    return row;
  });
  return { event: updated, warnings: r.warnings };
}

/* ------------------------------------------- duplicate / archive / delete */

export async function duplicateEvent(actor: ActorUser, id: string): Promise<EventRow> {
  const current = await loadEvent(id);
  if (!actor.active) throw new AppError("forbidden", "Your account is disabled.");
  const ev = current.event;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(events)
      .values({
        title: `${ev.title} (copy)`,
        description: ev.description,
        internalNotes: ev.internalNotes,
        categoryId: ev.categoryId,
        speakerId: ev.speakerId,
        status: "idea",
        allDay: ev.allDay,
        location: ev.location,
        onlineUrl: ev.onlineUrl,
        registrationUrl: "",
        color: ev.color,
        audience: ev.audience,
        createdBy: actor.id,
        updatedBy: actor.id,
      })
      .returning();
    await setOrganizers(tx, row.id, current.organizerIds.length ? current.organizerIds : [actor.id]);
    const srcTasks = await tx.select().from(tasks).where(eq(tasks.eventId, id));
    if (srcTasks.length) {
      await tx.insert(tasks).values(srcTasks.map((t) => ({ eventId: row.id, title: t.title, notes: t.notes, sortOrder: t.sortOrder, createdBy: actor.id })));
    }
    await audit({ actor, action: "event.duplicate", entityType: "event", entityId: row.id, summary: `Duplicated “${ev.title}” (date and publication are not copied)` }, tx);
    return row;
  });
}

export async function setArchived(actor: ActorUser, id: string, archived: boolean): Promise<EventRow> {
  if (!canArchiveEvent(actor)) throw new AppError("forbidden", "Only a Board Admin can archive events.");
  const { event: ev } = await loadEvent(id);
  const [row] = await db
    .update(events)
    .set({
      archivedAt: archived ? new Date() : null,
      // An archived event can never stay on the members calendar.
      isPublic: archived ? false : ev.isPublic,
      status: archived && ev.status === "published" ? "confirmed" : ev.status,
      sequence: archived && ev.isPublic ? ev.sequence + 1 : ev.sequence,
      version: ev.version + 1,
      updatedBy: actor.id,
      updatedAt: new Date(),
    })
    .where(eq(events.id, id))
    .returning();
  await audit({ actor, action: archived ? "event.archive" : "event.restore", entityType: "event", entityId: id, summary: `${archived ? "Archived" : "Restored"} “${ev.title}”` });
  return row;
}

export async function deleteEvent(actor: ActorUser, id: string) {
  if (!canDeleteEvent(actor)) throw new AppError("forbidden", "Only a Super Admin can permanently delete events. Archive it instead.");
  const { event: ev } = await loadEvent(id);
  await db.delete(events).where(eq(events.id, id));
  await audit({ actor, action: "event.delete", entityType: "event", entityId: id, summary: `Permanently deleted “${ev.title}”` });
}

/* ------------------------------------------------ comments & attachments */

export async function addComment(actor: ActorUser, eventId: string, body: string) {
  await loadEvent(eventId);
  if (!actor.active) throw new AppError("forbidden", "Your account is disabled.");
  const text = body.trim();
  if (!text) throw new AppError("invalid", "Write something first.");
  const [row] = await db.insert(comments).values({ eventId, userId: actor.id, body: text.slice(0, 4000) }).returning();
  return row;
}

export async function deleteComment(actor: ActorUser, commentId: string) {
  const [c] = await db.select().from(comments).where(eq(comments.id, commentId));
  if (!c) return;
  if (c.userId !== actor.id && !isAdmin(actor)) throw new AppError("forbidden", "You can only delete your own comments.");
  await db.delete(comments).where(eq(comments.id, commentId));
}

export function safeUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
  } catch {
    throw new AppError("invalid", `“${value}” is not a valid link.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new AppError("invalid", "Links must start with https://");
  return url.toString();
}

export async function addAttachment(actor: ActorUser, eventId: string, name: string, url: string) {
  const current = await loadEvent(eventId);
  assertEditable(actor, current);
  const link = safeUrl(url);
  if (!link) throw new AppError("invalid", "A link is required.");
  const [row] = await db.insert(attachments).values({ eventId, name: name.trim() || new URL(link).hostname, url: link, addedBy: actor.id }).returning();
  await audit({ actor, action: "attachment.add", entityType: "event", entityId: eventId, summary: `Attached “${row.name}” to “${current.event.title}”` });
  return row;
}

export async function removeAttachment(actor: ActorUser, attachmentId: string) {
  const [a] = await db.select().from(attachments).where(eq(attachments.id, attachmentId));
  if (!a) return;
  const current = await loadEvent(a.eventId);
  assertEditable(actor, current);
  await db.delete(attachments).where(eq(attachments.id, attachmentId));
  await audit({ actor, action: "attachment.remove", entityType: "event", entityId: a.eventId, summary: `Removed attachment “${a.name}”` });
}

/** Scheduled events that currently sit inside a hard-restricted window (e.g. after exam dates changed). */
export async function findRestrictedEvents() {
  const ctx = await loadPlanningContext();
  const rows = await db
    .select({ event: events, kind: categories.kind })
    .from(events)
    .innerJoin(categories, eq(categories.id, events.categoryId))
    .where(and(isNull(events.archivedAt), dsql`${events.startAt} is not null`, dsql`${events.status} not in ('cancelled','postponed','completed')`));
  const out: { event: EventRow; violations: Violation[] }[] = [];
  for (const r of rows) {
    const days = eventDays(r.event.startAt!, r.event.endAt);
    const hard = hardViolations(findViolations(ctx.windows, r.kind, days.start, days.end));
    if (hard.length) out.push({ event: r.event, violations: hard });
  }
  return out;
}

export { parisToInstant };
