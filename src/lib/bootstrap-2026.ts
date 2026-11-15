import "server-only";
import fs from "node:fs";
import path from "node:path";
import { and, eq, gte, inArray, lt, sql as dsql } from "drizzle-orm";
import { db } from "@/db";
import { academicEntries, academicImports, academicLayers, categories, events, importCandidates, speakers, users, type AcademicKind } from "@/db/schema";
import { approveCandidates, editCandidate, importCalendar, rejectCandidates } from "@/lib/academic/service";
import { audit } from "@/lib/audit";
import { createEvent } from "@/lib/events/service";
import { parisToInstant } from "@/lib/time";

/**
 * One-off content for the 2026–27 year, requested by the club's administrator
 * and applied once at deploy time (each part is skipped if already present):
 *
 *  1. the official academic calendars (BoE Y1/Y2 and AIDAMS Y1), from 1 November 2026;
 *  2. the first conference of the year.
 *
 * Calendar rows the extractor is confident about are approved automatically on
 * the administrator's instruction; rows it flagged as uncertain stay in the
 * review queue, and everything before November is set aside (not deleted).
 */

const FROM = "2026-11-01";
const MIN_CONFIDENCE = 75;
const CALENDARS = ["boe-y1-y2-2026-2027.pdf", "aidams-y1-2026-2027.pdf"];
const LUMA = "https://luma.com/embed/event/evt-5TKn85pTxdeOPPi/simple";

