import type { AcademicKind } from "@/db/schema";

/** One period read from a source document, awaiting human review. */
export type ParsedCandidate = {
  /** Stable layer key, e.g. "boe-y1", "boe-y2", "aidams-y1", "sport", "common". */
  layerKey: string;
  layerName: string;
  /** Text of the cell as printed, whitespace-normalised (e.g. "S1 W4", "Midterms"). */
  label: string;
  kind: AcademicKind;
  /** Inclusive ISO dates (YYYY-MM-DD). */
  startDate: string;
  endDate: string;
  /** 0–100: how sure the extractor is of the date span and label. */
  confidence: number;
  /** Human-readable reasons the reviewer should double-check this row. */
  issues: string[];
  source: { page: number; bbox: [number, number, number, number]; text: string };
};

export type ParsedLayer = { key: string; name: string; program: string; yearGroup: string };

export type ParsedCalendar = {
  title: string;
  /** e.g. "VERSION 08/09/2026" if printed on the document, else "". */
  versionLabel: string;
  layers: ParsedLayer[];
  candidates: ParsedCandidate[];
  /** Document-level problems (unreadable month column, unknown header, …). */
  warnings: string[];
};
