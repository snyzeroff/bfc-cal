import { addDays, formatIsoDay, formatIsoRange } from "./time";

/**
 * Restriction engine — pure functions, no I/O.
 *
 * Rules are expanded into concrete date windows. A window is either `hard`
 * (scheduling is refused unless a Super Admin overrides with a reason) or
 * `soft` (a warning that never blocks).
 */

export type RuleInput = {
  id: string;
  name: string;
  type: "victoriales" | "date_range" | "academic_kind";
  severity: "hard" | "soft";
  appliesTo: string[];
  params: { startDate?: string; endDate?: string; kinds?: string[]; layerKeys?: string[]; daysBefore?: number };
  message: string;
  active: boolean;
};

export type VictorialesInput = { id: string; label: string; date: string | null; endDate?: string | null };

export type AcademicInput = {
  label: string;
  kind: string;
  startDate: string;
  endDate: string;
  layerKey: string;
  layerName: string;
  verified: boolean;
};

export type RestrictionWindow = {
  ruleId: string;
  ruleName: string;
  type: RuleInput["type"];
  severity: "hard" | "soft";
  appliesTo: string[];
  /** Inclusive ISO days. */
  start: string;
  end: string;
  title: string;
  message: string;
};

export const VICTORIALES_DAYS = 21;

/** The N calendar days immediately preceding `date` (the event day itself is not included). */
export function victorialesWindow(date: string, daysBefore = VICTORIALES_DAYS): { start: string; end: string } {
  return { start: addDays(date, -daysBefore), end: addDays(date, -1) };
}

export function computeWindows(
  rules: RuleInput[],
  ctx: { victoriales: VictorialesInput[]; academic: AcademicInput[] },
): RestrictionWindow[] {
  const out: RestrictionWindow[] = [];
  for (const rule of rules) {
    if (!rule.active) continue;
    const base = { ruleId: rule.id, ruleName: rule.name, type: rule.type, severity: rule.severity, appliesTo: rule.appliesTo };

    if (rule.type === "victoriales") {
      const n = rule.params.daysBefore ?? VICTORIALES_DAYS;
      for (const ed of ctx.victoriales) {
        if (!ed.date) continue; // not configured yet: no restriction can be computed
        const w = victorialesWindow(ed.date, n);
        out.push({
          ...base,
          ...w,
          title: `No conferences — ${n} days before ${ed.label}`,
          message:
            rule.message ||
            `No BFC conference may be scheduled during the ${n} days before ${ed.label} (${formatIsoDay(ed.date, true)}). Restricted period: ${formatIsoRange(w.start, w.end)}.`,
        });
      }
    } else if (rule.type === "date_range") {
      const { startDate, endDate } = rule.params;
      if (!startDate || !endDate || endDate < startDate) continue;
      out.push({
        ...base,
        start: startDate,
        end: endDate,
        title: rule.name,
        message: rule.message || `${rule.name}: ${formatIsoRange(startDate, endDate)}.`,
      });
    } else if (rule.type === "academic_kind") {
      const kinds = rule.params.kinds ?? [];
      const layers = rule.params.layerKeys ?? [];
      for (const e of ctx.academic) {
        // Unverified dates must never be enforced as if they were facts.
        if (!e.verified) continue;
        if (!kinds.includes(e.kind)) continue;
        if (layers.length && !layers.includes(e.layerKey)) continue;
        out.push({
          ...base,
          start: e.startDate,
          end: e.endDate,
          title: `${e.label} — ${e.layerName}`,
          message: rule.message || `${rule.name}: ${e.label} (${e.layerName}), ${formatIsoRange(e.startDate, e.endDate)}.`,
        });
      }
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

export type Violation = RestrictionWindow;

/** Windows that a `kind` event on [startDay, endDay] (inclusive ISO days) falls into. */
export function findViolations(
  windows: RestrictionWindow[],
  kind: string,
  startDay: string,
  endDay: string = startDay,
): Violation[] {
  const seen = new Set<string>();
  return windows.filter((w) => {
    if (!w.appliesTo.includes(kind)) return false;
    if (w.end < startDay || w.start > endDay) return false;
    const key = `${w.ruleId}|${w.start}|${w.end}|${w.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const hardViolations = (v: Violation[]) => v.filter((x) => x.severity === "hard");
export const softViolations = (v: Violation[]) => v.filter((x) => x.severity === "soft");
