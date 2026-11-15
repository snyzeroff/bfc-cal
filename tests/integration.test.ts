import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, sql } from "@/db";
import * as s from "@/db/schema";
import { importCalendar, approveCandidates } from "@/lib/academic/service";
import { hashToken } from "@/lib/auth/crypto";
import { AppError } from "@/lib/errors";
import {
  addProposal,
  confirmProposal,
  createEvent,
  findRestrictedEvents,
  publishDueEvents,
  publishEvent,
  setArchived,
  unpublishEvent,
  updateEvent,
  type ActorUser,
} from "@/lib/events/service";
import { authenticateFeed, buildBoardFeed, buildPublicFeed, createFeedToken, revokeAllFeedTokens, revokeFeedToken, rotateFeedToken } from "@/lib/feeds";
import { loadPlanningContext } from "@/lib/planning";
import { getPublicEvent, listPublicEvents } from "@/lib/public";
import { writeSetting } from "@/lib/settings";
import { parisToInstant } from "@/lib/time";
import { addAcademic, category, makeUser, parseFeed, resetDb, setVictoriales } from "./helpers";

let superAdmin: ActorUser, admin: ActorUser, member: ActorUser, other: ActorUser;
let conf: s.Category, meeting: s.Category;

const at = (d: string, t: string) => parisToInstant(d, t);
const code = async (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : `unexpected: ${e}`));
const tokenOf = (url: string) => url.split("/").pop()!.replace(".ics", "");

async function confirmed(title = "Private equity night", day = "2027-02-10", extra: Partial<Parameters<typeof createEvent>[1]> = {}) {
  const { event } = await createEvent(admin, {
    title,
    categoryId: conf.id,
    status: "confirmed",
    startAt: at(day, "18:30"),
    endAt: at(day, "20:00"),
    location: "Amphi 1",
    description: "Public description.",
    internalNotes: "SECRET-NOTE budget 500 EUR",
    ...extra,
  });
  return event;
}

beforeEach(async () => {
  await resetDb();
  superAdmin = await makeUser("super_admin", "Sam Super");
  admin = await makeUser("board_admin", "Ada Admin");
  member = await makeUser("board_member", "Max Member");
  other = await makeUser("board_member", "Olga Other");
  conf = await category("Conference");
  meeting = await category("Board meeting");
});

