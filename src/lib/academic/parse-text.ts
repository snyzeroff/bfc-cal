import { ACADEMIC_KINDS, type AcademicKind } from "@/db/schema";
import { addDays, isValidDateIso, parisParts } from "@/lib/time";
import { classifyLabel } from "./classify";
import type { ParsedCalendar, ParsedCandidate } from "./types";

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "imported";

/**
 * iCalendar import: one candidate per VEVENT. Dates are explicit in the file, so
 * confidence is high — but they still go through review like everything else.
 */
export function parseIcs(text: string, filename: string, layerName: string): ParsedCalendar {
  const warnings: string[] = [];
  const unfolded = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  const name = /^X-WR-CALNAME:(.*)$/m.exec(unfolded)?.[1]?.trim();
  const layer = { key: slug(layerName || name || filename.replace(/\.[^.]+$/, "")), name: layerName || name || filename, program: "", yearGroup: "" };
  const candidates: ParsedCandidate[] = [];
  const blocks = unfolded.split("BEGIN:VEVENT").slice(1);
  blocks.forEach((raw, i) => {
    const block = raw.split("END:VEVENT")[0];
    const full = (n: string) => {
      const m = new RegExp(`^${n}((?:;[^:\\n]*)?):(.*)$`, "m").exec(block);
      return m ? { params: m[1], value: m[2].trim() } : null;
    };
    const summary = (full("SUMMARY")?.value ?? "").replace(/\\([,;\\])/g, "$1").replace(/\\n/gi, " ");
    const issues: string[] = [];
    /** The Paris day (and whether it is exactly midnight) of a DATE or DATE-TIME value. */
    const read = (p: { params: string; value: string } | null): { day: string; timed: boolean; midnight: boolean } | null => {
      const m = p && /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/.exec(p.value);
      if (!p || !m) return null;
      const written = `${m[1]}-${m[2]}-${m[3]}`;
      if (m[4] === undefined) return { day: written, timed: false, midnight: false };
      if (m[7]) {
        // UTC time: the school day is the day in Paris, which can differ late in the evening.
        const at = parisParts(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])));
        return { day: at.date, timed: true, midnight: at.time === "00:00" };
      }
      const zone = /TZID=([^;:]+)/.exec(p.params)?.[1];
      if (zone && zone !== "Europe/Paris") issues.push(`Times are in ${zone}; the day was taken as written.`);
      return { day: written, timed: true, midnight: m[4] === "00" && m[5] === "00" };
    };
    const ds = read(full("DTSTART"));
    const start = ds?.day ?? null;
    if (!summary || !start || !isValidDateIso(start)) {
      warnings.push(`Event ${i + 1} skipped: missing title or start date.`);
      return;
    }
    const de = read(full("DTEND"));
    let end = start;
    if (de) {
      // An end at midnight (and every all-day end) is exclusive: the event stops the day before.
      end = (!de.timed || de.midnight) && de.day > start ? addDays(de.day, -1) : de.day;
    } else {
      const dur = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?)?$/.exec(full("DURATION")?.value ?? "");
      if (dur) {
        const days = +(dur[1] ?? 0) * 7 + +(dur[2] ?? 0);
        const extra = +(dur[3] ?? 0) * 60 + +(dur[4] ?? 0) > 0 ? 1 : 0;
        end = addDays(start, Math.max(0, days + extra - 1));
      }
    }
    if (!isValidDateIso(end) || end < start) {
      end = start;
      issues.push("End date could not be read; assumed a single day.");
    }
    if (/^RRULE/m.test(block)) issues.push("Recurring event: only the first occurrence was imported.");
    candidates.push({
      layerKey: layer.key,
      layerName: layer.name,
      label: summary,
      kind: classifyLabel(summary),
      startDate: start,
      endDate: end,
      confidence: issues.length ? 60 : 95,
      issues,
      source: { page: 1, bbox: [0, 0, 0, 0], text: `VEVENT #${i + 1}: ${summary}` },
    });
  });
  if (!candidates.length) warnings.push("No events were found in this file.");
  return { title: name ?? filename, versionLabel: "", layers: [layer], candidates, warnings };
}

/**
 * CSV import. Columns (header row required, any order):
 *   label, start, end (optional), kind (optional), layer (optional)
 * Dates must be YYYY-MM-DD or DD/MM/YYYY.
 */
export function parseCsv(text: string, filename: string, defaultLayer: string): ParsedCalendar {
  const warnings: string[] = [];
  const rows = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (rows.length < 2) return { title: filename, versionLabel: "", layers: [], candidates: [], warnings: ["The file is empty."] };
  const sep = (rows[0].match(/;/g)?.length ?? 0) > (rows[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const split = (line: string) => {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) {
        out.push(cur.trim());
        cur = "";
      }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const header = split(rows[0]).map((h) => h.toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iLabel = col("label", "title", "name", "summary");
  const iStart = col("start", "start_date", "startdate", "date", "from");
  const iEnd = col("end", "end_date", "enddate", "to");
  const iKind = col("kind", "type");
  const iLayer = col("layer", "program", "calendar");
  if (iLabel < 0 || iStart < 0) {
    return { title: filename, versionLabel: "", layers: [], candidates: [], warnings: ["The header row must contain at least “label” and “start” columns."] };
  }
  const toIso = (v: string) => {
    const m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(v);
    return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : v;
  };
  const layers = new Map<string, { key: string; name: string; program: string; yearGroup: string }>();
  const candidates: ParsedCandidate[] = [];
  rows.slice(1).forEach((line, i) => {
    const c = split(line);
    const label = c[iLabel] ?? "";
    const start = toIso(c[iStart] ?? "");
    let end = iEnd >= 0 && c[iEnd] ? toIso(c[iEnd]) : start;
    if (!label || !isValidDateIso(start)) {
      warnings.push(`Row ${i + 2} skipped: missing label or unreadable start date.`);
      return;
    }
    const issues: string[] = [];
    if (!isValidDateIso(end) || end < start) {
      issues.push(`End date “${c[iEnd]}” could not be read; assumed a single day.`);
      end = start;
    }
    const layerName = (iLayer >= 0 && c[iLayer]) || defaultLayer || filename.replace(/\.[^.]+$/, "");
    const key = slug(layerName);
    if (!layers.has(key)) layers.set(key, { key, name: layerName, program: "", yearGroup: "" });
    const rawKind = iKind >= 0 ? c[iKind]?.toLowerCase() : "";
    const kind = (ACADEMIC_KINDS as readonly string[]).includes(rawKind) ? (rawKind as AcademicKind) : classifyLabel(label);
    candidates.push({
      layerKey: key,
      layerName,
      label,
      kind,
      startDate: start,
      endDate: end,
      confidence: issues.length ? 60 : 95,
      issues,
      source: { page: 1, bbox: [0, 0, 0, 0], text: `Row ${i + 2}: ${line.slice(0, 160)}` },
    });
  });
  return { title: filename, versionLabel: "", layers: [...layers.values()], candidates, warnings };
}
