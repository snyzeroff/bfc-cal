import "server-only";
import { eq, sql as dsql } from "drizzle-orm";
import { db } from "@/db";
import { categories, restrictionRules, templates, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/crypto";

const DEFAULT_CATEGORIES = [
  { name: "Conference", kind: "conference", color: "#841E21", icon: "mic", sortOrder: 0 },
  { name: "Workshop", kind: "conference", color: "#B4532A", icon: "presentation", sortOrder: 1 },
  { name: "Networking", kind: "social", color: "#2F7D6B", icon: "users", sortOrder: 2 },
  { name: "Board meeting", kind: "meeting", color: "#3F5B8C", icon: "briefcase", sortOrder: 3 },
  { name: "Deadline", kind: "deadline", color: "#8A6A1F", icon: "flag", sortOrder: 4 },
  { name: "Other", kind: "other", color: "#5B6470", icon: "calendar", sortOrder: 5 },
] as const;

/**
 * Idempotent reference data every installation needs: categories, the built-in
 * Victoriales rule, sensible default warnings and (once) the first Super Admin.
 */
export async function ensureBaseData(admin?: { email: string; password: string; name: string }) {
  const [{ n: catCount }] = await db.select({ n: dsql<number>`count(*)::int` }).from(categories);
  if (catCount === 0) await db.insert(categories).values([...DEFAULT_CATEGORIES]);

  const [victoriales] = await db.select().from(restrictionRules).where(eq(restrictionRules.type, "victoriales"));
  if (!victoriales) {
    await db.insert(restrictionRules).values([
      {
        name: "Victoriales — 21 days before",
        type: "victoriales",
        severity: "hard",
        appliesTo: ["conference"],
        params: { daysBefore: 21 },
        builtin: true,
      },
      {
        name: "Exams and midterms",
        type: "academic_kind",
        severity: "soft",
        appliesTo: ["conference", "social"],
        params: { kinds: ["exam", "midterm"] },
        message: "",
      },
      {
        name: "Reading days",
        type: "academic_kind",
        severity: "soft",
        appliesTo: ["conference"],
        params: { kinds: ["reading"] },
      },
      {
        name: "Vacations and public holidays",
        type: "academic_kind",
        severity: "soft",
        appliesTo: ["conference", "social", "meeting"],
        params: { kinds: ["vacation", "holiday"] },
      },
    ]);
  }

  const [{ n: tplCount }] = await db.select({ n: dsql<number>`count(*)::int` }).from(templates);
  if (tplCount === 0) {
    const [conf] = await db.select().from(categories).where(eq(categories.kind, "conference")).limit(1);
    await db.insert(templates).values({
      name: "Evening conference with external speaker",
      data: {
        categoryId: conf?.id,
        durationMinutes: 90,
        startTime: "18:30",
        location: "",
        description: "",
        tasks: [
          { title: "Send formal invitation to the speaker", offsetDays: -35 },
          { title: "Book the room", offsetDays: -28 },
          { title: "Confirm logistics with the speaker (arrival, slides, AV)", offsetDays: -14 },
          { title: "Prepare visuals and announcement text", offsetDays: -12 },
          { title: "Publish the event and open registration", offsetDays: -10 },
          { title: "Send reminder to members", offsetDays: -2 },
          { title: "Thank-you message to the speaker", offsetDays: 1 },
        ],
      },
    });
  }

  if (admin) {
    const [{ n: userCount }] = await db.select({ n: dsql<number>`count(*)::int` }).from(users);
    if (userCount === 0) {
      await db.insert(users).values({
        email: admin.email.toLowerCase().trim(),
        name: admin.name,
        role: "super_admin",
        passwordHash: await hashPassword(admin.password),
      });
      return { createdAdmin: true };
    }
  }
  return { createdAdmin: false };
}