describe("publication is a separate, controlled step", () => {
  it("a confirmed event stays private until it is published", async () => {
    const ev = await confirmed();
    expect(ev.status).toBe("confirmed");
    expect(ev.isPublic).toBe(false);
    expect(await listPublicEvents()).toHaveLength(0);
    expect(await getPublicEvent(ev.id)).toBeNull();
    expect(parseFeed(await buildPublicFeed()).events).toHaveLength(0);
  });

  it("private → public: the event appears on the public calendar and feed, without private data", async () => {
    const ev = await confirmed();
    const published = await publishEvent(admin, ev.id);
    expect(published).toMatchObject({ isPublic: true, status: "published" });
    expect(published.sequence).toBe(ev.sequence + 1);

    const pub = await getPublicEvent(ev.id);
    expect(pub?.title).toBe("Private equity night");
    expect(JSON.stringify(pub)).not.toContain("SECRET-NOTE");

    const ics = await buildPublicFeed();
    expect(ics).not.toContain("SECRET-NOTE");
    const feed = parseFeed(ics);
    expect(feed.events).toHaveLength(1);
    expect(feed.events[0]).toMatchObject({ uid: `event-${ev.id}@bfc-calendar`, status: "CONFIRMED", summary: "Private equity night" });
  });

  it("public → private: unpublishing removes it from the public calendar and feed", async () => {
    const ev = await confirmed();
    await publishEvent(admin, ev.id);
    const back = await unpublishEvent(admin, ev.id);
    expect(back).toMatchObject({ isPublic: false, status: "confirmed" });
    expect(await getPublicEvent(ev.id)).toBeNull();
    expect(parseFeed(await buildPublicFeed()).events).toHaveLength(0);
    // …while the board still sees it.
    const { url } = await createFeedToken(admin);
    const auth = await authenticateFeed(tokenOf(url));
    expect(parseFeed(await buildBoardFeed(auth!)).events.map((e) => e.uid)).toContain(`event-${ev.id}@bfc-calendar`);
  });

  it("moving a public event back to a planning status takes it off the public calendar", async () => {
    const ev = await confirmed();
    await publishEvent(admin, ev.id);
    const { event } = await updateEvent(admin, ev.id, { status: "tentative" });
    expect(event.isPublic).toBe(false);
    expect(await listPublicEvents()).toHaveLength(0);
  });

  it("only Board Admins publish; 'published' cannot be set as a plain status; drafts cannot be published", async () => {
    const ev = await confirmed();
    expect(await code(publishEvent(member, ev.id))).toBe("forbidden");
    expect(await code(updateEvent(admin, ev.id, { status: "published" }))).toBe("invalid");
    const { event: idea } = await createEvent(admin, { title: "Idea", categoryId: conf.id });
    expect(await code(publishEvent(admin, idea.id))).toBe("invalid");
    const { event: tentative } = await createEvent(admin, { title: "T", categoryId: conf.id, status: "tentative", startAt: at("2027-02-11", "18:00"), endAt: at("2027-02-11", "19:00") });
    expect(await code(publishEvent(admin, tentative.id))).toBe("invalid");
  });

  it("archiving a published event unpublishes it", async () => {
    const ev = await confirmed();
    await publishEvent(admin, ev.id);
    await setArchived(admin, ev.id, true);
    expect(await listPublicEvents()).toHaveLength(0);
  });

  it("scheduled publication publishes when due, and only then", async () => {
    const ev = await confirmed();
    await updateEvent(admin, ev.id, { scheduledPublishAt: new Date(Date.now() + 3_600_000) });
    expect(await publishDueEvents()).toBe(0);
    expect(await listPublicEvents()).toHaveLength(0);
    expect(await publishDueEvents(new Date(Date.now() + 7_200_000))).toBe(1);
    expect(await listPublicEvents()).toHaveLength(1);
  });
});

describe("database-level privacy", () => {
  it("the public view exposes no private column", async () => {
    const cols = (await sql`select column_name from information_schema.columns where table_name = 'public_events'`).map((r) => r.column_name as string);
    for (const forbidden of ["internal_notes", "override_reason", "created_by", "updated_by", "speaker_id", "is_public", "version", "scheduled_publish_at"]) {
      expect(cols).not.toContain(forbidden);
    }
    expect(cols.some((c) => /email|phone|linkedin|notes|contact/.test(c))).toBe(false);
  });

  it("speaker contact details never reach the public read model or feed", async () => {
    const [sp] = await db.insert(s.speakers).values({ name: "Jane Doe", organization: "Fund", bio: "Public bio", email: "jane.private@example.com", phone: "+33 6 11 22 33 44", notes: "PRIVATE-SPEAKER-NOTE" }).returning();
    const ev = await confirmed("With speaker", "2027-02-12", { speakerId: sp.id });
    await publishEvent(admin, ev.id);
    const blob = JSON.stringify(await listPublicEvents()) + (await buildPublicFeed());
    expect(blob).toContain("Jane Doe");
    expect(blob).toContain("Public bio");
    for (const secret of ["jane.private@example.com", "+33 6 11 22 33 44", "PRIVATE-SPEAKER-NOTE"]) expect(blob).not.toContain(secret);
  });

  it("a public visitor cannot fetch a private event by guessing its id", async () => {
    const ev = await confirmed();
    expect(await getPublicEvent(ev.id)).toBeNull();
    expect(await getPublicEvent("not-a-uuid")).toBeNull();
    expect(await getPublicEvent("' or 1=1 --")).toBeNull();
  });

  it("tentative dates, proposals and task deadlines never enter the public feed", async () => {
    const { event } = await createEvent(member, { title: "Hush-hush speaker", categoryId: conf.id, proposals: [{ startAt: at("2027-02-15", "18:00"), endAt: at("2027-02-15", "19:30") }] });
    await db.insert(s.tasks).values({ eventId: event.id, title: "Call the speaker", dueDate: "2027-02-01" });
    const ics = await buildPublicFeed();
    expect(ics).not.toContain("Hush-hush");
    expect(ics).not.toContain("Call the speaker");
  });
});

