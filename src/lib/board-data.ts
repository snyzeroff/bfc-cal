import "server-only";
import { cache } from "react";
import { and, asc, desc, eq, inArray, isNull, sql as dsql } from "drizzle-orm";
import { db } from "@/db";
import { academicLayers, attachments, auditLog, categories, comments, eventOrganizers, eventProposals, events, speakers, tasks, templates, users } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { canEditEvent, isAdmin, isSuperAdmin } from "@/lib/permissions";
import { loadPlanningContext } from "@/lib/planning";
import { findViolations, hardViolations } from "@/lib/restrictions";
import { eventDays, instantToWall, todayParis } from "@/lib/time";
import type { BoardAcademic, BoardEvent, BoardTask, CalendarData, EventDetail, Me } from "./board-types";

export const toMe = (u: SessionUser): Me => ({ id: u.id, name: u.name, email: u.email, role: u.role, isAdmin: isAdmin(u), isSuperAdmin: isSuperAdmin(u) });

export const listUsers = cache(async () =>
  db.select({ id: users.id, name: users.name, role: users.role, active: users.active }).from(users).orderBy(asc(users.name)),
);

export async function loadTasks(): Promise<BoardTask[]> {
  const rows = await db
    .select({ t: tasks, eventTitle: events.title, archivedAt: events.archivedAt })
    .from(tasks)
    .leftJoin(events, eq(events.id, tasks.eventId))
    .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt));
  return rows
    .filter((r) => !r.archivedAt)
    .map(({ t, eventTitle }) => ({
      id: t.id,
      title: t.title,
      notes: t.notes,
      dueDate: t.dueDate,
      eventId: t.eventId,
      eventTitle,
      assigneeId: t.assigneeId,
      createdBy: t.createdBy,
      done: !!t.doneAt,
      doneAt: t.doneAt?.toISOString() ?? null,
    }));
}

/** Everything the board calendar, pipeline and dashboard need, in one round of queries. */
/** One load per request and variant, however many components ask (the session user is the same object throughout a request). */
export const loadCalendarData = (user: SessionUser, opts: { includeArchived?: boolean } = {}) => calendarData(user, !!opts.includeArchived);

const calendarData = cache(async (user: SessionUser, includeArchived: boolean): Promise<CalendarData> => {
  const opts = { includeArchived };
  const [ctx, eventRows, orgRows, proposalRows, taskRows, layerRows, categoryRows, userRows, speakerRows, templateRows] = await Promise.all([
    loadPlanningContext(),
    db
      .select({ e: events, c: categories, speakerName: speakers.name, speakerOrg: speakers.organization })
      .from(events)
      .innerJoin(categories, eq(categories.id, events.categoryId))
      .leftJoin(speakers, eq(speakers.id, events.speakerId))
      .where(opts.includeArchived ? undefined : isNull(events.archivedAt))
      .orderBy(asc(events.startAt), desc(events.updatedAt)),
    db.select().from(eventOrganizers),
    db
      .select({ p: eventProposals, title: events.title, color: events.color, catColor: categories.color, archivedAt: events.archivedAt })
      .from(eventProposals)
      .innerJoin(events, eq(events.id, eventProposals.eventId))
      .innerJoin(categories, eq(categories.id, events.categoryId))
      .where(inArray(eventProposals.state, ["active"]))
      .orderBy(asc(eventProposals.startAt)),
    loadTasks(),
    db.select().from(academicLayers).orderBy(asc(academicLayers.sortOrder), asc(academicLayers.name)),
    db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name)),
    listUsers(),
    db.select({ id: speakers.id, name: speakers.name, organization: speakers.organization }).from(speakers).where(eq(speakers.archived, false)).orderBy(asc(speakers.name)),
    db.select().from(templates).orderBy(asc(templates.name)),
  ]);

  const organizers = new Map<string, string[]>();
  for (const o of orgRows) organizers.set(o.eventId, [...(organizers.get(o.eventId) ?? []), o.userId]);
  const taskStats = new Map<string, { open: number; total: number }>();
  for (const t of taskRows) {
    if (!t.eventId) continue;
    const s = taskStats.get(t.eventId) ?? { open: 0, total: 0 };
    s.total++;
    if (!t.done) s.open++;
    taskStats.set(t.eventId, s);
  }
  const proposalCount = new Map<string, number>();
  for (const { p } of proposalRows) proposalCount.set(p.eventId, (proposalCount.get(p.eventId) ?? 0) + 1);

  const eventsOut: BoardEvent[] = eventRows.map(({ e, c, speakerName, speakerOrg }) => {
    const organizerIds = organizers.get(e.id) ?? [];
    let violation: string | null = null;
    if (e.startAt && !["cancelled", "postponed", "completed"].includes(e.status)) {
      const d = eventDays(e.startAt, e.endAt);
      violation = hardViolations(findViolations(ctx.windows, c.kind, d.start, d.end))[0]?.message ?? null;
    }
    const stats = taskStats.get(e.id);
    return {
      id: e.id,
      title: e.title,
      status: e.status,
      isPublic: e.isPublic,
      start: e.startAt ? instantToWall(e.startAt) : null,
      end: e.endAt ? instantToWall(e.endAt) : null,
      allDay: e.allDay,
      categoryId: e.categoryId,
      categoryName: c.name,
      kind: c.kind,
      color: e.color ?? c.color,
      speakerId: e.speakerId,
      speakerName,
      speakerOrg,
      location: e.location,
      audience: e.audience,
      organizerIds,
      createdBy: e.createdBy,
      version: e.version,
      canEdit: canEditEvent(user, { createdBy: e.createdBy, organizerIds }),
      archived: !!e.archivedAt,
      overrideReason: e.overrideReason,
      violation,
      openTasks: stats?.open ?? 0,
      totalTasks: stats?.total ?? 0,
      activeProposals: proposalCount.get(e.id) ?? 0,
      updatedAt: e.updatedAt.toISOString(),
      scheduledPublishAt: e.scheduledPublishAt ? instantToWall(e.scheduledPublishAt) : null,
    };
  });

  return {
    me: toMe(user),
    events: eventsOut,
    proposals: proposalRows
      .filter((r) => !r.archivedAt)
      .map(({ p, title, color, catColor }) => ({
        id: p.id,
        eventId: p.eventId,
        eventTitle: title,
        start: instantToWall(p.startAt),
        end: instantToWall(p.endAt),
        state: p.state,
        availability: p.availability,
        note: p.note,
        color: color ?? catColor,
      })),
    tasks: taskRows,
    layers: layerRows.map((l) => ({ id: l.id, key: l.key, name: l.name, program: l.program, yearGroup: l.yearGroup, color: l.color, visibleByDefault: l.visibleByDefault })),
    academic: ctx.academic.map((a) => ({ id: a.id, layerId: a.layerId, layerKey: a.layerKey, label: a.label, kind: a.kind as BoardAcademic["kind"], start: a.startDate, end: a.endDate })),
    windows: ctx.windows.map((w, i) => ({ key: `${w.ruleId}-${w.start}-${i}`, ruleId: w.ruleId, type: w.type, severity: w.severity, appliesTo: w.appliesTo, start: w.start, end: w.end, title: w.title, message: w.message })),
    categories: categoryRows.map((c) => ({ id: c.id, name: c.name, kind: c.kind, color: c.color, icon: c.icon, archived: c.archived })),
    users: userRows,
    speakers: speakerRows,
    templates: templateRows.map((t) => ({ id: t.id, name: t.name, categoryId: t.data.categoryId ?? null, startTime: t.data.startTime, durationMinutes: t.data.durationMinutes, taskCount: t.data.tasks.length })),
    today: todayParis(),
  };
});

