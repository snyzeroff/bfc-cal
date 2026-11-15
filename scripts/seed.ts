/**
 * npm run db:seed          → reference data + first Super Admin (idempotent)
 * npm run db:demo          → the above plus sample people, speakers and events
 *
 * Demo data never invents academic dates or the Victoriales date: those must
 * come from an imported calendar and from an administrator.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

async function main() {
  const { ensureBaseData } = await import("../src/lib/bootstrap");
  const { db, sql } = await import("../src/db");
  const s = await import("../src/db/schema");
  const { hashPassword } = await import("../src/lib/auth/crypto");
  const { parisToInstant, addDays, todayParis } = await import("../src/lib/time");

  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (process.argv.includes("--base-only") || !email || !password) {
    // Deploy builds: make sure categories, rules and templates exist. The first
    // Super Admin is then created from the /setup page.
    if (!process.argv.includes("--base-only")) console.log("• SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set: no admin created (use the /setup page).");
    await ensureBaseData();
    console.log("✓ Reference data present");
  } else {
    if (password.length < 10) throw new Error("SEED_ADMIN_PASSWORD must be at least 10 characters.");
    const res = await ensureBaseData({ email, password, name: process.env.SEED_ADMIN_NAME ?? "Admin" });
    console.log(res.createdAdmin ? `✓ Created Super Admin ${email}` : "✓ Reference data present (existing users untouched)");
  }

  if (process.argv.includes("--demo")) {
    const existing = await db.select().from(s.events).limit(1);
    if (existing.length) {
      console.log("• Demo data skipped: events already exist.");
    } else {
      const pw = await hashPassword("bfc-demo-password-1");
      const people = await db
        .insert(s.users)
        .values([
          { email: "camille@bfc.test", name: "Camille Roux", role: "board_admin", passwordHash: pw },
          { email: "noah@bfc.test", name: "Noah Lambert", role: "board_member", passwordHash: pw },
          { email: "ines@bfc.test", name: "Inès Marchand", role: "board_member", passwordHash: pw },
        ])
        .onConflictDoNothing()
        .returning();
      const [admin] = await db.select().from(s.users).limit(1);
      const cats = await db.select().from(s.categories);
      const cat = (k: string) => cats.find((c) => c.name === k)!.id;
      const [camille, noah, ines] = people;
      const sp = await db
        .insert(s.speakers)
        .values([
          { name: "Élise Fontaine", organization: "Private equity fund (sample)", position: "Managing Director", bio: "Sample speaker profile for the demo data set.", contactStatus: "accepted", ownerId: camille?.id, email: "elise@example.com" },
          { name: "Marc Delattre", organization: "Investment bank (sample)", position: "VP, M&A", bio: "Sample speaker profile for the demo data set.", contactStatus: "in_discussion", ownerId: noah?.id, email: "marc@example.com", phone: "+33 6 00 00 00 00", notes: "Prefers evenings. Introduced by an alumnus." },
          { name: "Sofia Benali", organization: "Fintech start-up (sample)", position: "Co-founder & CFO", contactStatus: "to_contact", ownerId: ines?.id },
          { name: "Thomas Girard", organization: "Asset manager (sample)", position: "Portfolio Manager", contactStatus: "prospect" },
        ])
        .returning();
      const day = (n: number) => addDays(todayParis(), n);
      const at = (n: number, t: string) => parisToInstant(day(n), t);
      const mk = async (v: Partial<typeof s.events.$inferInsert> & { title: string; categoryId: string }, organizers: (string | undefined)[] = []) => {
        const [e] = await db.insert(s.events).values({ createdBy: admin.id, updatedBy: admin.id, ...v }).returning();
        const ids = organizers.filter(Boolean) as string[];
        if (ids.length) await db.insert(s.eventOrganizers).values(ids.map((userId) => ({ eventId: e.id, userId })));
        return e;
      };
      const pe = await mk({ title: "Inside private equity: how a deal really gets done", categoryId: cat("Conference"), speakerId: sp[0].id, status: "published", isPublic: true, publishedAt: new Date(), startAt: at(9, "18:30"), endAt: at(9, "20:00"), location: "Amphi Michelin, Bâtiment Eiffel", description: "An evening with a private equity investor: sourcing, due diligence and what happens after the signing.\n\nOpen to all bachelor students. Q&A and networking afterwards.", registrationUrl: "https://example.com/register" }, [camille?.id, noah?.id]);
      const ma = await mk({ title: "M&A careers — what the first three years look like", categoryId: cat("Conference"), speakerId: sp[1].id, status: "awaiting_confirmation", internalNotes: "Marc is checking with his team which week works." }, [noah?.id]);
      await db.insert(s.eventProposals).values([
        { eventId: ma.id, startAt: at(23, "18:30"), endAt: at(23, "20:00"), availability: "available", note: "Marc's first choice" },
        { eventId: ma.id, startAt: at(25, "18:30"), endAt: at(25, "20:00"), availability: "unknown" },
        { eventId: ma.id, startAt: at(30, "19:00"), endAt: at(30, "20:30"), availability: "unavailable", note: "Travelling" },
      ]);
      await mk({ title: "Fintech founders panel", categoryId: cat("Conference"), speakerId: sp[2].id, status: "idea", internalNotes: "Could pair with another founder for a panel format." }, [ines?.id]);
      await mk({ title: "Excel & valuation workshop", categoryId: cat("Workshop"), status: "confirmed", startAt: at(16, "17:00"), endAt: at(16, "19:00"), location: "Room EB.112" }, [ines?.id]);
      await mk({ title: "Board meeting", categoryId: cat("Board meeting"), status: "confirmed", startAt: at(2, "12:30"), endAt: at(2, "13:30"), location: "Club room" }, [camille?.id]);
      await mk({ title: "Asset management in a high-rate world", categoryId: cat("Conference"), speakerId: sp[3].id, status: "tentative", startAt: at(37, "18:30"), endAt: at(37, "20:00") }, [camille?.id]);
      await db.insert(s.tasks).values([
        { eventId: pe.id, title: "Book the amphitheatre", dueDate: day(-6), doneAt: new Date(), assigneeId: camille?.id, createdBy: admin.id },
        { eventId: pe.id, title: "Publish the announcement on Instagram", dueDate: day(2), assigneeId: noah?.id, createdBy: admin.id },
        { eventId: pe.id, title: "Send reminder to members", dueDate: day(7), assigneeId: ines?.id, createdBy: admin.id },
        { eventId: ma.id, title: "Follow up with Marc on the date", dueDate: day(1), assigneeId: noah?.id, createdBy: admin.id },
        { title: "Renew the club's room-booking authorisation", dueDate: day(12), assigneeId: admin.id, createdBy: admin.id },
      ]);
      await db.insert(s.comments).values({ eventId: ma.id, userId: noah?.id ?? admin.id, body: "Marc replied: the 23rd works best, he will confirm by Friday." });
      console.log("✓ Demo data created (demo accounts use the password “bfc-demo-password-1”)");
    }
  }
  await sql.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
