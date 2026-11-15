import "server-only";
import { and, eq, isNull, sql as dsql } from "drizzle-orm";
import { db } from "@/db";
import { categories, eventProposals, events, importCandidates } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { loadPlanningContext } from "@/lib/planning";
import type { AssistantInput, Booking, SpeakerDay } from "@/lib/scheduling";
import { eachDay, eventDays, parisDay } from "@/lib/time";

/** Gathers everything recorded in the database that bears on scheduling one event. */
export async function buildAssistantInput(eventId: string, from: string, to: string, weekdays: number[]): Promise<AssistantInput & { pendingReview: number }> {
  const [row] = await db
    .select({ e: events, kind: categories.kind })
    .from(events)
    .innerJoin(categories, eq(categories.id, events.categoryId))
    .where(eq(events.id, eventId));
  if (!row) throw new AppError("not_found", "This event no longer exists.");

  const [ctx, others, proposals, [pending]] = await Promise.all([
    loadPlanningContext(),
    db
      .select({ e: events, kind: categories.kind })
      .from(events)
      .innerJoin(categories, eq(categories.id, events.categoryId))
      .where(and(isNull(events.archivedAt), dsql`${events.startAt} is not null`, dsql`${events.status} not in ('cancelled','postponed')`)),
    db
      .select({ p: eventProposals, title: events.title, kind: categories.kind })
      .from(eventProposals)
      .innerJoin(events, eq(events.id, eventProposals.eventId))
      .innerJoin(categories, eq(categories.id, events.categoryId))
      .where(and(eq(eventProposals.state, "active"), isNull(events.archivedAt))),
    // Imported dates nobody has reviewed yet are *not* used, but the assistant says so.
    db
      .select({ n: dsql<number>`count(*)::int` })
      .from(importCandidates)
      .where(and(eq(importCandidates.status, "pending"), dsql`${importCandidates.endDate} >= ${from}`, dsql`${importCandidates.startDate} <= ${to}`)),
  ]);

  const bookings: Booking[] = [];
  for (const o of others) {
    const d = eventDays(o.e.startAt!, o.e.endAt);
    const firm = ["confirmed", "published", "completed"].includes(o.e.status);
    for (const day of eachDay(d.start, d.end)) bookings.push({ id: o.e.id, eventId: o.e.id, title: o.e.title, day, kind: o.kind, firm });
  }
  const speaker: SpeakerDay[] = [];
  for (const { p, title, kind } of proposals) {
    if (p.eventId === eventId) speaker.push({ day: parisDay(p.startAt), availability: p.availability });
    else bookings.push({ id: p.id, eventId: p.eventId, title, day: parisDay(p.startAt), kind, firm: false });
  }

  return {
    from,
    to,
    kind: row.kind,
    audience: row.e.audience,
    weekdays,
    windows: ctx.windows,
    academic: ctx.academic,
    bookings,
    speaker,
    eventId,
    pendingReview: pending?.n ?? 0,
  };
}
