import ICAL from "ical.js";
import { eq } from "drizzle-orm";
import { db, sql } from "@/db";
import * as s from "@/db/schema";
import { ensureBaseData } from "@/lib/bootstrap";
import type { ActorUser } from "@/lib/events/service";
import { writeSetting } from "@/lib/settings";

export async function resetDb() {
  await sql.unsafe(`TRUNCATE ${[
    "audit_log", "attachments", "comments", "tasks", "event_organizers", "event_proposals", "events", "speakers", "templates",
    "import_candidates", "academic_entries", "academic_imports", "academic_layers", "restriction_rules", "settings",
    "feed_tokens", "invite_tokens", "sessions", "login_attempts", "users", "categories",
  ].join(", ")} RESTART IDENTITY CASCADE`);
  await ensureBaseData();
}

export async function makeUser(role: s.Role, name: string = role): Promise<ActorUser & { email: string }> {
  const [u] = await db.insert(s.users).values({ email: `${name}-${Math.random().toString(36).slice(2, 8)}@test.dev`, name, role }).returning();
  return { id: u.id, name: u.name, role: u.role, active: u.active, email: u.email };
}

export async function category(name: string) {
  const [c] = await db.select().from(s.categories).where(eq(s.categories.name, name));
  return c;
}

export async function setVictoriales(date: string | null) {
  await writeSetting("victoriales", [{ id: "test", label: "Victoriales 2027", date, endDate: null }], null);
}

export type ParsedEvent = { uid: string; summary: string; status: string; sequence: number; start: string; end: string; description: string; isDate: boolean };

/** Parses a feed with an independent RFC 5545 implementation (ical.js). */
export function parseFeed(ics: string): { name: string; events: ParsedEvent[] } {
  const comp = new ICAL.Component(ICAL.parse(ics));
  return {
    name: String(comp.getFirstPropertyValue("x-wr-calname")),
    events: comp.getAllSubcomponents("vevent").map((v) => {
      const e = new ICAL.Event(v);
      return {
        uid: e.uid,
        summary: e.summary,
        status: String(v.getFirstPropertyValue("status")),
        sequence: e.sequence,
        start: e.startDate.toString(),
        end: e.endDate.toString(),
        description: e.description ?? "",
        isDate: e.startDate.isDate,
      };
    }),
  };
}
