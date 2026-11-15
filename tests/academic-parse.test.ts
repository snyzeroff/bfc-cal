import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { classifyLabel } from "@/lib/academic/classify";
import { parseAcademicPdf } from "@/lib/academic/parse-pdf";
import { parseCsv, parseIcs } from "@/lib/academic/parse-text";
import type { ParsedCalendar, ParsedCandidate } from "@/lib/academic/types";
import { isValidDateIso } from "@/lib/time";

const load = (name: string) => parseAcademicPdf(new Uint8Array(fs.readFileSync(`tests/fixtures/academic/${name}.pdf`)), `${name}.pdf`);

/**
 * Ground truth below was read by eye from the rendered documents
 * (tests/fixtures/academic/*.pdf), not derived from the extractor's output.
 */
describe("academic PDF extraction — Bachelor of Engineering Y1/Y2 2026–27", () => {
  let cal: ParsedCalendar;
  const find = (layer: string, label: RegExp, start: string): ParsedCandidate | undefined =>
    cal.candidates.find((c) => c.layerKey === layer && label.test(c.label) && c.startDate === start);

  beforeAll(async () => {
    cal = await load("boe-y1-y2-2026-2027");
  });

  it("reads the document title, version stamp and layers", () => {
    expect(cal.title).toBe("Bachelor of Engineering 2026–27");
    expect(cal.versionLabel).toBe("VERSION 08/09/2026");
    expect(cal.layers.map((l) => l.key)).toEqual(["boe-y1", "boe-y2"]);
    expect(cal.warnings).toEqual([]);
  });

  it.each([
    ["boe-y1", /^Reading days$/, "2026-10-19", "2026-10-20", "reading"],
    ["boe-y1", /^Midterms$/, "2026-10-21", "2026-10-23", "midterm"],
    ["boe-y2", /^Midterms$/, "2026-10-21", "2026-10-23", "midterm"],
    ["boe-y1", /^Vacation$/, "2026-10-26", "2026-10-30", "vacation"],
    ["boe-y1", /^Holiday$/, "2026-11-11", "2026-11-11", "holiday"],
    ["boe-y1", /^Vacation$/, "2026-12-21", "2026-12-25", "vacation"],
    ["boe-y1", /^Reading days$/, "2027-01-11", "2027-01-12", "reading"],
    ["boe-y1", /^Exams$/, "2027-01-13", "2027-01-15", "exam"],
    ["boe-y2", /^Exams$/, "2027-01-13", "2027-01-15", "exam"],
    ["boe-y1", /^Ski Vacation$/, "2027-02-15", "2027-02-19", "vacation"],
    ["boe-y1", /^MIDTERM$/, "2027-03-31", "2027-04-02", "midterm"],
    ["boe-y1", /^EXAMS$/, "2027-06-02", "2027-06-04", "exam"],
    ["boe-y1", /^S1 W4$/, "2026-09-28", "2026-10-02", "teaching"], // split across September/October in the document
    ["boe-y1", /^S2 W1$/, "2027-02-01", "2027-02-05", "teaching"],
  ])("%s %s starting %s", (layer, label, start, end, kind) => {
    const c = find(layer as string, label as RegExp, start as string);
    expect(c, `${label} not found on ${start}`).toBeDefined();
    expect(c!.endDate).toBe(end);
    expect(c!.kind).toBe(kind);
  });

  it("joins a period whose first day is an unlabelled cell in the previous month, and says so", () => {
    const w9 = find("boe-y1", /^S1 W9$/, "2026-11-30");
    expect(w9?.endDate).toBe("2026-12-04");
    expect(w9!.issues.join(" ")).toMatch(/month boundary/);
  });

  it("is candid about what it is less sure of", () => {
    // White cells have no colour to measure: lower confidence, with an explanation.
    const vacation = find("boe-y1", /^Vacation$/, "2026-10-26")!;
    expect(vacation.confidence).toBeLessThan(85);
    expect(vacation.issues.length).toBeGreaterThan(0);
    // A cell merged across both year columns is applied to both, and flagged.
    const holiday = find("boe-y2", /^Holiday$/, "2026-11-11")!;
    expect(holiday.issues.join(" ")).toMatch(/merged across columns/);
    // Clean coloured cells are high confidence.
    expect(find("boe-y1", /^Midterms$/, "2026-10-21")!.confidence).toBeGreaterThanOrEqual(90);
    // Every low-confidence row explains itself.
    for (const c of cal.candidates) if (c.confidence < 85) expect(c.issues.length, c.label).toBeGreaterThan(0);
  });

  it("assigns sport sessions to the year named in the label", () => {
    const y1 = cal.candidates.filter((c) => c.layerKey === "boe-y1" && c.kind === "sport");
    const y2 = cal.candidates.filter((c) => c.layerKey === "boe-y2" && c.kind === "sport");
    expect(y1.length).toBeGreaterThan(10);
    expect(y2.length).toBeGreaterThan(10);
    expect(y1.every((c) => /Y1|Retake/i.test(c.label))).toBe(true);
    expect(find("boe-y1", /^Sport 4 Y1$/, "2026-11-02")?.endDate).toBe("2026-11-02");
    expect(find("boe-y2", /^Sport 4 Y2$/, "2026-11-04")).toBeDefined();
  });
});

