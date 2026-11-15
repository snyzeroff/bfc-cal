import "server-only";
import fs from "node:fs";
import path from "node:path";
import { and, eq, gte, inArray, lt, sql as dsql } from "drizzle-orm";
import { db } from "@/db";
import { academicImports, categories, events, importCandidates, speakers, users } from "@/db/schema";
import { approveCandidates, importCalendar, rejectCandidates } from "@/lib/academic/service";
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
