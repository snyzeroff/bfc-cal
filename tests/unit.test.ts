import { describe, expect, it } from "vitest";
import ICAL from "ical.js";
import { buildCalendar, escapeText, foldLine, formatUtc } from "@/lib/ics";
import { canEditEvent, canOverrideRestriction, canPublish } from "@/lib/permissions";
import { computeWindows, findViolations, victorialesWindow, type RuleInput } from "@/lib/restrictions";
import { assessDay, suggestSlots, type AssistantInput } from "@/lib/scheduling";
import { addDays, diffDays, eventDays, formatRange, instantToWall, parisDay, parisToInstant, wallToInstant } from "@/lib/time";

describe("time — Europe/Paris and daylight saving", () => {
  it("converts winter and summer wall-clock times to the right instants", () => {
    expect(parisToInstant("2027-01-20", "18:30").toISOString()).toBe("2027-01-20T17:30:00.000Z"); // CET, UTC+1
    expect(parisToInstant("2027-06-10", "18:30").toISOString()).toBe("2027-06-10T16:30:00.000Z"); // CEST, UTC+2
  });

  it("handles the days around the spring-forward transition (28 March 2027)", () => {
    expect(parisToInstant("2027-03-27", "18:30").toISOString()).toBe("2027-03-27T17:30:00.000Z");
    expect(parisToInstant("2027-03-28", "18:30").toISOString()).toBe("2027-03-28T16:30:00.000Z");
    // The day is 23 hours long, yet it is still exactly one calendar day.
    const start = parisToInstant("2027-03-28");
    const end = parisToInstant("2027-03-29");
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);
    expect(eventDays(start, end)).toEqual({ start: "2027-03-28", end: "2027-03-28" });
  });

  it("handles the fall-back transition (31 October 2027)", () => {
    expect(parisToInstant("2027-10-30", "18:30").toISOString()).toBe("2027-10-30T16:30:00.000Z");
    expect(parisToInstant("2027-10-31", "18:30").toISOString()).toBe("2027-10-31T17:30:00.000Z");
    const start = parisToInstant("2027-10-31");
    expect((parisToInstant("2027-11-01").getTime() - start.getTime()) / 3_600_000).toBe(25);
  });

  it("round-trips wall strings and finds the Paris day of late-evening instants", () => {
    expect(instantToWall(wallToInstant("2027-03-28T18:30"))).toBe("2027-03-28T18:30");
    expect(parisDay(new Date("2027-06-10T22:30:00Z"))).toBe("2027-06-11"); // 00:30 in Paris
    expect(formatRange(parisToInstant("2027-06-10", "18:30"), parisToInstant("2027-06-10", "20:00"))).toContain("18:30 – 20:00");
  });

  it("does calendar-day arithmetic without time zones", () => {
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(diffDays("2027-03-27", "2027-03-29")).toBe(2);
  });
});

describe("restriction engine", () => {
  const victoriales: RuleInput = { id: "v", name: "Victoriales", type: "victoriales", severity: "hard", appliesTo: ["conference"], params: { daysBefore: 21 }, message: "", active: true };

  it("restricts exactly the 21 calendar days immediately preceding the Victoriales", () => {
    const w = victorialesWindow("2027-04-02");
    expect(w).toEqual({ start: "2027-03-12", end: "2027-04-01" });
    expect(diffDays(w.start, w.end) + 1).toBe(21);
  });

  it("blocks conferences inside the window and nothing outside it", () => {
    const windows = computeWindows([victoriales], { victoriales: [{ id: "a", label: "Victoriales 2027", date: "2027-04-02" }], academic: [] });
    const hit = (d: string, kind = "conference") => findViolations(windows, kind, d).length;
    expect(hit("2027-03-11")).toBe(0);
    expect(hit("2027-03-12")).toBe(1);
    expect(hit("2027-04-01")).toBe(1);
    expect(hit("2027-04-02")).toBe(0); // the Victoriales day itself is not part of the "preceding" period
    expect(hit("2027-03-20", "meeting")).toBe(0); // internal meetings are exempt
  });

  it("produces no restriction while the date is not configured", () => {
    expect(computeWindows([victoriales], { victoriales: [{ id: "a", label: "V", date: null }], academic: [] })).toEqual([]);
  });

  it("never enforces unverified academic periods", () => {
    const rule: RuleInput = { id: "x", name: "Exams", type: "academic_kind", severity: "hard", appliesTo: ["conference"], params: { kinds: ["exam"] }, message: "", active: true };
    const entry = { label: "Exams", kind: "exam", startDate: "2027-01-12", endDate: "2027-01-15", layerKey: "boe-y1", layerName: "BoE Year 1" };
    expect(computeWindows([rule], { victoriales: [], academic: [{ ...entry, verified: false }] })).toHaveLength(0);
    expect(computeWindows([rule], { victoriales: [], academic: [{ ...entry, verified: true }] })).toHaveLength(1);
  });

  it("ignores inactive rules and supports multi-day spans", () => {
    const range: RuleInput = { id: "r", name: "Integration week", type: "date_range", severity: "soft", appliesTo: ["conference"], params: { startDate: "2026-09-07", endDate: "2026-09-11" }, message: "", active: true };
    const windows = computeWindows([range, { ...victoriales, active: false }], { victoriales: [{ id: "a", label: "V", date: "2027-04-02" }], academic: [] });
    expect(windows).toHaveLength(1);
    expect(findViolations(windows, "conference", "2026-09-05", "2026-09-07")).toHaveLength(1);
    expect(findViolations(windows, "conference", "2026-09-12", "2026-09-13")).toHaveLength(0);
  });
});