export async function countPendingCandidates(): Promise<number> {
  const [{ n }] = await db.execute<{ n: number }>(dsql`select count(*)::int as n from import_candidates where status = 'pending'`);
  return n;
}


/** Cached per request: the page and its metadata both need it. */
export const loadEventDetail = cache(async (user: SessionUser, id: string): Promise<EventDetail | null> => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const data = await loadCalendarData(user, { includeArchived: true });
  const base = data.events.find((e) => e.id === id);
  if (!base) return null;
  const [[row], proposalRows, commentRows, attachmentRows, history] = await Promise.all([
    db
      .select({ e: events, catColor: categories.color, position: speakers.position, bio: speakers.bio })
      .from(events)
      .innerJoin(categories, eq(categories.id, events.categoryId))
      .leftJoin(speakers, eq(speakers.id, events.speakerId))
      .where(eq(events.id, id)),
    db.select().from(eventProposals).where(eq(eventProposals.eventId, id)).orderBy(asc(eventProposals.startAt)),
    db.select({ c: comments, name: users.name }).from(comments).leftJoin(users, eq(users.id, comments.userId)).where(eq(comments.eventId, id)).orderBy(asc(comments.createdAt)),
    db.select({ a: attachments, name: users.name }).from(attachments).leftJoin(users, eq(users.id, attachments.addedBy)).where(eq(attachments.eventId, id)).orderBy(asc(attachments.createdAt)),
    db.select().from(auditLog).where(and(eq(auditLog.entityType, "event"), eq(auditLog.entityId, id))).orderBy(desc(auditLog.at)).limit(100),
  ]);
  const nameOf = (uid: string | null) => data.users.find((u) => u.id === uid)?.name ?? null;
  return {
    event: {
      ...base,
      description: row.e.description,
      internalNotes: row.e.internalNotes,
      onlineUrl: row.e.onlineUrl,
      registrationUrl: row.e.registrationUrl,
      embedUrl: row.e.embedUrl,
      featured: row.e.featured,
      customColor: row.e.color,
      categoryColor: row.catColor,
      publishedAt: row.e.publishedAt?.toISOString() ?? null,
      createdAt: row.e.createdAt.toISOString(),
      createdByName: nameOf(row.e.createdBy),
      updatedByName: nameOf(row.e.updatedBy),
      speakerPosition: row.position,
      speakerBio: row.bio,
    },
    proposals: proposalRows.map((p) => ({
      id: p.id,
      eventId: p.eventId,
      eventTitle: base.title,
      start: instantToWall(p.startAt),
      end: instantToWall(p.endAt),
      state: p.state,
      availability: p.availability,
      note: p.note,
      color: base.color,
      resolvedAt: p.resolvedAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
    })),
    tasks: data.tasks.filter((t) => t.eventId === id),
    comments: commentRows.map(({ c, name }) => ({ id: c.id, body: c.body, userId: c.userId, userName: name ?? "Former member", createdAt: c.createdAt.toISOString() })),
    attachments: attachmentRows.map(({ a, name }) => ({ id: a.id, name: a.name, url: a.url, addedByName: name })),
    history: history.map((h) => ({ id: h.id, action: h.action, summary: h.summary, actorName: h.actorName, at: h.at.toISOString(), reason: h.reason, changes: h.changes })),
  };
});