describe("academic PDF extraction — AIDAMS Y1 2026–27", () => {
  let cal: ParsedCalendar;
  beforeAll(async () => {
    cal = await load("aidams-y1-2026-2027");
  });

  it("creates the AIDAMS layer", () => {
    expect(cal.title).toBe("Bachelor AIDAMS 2026–27");
    expect(cal.layers).toEqual([{ key: "aidams-y1", name: "AIDAMS Year 1", program: "AIDAMS", yearGroup: "Y1" }]);
  });

  it.each([
    ["2026-10-21", "2026-10-23"],
    ["2026-12-16", "2026-12-18"],
    ["2027-02-03", "2027-02-05"],
    ["2027-04-07", "2027-04-09"],
    ["2027-06-02", "2027-06-04"],
  ])("finds the exam session %s → %s", (start, end) => {
    const exam = cal.candidates.find((c) => c.kind === "exam" && c.startDate === start);
    expect(exam?.endDate).toBe(end);
  });

  it("flags clipped and tentative labels instead of guessing", () => {
    const question = cal.candidates.find((c) => c.label.includes("?"));
    expect(question?.confidence).toBeLessThan(85);
    const bare = cal.candidates.filter((c) => /^S2$/.test(c.label));
    expect(bare.length).toBeGreaterThan(0);
    for (const c of bare) {
      expect(c.kind).toBe("teaching");
      expect(c.issues.join(" ")).toMatch(/No week number is printed/);
    }
    const weekend = cal.candidates.find((c) => c.label === "Public Holiday" && c.startDate === "2027-03-27");
    expect(weekend?.issues.join(" ")).toMatch(/weekend/);
  });
});

describe("academic PDF extraction — invariants on every fixture", () => {
  it.each(["boe-y1-y2-2026-2027", "boe-final-2026-2027", "aidams-y1-2026-2027"])("%s", async (name) => {
    const cal = await load(name);
    expect(cal.candidates.length).toBeGreaterThan(80);
    for (const c of cal.candidates) {
      expect(isValidDateIso(c.startDate), `${c.label} start ${c.startDate}`).toBe(true);
      expect(isValidDateIso(c.endDate), `${c.label} end ${c.endDate}`).toBe(true);
      expect(c.endDate >= c.startDate, `${c.label} ${c.startDate}..${c.endDate}`).toBe(true);
      expect(c.startDate >= "2026-08-01" && c.endDate <= "2027-08-31").toBe(true);
      expect(c.confidence).toBeGreaterThanOrEqual(0);
      expect(c.confidence).toBeLessThanOrEqual(100);
      expect(c.source.page).toBe(1);
      expect(c.source.bbox).toHaveLength(4);
      expect(c.source.text.length).toBeGreaterThan(0);
      expect(cal.layers.some((l) => l.key === c.layerKey)).toBe(true);
    }
    // Deterministic ordering.
    const again = await load(name);
    expect(again.candidates.map((c) => `${c.startDate}|${c.layerKey}|${c.label}`)).toEqual(cal.candidates.map((c) => `${c.startDate}|${c.layerKey}|${c.label}`));
  });

  it("rejects files that are not calendars", async () => {
    await expect(parseAcademicPdf(new TextEncoder().encode("hello"), "x.pdf")).rejects.toThrow(/not a PDF/);
  });
});

describe("label classification", () => {
  it.each([
    ["S1 W4", "teaching"], ["WW & S1 W1", "teaching"], ["S2", "teaching"],
    ["Midterms", "midterm"], ["MIDTERM", "midterm"],
    ["Exams", "exam"], ["Retakes", "exam"], ["Retake/Internship", "exam"],
    ["Reading days", "reading"],
    ["Vacation", "vacation"], ["Ski Vacation", "vacation"],
    ["Holiday", "holiday"], ["Public Holiday", "holiday"],
    ["Internship period", "internship"],
    ["Sport 4 Y1", "sport"], ["EPS 12 Y2", "sport"],
    ["Coding Weeks", "school_event"], ["FORUM", "school_event"], ["Coupe X", "school_event"],
    ["Zzz", "other"],
  ])("%s → %s", (label, kind) => expect(classifyLabel(label)).toBe(kind));
});

describe("structured imports", () => {
  it("reads all-day and timed iCalendar events (exclusive DTEND handled)", () => {
    const ics = ["BEGIN:VCALENDAR", "X-WR-CALNAME:School", "BEGIN:VEVENT", "SUMMARY:Exams", "DTSTART;VALUE=DATE:20270113", "DTEND;VALUE=DATE:20270116", "END:VEVENT", "BEGIN:VEVENT", "SUMMARY:Gala", "DTSTART:20270320T190000Z", "DTEND:20270320T230000Z", "END:VEVENT", "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20270101", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const r = parseIcs(ics, "school.ics", "");
    expect(r.candidates.map((c) => [c.label, c.startDate, c.endDate, c.kind])).toEqual([["Exams", "2027-01-13", "2027-01-15", "exam"], ["Gala", "2027-03-20", "2027-03-20", "school_event"]]);
    expect(r.warnings.join(" ")).toMatch(/skipped/);
    expect(r.layers[0].key).toBe("school");
  });

  it("reads CSV with either separator and date format, and reports unreadable rows", () => {
    const r = parseCsv("label;start;end;kind\nMidterms;22/10/2026;23/10/2026;midterm\nBroken;not-a-date;;\n", "c.csv", "BoE Year 1");
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ label: "Midterms", startDate: "2026-10-22", endDate: "2026-10-23", kind: "midterm", layerKey: "boe-year-1" });
    expect(r.warnings.join(" ")).toMatch(/Row 3 skipped/);
  });
});