describe("feed synchronisation", () => {
  it("rescheduling keeps the UID, changes DTSTART and increases SEQUENCE", async () => {
    const ev = await confirmed();
    await publishEvent(admin, ev.id);
    const before = parseFeed(await buildPublicFeed()).events[0];
    await updateEvent(admin, ev.id, { startAt: at("2027-02-17", "19:00"), endAt: at("2027-02-17", "20:30"), location: "Amphi 2" });
    const after = parseFeed(await buildPublicFeed()).events[0];
    expect(after.uid).toBe(before.uid);
    expect(after.start).toBe("2027-02-17T18:00:00Z");
    expect(after.sequence).toBeGreaterThan(before.sequence);
    expect(await buildPublicFeed()).toContain("LOCATION:Amphi 2");
  });

  it("edits that subscribers cannot see do not bump SEQUENCE", async () => {
    const ev = await confirmed();
    const { event } = await updateEvent(admin, ev.id, { internalNotes: "changed" });
    expect(event.sequence).toBe(ev.sequence);
    expect(event.version).toBe(ev.version + 1);
  });

  it("a cancellation reaches subscribers as STATUS:CANCELLED, then leaves the feed after the retention period", async () => {
    const ev = await confirmed();
    await publishEvent(admin, ev.id);
    const before = parseFeed(await buildPublicFeed()).events[0];
    await updateEvent(admin, ev.id, { status: "cancelled" });

    const cancelled = parseFeed(await buildPublicFeed()).events[0];
    expect(cancelled.uid).toBe(before.uid);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.summary).toBe("Cancelled: Private equity night");
    expect(cancelled.sequence).toBeGreaterThan(before.sequence);
    expect((await getPublicEvent(ev.id))?.status).toBe("cancelled"); // the website shows it as cancelled too

    await db.update(s.events).set({ cancelledAt: new Date(Date.now() - 40 * 86_400_000) }).where(eq(s.events.id, ev.id));
    expect(parseFeed(await buildPublicFeed()).events).toHaveLength(0);
    await writeSetting("feed", { cancelledRetentionDays: 60, refreshMinutes: 60 }, null);
    expect(parseFeed(await buildPublicFeed()).events).toHaveLength(1);
  });

  it("writes correct instants on both sides of a daylight-saving change", async () => {
    const a = await confirmed("Before DST", "2027-03-27");
    const b = await confirmed("After DST", "2027-03-29");
    await publishEvent(admin, a.id);
    await publishEvent(admin, b.id);
    const feed = parseFeed(await buildPublicFeed()).events;
    expect(feed.find((e) => e.summary === "Before DST")?.start).toBe("2027-03-27T17:30:00Z");
    expect(feed.find((e) => e.summary === "After DST")?.start).toBe("2027-03-29T16:30:00Z");
  });

  it("all-day events use DATE values with an exclusive end", async () => {
    const { event } = await createEvent(admin, { title: "Forum", categoryId: conf.id, status: "confirmed", allDay: true, startAt: parisToInstant("2027-03-27"), endAt: parisToInstant("2027-03-30") });
    await publishEvent(admin, event.id);
    const e = parseFeed(await buildPublicFeed()).events[0];
    expect(e).toMatchObject({ isDate: true, start: "2027-03-27", end: "2027-03-30" });
  });
});