export async function runBootstrap2026(log: (m: string) => void = console.log) {
  const [admin] = await db.select().from(users).where(and(eq(users.role, "super_admin"), eq(users.active, true))).limit(1);
  if (!admin) return log("• 2026–27 content: waiting for the first Super Admin (will run at the next deploy).");
  const actor = { id: admin.id, name: admin.name, role: admin.role, active: true };

  /* ---- 1. academic calendars ---- */
  const [{ n: imports }] = await db.select({ n: dsql<number>`count(*)::int` }).from(academicImports);
  if (imports === 0) {
    for (const file of CALENDARS) {
      const bytes = new Uint8Array(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/academic", file)));
      const res = await importCalendar(actor, file, bytes);
      const sure = await db
        .select({ id: importCandidates.id })
        .from(importCandidates)
        .where(and(eq(importCandidates.importId, res.id), gte(importCandidates.startDate, FROM), gte(importCandidates.confidence, MIN_CONFIDENCE), dsql`${importCandidates.kind} <> 'other'`));
      const earlier = await db.select({ id: importCandidates.id }).from(importCandidates).where(and(eq(importCandidates.importId, res.id), lt(importCandidates.startDate, FROM)));
      const { approved } = await approveCandidates(actor, sure.map((c) => c.id));
      await rejectCandidates(actor, earlier.map((c) => c.id));
      await audit({
        actor: null,
        action: "academic.bootstrap",
        entityType: "academic_import",
        entityId: res.id,
        summary: `${file}: ${approved} periods from ${FROM} approved automatically at the administrator's request; ${earlier.length} earlier rows set aside; ${res.count - approved - earlier.length} uncertain rows left for review`,
      });
      log(`✓ ${file}: ${approved} periods approved, ${res.count - approved - earlier.length} left for review`);
    }
  }

  await reviewLeftovers2026(actor, log);

  /* ---- 2. first conference ---- */
  const existing = await db.select({ id: events.id }).from(events).where(inArray(events.embedUrl, [LUMA])).limit(1);
  if (existing.length === 0) {
    const [conference] = await db.select().from(categories).where(eq(categories.name, "Conference"));
    if (!conference) return log("• First conference skipped: no “Conference” category.");
    let [speaker] = await db.select().from(speakers).where(eq(speakers.name, "Philippe Heim"));
    if (!speaker) {
      [speaker] = await db
        .insert(speakers)
        .values({
          name: "Philippe Heim",
          organization: "Club Med",
          position: "Deputy CEO",
          bio: "Philippe Heim began his career at the French Ministry of the Economy and Finance before spending 14 years at Société Générale, where he held several senior positions, including Group CFO and Deputy CEO. He later served as CEO of La Banque Postale and Deputy CEO of La Poste, before joining Fosun International as Co-CFO. Since October 2026, he has been Deputy CEO of Club Med.",
          contactStatus: "accepted",
          ownerId: admin.id,
        })
        .returning();
    }
    const { event } = await createEvent(actor, {
      title: "Philippe Heim – Conference Q&A",
      categoryId: conference.id,
      speakerId: speaker.id,
      status: "confirmed",
      startAt: parisToInstant("2026-11-17", "19:00"),
      endAt: parisToInstant("2026-11-17", "20:30"),
      location: "Breguet — Amphi 270, CentraleSupélec",
      description:
        "The Bachelor Finance Club is delighted to welcome Philippe Heim, currently Deputy CEO of Club Med, for a conference on his career, leadership experience, and insights into the world of finance.\n\nThis conference will be an opportunity to explore his career choices, leadership experience, and the lessons he has learned along the way, while gaining valuable insights and practical advice on navigating the world of finance.\n\nThere will be a live Q&A session at the end of the conference, giving you the opportunity to ask your questions directly.",
      embedUrl: LUMA,
      featured: true,
      organizerIds: [admin.id],
    });
    log(`✓ Created “${event.title}” (confirmed, not published — publish it from its page)`);
  }
}

/**
 * The rows the extractor was unsure about, checked by eye against the two PDFs
 * (15 Nov 2026) at the administrator's request. Each item names the row as it
 * was extracted and what the document actually shows. Applied only to rows that
 * are still waiting for review, so a decision made by hand is never overwritten.
 */
type Fix = { layer: string; start: string; end: string; label: string; set?: { label?: string; kind?: AcademicKind } };
const REVIEWED: Fix[] = [
  // AIDAMS Y1 — the label of the week and the label of the next cell ran together.
  { layer: "aidams-y1", start: "2027-01-25", end: "2027-01-28", label: "S1W12 Climate Day &", set: { label: "S1W12", kind: "teaching" } },
  { layer: "aidams-y1", start: "2027-01-29", end: "2027-01-29", label: "Career", set: { label: "Climate Day & Career Workshop", kind: "school_event" } },
  // AIDAMS Y1 — semester-2 weeks: the document prints "S2" with no week number, on these exact days.
  ...["2027-02-08|2027-02-12", "2027-02-22|2027-02-26", "2027-03-01|2027-03-05", "2027-03-08|2027-03-12", "2027-03-15|2027-03-16", "2027-03-18|2027-03-19", "2027-03-30|2027-04-02", "2027-04-19|2027-04-23", "2027-04-26|2027-04-30", "2027-05-10|2027-05-14", "2027-05-18|2027-05-21", "2027-05-24|2027-05-28"].map((d) => {
    const [start, end] = d.split("|");
    return { layer: "aidams-y1", start, end, label: "S2" };
  }),
  // Printed with a question mark in the document; kept as printed.
  { layer: "aidams-y1", start: "2027-05-03", end: "2027-05-03", label: "S2?" },
  // One cell on Tue 4 May whose text is cut off after "Retour Learning"; Wed 5 May is an unlabelled cell in the teaching colour.
  { layer: "aidams-y1", start: "2027-05-04", end: "2027-05-04", label: "Retour", set: { label: "Retour Learning…", kind: "school_event" } },
  { layer: "aidams-y1", start: "2027-05-05", end: "2027-05-05", label: "Learning", set: { label: "S2", kind: "teaching" } },
  // BoE Y2 — single-day cell on Fri 20 Nov, text slightly clipped but complete.
  { layer: "boe-y2", start: "2026-11-20", end: "2026-11-20", label: "Robotics Bootcamp" },
];

async function reviewLeftovers2026(actor: Parameters<typeof approveCandidates>[0], log: (m: string) => void) {
  let approved = 0;
  for (const fix of REVIEWED) {
    const [c] = await db
      .select()
      .from(importCandidates)
      .where(and(eq(importCandidates.status, "pending"), eq(importCandidates.layerKey, fix.layer), eq(importCandidates.startDate, fix.start), eq(importCandidates.endDate, fix.end), eq(importCandidates.label, fix.label)));
    if (!c) continue;
    if (fix.set) await editCandidate(actor, c.id, fix.set);
    approved += (await approveCandidates(actor, [c.id])).approved;
  }

  // Two rows approved automatically earlier were wrong on a weekend edge.
  const [aidams] = await db.select().from(academicLayers).where(eq(academicLayers.key, "aidams-y1"));
  let corrected = 0;
  if (aidams) {
    // "Workshop" on Sat 30–Sun 31 Jan was only the overflowing end of "Climate Day & Career Workshop" (Fri 29 Jan).
    const gone = await db
      .delete(academicEntries)
      .where(and(eq(academicEntries.layerId, aidams.id), eq(academicEntries.label, "Workshop"), eq(academicEntries.startDate, "2027-01-30"), eq(academicEntries.endDate, "2027-01-31")))
      .returning();
    for (const g of gone) if (g.candidateId) await db.update(importCandidates).set({ status: "rejected" }).where(eq(importCandidates.id, g.candidateId));
    // Easter Monday is Mon 29 Mar only; the weekend before it had been joined to it.
    const moved = await db
      .update(academicEntries)
      .set({ startDate: "2027-03-29", updatedAt: new Date() })
      .where(and(eq(academicEntries.layerId, aidams.id), eq(academicEntries.label, "Public Holiday"), eq(academicEntries.startDate, "2027-03-27"), eq(academicEntries.endDate, "2027-03-29")))
      .returning();
    corrected = gone.length + moved.length;
  }

  if (approved || corrected) {
    await audit({
      actor: null,
      action: "academic.bootstrap",
      entityType: "academic_import",
      summary: `Calendar review at the administrator's request: ${approved} remaining rows checked against the PDF and approved, ${corrected} earlier rows corrected`,
    });
    log(`✓ Calendar review: ${approved} remaining rows approved, ${corrected} earlier rows corrected`);
  }
}