describe("scheduling assistant", () => {
  const base: AssistantInput = {
    from: "2027-03-01", to: "2027-03-12", kind: "conference", audience: [], weekdays: [1, 2, 3, 4, 5],
    windows: computeWindows([{ id: "v", name: "V", type: "victoriales", severity: "hard", appliesTo: ["conference"], params: {}, message: "", active: true }], { victoriales: [{ id: "a", label: "Victoriales", date: "2027-03-30" }], academic: [] }),
    academic: [
      { label: "S2 W5", kind: "teaching", startDate: "2027-03-01", endDate: "2027-03-05", layerKey: "boe-y1", layerName: "BoE Year 1", verified: true },
      { label: "Midterm", kind: "midterm", startDate: "2027-03-04", endDate: "2027-03-05", layerKey: "boe-y1", layerName: "BoE Year 1", verified: true },
    ],
    bookings: [{ id: "b", eventId: "other", title: "Other conference", day: "2027-03-03", kind: "conference", firm: true }],
    speaker: [{ day: "2027-03-02", availability: "available" }, { day: "2027-03-01", availability: "unavailable" }],
  };

  it("classifies days and never mistakes missing data for availability", () => {
    expect(assessDay("2027-03-02", base)).toMatchObject({ status: "available", speaker: "confirmed" });
    expect(assessDay("2027-03-01", base)).toMatchObject({ status: "unavailable", speaker: "unavailable" });
    expect(assessDay("2027-03-03", base).status).toBe("unavailable"); // another confirmed conference
    expect(assessDay("2027-03-04", base).status).toBe("conflict"); // midterm
    // No verified academic data for that week: unknown, not available.
    const unknown = assessDay("2027-03-08", base);
    expect(unknown.status).toBe("unknown");
    expect(unknown.speaker).toBe("unconfirmed");
    expect(assessDay("2027-03-10", base).status).toBe("restricted"); // inside the Victoriales window (9–29 March)
  });

  it("never suggests restricted or unavailable days, and ranks evidence-backed days first", () => {
    const s = suggestSlots(base);
    expect(s.map((x) => x.day)).not.toContain("2027-03-10");
    expect(s.map((x) => x.day)).not.toContain("2027-03-01");
    expect(s[0].day).toBe("2027-03-02");
    expect(s.every((x) => x.reasons.length > 0)).toBe(true);
  });
});

describe("iCalendar writer", () => {
  const base = { uid: "event-1@bfc-calendar", title: "Hello, world; ok", start: new Date("2027-03-28T16:30:00Z"), end: new Date("2027-03-28T18:00:00Z"), status: "CONFIRMED" as const, sequence: 3, createdAt: new Date("2027-01-01T00:00:00Z"), updatedAt: new Date("2027-01-02T00:00:00Z") };

  it("escapes text and folds long lines at 75 octets without breaking UTF-8", () => {
    expect(escapeText("a,b;c\\d\ne")).toBe("a\\,b\;c\\\\d\\ne");
    const folded = foldLine("DESCRIPTION:" + "é".repeat(120));
    for (const line of folded.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe("DESCRIPTION:" + "é".repeat(120));
    expect(formatUtc(new Date("2027-03-28T16:30:00Z"))).toBe("20270328T163000Z");
  });

  it("produces a feed a strict parser accepts, with CRLF line endings", () => {
    const ics = buildCalendar({ name: "Test", events: [base, { ...base, uid: "allday@bfc", allDay: true, startDay: "2027-03-27", endDayExclusive: "2027-03-30" }] });
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.split("\r\n").every((l) => !l.includes("\n"))).toBe(true);
    const comp = new ICAL.Component(ICAL.parse(ics));
    const [timed, allDay] = comp.getAllSubcomponents("vevent").map((v) => new ICAL.Event(v));
    expect(timed.summary).toBe("Hello, world; ok");
    expect(timed.startDate.toJSDate().toISOString()).toBe("2027-03-28T16:30:00.000Z");
    expect(timed.sequence).toBe(3);
    expect(allDay.startDate.isDate).toBe(true);
    expect(allDay.endDate.toString()).toBe("2027-03-30");
  });

  it("marks cancellations in a way every client can show", () => {
    const ics = buildCalendar({ name: "T", events: [{ ...base, status: "CANCELLED" }] });
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("SUMMARY:Cancelled: Hello\\, world\; ok");
    expect(ics).toContain("TRANSP:TRANSPARENT");
  });
});

describe("permissions", () => {
  const member = { id: "m", role: "board_member" as const, active: true };
  const admin = { id: "a", role: "board_admin" as const, active: true };
  const superAdmin = { id: "s", role: "super_admin" as const, active: true };
  it("applies the role matrix", () => {
    expect(canEditEvent(member, { createdBy: "m", organizerIds: [] })).toBe(true);
    expect(canEditEvent(member, { createdBy: "x", organizerIds: ["m"] })).toBe(true);
    expect(canEditEvent(member, { createdBy: "x", organizerIds: [] })).toBe(false);
    expect(canEditEvent(admin, { createdBy: "x", organizerIds: [] })).toBe(true);
    expect([canPublish(member), canPublish(admin), canPublish(superAdmin)]).toEqual([false, true, true]);
    expect([canOverrideRestriction(member), canOverrideRestriction(admin), canOverrideRestriction(superAdmin)]).toEqual([false, false, true]);
  });
  it("denies everything to deactivated accounts", () => {
    const off = { ...superAdmin, active: false };
    expect(canEditEvent(off, { createdBy: "s", organizerIds: [] })).toBe(false);
    expect(canPublish(off)).toBe(false);
    expect(canOverrideRestriction(off)).toBe(false);
  });
});