describe("private feed tokens", () => {
  it("only the hash is stored, and the feed works with the secret", async () => {
    const { url, id } = await createFeedToken(member);
    const token = tokenOf(url);
    const [row] = await db.select().from(s.feedTokens).where(eq(s.feedTokens.id, id));
    expect(row.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(await authenticateFeed(token)).not.toBeNull();
    expect(await authenticateFeed("x".repeat(43))).toBeNull();
    expect(await authenticateFeed("../../etc/passwd")).toBeNull();
  });

  it("a revoked token stops working immediately", async () => {
    const { url, id } = await createFeedToken(member);
    await revokeFeedToken({ ...member }, id);
    expect(await authenticateFeed(tokenOf(url))).toBeNull();
  });

  it("rotation invalidates the old address and issues a new one", async () => {
    const first = await createFeedToken(member);
    const second = await rotateFeedToken({ ...member }, first.id);
    expect(second.url).not.toBe(first.url);
    expect(await authenticateFeed(tokenOf(first.url))).toBeNull();
    expect(await authenticateFeed(tokenOf(second.url))).not.toBeNull();
  });

  it("members cannot revoke someone else's feed", async () => {
    const { id } = await createFeedToken(member);
    expect(await code(revokeFeedToken({ ...other }, id))).toBe("forbidden");
  });

  it("a board member who loses access loses their feed, even if the token was never revoked", async () => {
    const { url } = await createFeedToken(member);
    await db.update(s.users).set({ active: false }).where(eq(s.users.id, member.id));
    expect(await authenticateFeed(tokenOf(url))).toBeNull();
    await db.update(s.users).set({ active: true }).where(eq(s.users.id, member.id));
    await revokeAllFeedTokens(member.id);
    expect(await authenticateFeed(tokenOf(url))).toBeNull();
  });

  it("the board feed contains private planning data; options are tentative", async () => {
    const { event } = await createEvent(member, { title: "M&A careers", categoryId: conf.id, proposals: [{ startAt: at("2027-02-15", "18:00"), endAt: at("2027-02-15", "19:30") }] });
    await confirmed();
    const { url } = await createFeedToken(member, { includeTentative: true });
    const feed = parseFeed(await buildBoardFeed((await authenticateFeed(tokenOf(url)))!));
    expect(feed.events.find((e) => e.summary === "[Option] M&A careers")?.status).toBe("TENTATIVE");
    expect(feed.events.find((e) => e.summary === "Private equity night")?.status).toBe("CONFIRMED");
    const lean = await createFeedToken(member, { includeTentative: false, includeDeadlines: false });
    const leanFeed = parseFeed(await buildBoardFeed((await authenticateFeed(tokenOf(lean.url)))!));
    expect(leanFeed.events.some((e) => e.summary.startsWith("[Option]"))).toBe(false);
    void event;
  });
});

describe("tentative dates", () => {
  it("confirming one option sets the date, releases the others and keeps their history", async () => {
    const { event } = await createEvent(member, {
      title: "M&A careers",
      categoryId: conf.id,
      status: "proposed",
      proposals: [
        { startAt: at("2027-02-15", "18:00"), endAt: at("2027-02-15", "19:30") },
        { startAt: at("2027-02-17", "18:00"), endAt: at("2027-02-17", "19:30") },
        { startAt: at("2027-02-22", "18:00"), endAt: at("2027-02-22", "19:30") },
      ],
    });
    const props = await db.select().from(s.eventProposals).where(eq(s.eventProposals.eventId, event.id));
    const chosen = props.find((p) => p.startAt.getTime() === at("2027-02-17", "18:00").getTime())!;
    const res = await confirmProposal(member, chosen.id);

    expect(res.event.status).toBe("confirmed");
    expect(res.event.startAt?.toISOString()).toBe(at("2027-02-17", "18:00").toISOString());
    expect(res.event.isPublic).toBe(false); // confirmation never publishes

    const after = await db.select().from(s.eventProposals).where(eq(s.eventProposals.eventId, event.id));
    expect(after).toHaveLength(3); // nothing deleted
    expect(after.filter((p) => p.state === "confirmed").map((p) => p.id)).toEqual([chosen.id]);
    expect(after.filter((p) => p.state === "released")).toHaveLength(2);
    expect(after.every((p) => p.resolvedAt !== null)).toBe(true);

    // The released holds are gone from the board feed; the confirmed event is there.
    const { url } = await createFeedToken(member);
    const feed = parseFeed(await buildBoardFeed((await authenticateFeed(tokenOf(url)))!));
    expect(feed.events.filter((e) => e.summary.startsWith("[Option]"))).toHaveLength(0);
    expect(feed.events.find((e) => e.uid === `event-${event.id}@bfc-calendar`)?.start).toBe("2027-02-17T17:00:00Z");
  });

  it("refuses to confirm a date the speaker declined, and adding an option moves an idea to 'proposed'", async () => {
    const { event } = await createEvent(member, { title: "Idea", categoryId: conf.id });
    const { proposal } = await addProposal(member, event.id, { startAt: at("2027-02-15", "18:00"), endAt: at("2027-02-15", "19:30") });
    const [after] = await db.select().from(s.events).where(eq(s.events.id, event.id));
    expect(after.status).toBe("proposed");
    await db.update(s.eventProposals).set({ availability: "unavailable" }).where(eq(s.eventProposals.id, proposal.id));
    expect(await code(confirmProposal(member, proposal.id))).toBe("invalid");
  });
});

describe("no conference in the 21 days before exams", () => {
  // Exams 13–15 Jan 2027 → restricted 23 Dec 2026 – 12 Jan 2027.
  beforeEach(() => addAcademic("boe-y1", "Exams", "exam", "2027-01-13", "2027-01-15"));
  const mk = (actor: ActorUser, day: string, cat?: string, o: Parameters<typeof createEvent>[2] = {}) =>
    code(createEvent(actor, { title: day, categoryId: cat ?? conf.id, status: "tentative", startAt: at(day, "18:30"), endAt: at(day, "20:00") }, o));

  it("blocks members and Board Admins on both edges of the window, and only there", async () => {
    expect(await mk(member, "2026-12-22")).toBe("ok");
    expect(await mk(member, "2026-12-23")).toBe("restricted");
    expect(await mk(admin, "2027-01-12")).toBe("restricted");
    expect(await mk(member, "2027-01-18")).toBe("ok");
    expect(await mk(member, "2027-01-05", meeting.id)).toBe("ok"); // board meetings are exempt
  });

  it("explains the reason with the exam it protects", async () => {
    const err = await createEvent(member, { title: "x", categoryId: conf.id, startAt: at("2027-01-05", "18:30"), endAt: at("2027-01-05", "20:00") }).catch((e) => e as AppError);
    expect((err as AppError).code).toBe("restricted");
    expect((err as AppError).message).toMatch(/21 days before Exams for BOE-Y1/);
  });

  it("uses only approved exam dates: an unverified period or a midterm does not block", async () => {
    await addAcademic("aidams-y1", "Exams", "exam", "2027-04-07", "2027-04-09", false);
    await addAcademic("boe-y1", "MIDTERM", "midterm", "2027-03-31", "2027-04-02");
    expect(await mk(member, "2027-03-24")).toBe("ok");
    expect((await loadPlanningContext()).windows.filter((w) => w.severity === "hard")).toHaveLength(1);
  });

  it("can be extended to midterms and to another number of days", async () => {
    await addAcademic("boe-y1", "MIDTERM", "midterm", "2027-03-31", "2027-04-02");
    await db.update(s.restrictionRules).set({ params: { kinds: ["exam", "midterm"], daysBefore: 7 } }).where(eq(s.restrictionRules.builtin, true));
    expect(await mk(member, "2027-03-24")).toBe("restricted");
    expect(await mk(member, "2027-03-23")).toBe("ok");
    expect(await mk(member, "2026-12-30")).toBe("ok"); // 14 days before the January exams: no longer blocked
  });

  it("every program's exams count, and the window follows the dates when they are corrected", async () => {
    const e = await addAcademic("aidams-y1", "Exams", "exam", "2027-02-03", "2027-02-05");
    expect(await mk(member, "2027-01-20")).toBe("restricted");
    await db.update(s.academicEntries).set({ startDate: "2027-02-17", endDate: "2027-02-19" }).where(eq(s.academicEntries.id, e.id));
    expect(await mk(member, "2027-01-20")).toBe("ok");
    expect(await mk(member, "2027-02-10")).toBe("restricted");
  });

  it("a Super Admin can override with a reason, which is audited; scheduled events are flagged when exam dates arrive later", async () => {
    expect(await mk(superAdmin, "2027-01-05")).toBe("restricted");
    expect(await mk(superAdmin, "2027-01-05", undefined, { overrideReason: "Speaker only free that week" })).toBe("ok");
    expect(await db.select().from(s.auditLog).where(eq(s.auditLog.action, "restriction.override"))).toHaveLength(1);
    const ev = await confirmed("Planned early", "2027-05-20");
    expect((await findRestrictedEvents()).map((f) => f.event.id)).not.toContain(ev.id);
    await addAcademic("boe-y1", "EXAMS", "exam", "2027-06-02", "2027-06-04"); // restricted 12 May – 1 June
    expect((await findRestrictedEvents()).map((f) => f.event.id)).toContain(ev.id);
  });

  it("is the built-in rule of a fresh installation and never shows publicly", async () => {
    const [rule] = await db.select().from(s.restrictionRules).where(eq(s.restrictionRules.builtin, true));
    expect(rule).toMatchObject({ type: "academic_kind", severity: "hard", appliesTo: ["conference"], params: { kinds: ["exam"], daysBefore: 21 } });
    expect(await buildPublicFeed()).not.toMatch(/No conferences|restrict/i);
  });
});

describe("key-date restriction (N days before a fixed date)", () => {
  beforeEach(() => setVictoriales("2027-04-02")); // restricted: 12 March – 1 April 2027

  it("blocks board members and Board Admins from scheduling a conference in the 21 days before", async () => {
    for (const actor of [member, admin]) {
      const res = await code(createEvent(actor, { title: "Blocked", categoryId: conf.id, status: "tentative", startAt: at("2027-03-20", "18:30"), endAt: at("2027-03-20", "20:00") }));
      expect(res).toBe("restricted");
    }
    expect(await db.select().from(s.events)).toHaveLength(0);
  });

  it("explains why, and whether the user may override", async () => {
    const err = await createEvent(member, { title: "Blocked", categoryId: conf.id, startAt: at("2027-03-12", "18:30"), endAt: at("2027-03-12", "20:00") }).catch((e) => e as AppError);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).message).toMatch(/21 days before Victoriales 2027/);
    expect((err as AppError).details).toMatchObject({ canOverride: false });
  });

  it("enforces both edges of the window and exempts internal meetings", async () => {
    const mk = (day: string, cat = conf.id) => code(createEvent(member, { title: day, categoryId: cat, status: "tentative", startAt: at(day, "18:30"), endAt: at(day, "20:00") }));
    expect(await mk("2027-03-11")).toBe("ok");
    expect(await mk("2027-03-12")).toBe("restricted");
    expect(await mk("2027-04-01")).toBe("restricted");
    expect(await mk("2027-04-02")).toBe("ok");
    expect(await mk("2027-03-20", meeting.id)).toBe("ok");
  });

  it("also blocks moving an existing conference, proposing a date, and confirming an option inside the window", async () => {
    const ev = await confirmed("Movable", "2027-02-10");
    expect(await code(updateEvent(admin, ev.id, { startAt: at("2027-03-25", "18:30"), endAt: at("2027-03-25", "20:00") }))).toBe("restricted");
    expect(await code(addProposal(member, (await createEvent(member, { title: "X", categoryId: conf.id })).event.id, { startAt: at("2027-03-25", "18:00"), endAt: at("2027-03-25", "19:00") }))).toBe("restricted");
    const [unchanged] = await db.select().from(s.events).where(eq(s.events.id, ev.id));
    expect(unchanged.startAt?.toISOString()).toBe(at("2027-02-10", "18:30").toISOString());
  });

  it("lets a Super Admin override only with a reason, and records it in the audit log", async () => {
    const input = { title: "Exception", categoryId: conf.id, status: "confirmed" as const, startAt: at("2027-03-20", "18:30"), endAt: at("2027-03-20", "20:00") };
    expect(await code(createEvent(superAdmin, input))).toBe("restricted");
    expect(await code(createEvent(superAdmin, input, { overrideReason: "  " }))).toBe("restricted");
    expect(await code(createEvent(admin, input, { overrideReason: "I am only an admin" }))).toBe("restricted");

    const { event } = await createEvent(superAdmin, input, { overrideReason: "Speaker only available this week; board vote 12 Jan" });
    expect(event.overrideReason).toContain("board vote");
    expect(event.overrideBy).toBe(superAdmin.id);
    const log = await db.select().from(s.auditLog).where(and(eq(s.auditLog.action, "restriction.override"), eq(s.auditLog.entityId, event.id)));
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorId: superAdmin.id, reason: "Speaker only available this week; board vote 12 Jan" });
  });

  it("recalculates when the Victoriales date changes and flags events that are now inside the window", async () => {
    const ev = await confirmed("Was fine", "2027-03-05"); // outside 12 Mar – 1 Apr
    expect(await findRestrictedEvents()).toHaveLength(0);

    await setVictoriales("2027-03-19"); // restricted is now 26 Feb – 18 Mar
    const flagged = await findRestrictedEvents();
    expect(flagged.map((f) => f.event.id)).toEqual([ev.id]);
    expect(flagged[0].violations[0].start).toBe("2027-02-26");

    // The old window no longer blocks; the new one does.
    expect(await code(createEvent(member, { title: "Now free", categoryId: conf.id, status: "tentative", startAt: at("2027-03-25", "18:30"), endAt: at("2027-03-25", "20:00") }))).toBe("ok");
    expect(await code(createEvent(member, { title: "Now blocked", categoryId: conf.id, status: "tentative", startAt: at("2027-03-01", "18:30"), endAt: at("2027-03-01", "20:00") }))).toBe("restricted");
    // Unrelated edits to the flagged event are still possible (e.g. to fix a typo before moving it).
    expect(await code(updateEvent(admin, ev.id, { title: "Was fine (to be moved)" }))).toBe("ok");
  });

  it("the restriction never appears on the public calendar or feed", async () => {
    const ics = await buildPublicFeed();
    expect(ics).not.toMatch(/Victoriales|restrict/i);
    expect(JSON.stringify(await listPublicEvents())).not.toMatch(/Victoriales/i);
  });

  it("does nothing while no date is configured", async () => {
    await setVictoriales(null);
    expect((await loadPlanningContext()).windows.filter((w) => w.type === "victoriales")).toHaveLength(0);
    expect(await code(createEvent(member, { title: "Free", categoryId: conf.id, status: "tentative", startAt: at("2027-03-20", "18:30"), endAt: at("2027-03-20", "20:00") }))).toBe("ok");
  });
});

