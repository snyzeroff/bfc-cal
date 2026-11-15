/**
 * Minimal, standards-compliant iCalendar (RFC 5545) writer for subscription feeds.
 *
 * Design notes
 *  - Timed events are written in UTC (`...Z`). UTC instants are unambiguous for
 *    every client and across daylight-saving transitions, so no VTIMEZONE is needed.
 *  - All-day events use VALUE=DATE with an exclusive DTEND.
 *  - UIDs are derived from database ids and never change.
 *  - SEQUENCE is bumped by the application whenever subscriber-visible data changes.
 *  - Cancelled events stay in the feed with STATUS:CANCELLED for a retention
 *    period: clients that honour the status show the cancellation, and clients
 *    that do not at least display the "Cancelled:" title prefix.
 */

export type IcsEvent = {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  url?: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  /** For all-day events: inclusive ISO start day and exclusive end day. */
  startDay?: string;
  endDayExclusive?: string;
  status: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  sequence: number;
  createdAt: Date;
  updatedAt: Date;
  categories?: string[];
  organizerName?: string;
  /** Free/busy transparency: tentative holds and deadlines should not block time. */
  transparent?: boolean;
};

export type IcsCalendar = {
  name: string;
  description?: string;
  /** Refresh hint in minutes. Clients decide whether to honour it. */
  refreshMinutes?: number;
  prodId?: string;
  events: IcsEvent[];
  color?: string;
};

export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

const pad = (n: number, l = 2) => String(n).padStart(l, "0");

export function formatUtc(d: Date): string {
  return (
    `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Fold to 75 octets per line (RFC 5545 §3.1) without splitting UTF-8 sequences. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
      limit = 74; // continuation lines start with one space
    }
    current += ch;
    bytes += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function eventLines(e: IcsEvent): string[] {
  const lines = ["BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${formatUtc(e.updatedAt)}`];
  if (e.allDay && e.startDay && e.endDayExclusive) {
    lines.push(`DTSTART;VALUE=DATE:${e.startDay.replace(/-/g, "")}`);
    lines.push(`DTEND;VALUE=DATE:${e.endDayExclusive.replace(/-/g, "")}`);
  } else {
    lines.push(`DTSTART:${formatUtc(e.start)}`);
    lines.push(`DTEND:${formatUtc(e.end)}`);
  }
  const title = e.status === "CANCELLED" && !/^cancelled/i.test(e.title) ? `Cancelled: ${e.title}` : e.title;
  lines.push(`SUMMARY:${escapeText(title)}`);
  if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
  if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
  if (e.url) lines.push(`URL:${e.url}`);
  if (e.categories?.length) lines.push(`CATEGORIES:${e.categories.map(escapeText).join(",")}`);
  lines.push(`STATUS:${e.status}`);
  lines.push(`SEQUENCE:${e.sequence}`);
  lines.push(`CREATED:${formatUtc(e.createdAt)}`);
  lines.push(`LAST-MODIFIED:${formatUtc(e.updatedAt)}`);
  lines.push(`TRANSP:${e.transparent || e.status === "CANCELLED" ? "TRANSPARENT" : "OPAQUE"}`);
  lines.push("END:VEVENT");
  return lines;
}

export function buildCalendar(cal: IcsCalendar): string {
  const refresh = `PT${Math.max(15, cal.refreshMinutes ?? 60)}M`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${cal.prodId ?? "-//Bachelor Finance Club//BFC Calendar//EN"}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `NAME:${escapeText(cal.name)}`,
    `X-WR-CALNAME:${escapeText(cal.name)}`,
    "X-WR-TIMEZONE:Europe/Paris",
    `REFRESH-INTERVAL;VALUE=DURATION:${refresh}`,
    `X-PUBLISHED-TTL:${refresh}`,
  ];
  if (cal.description) {
    lines.push(`DESCRIPTION:${escapeText(cal.description)}`, `X-WR-CALDESC:${escapeText(cal.description)}`);
  }
  if (cal.color) lines.push(`X-APPLE-CALENDAR-COLOR:${cal.color}`);
  for (const e of cal.events) lines.push(...eventLines(e));
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

export function icsResponseHeaders(filename: string, isPrivate: boolean): HeadersInit {
  return {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": `inline; filename="${filename}"`,
    // Feeds must always reflect the database: never serve a stale copy.
    "Cache-Control": isPrivate ? "private, no-store" : "public, max-age=0, must-revalidate",
    ...(isPrivate ? { "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" } : {}),
  };
}
