import type { AcademicKind } from "@/db/schema";

/** Collapse whitespace and strip accents/case for matching (not for display). */
function norm(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const TEACHING_WEEK = /\bs\s?\d\s*w\s?\d{1,2}\b/; // "S1 W4", "S2 W10", "WW & S1 W1"
const WELCOME_WEEK = /(^|[^a-z])ww($|[^a-z])/; // "WW", "WW & W1 class"
const MIDTERM = /\bmid[\s-]?terms?\b/;
const READING = /\breading\s+days?\b/;
const EXAM = /\b(exams?|examens?|retakes?|rattrapages?)\b/;
const VACATION = /\b(vacations?|vacances|break)\b/;
const HOLIDAY = /\b(holidays?|ferie|bank holiday)\b/;
const INTERNSHIP = /\b(internships?|stages?)\b/;
/** "Sport 4 Y1", "EPS 4 Y1", "sport 3 Y1", "Sport 9  Y2" — a numbered session and/or a year suffix. */
const SPORT_SESSION = /^(sport|eps)\b\.?\s*(\d+\b|.*\by\s?\d\b)/;

/** Named school activities seen on the CentraleSupélec calendars, plus generic activity words. */
const SCHOOL_EVENT =
  /\b(coding weeks?|robotics|bootcamp|modell?ing weeks?|innov|business games?|organi[sz]ational behaviou?r|beprepared|be prepared|coupe|sports tour|tour cotiz|dinner|gala|forum|cohesion|learning expedition|climate day|career|workshop|welcome|orientation|integration|hackathon|project|seminar|conference|ceremony|graduation|weeks?|days?|games?)\b/;

/**
 * Map a calendar cell label to an academic kind. Pure; never throws.
 * Mixed labels resolve by the precedence documented in the product brief
 * ("Retake/Internship" → exam); use {@link labelIssues} to surface the ambiguity.
 */
export function classifyLabel(label: string): AcademicKind {
  const s = norm(label);
  if (!s) return "other";
  if (TEACHING_WEEK.test(s) || WELCOME_WEEK.test(s)) return "teaching";
  if (MIDTERM.test(s)) return "midterm";
  if (READING.test(s)) return "reading";
  if (EXAM.test(s)) return "exam";
  if (HOLIDAY.test(s) && !VACATION.test(s)) return "holiday";
  if (VACATION.test(s)) return "vacation";
  if (HOLIDAY.test(s)) return "holiday";
  if (INTERNSHIP.test(s)) return "internship";
  if (SPORT_SESSION.test(s)) return "sport";
  if (SCHOOL_EVENT.test(s)) return "school_event";
  return "other";
}

/** Reviewer-facing notes about labels that mix several kinds or could not be classified. */
export function labelIssues(label: string): string[] {
  const s = norm(label);
  const issues: string[] = [];
  const kind = classifyLabel(label);
  const retake = /\b(retakes?|rattrapages?)\b/.test(s);
  if (retake && INTERNSHIP.test(s)) {
    issues.push(`Mixed label "${label.trim()}": classified as exam (retakes) but the period is also an internship period`);
  } else if (retake && kind === "teaching") {
    issues.push(`Mixed label "${label.trim()}": classified as teaching week, but retakes are also scheduled`);
  } else if (retake && /\b(sport|eps)\b/.test(s)) {
    issues.push(`Mixed label "${label.trim()}": classified as exam (retake) for sport`);
  }
  if (kind === "other") issues.push(`Label "${label.trim()}" not recognised; kind left as "other"`);
  return issues;
}