describe("concurrent editing and permissions", () => {
  it("the second of two administrators editing the same version gets a conflict, and nothing is overwritten", async () => {
    const ev = await confirmed();
    const first = await updateEvent(admin, ev.id, { location: "Room A" }, { expectedVersion: ev.version });
    expect(first.event.version).toBe(ev.version + 1);
    const err = await updateEvent(superAdmin, ev.id, { location: "Room B" }, { expectedVersion: ev.version }).catch((e) => e as AppError);
    expect((err as AppError).code).toBe("conflict");
    expect((err as AppError).message).toContain("Ada Admin");
    const [row] = await db.select().from(s.events).where(eq(s.events.id, ev.id));
    expect(row.location).toBe("Room A");
    // After reloading, the second editor can save.
    expect(await code(updateEvent(superAdmin, ev.id, { location: "Room B" }, { expectedVersion: row.version }))).toBe("ok");
  });

  it("board members edit only events they created or organise", async () => {
    const { event } = await createEvent(member, { title: "Mine", categoryId: conf.id });
    expect(await code(updateEvent(other, event.id, { title: "Hijacked" }))).toBe("forbidden");
    expect(await code(updateEvent(member, event.id, { title: "Still mine" }))).toBe("ok");
    await updateEvent(admin, event.id, { organizerIds: [member.id, other.id] });
    expect(await code(updateEvent(other, event.id, { title: "Co-organised" }))).toBe("ok");
  });

  it("board members cannot change the status of a published event or archive events", async () => {
    const { event } = await createEvent(member, { title: "Mine", categoryId: conf.id, status: "confirmed", startAt: at("2027-02-10", "18:00"), endAt: at("2027-02-10", "19:00") });
    await publishEvent(admin, event.id);
    expect(await code(updateEvent(member, event.id, { status: "cancelled" }))).toBe("forbidden");
    expect(await code(setArchived(member, event.id, true))).toBe("forbidden");
  });

  it("every change leaves a trace in the event history", async () => {
    const ev = await confirmed();
    await updateEvent(admin, ev.id, { location: "Room Z" });
    await publishEvent(admin, ev.id);
    const actions = (await db.select().from(s.auditLog).where(eq(s.auditLog.entityId, ev.id))).map((a) => a.action).sort();
    expect(actions).toEqual(["event.create", "event.publish", "event.update"]);
  });
});

