/**
 * Extractor for CentraleSupélec academic-year calendar PDFs (Excel exports).
 *
 * The page is a grid of 13 month blocks. Each block has a weekday column, a date
 * column and one or more programme columns; one row per day. A period is a merged
 * cell covering several day rows. The export draws
 *   - cell backgrounds as filled rectangles (one per row, sometimes spanning columns),
 *   - cell borders as very thin filled rectangles (there are no stroked lines),
 *   - text as positioned runs.
 *
 * Strategy: rebuild the grid (rows from the date labels, columns from the vertical
 * border rects), then flood-fill neighbouring grid cells that are NOT separated by a
 * border and share the same background. Each connected region that contains text is
 * one candidate; its date span comes from the rows it covers, never from the text.
 *
 * Coordinates in `source.bbox` are [x0, y0, x1, y1] in PDF points with the origin at
 * the TOP-LEFT of the page (pdf.js viewport space at scale 1).
 */
import type { AcademicKind } from "@/db/schema";
import { classifyLabel, labelIssues } from "./classify";
import type { ParsedCalendar, ParsedCandidate, ParsedLayer } from "./types";

// ---------------------------------------------------------------------------
// Low-level geometry
// ---------------------------------------------------------------------------

type Matrix = [number, number, number, number, number, number];
type Rect = { x0: number; y0: number; x1: number; y1: number };
type FillRect = Rect & { color: string | null };
type TextRun = { str: string; x0: number; x1: number; y: number; size: number };

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function mul(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// pdf.js loading and page extraction
// ---------------------------------------------------------------------------

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjsPromise: Promise<PdfJs> | null = null;

async function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const g = globalThis as unknown as { pdfjsWorker?: unknown };
      if (!g.pdfjsWorker) {
        // Run the parser on the main thread ("fake worker"). Importing the worker
        // module explicitly lets serverless bundlers trace it; pdf.js picks it up
        // from globalThis.pdfjsWorker instead of spawning a Worker.
        try {
          g.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
        } catch {
          // pdf.js will fall back to its own dynamic import of the worker file.
        }
      }
      return import("pdfjs-dist/legacy/build/pdf.mjs");
    })();
  }
  return pdfjsPromise;
}

function parseColor(args: unknown[] | null): string | null {
  if (!args || args.length === 0) return null;
  if (typeof args[0] === "string") return args[0].toLowerCase();
  if (args.length >= 3 && args.slice(0, 3).every((v) => typeof v === "number")) {
    return (
      "#" +
      (args.slice(0, 3) as number[])
        .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
        .join("")
    );
  }
  return null;
}

/** Split a pdf.js path buffer into sub-paths and keep those that are axis-aligned rectangles. */
function rectsFromPath(data: ArrayLike<number>): Rect[] {
  const out: Rect[] = [];
  let pts: number[] = [];
  let ok = true;
  const flush = () => {
    if (ok && pts.length >= 8) {
      const xs = pts.filter((_, i) => i % 2 === 0);
      const ys = pts.filter((_, i) => i % 2 === 1);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const eps = 0.02;
      const onCorner = xs.every(
        (x, i) =>
          (Math.abs(x - x0) < eps || Math.abs(x - x1) < eps) &&
          (Math.abs(ys[i] - y0) < eps || Math.abs(ys[i] - y1) < eps),
      );
      if (onCorner && x1 > x0 && y1 > y0) out.push({ x0, y0, x1, y1 });
    }
    pts = [];
    ok = true;
  };
  for (let i = 0; i < data.length; ) {
    const op = data[i++];
    if (op === 0) { flush(); pts.push(data[i], data[i + 1]); i += 2; } // moveTo
    else if (op === 1) { pts.push(data[i], data[i + 1]); i += 2; } // lineTo
    else if (op === 2) { ok = false; i += 6; } // curveTo
    else if (op === 3) { ok = false; i += 4; } // quadraticCurveTo
    else if (op === 4) { /* closePath */ }
    else { ok = false; break; }
  }
  flush();
  return out;
}

type PageData = { width: number; height: number; fills: FillRect[]; texts: TextRun[] };

