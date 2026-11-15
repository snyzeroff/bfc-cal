import { findViolations, type AcademicInput, type RestrictionWindow } from "./restrictions";
import { eachDay, weekdayOf } from "./time";

/**
 * Scheduling assistant — pure functions, no I/O.
 *
 * It never claims that people are free. A day is only called "available" when
 * verified academic data covers it and nothing recorded conflicts with it;
 * days without data are reported as "unknown", and speaker availability is
 * reported separately as confirmed or not confirmed.
 */

export type SlotStatus = "available" | "conflict" | "restricted" | "unavailable" | "unknown";

export const SLOT_META: Record<SlotStatus, { label: string; description: string }> = {
  available: { label: "Available", description: "Verified calendar data, no recorded conflict" },
  conflict: { label: "Potential conflict", description: "Possible, but something overlaps" },
  restricted: { label: "Restricted", description: "Blocked by a scheduling rule" },
  unavailable: { label: "Unavailable", description: "A confirmed commitment makes this impossible" },
  unknown: { label: "Unknown", description: "No verified data for this day" },
};

export type Booking = {
  id: string;
  title: string;
  /** Paris ISO day. */
  day: string;
  kind: string;
  /** true for confirmed/published events, false for tentative holds and proposals. */
  firm: boolean;
  eventId: string;
};

export type SpeakerDay = { day: string; availability: "unknown" | "available" | "unavailable" };

export type AssistantInput = {
  from: string;
  to: string;
  kind: string;
  /** Layer keys of the students this event targets. Empty = every layer. */
  audience: string[];
  /** Weekdays allowed (0 = Sunday). */
  weekdays: number[];
  windows: RestrictionWindow[];
  academic: AcademicInput[];
  bookings: Booking[];
  /** What the speaker has told us, per day. */
  speaker: SpeakerDay[];
  /** Event being scheduled, so it does not conflict with itself. */
  eventId?: string;
};

export type Reason = { tone: "good" | "warn" | "bad" | "info"; text: string };

export type DayAssessment = {
  day: string;
  status: SlotStatus;
  speaker: "confirmed" | "unconfirmed" | "unavailable";
  reasons: Reason[];
  score: number;
};

/** Academic kinds during which most students cannot or will not attend. */
const AWAY = new Set(["vacation", "holiday", "internship"]);
const BUSY = new Set(["exam", "midterm", "reading"]);

export function assessDay(day: string, input: AssistantInput): DayAssessment {
  const reasons: Reason[] = [];
  const violations = findViolations(input.windows, input.kind, day);
  const hard = violations.filter((v) => v.severity === "hard");
  const soft = violations.filter((v) => v.severity === "soft");

  const relevant = input.academic.filter(
    (e) => e.verified && e.startDate <= day && e.endDate >= day && (input.audience.length === 0 || input.audience.includes(e.layerKey)),
  );
  const others = input.bookings.filter((b) => b.day === day && b.eventId !== input.eventId);
  const sp = input.speaker.find((s) => s.day === day);
  const speaker: DayAssessment["speaker"] =
    sp?.availability === "available" ? "confirmed" : sp?.availability === "unavailable" ? "unavailable" : "unconfirmed";

  let status: SlotStatus = "available";
  let score = 100;
  const worsen = (s: SlotStatus) => {
    const order: SlotStatus[] = ["available", "unknown", "conflict", "unavailable", "restricted"];
    if (order.indexOf(s) > order.indexOf(status)) status = s;
  };

  for (const v of hard) {
    worsen("restricted");
    reasons.push({ tone: "bad", text: v.message });
  }

  if (speaker === "unavailable") {
    worsen("unavailable");
    reasons.push({ tone: "bad", text: "The speaker said they are not available on this day." });
  }
  for (const b of others.filter((b) => b.firm && b.kind === "conference")) {
    worsen("unavailable");
    reasons.push({ tone: "bad", text: `Another conference is already confirmed: “${b.title}”.` });
  }

  for (const v of soft) {
    worsen("conflict");
    score -= 30;
    reasons.push({ tone: "warn", text: v.message });
  }
  for (const e of relevant) {
    if (BUSY.has(e.kind)) {
      worsen("conflict");
      score -= 35;
      reasons.push({ tone: "warn", text: `${e.layerName}: ${e.label}.` });
    } else if (AWAY.has(e.kind)) {
      worsen("conflict");
      score -= 40;
      reasons.push({ tone: "warn", text: `${e.layerName} students are away: ${e.label}.` });
    } else if (e.kind === "school_event") {
      worsen("conflict");
      score -= 15;
      reasons.push({ tone: "warn", text: `${e.layerName}: ${e.label} takes place this day.` });
    }
  }
  for (const b of others.filter((b) => !(b.firm && b.kind === "conference"))) {
    worsen("conflict");
    score -= b.firm ? 20 : 10;
    reasons.push({
      tone: "warn",
      text: b.firm ? `Same day as “${b.title}”.` : `“${b.title}” has a tentative hold on this day.`,
    });
  }
  const wd = weekdayOf(day);
  if (wd === 0 || wd === 6) {
    worsen("conflict");
    score -= 40;
    reasons.push({ tone: "warn", text: "Weekend." });
  }

  // "Available" requires evidence: verified teaching-period data for the audience on that day.
  const teaching = relevant.filter((e) => e.kind === "teaching");
  if (status === "available") {
    if (teaching.length === 0) {
      status = "unknown";
      score -= 25;
      reasons.push({
        tone: "info",
        text: "No verified academic calendar data covers this day, so student availability cannot be assessed.",
      });
    } else {
      reasons.push({ tone: "good", text: `Regular teaching period (${[...new Set(teaching.map((t) => t.layerName))].join(", ")}).` });
      reasons.push({ tone: "good", text: "No exam, holiday, restriction or other BFC event recorded." });
    }
  }

  if (speaker === "confirmed") {
    score += 15;
    reasons.push({ tone: "good", text: "The speaker confirmed this date works." });
  } else if (speaker === "unconfirmed") {
    reasons.push({ tone: "info", text: "Speaker availability has not been confirmed for this day." });
  }

  if ([2, 3, 4].includes(wd)) score += 5; // mid-week evenings draw the best attendance
  return { day, status, speaker, reasons, score: Math.max(0, Math.min(score, 120)) };
}

export function assessRange(input: AssistantInput): DayAssessment[] {
  return eachDay(input.from, input.to).map((d) => assessDay(d, input));
}

/** Best candidate days. Restricted and unavailable days are never suggested. */
export function suggestSlots(input: AssistantInput, limit = 6): DayAssessment[] {
  return assessRange(input)
    .filter((a) => input.weekdays.includes(weekdayOf(a.day)))
    .filter((a) => a.status === "available" || a.status === "unknown" || (a.status === "conflict" && a.score >= 60))
    .sort((a, b) => rank(a) - rank(b) || b.score - a.score || a.day.localeCompare(b.day))
    .slice(0, limit);
}

const rank = (a: DayAssessment) => (a.status === "available" ? 0 : a.status === "unknown" ? 1 : 2);