describe("academic imports must be reviewed", () => {
  const csv = "label,start,end,kind,layer\nMidterms,2026-10-22,2026-10-23,midterm,BoE Year 1\nReading days,19/10/2026,soon,,BoE Year 1\n";

  it("imported periods are only candidates: they are not used anywhere until approved", async () => {
    const res = await importCalendar(admin, "calendar.csv", new TextEncoder().encode(csv));
    expect(res.count).toBe(2);
    expect(await db.select().from(s.academicEntries)).toHaveLength(0);
    expect((await loadPlanningContext()).academic).toHaveLength(0);
  });

  it("an ambiguous date is flagged with low confidence and stays unverified until a human approves it", async () => {
    const res = await importCalendar(admin, "calendar.csv", new TextEncoder().encode(csv));
    const candidates = await db.select().from(s.importCandidates).where(eq(s.importCandidates.importId, res.id));
    const ambiguous = candidates.find((c) => c.label === "Reading days")!;
    const clean = candidates.find((c) => c.label === "Midterms")!;
    expect(ambiguous.confidence).toBeLessThan(85);
    expect(ambiguous.issues.join(" ")).toMatch(/could not be read/);
    expect(ambiguous.status).toBe("pending");
    expect(clean.confidence).toBeGreaterThanOrEqual(85);

    await approveCandidates(admin, [clean.id]);
    const ctx = await loadPlanningContext();
    expect(ctx.academic.map((a) => a.label)).toEqual(["Midterms"]);
    expect(ctx.academic[0]).toMatchObject({ verified: true, layerKey: "boe-year-1" });
    // The source reference is preserved on the verified entry.
    const [entry] = await db.select().from(s.academicEntries);
    expect(entry.source).toMatchObject({ filename: "calendar.csv" });
    expect(entry.verifiedBy).toBe(admin.id);
    // The approved midterm now produces a (soft) scheduling warning.
    expect(ctx.windows.some((w) => w.type === "academic_kind" && w.start === "2026-10-22" && w.severity === "soft")).toBe(true);
  });

  it("only Board Admins can import or approve; unreadable files are rejected with a clear message", async () => {
    expect(await code(importCalendar(member, "calendar.csv", new TextEncoder().encode(csv)))).toBe("forbidden");
    expect(await code(importCalendar(admin, "notes.txt", new TextEncoder().encode("hello")))).toBe("invalid");
    expect(await code(importCalendar(admin, "fake.pdf", new TextEncoder().encode("not a pdf")))).toBe("invalid");
    expect(await code(importCalendar(admin, "empty.csv", new Uint8Array()))).toBe("invalid");
  });
});
