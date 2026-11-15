import { TZDate } from "@date-fns/tz";

/** All club activity happens in Paris; instants are stored in UTC. */
export const TZ = "Europe/Paris";

const pad = (n: number) => String(n).padStart(2, "0");

/** Wall-clock Paris date + time → the corresponding instant (DST-aware). */
export function parisToInstant(dateIso: string, time = "00:00"): Date {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(new TZDate(y, m - 1, d, hh, mm, 0, TZ).getTime());
}

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

export function parisParts(instant: Date): { date: string; time: string; weekday: string } {
  const p = Object.fromEntries(partsFmt.formatToParts(instant).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, weekday: p.weekday };
}

/** Paris calendar day (YYYY-MM-DD) of an instant. */
export const parisDay = (instant: Date) => parisParts(instant).date;

/** Current instant in ms (kept here so render code stays free of direct clock reads). */
export const nowMs = (): number => Date.now();

export function todayParis(): string {
  return parisDay(new Date());
}

/* ----- pure calendar-day arithmetic on ISO strings (no time zone involved) ----- */

export function addDays(dateIso: string, n: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function diffDays(a: string, b: string): number {
  const p = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((p(b) - p(a)) / 86400000);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(dateIso: string): number {
  const [y, m, d] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isValidDateIso(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Paris days an event touches. `end` is exclusive for timed and all-day events alike. */
export function eventDays(start: Date, end: Date | null): { start: string; end: string } {
  const s = parisDay(start);
  if (!end || end.getTime() <= start.getTime()) return { start: s, end: s };
  const e = parisDay(new Date(end.getTime() - 1));
  return { start: s, end: e < s ? s : e };
}

/* ------------------------------------------------------------- formatting */

const fmt = (opts: Intl.DateTimeFormatOptions, locale = "en-GB") =>
  new Intl.DateTimeFormat(locale, { timeZone: TZ, ...opts });

const dayLong = fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
const dayMed = fmt({ weekday: "short", day: "numeric", month: "short" });
const dayMedYear = fmt({ day: "numeric", month: "short", year: "numeric" });
const timeFmt = fmt({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dateTimeFmt = fmt({ day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export const formatDayLong = (d: Date) => dayLong.format(d);
export const formatDay = (d: Date) => dayMed.format(d);
export const formatDayYear = (d: Date) => dayMedYear.format(d);
export const formatTime = (d: Date) => timeFmt.format(d);
export const formatDateTime = (d: Date) => dateTimeFmt.format(d);

export function formatIsoDay(dateIso: string, withYear = false): string {
  const d = parisToInstant(dateIso, "12:00");
  return withYear ? dayMedYear.format(d) : dayMed.format(d);
}

export function formatRange(start: Date, end: Date | null, allDay = false): string {
  if (allDay) {
    const days = eventDays(start, end);
    return days.start === days.end
      ? dayLong.format(start)
      : `${formatIsoDay(days.start)} – ${formatIsoDay(days.end, true)}`;
  }
  if (!end) return `${dayLong.format(start)}, ${timeFmt.format(start)}`;
  if (parisDay(start) === parisDay(end)) {
    return `${dayLong.format(start)}, ${timeFmt.format(start)} – ${timeFmt.format(end)}`;
  }
  return `${dateTimeFmt.format(start)} – ${dateTimeFmt.format(end)}`;
}

export function formatIsoRange(start: string, end: string): string {
  return start === end ? formatIsoDay(start, true) : `${formatIsoDay(start)} – ${formatIsoDay(end, true)}`;
}

export function relativeDays(dateIso: string, from = todayParis()): string {
  const n = diffDays(from, dateIso);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/* ----- "wall" strings: Paris wall-clock time without offset, e.g. 2026-11-18T18:30 ----- */

export function wallToInstant(wall: string): Date {
  const [d, t = "00:00"] = wall.split("T");
  return parisToInstant(d, t.slice(0, 5));
}

export function instantToWall(instant: Date): string {
  const p = parisParts(instant);
  return `${p.date}T${p.time}`;
}