async function extractPage(pdfjs: PdfJs, page: import("pdfjs-dist/legacy/build/pdf.mjs").PDFPageProxy): Promise<PageData> {
  const viewport = page.getViewport({ scale: 1 });
  const vt = viewport.transform as Matrix;
  const OPS = pdfjs.OPS;

  // --- text
  const tc = await page.getTextContent();
  const texts: TextRun[] = [];
  for (const item of tc.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const m = mul(vt, item.transform as Matrix);
    // Skip rotated text: the calendars only carry horizontal labels.
    if (Math.abs(m[1]) > 0.05 * Math.abs(m[0])) continue;
    const size = Math.hypot(m[2], m[3]);
    const lead = item.str.length - item.str.trimStart().length;
    const trail = item.str.length - item.str.trimEnd().length;
    const perChar = item.str.length ? item.width / item.str.length : 0;
    texts.push({
      str: item.str.trim(),
      x0: m[4] + lead * perChar,
      x1: m[4] + item.width - trail * perChar,
      y: m[5],
      size,
    });
  }

  // --- filled rectangles
  const ol = await page.getOperatorList();
  const fillOps = new Set<number>([
    OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke,
  ]);
  const fills: FillRect[] = [];
  let ctm: Matrix = IDENTITY;
  let color: string | null = "#000000";
  const stack: { ctm: Matrix; color: string | null }[] = [];
  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i];
    const args = ol.argsArray[i] as unknown[] | null;
    if (fn === OPS.save) stack.push({ ctm, color });
    else if (fn === OPS.restore) {
      const s = stack.pop();
      if (s) ({ ctm, color } = s);
    } else if (fn === OPS.transform && args) ctm = mul(ctm, args as unknown as Matrix);
    else if (fn === OPS.setFillRGBColor) color = parseColor(args);
    else if (fn === OPS.constructPath && args && typeof args[0] === "number" && fillOps.has(args[0])) {
      const data = (args[1] as ArrayLike<number>[] | undefined)?.[0];
      if (!data) continue;
      const m = mul(vt, ctm);
      // Only axis-preserving transforms keep rectangles rectangular.
      if (Math.abs(m[1]) > 1e-6 || Math.abs(m[2]) > 1e-6) continue;
      for (const r of rectsFromPath(data)) {
        const [ax, ay] = apply(m, r.x0, r.y0);
        const [bx, by] = apply(m, r.x1, r.y1);
        fills.push({
          x0: Math.min(ax, bx), x1: Math.max(ax, bx), y0: Math.min(ay, by), y1: Math.max(ay, by), color,
        });
      }
    }
  }
  return { width: viewport.width, height: viewport.height, fills, texts };
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const MONTH_NAMES: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8,
  septembre: 9, octobre: 10, novembre: 11, decembre: 12,
};
const MONTH_ABBR: Record<string, number> = {
  jan: 1, janv: 1, feb: 2, fev: 2, fevr: 2, mar: 3, mars: 3, apr: 4, avr: 4, avril: 4, may: 5, mai: 5,
  jun: 6, june: 6, juin: 6, jul: 7, july: 7, juil: 7, aug: 8, aout: 8, sep: 9, sept: 9, oct: 10,
  nov: 11, dec: 12,
};
const WEEKDAY_PREFIX = ["su", "mo", "tu", "we", "th", "fr", "sa"]; // also matches French di/lu/… poorly: checked loosely
const MONTH_LABEL = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function iso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function nextDay(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Grid model
// ---------------------------------------------------------------------------

type ColumnRole =
  | { type: "layers"; keys: string[] } // programme column(s)
  | { type: "sport" }
  | { type: "all" }; // unlabeled column: applies to every layer

type Column = { x0: number; x1: number; header: string; role: ColumnRole };

type Block = {
  month: number;
  year: number;
  days: number;
  dateColX: number; // centre of the date labels
  columns: Column[];
};

const WHITE = new Set(["#ffffff", "#fefefe", "#fdfdfd"]);
const isThin = (r: Rect) => Math.min(r.x1 - r.x0, r.y1 - r.y0) < 1;

function layerFor(program: string, year: string): ParsedLayer {
  if (program === "BoE") return { key: `boe-y${year}`, name: `BoE Year ${year}`, program: "BoE", yearGroup: `Y${year}` };
  if (program === "AIDAMS") return { key: `aidams-y${year}`, name: `AIDAMS Year ${year}`, program: "AIDAMS", yearGroup: `Y${year}` };
  const slug = program.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "program";
  return { key: `${slug}-y${year}`, name: `${program} Year ${year}`, program, yearGroup: `Y${year}` };
}

/** Interpret a sub-column header. Returns null when it is not understood. */
function parseHeader(header: string, docProgram: string): { kind: "year"; program: string; year: string } | { kind: "program"; program: string } | { kind: "sport" } | { kind: "blank" } | null {
  const h = fold(header).replace(/\s+/g, " ");
  if (!h) return { kind: "blank" };
  if (/^(sports?|eps)$/.test(h)) return { kind: "sport" };
  let m = /^boe ?(?:y ?)?(\d)$/.exec(h);
  if (m) return { kind: "year", program: "BoE", year: m[1] };
  if (h === "boe") return { kind: "program", program: "BoE" };
  m = /^aidams? ?(?:y ?)?(\d)$/.exec(h);
  if (m) return { kind: "year", program: "AIDAMS", year: m[1] };
  if (/^aidams?$/.test(h)) return { kind: "program", program: "AIDAMS" };
  m = /^(?:y|year) ?(\d)$/.exec(h);
  if (m && docProgram) return { kind: "year", program: docProgram, year: m[1] };
  return null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function parseAcademicPdf(data: Uint8Array, filename: string): Promise<ParsedCalendar> {
  const head = Buffer.from(data.subarray(0, 1024)).toString("latin1");
  if (!head.includes("%PDF-")) {
    throw new Error(`"${filename}" is not a PDF file (missing %PDF header)`);
  }
  const pdfjs = await loadPdfJs();
  let doc: import("pdfjs-dist/legacy/build/pdf.mjs").PDFDocumentProxy;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(data), // pdf.js takes ownership of the buffer: hand it a copy
      useSystemFonts: false,
      disableFontFace: true,
      isEvalSupported: false,
      verbosity: 0,
    }).promise;
  } catch (err) {
    throw new Error(`"${filename}" could not be read as a PDF: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const result: ParsedCalendar = { title: "", versionLabel: "", layers: [], candidates: [], warnings: [] };
    const layerMap = new Map<string, ParsedLayer>();
    let gridFound = false;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const pageData = await extractPage(pdfjs, page);
      const parsed = parsePage(pageData, p, filename, result.warnings);
      if (!parsed) continue;
      gridFound = true;
      if (!result.title) result.title = parsed.title;
      if (!result.versionLabel) result.versionLabel = parsed.versionLabel;
      for (const l of parsed.layers) if (!layerMap.has(l.key)) layerMap.set(l.key, l);
      result.candidates.push(...parsed.candidates);
    }
    if (!gridFound) {
      throw new Error(`No month grid found in "${filename}": expected month headers with one row per day`);
    }
    result.layers = [...layerMap.values()].sort((a, b) => a.key.localeCompare(b.key));
    result.candidates.sort(
      (a, b) =>
        a.startDate.localeCompare(b.startDate) ||
        a.layerKey.localeCompare(b.layerKey) ||
        a.label.localeCompare(b.label) ||
        a.endDate.localeCompare(b.endDate),
    );
    return result;
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Page parsing
// ---------------------------------------------------------------------------

type PageResult = { title: string; versionLabel: string; layers: ParsedLayer[]; candidates: ParsedCandidate[] };

function parsePage(pd: PageData, pageNo: number, filename: string, warnings: string[]): PageResult | null {
  const { texts, fills } = pd;

  // ---- 1. date labels ("1 Aug", "12 sept", "3 janv") -> blocks and rows -------------
  type DateLabel = { day: number; month: number; xc: number; y: number; size: number };
  const dateLabels: DateLabel[] = [];
  for (const t of texts) {
    const m = /^(\d{1,2})\s*([a-z]{3,5})\.?$/.exec(fold(t.str));
    if (!m) continue;
    const month = MONTH_ABBR[m[2]];
    const day = Number(m[1]);
    if (!month || day < 1 || day > 31) continue;
    dateLabels.push({ day, month, xc: (t.x0 + t.x1) / 2, y: t.y, size: t.size });
  }
  if (dateLabels.length < 20) return null;

  // Cluster by x: one cluster per month block.
  dateLabels.sort((a, b) => a.xc - b.xc);
  const clusters: DateLabel[][] = [];
  for (const l of dateLabels) {
    const last = clusters[clusters.length - 1];
    if (last && l.xc - last[last.length - 1].xc < 10) last.push(l);
    else clusters.push([l]);
  }
  const dateClusters = clusters.filter((c) => c.length >= 10);
  if (dateClusters.length === 0) return null;

  // Row pitch and row-1 position (all blocks share the same rows).
  const pitches: number[] = [];
  for (const c of dateClusters) {
    const byDay = [...c].sort((a, b) => a.day - b.day);
    const a = byDay[0], b = byDay[byDay.length - 1];
    if (b.day > a.day) pitches.push((b.y - a.y) / (b.day - a.day));
  }
  const pitch = median(pitches);
  if (!(pitch > 1)) return null;
  const all = dateClusters.flat();
  const fontSize = median(all.map((l) => l.size));
  // Estimated top of row 1 from the label baselines, refined below with the borders.
  let rowTop = median(all.map((l) => l.y - (l.day - 1) * pitch)) - fontSize * 0.35 - pitch / 2;

  const thin = fills.filter(isThin);
  const hLines = thin.filter((r) => r.x1 - r.x0 > r.y1 - r.y0);
  const vLines = thin.filter((r) => r.y1 - r.y0 >= r.x1 - r.x0);
  const solid = fills.filter((r) => !isThin(r));

  const gridBottomEst = rowTop + 31 * pitch;
  {
    // Snap the row origin to the horizontal borders (or, failing that, fill edges).
    const residuals: number[] = [];
    const edges = hLines.length >= 10
      ? hLines.map((r) => (r.y0 + r.y1) / 2)
      : solid.filter((r) => Math.abs(r.y1 - r.y0 - pitch) < pitch * 0.2).map((r) => r.y0);
    for (const y of edges) {
      if (y < rowTop - pitch / 2 || y > gridBottomEst + pitch / 2) continue;
      const k = Math.round((y - rowTop) / pitch);
      residuals.push(y - rowTop - k * pitch);
    }
    if (residuals.length >= 10) rowTop += median(residuals);
  }
  const rowY = (r: number) => rowTop + r * pitch; // top edge of 0-based row r
  const gridBottom = rowY(31);

  // ---- 2. title, version, academic years --------------------------------------------
  const above = texts.filter((t) => t.y < rowTop);
  const lineOf = (seed: TextRun) =>
    above
      .filter((t) => Math.abs(t.y - seed.y) < seed.size * 0.5)
      .sort((a, b) => a.x0 - b.x0)
      .map((t) => t.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  const titleSeed =
    above.find((t) => /bachelor|calendar|calendrier/i.test(t.str)) ??
    above.filter((t) => /20\d\d\s*[–—-]\s*\d\d/.test(t.str)).sort((a, b) => b.size - a.size)[0];
  const title = titleSeed ? lineOf(titleSeed) : "";
  if (!title) warnings.push(`Page ${pageNo}: document title not found`);
  const versionSeed = above.find((t) => /^version\b/i.test(t.str));
  const versionLabel = versionSeed ? lineOf(versionSeed) : "";

  let startYear: number | null = null;
  const ym = /(20\d\d)\s*[–—\-/]\s*(?:20)?(\d\d)\b/.exec(title);
  if (ym) {
    startYear = Number(ym[1]);
    if ((startYear + 1) % 100 !== Number(ym[2])) {
      warnings.push(`Page ${pageNo}: title years "${ym[0]}" are not consecutive; using ${startYear} as the first year`);
    }
  }

  // ---- 3. month headers --------------------------------------------------------------
  type MonthHeader = { month: number; year: number | null; xc: number; y: number };
  const monthHeaders: MonthHeader[] = [];
  for (const t of above) {
    const m = /^([a-z]+)\s*(20\d\d)?$/.exec(fold(t.str));
    if (!m || !MONTH_NAMES[m[1]]) continue;
    monthHeaders.push({ month: MONTH_NAMES[m[1]], year: m[2] ? Number(m[2]) : null, xc: (t.x0 + t.x1) / 2, y: t.y });
  }
  const headerY = median(monthHeaders.map((h) => h.y));
  const headersOnLine = monthHeaders.filter((h) => Math.abs(h.y - headerY) < pitch).sort((a, b) => a.xc - b.xc);
  if (startYear === null) {
    const explicit = headersOnLine.find((h) => h.year !== null);
    if (explicit?.year) {
      startYear = explicit.year;
      warnings.push(`Page ${pageNo}: academic year not found in the title; taken from the "${MONTH_LABEL[explicit.month]} ${explicit.year}" month header`);
    } else {
      const fm = /(20\d\d)\s*[-_–]\s*(20)?\d\d/.exec(filename);
      if (!fm) throw new Error(`Cannot determine the academic year of "${filename}": no "2026–27"-style year in the title or month headers`);
      startYear = Number(fm[1]);
      warnings.push(`Page ${pageNo}: academic year not printed on the document; taken from the file name (${startYear})`);
    }
  }
  const program = /engineering|\bboe\b/i.test(title) ? "BoE" : /aidams?/i.test(title) ? "AIDAMS" : "";
  if (!program) warnings.push(`Page ${pageNo}: programme not recognised from title "${title}"`);

  // ---- 4. column boundaries from vertical borders -----------------------------------
  const headerTop = Number.isFinite(headerY) ? headerY : rowTop - 2 * pitch;
  const vInGrid = vLines.filter((r) => r.y1 > headerTop && r.y0 < gridBottom);
  const xsRaw = vInGrid.map((r) => (r.x0 + r.x1) / 2).sort((a, b) => a - b);
  const bounds: number[] = [];
  {
    let group: number[] = [];
    const flush = () => { if (group.length) bounds.push(median(group)); group = []; };
    for (const x of xsRaw) {
      if (group.length && x - group[group.length - 1] > 1.2) flush();
      group.push(x);
    }
    flush();
  }
  // Outer edges of the grid (fills may extend past the last border).
  const rowFills = solid.filter((r) => r.y0 > rowTop - pitch && r.y1 < gridBottom + pitch && r.y1 - r.y0 < pitch * 8);
  if (rowFills.length) {
    const minX = Math.min(...rowFills.map((r) => r.x0));
    const maxX = Math.max(...rowFills.map((r) => r.x1));
    if (!bounds.length || minX < bounds[0] - 2) bounds.unshift(minX);
    if (maxX > bounds[bounds.length - 1] + 2) bounds.push(maxX);
  }
  if (bounds.length < 3) {
    warnings.push(`Page ${pageNo}: no cell borders found; cannot reconstruct the month grid`);
    return null;
  }
  const colIndexAt = (x: number) => {
    for (let i = 0; i + 1 < bounds.length; i++) if (x >= bounds[i] && x < bounds[i + 1]) return i;
    return -1;
  };

  // ---- 5. blocks ----------------------------------------------------------------------
  const headerBand = texts.filter((t) => t.y > headerTop + pitch * 0.4 && t.y < rowTop + pitch * 0.1);
  const blocks: Block[] = [];
  const clusterInfo = dateClusters.map((c) => {
    const counts = new Map<number, number>();
    for (const l of c) counts.set(l.month, (counts.get(l.month) ?? 0) + 1);
    const month = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return { labels: c, month, xc: median(c.map((l) => l.xc)), dateCol: colIndexAt(median(c.map((l) => l.xc))) };
  });
  if (headersOnLine.length !== clusterInfo.length) {
    warnings.push(`Page ${pageNo}: ${headersOnLine.length} month headers but ${clusterInfo.length} date columns; months taken from the date labels`);
  }
  let year = startYear;
  let prevMonth = 0;
  const yearLayerKeys = new Map<string, ParsedLayer>();
  const pendingColumns: { block: Block; col: Column; parsed: ReturnType<typeof parseHeader> }[] = [];
  for (let i = 0; i < clusterInfo.length; i++) {
    const ci = clusterInfo[i];
    if (prevMonth && ci.month < prevMonth) year++;
    else if (prevMonth && ci.month === prevMonth) {
      warnings.push(`Page ${pageNo}: two consecutive ${MONTH_LABEL[ci.month]} blocks; the second is ignored`);
      continue;
    }
    prevMonth = ci.month;
    const name = `${MONTH_LABEL[ci.month]} ${year}`;
    const hdr = headersOnLine.length === clusterInfo.length ? headersOnLine[i] : undefined;
    if (hdr && hdr.month !== ci.month) {
      warnings.push(`Page ${pageNo}: month header "${MONTH_LABEL[hdr.month]}" does not match its date labels (${MONTH_LABEL[ci.month]}); block skipped`);
      continue;
    }
    if (hdr?.year && hdr.year !== year) {
      warnings.push(`Page ${pageNo}: header says ${MONTH_LABEL[hdr.month]} ${hdr.year} but the title implies ${year}; using ${year}`);
    }
    if (ci.dateCol < 0) {
      warnings.push(`Page ${pageNo}: date column of ${name} not located in the grid; block skipped`);
      continue;
    }
    const dim = daysInMonth(year, ci.month);
    // Row check: label "d <month>" must sit in row d.
    const misplaced = ci.labels.filter((l) => l.month === ci.month && Math.floor((l.y - fontSize * 0.35 - rowTop) / pitch) !== l.day - 1);
    const seenDays = new Set(ci.labels.filter((l) => l.month === ci.month).map((l) => l.day));
    if (misplaced.length) {
      warnings.push(`Page ${pageNo}: ${misplaced.length} date label(s) of ${name} are not on their expected row; spans in this month may be off`);
    }
    if (seenDays.size < dim) {
      warnings.push(`Page ${pageNo}: ${name} shows ${seenDays.size} date labels, expected ${dim}`);
    }
    if ([...seenDays].some((d) => d > dim)) {
      warnings.push(`Page ${pageNo}: ${name} lists a day beyond ${dim}; ignored`);
    }
    // Weekday check on the 1st of the month.
    const first = ci.labels.find((l) => l.day === 1);
    if (first && ci.dateCol > 0) {
      const wd = texts.find(
        (t) => Math.abs(t.y - first.y) < pitch * 0.4 && colIndexAt((t.x0 + t.x1) / 2) === ci.dateCol - 1 && /^[a-z]{2,}/i.test(t.str),
      );
      const expected = WEEKDAY_PREFIX[new Date(Date.UTC(year, ci.month - 1, 1)).getUTCDay()];
      if (wd && WEEKDAY_PREFIX.includes(fold(wd.str).slice(0, 2)) && fold(wd.str).slice(0, 2) !== expected) {
        warnings.push(`Page ${pageNo}: 1 ${name} is printed as "${wd.str}" but that date is a ${expected}…; the year may be wrong`);
      }
    }
    // Content columns: everything between this date column and the next block's weekday column.
    const nextDateCol = i + 1 < clusterInfo.length ? clusterInfo[i + 1].dateCol : -1;
    const lastCol = nextDateCol > 0 ? nextDateCol - 2 : bounds.length - 2;
    const block: Block = { month: ci.month, year, days: dim, dateColX: ci.xc, columns: [] };
    for (let c = ci.dateCol + 1; c <= lastCol; c++) {
      const x0 = bounds[c], x1 = bounds[c + 1];
      if (x1 - x0 < 2) continue; // double border, not a column
      const header = headerBand
        .filter((t) => (t.x0 + t.x1) / 2 >= x0 && (t.x0 + t.x1) / 2 < x1)
        .sort((a, b) => a.y - b.y || a.x0 - b.x0)
        .map((t) => t.str)
        .join(" ");
      const col: Column = { x0, x1, header, role: { type: "all" } };
      const parsed = parseHeader(header, program);
      if (parsed?.kind === "year") yearLayerKeys.set(layerFor(parsed.program, parsed.year).key, layerFor(parsed.program, parsed.year));
      pendingColumns.push({ block, col, parsed });
      block.columns.push(col);
    }
    if (block.columns.length === 0) {
      warnings.push(`Page ${pageNo}: ${name} has no programme column`);
      continue;
    }
    blocks.push(block);
  }
  if (blocks.length === 0) return null;

  // Resolve column roles now that every year layer of the document is known.
  const layers = new Map<string, ParsedLayer>(yearLayerKeys);
  if (layers.size === 0) {
    const l: ParsedLayer = {
      key: (program || "calendar").toLowerCase(), name: program || "Calendar", program: program || "", yearGroup: "",
    };
    layers.set(l.key, l);
    warnings.push(`Page ${pageNo}: no year column header (e.g. "BoE1") recognised; all periods put on layer "${l.key}"`);
  }
  const allKeys = () => [...layers.keys()].sort();
  const keysOfProgram = (prog: string) => {
    const ks = [...layers.values()].filter((l) => l.program === prog).map((l) => l.key).sort();
    return ks.length ? ks : allKeys();
  };
  const unknownHeaders = new Set<string>();
  for (const { block, col, parsed } of pendingColumns) {
    if (!parsed) {
      col.role = { type: "all" };
      unknownHeaders.add(`"${col.header}" (${MONTH_LABEL[block.month]} ${block.year})`);
    } else if (parsed.kind === "year") col.role = { type: "layers", keys: [layerFor(parsed.program, parsed.year).key] };
    else if (parsed.kind === "program") col.role = { type: "layers", keys: keysOfProgram(parsed.program) };
    else if (parsed.kind === "sport") col.role = { type: "sport" };
    else col.role = { type: "all" };
  }
  for (const h of unknownHeaders) warnings.push(`Page ${pageNo}: column header ${h} not recognised; its periods are applied to every layer`);

  // ---- 6. regions per block -----------------------------------------------------------
  const fillAt = (x: number, y: number): string | null => {
    for (let i = solid.length - 1; i >= 0; i--) {
      const r = solid[i];
      if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return r.color && !WHITE.has(r.color) ? r.color : null;
    }
    return null;
  };
  const hasH = (edge: number, x0: number, x1: number): boolean => {
    const y = rowY(edge);
    let covered = 0;
    for (const l of hLines) {
      if (Math.abs((l.y0 + l.y1) / 2 - y) > pitch * 0.3) continue;
      covered += Math.max(0, Math.min(l.x1, x1) - Math.max(l.x0, x0));
      if (covered >= (x1 - x0) * 0.6) return true;
    }
    return false;
  };
  const hasV = (x: number, row: number): boolean => {
    const y0 = rowY(row), y1 = rowY(row + 1);
    let covered = 0;
    for (const l of vLines) {
      if (Math.abs((l.x0 + l.x1) / 2 - x) > 1) continue;
      covered += Math.max(0, Math.min(l.y1, y1) - Math.max(l.y0, y0));
      if (covered >= pitch * 0.6) return true;
    }
    return false;
  };

  const ROWS = 31;
  const candidates: ParsedCandidate[] = [];
  const usedText = new Set<TextRun>();

  for (const block of blocks) {
    const nC = block.columns.length;
    const blockName = `${MONTH_LABEL[block.month]} ${block.year}`;
    const fill: (string | null)[][] = [];
    for (let r = 0; r < ROWS; r++) {
      fill.push(block.columns.map((c) => fillAt((c.x0 + c.x1) / 2, rowY(r) + pitch / 2)));
    }
    // edgeBelow[r][c]: border between row r and r+1; edgeRight[r][c]: between col c and c+1.
    const edgeBelow = fill.map((_, r) => block.columns.map((c) => hasH(r + 1, c.x0, c.x1)));
    const edgeAbove0 = block.columns.map((c) => hasH(0, c.x0, c.x1));
    const edgeRight = fill.map((_, r) => block.columns.map((c, ci) => (ci + 1 < nC ? hasV(c.x1, r) : true)));

    const regionId: number[][] = fill.map(() => new Array<number>(nC).fill(-1));
    const regions: { cells: [number, number][] }[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < nC; c++) {
        if (regionId[r][c] !== -1) continue;
        const id = regions.length;
        const cells: [number, number][] = [];
        const queue: [number, number][] = [[r, c]];
        regionId[r][c] = id;
        while (queue.length) {
          const [cr, cc] = queue.pop()!;
          cells.push([cr, cc]);
          const tryGo = (nr: number, nc: number, open: boolean) => {
            if (!open || nr < 0 || nr >= ROWS || nc < 0 || nc >= nC) return;
            if (regionId[nr][nc] !== -1 || fill[nr][nc] !== fill[cr][cc]) return;
            regionId[nr][nc] = id;
            queue.push([nr, nc]);
          };
          tryGo(cr + 1, cc, !edgeBelow[cr][cc]);
          if (cr > 0) tryGo(cr - 1, cc, !edgeBelow[cr - 1][cc]);
          tryGo(cr, cc + 1, !edgeRight[cr][cc]);
          if (cc > 0) tryGo(cr, cc - 1, !edgeRight[cr][cc - 1]);
        }
        regions.push({ cells });
      }
    }

    // Assign text runs to regions (by the centre of each run).
    const regionTexts = new Map<number, TextRun[]>();
    const bx0 = block.columns[0].x0, bx1 = block.columns[nC - 1].x1;
    for (const t of texts) {
      const xc = (t.x0 + t.x1) / 2;
      const yc = t.y - t.size * 0.35;
      if (xc < bx0 || xc >= bx1 || yc < rowTop || yc >= gridBottom) continue;
      const c = block.columns.findIndex((col) => xc >= col.x0 && xc < col.x1);
      const r = Math.floor((yc - rowTop) / pitch);
      if (c < 0 || r < 0 || r >= ROWS) continue;
      usedText.add(t);
      const id = regionId[r][c];
      if (!regionTexts.has(id)) regionTexts.set(id, []);
      regionTexts.get(id)!.push(t);
    }

    for (const [id, runs] of [...regionTexts.entries()].sort((a, b) => a[0] - b[0])) {
      const cells = regions[id].cells;
      const rows = cells.map((c) => c[0]);
      const cols = cells.map((c) => c[1]);
      const r0 = Math.min(...rows), r1 = Math.max(...rows);
      const c0 = Math.min(...cols), c1 = Math.max(...cols);
      const rectangular = cells.length === (r1 - r0 + 1) * (c1 - c0 + 1);
      const color = fill[r0][cols[rows.indexOf(r0)]];
      const issues: string[] = [];
      let confidence = 95;
      const cap = (value: number, issue: string) => {
        confidence = Math.min(confidence, value);
        issues.push(issue);
      };

      // --- label
      const sorted = [...runs].sort((a, b) => a.y - b.y || a.x0 - b.x0);
      const lines: TextRun[][] = [];
      for (const t of sorted) {
        const last = lines[lines.length - 1];
        if (last && Math.abs(t.y - last[0].y) < t.size * 0.5) last.push(t);
        else lines.push([t]);
      }
      const lineStrs = lines.map((l) => l.sort((a, b) => a.x0 - b.x0).map((t) => t.str).join(" ").replace(/\s+/g, " ").trim());
      let label = "";
      for (const s of lineStrs) {
        if (!label) label = s;
        else if (/[-/]$/.test(label)) label += s;
        else label += " " + s;
      }
      label = label.replace(/\s+/g, " ").trim();
      const sourceText = lineStrs.join("\n");
      if (!label) continue;

      // Same phrase printed twice in one cell (overflow from a neighbouring cell).
      const words = label.split(" ");
      if (words.length >= 2 && words.length % 2 === 0) {
        const half = words.length / 2;
        if (words.slice(0, half).join(" ") === words.slice(half).join(" ")) {
          label = words.slice(0, half).join(" ");
          cap(70, "Label text appears twice in the cell; duplicate removed");
        }
      }

      // --- span
      if (r0 >= block.days) {
        warnings.push(`Page ${pageNo}: text "${label}" sits below the last day of ${blockName}; ignored`);
        continue;
      }
      const endRow = Math.min(r1, block.days - 1);
      if (r1 > endRow) {
        cap(70, `Cell extends below ${block.days} ${MONTH_LABEL[block.month]}; span cut at the end of the month`);
      }
      if (!rectangular) {
        cap(50, "Cell outline is not a clean rectangle (missing borders); span taken from its bounding rows");
      }

      // Text vs cell geometry.
      const x0 = block.columns[c0].x0, x1 = block.columns[c1].x1;
      const y0 = rowY(r0), y1 = rowY(r1 + 1);
      const size = median(runs.map((t) => t.size));
      const textTop = Math.min(...runs.map((t) => t.y - t.size * 0.75));
      const textBottom = Math.max(...runs.map((t) => t.y + t.size * 0.2));
      const overflowY = textTop < y0 - size * 0.25 || textBottom > y1 + size * 0.25;
      const overflowX = runs.some((t) => t.x0 < x0 - size * 0.5 || t.x1 > x1 + size * 0.5);
      if (overflowY || overflowX) {
        cap(70, "Text does not fit in its cell (clipped or overflowing); label may be incomplete");
      }

      // How the top and bottom of the span are known.
      const colsInRegion = [...new Set(cols)].sort((a, b) => a - b);
      const topBordered = colsInRegion.every((c) => (r0 === 0 ? edgeAbove0[c] : edgeBelow[r0 - 1][c]));
      const bottomBordered = colsInRegion.every((c) => r1 === ROWS - 1 || edgeBelow[r1][c]);
      if (color === null) {
        if (topBordered && bottomBordered) {
          cap(80, "Cell has no fill; span taken from the cell borders");
        } else {
          cap(50, "Span inferred from neighbouring cells; cell has no fill and no complete border");
        }
      } else {
        // Check the coloured area really ends on row boundaries.
        const cover = solid.filter(
          (f) => f.color === color && f.x0 < (x0 + x1) / 2 + 0.01 && f.x1 > x0 + (x1 - x0) * 0.25 && f.y1 > y0 + 0.5 && f.y0 < y1 - 0.5,
        );
        const top = Math.min(...cover.map((f) => f.y0));
        const bottom = Math.max(...cover.map((f) => f.y1));
        const tol = pitch * 0.2;
        if (!cover.length || Math.abs(top - y0) > tol || Math.abs(bottom - y1) > tol) {
          if (!(topBordered && bottomBordered)) {
            cap(60, "Coloured area does not align with whole day rows and no border separates it from its neighbours");
          }
        }
      }

      // --- layers
      const roles = colsInRegion.map((c) => block.columns[c].role);
      const yearInLabel = /\bY\s?(\d)\b/i.exec(label);
      let layerKeys: string[];
      if (roles.every((r) => r.type === "sport")) {
        if (yearInLabel) {
          const l = layerFor(program || [...layers.values()][0].program, yearInLabel[1]);
          if (!layers.has(l.key)) {
            layers.set(l.key, l);
            warnings.push(`Page ${pageNo}: sport column mentions Y${yearInLabel[1]} which has no column of its own; layer "${l.key}" added`);
          }
          layerKeys = [l.key];
        } else layerKeys = allKeys();
      } else {
        const set = new Set<string>();
        for (const r of roles) {
          if (r.type === "layers") r.keys.forEach((k) => set.add(k));
          else allKeys().forEach((k) => set.add(k));
        }
        layerKeys = [...set].sort();
      }
      if (colsInRegion.length > 1) {
        const names = colsInRegion.map((c) => block.columns[c].header || "unlabeled").join(" + ");
        cap(75, `Cell is merged across columns ${names}; applied to ${layerKeys.join(", ")}`);
      }
      if (colsInRegion.some((c) => unknownHeaders.size > 0 && parseHeader(block.columns[c].header, program) === null)) {
        cap(60, `Column header "${block.columns[colsInRegion[0]].header}" not recognised; layer assignment is a guess`);
      }

      // --- kind
      let kind: AcademicKind = classifyLabel(label);
      const inSportColumn = roles.every((r) => r.type === "sport");
      if (inSportColumn && kind === "other" && /^(sport|eps)\b/i.test(label)) kind = "sport";
      for (const issue of labelIssues(label)) {
        if (kind !== "other" && /not recognised/.test(issue)) continue;
        cap(kind === "other" ? 80 : 84, issue);
      }
      if (/\?/.test(label)) cap(70, "Label contains a question mark in the source document (tentative entry)");
      if (/^s\d$/i.test(label)) cap(70, "Week number missing from the label (clipped in the PDF)");

      const bbox: [number, number, number, number] = [round2(x0), round2(y0), round2(x1), round2(rowY(endRow + 1))];
      const startDate = iso(block.year, block.month, r0 + 1);
      const endDate = iso(block.year, block.month, endRow + 1);
      for (const key of layerKeys) {
        candidates.push({
          layerKey: key,
          layerName: layers.get(key)?.name ?? key,
          label,
          kind,
          startDate,
          endDate,
          confidence,
          issues: [...issues],
          source: { page: pageNo, bbox, text: sourceText },
        });
      }
    }
  }

  return { title, versionLabel, layers: [...layers.values()], candidates: mergeContiguous(candidates) };
}

/**
 * Join cells that are obviously one period: same layer, same label, and the second
 * starts the day after the first ends (e.g. "S1 W4" split at a month boundary, or
 * "Reading days" printed on two consecutive one-day cells).
 */
function mergeContiguous(input: ParsedCandidate[]): ParsedCandidate[] {
  const sorted = [...input].sort(
    (a, b) => a.layerKey.localeCompare(b.layerKey) || a.label.localeCompare(b.label) || a.startDate.localeCompare(b.startDate),
  );
  const out: ParsedCandidate[] = [];
  for (const c of sorted) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.layerKey === c.layerKey &&
      prev.label === c.label &&
      prev.kind === c.kind &&
      prev.source.page === c.source.page &&
      nextDay(prev.endDate) === c.startDate
    ) {
      prev.endDate = c.endDate;
      prev.confidence = Math.min(prev.confidence, c.confidence);
      for (const i of c.issues) if (!prev.issues.includes(i)) prev.issues.push(i);
      const a = prev.source.bbox, b = c.source.bbox;
      prev.source = {
        page: prev.source.page,
        bbox: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])],
        text: prev.source.text === c.source.text ? prev.source.text : `${prev.source.text}\n${c.source.text}`,
      };
      const note = "Joined from adjacent cells with the same label";
      if (prev.confidence < 85 && !prev.issues.includes(note)) prev.issues.push(note);
    } else {
      out.push({ ...c, issues: [...c.issues], source: { ...c.source } });
    }
  }
  return out;
}
