import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { ensureBaseData } from "@/lib/bootstrap";
import { runBootstrap2026 } from "@/lib/bootstrap-2026";
import { makeUser, resetDb } from "./helpers";

const count = async (table: typeof s.academicImports | typeof s.academicEntries | typeof s.events | typeof s.speakers) => (await db.select().from(table as typeof s.events)).length;
const quiet = () => {};

beforeEach(async () => {
  await resetDb();
  await ensureBaseData();
});

describe("one-off 2026–27 content", () => {
  it("waits for the first Super Admin", async () => {
    await runBootstrap2026(quiet);
    expect(await count(s.academicImports)).toBe(0);
    expect(await count(s.events)).toBe(0);
  });

  it("runs once: a later deploy never brings back what an administrator deleted or changed", async () => {
    await makeUser("super_admin", "Sam Super");
    await runBootstrap2026(quiet);
    const entries = await count(s.academicEntries);
    expect(await count(s.academicImports)).toBe(2);
    expect(entries).toBeGreaterThan(100);
    const [event] = await db.select().from(s.events);
    expect(event).toMatchObject({ title: "Philippe Heim – Conference Q&A", status: "confirmed", isPublic: false, featured: true });

    // Same state again: nothing is duplicated.
    await runBootstrap2026(quiet);
    expect(await count(s.academicEntries)).toBe(entries);
    expect(await count(s.events)).toBe(1);

    // The administrator removes the imports, withdraws a period and deletes the conference.
    await db.delete(s.importCandidates);
    await db.delete(s.academicImports);
    const [gone] = await db.select().from(s.academicEntries).limit(1);
    await db.delete(s.academicEntries).where(eq(s.academicEntries.id, gone.id));
    await db.delete(s.events);
    await db.delete(s.speakers);

    await runBootstrap2026(quiet);
    expect(await count(s.academicImports)).toBe(0);
    expect(await count(s.academicEntries)).toBe(entries - 1);
    expect(await count(s.events)).toBe(0);
    expect(await count(s.speakers)).toBe(0);
  }, 120_000);

  it("recognises a site where the content was loaded before the marker existed", async () => {
    await makeUser("super_admin", "Sam Super");
    await runBootstrap2026(quiet);
    const entries = await count(s.academicEntries);
    // Older deployments have the audit trail but no marker.
    await db.delete(s.settings).where(eq(s.settings.key, "bootstrap2026"));
    await db.delete(s.importCandidates);
    await db.delete(s.academicImports);
    await db.delete(s.events);

    await runBootstrap2026(quiet);
    expect(await count(s.academicImports)).toBe(0);
    expect(await count(s.academicEntries)).toBe(entries);
    expect(await count(s.events)).toBe(0);
  }, 120_000);
});
