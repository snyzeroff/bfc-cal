import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { academicEntries, academicImports, academicLayers, importCandidates, type AcademicKind } from "@/db/schema";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { canManageAcademic, type Actor } from "@/lib/permissions";
import { isValidDateIso } from "@/lib/time";
import { parseCsv, parseIcs } from "./parse-text";
import type { ParsedCalendar } from "./types";

type ActorUser = Actor & { name: string };

const LAYER_COLORS = ["#2F6FB5", "#7C6BD6", "#2F7D6B", "#B4532A", "#A8549B", "#8A6A1F"];
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

function assertAdmin(actor: ActorUser) {
  if (!canManageAcademic(actor)) throw new AppError("forbidden", "Only a Board Admin can manage academic calendars.");
}

export async function parseCalendarFile(filename: string, bytes: Uint8Array, layerName = ""): Promise<{ format: string; parsed: ParsedCalendar }> {
  const lower = filename.toLowerCase();
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 5));
  if (head === "%PDF-" || lower.endsWith(".pdf")) {
    if (head !== "%PDF-") throw new AppError("invalid", "This file has a .pdf extension but is not a PDF document.");
    const { parseAcademicPdf } = await import("./parse-pdf");
    try {
      return { format: "pdf", parsed: await parseAcademicPdf(bytes, filename) };
    } catch (e) {
      throw new AppError("invalid", e instanceof Error ? e.message : "This PDF could not be read.");
    }
  }
  const text = new TextDecoder("utf-8").decode(bytes);
  if (lower.endsWith(".ics") || text.includes("BEGIN:VCALENDAR")) return { format: "ics", parsed: parseIcs(text, filename, layerName) };
  if (lower.endsWith(".csv")) return { format: "csv", parsed: parseCsv(text, filename, layerName) };
  throw new AppError("invalid", "Unsupported file type. Import a PDF, an .ics calendar or a .csv file.");
}

/** Stores extracted periods as *candidates*. Nothing reaches the calendar until a human approves it. */
export async function importCalendar(actor: ActorUser, filename: string, bytes: Uint8Array, layerName = "") {
  assertAdmin(actor);
  if (bytes.byteLength === 0) throw new AppError("invalid", "The file is empty.");
  if (bytes.byteLength > MAX_IMPORT_BYTES) throw new AppError("invalid", "The file is larger than 8 MB.");
  const { format, parsed } = await parseCalendarFile(filename, bytes, layerName);
  if (parsed.candidates.length === 0) {
    throw new AppError("invalid", parsed.warnings[0] ?? "No dates could be extracted from this file. You can add periods manually instead.");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return db.transaction(async (tx) => {
    const [imp] = await tx
      .insert(academicImports)
      .values({ filename, sha256, title: parsed.title, versionLabel: parsed.versionLabel, format, warnings: parsed.warnings, uploadedBy: actor.id })
      .returning();
    for (let i = 0; i < parsed.candidates.length; i += 200) {
      await tx.insert(importCandidates).values(
        parsed.candidates.slice(i, i + 200).map((c) => ({
          importId: imp.id,
          layerKey: c.layerKey,
          layerName: c.layerName,
          label: c.label.slice(0, 200),
          kind: c.kind,
          startDate: c.startDate,
          endDate: c.endDate,
          confidence: Math.max(0, Math.min(100, Math.round(c.confidence))),
          issues: c.issues,
          source: { importId: imp.id, filename, page: c.source.page, bbox: c.source.bbox, text: c.source.text },
        })),
      );
    }
    await audit(
      { actor, action: "academic.import", entityType: "academic_import", entityId: imp.id, summary: `Imported “${filename}” — ${parsed.candidates.length} periods awaiting review` },
      tx,
    );
    return { id: imp.id, count: parsed.candidates.length, warnings: parsed.warnings };
  });
}

export async function editCandidate(
  actor: ActorUser,
  candidateId: string,
  patch: { label?: string; kind?: AcademicKind; startDate?: string; endDate?: string; layerKey?: string; layerName?: string },
) {
  assertAdmin(actor);
  const [c] = await db.select().from(importCandidates).where(eq(importCandidates.id, candidateId));
  if (!c) throw new AppError("not_found", "This row no longer exists.");
  if (c.status === "approved") throw new AppError("invalid", "This period is already approved. Edit it in the calendar layer instead.");
  const start = patch.startDate ?? c.startDate;
  const end = patch.endDate ?? c.endDate;
  if (!isValidDateIso(start) || !isValidDateIso(end)) throw new AppError("invalid", "Enter valid dates.");
  if (end < start) throw new AppError("invalid", "The end date is before the start date.");
  await db.update(importCandidates).set({ ...patch, edited: true }).where(eq(importCandidates.id, candidateId));
}

async function ensureLayer(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], key: string, name: string) {
  const [existing] = await tx.select().from(academicLayers).where(eq(academicLayers.key, key));
  if (existing) return existing;
  const all = await tx.select({ id: academicLayers.id }).from(academicLayers);
  const m = /^(.*?)-?(y\d)$/i.exec(key);
  const [row] = await tx
    .insert(academicLayers)
    .values({
      key,
      name,
      program: m ? m[1].toUpperCase() : "",
      yearGroup: m ? m[2].toUpperCase() : "",
      color: LAYER_COLORS[all.length % LAYER_COLORS.length],
      sortOrder: all.length,
    })
    .returning();
  return row;
}

/** A human vouches for these rows: they become verified entries on their layer. */
export async function approveCandidates(actor: ActorUser, candidateIds: string[]) {
  assertAdmin(actor);
  if (!candidateIds.length) return { approved: 0 };
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(importCandidates)
      .where(and(inArray(importCandidates.id, candidateIds), inArray(importCandidates.status, ["pending", "rejected"])));
    for (const c of rows) {
      const layer = await ensureLayer(tx, c.layerKey, c.layerName);
      await tx.insert(academicEntries).values({
        layerId: layer.id,
        label: c.label,
        kind: c.kind,
        startDate: c.startDate,
        endDate: c.endDate,
        verified: true,
        verifiedBy: actor.id,
        source: c.source,
        candidateId: c.id,
      });
      await tx.update(importCandidates).set({ status: "approved", reviewedBy: actor.id, reviewedAt: new Date() }).where(eq(importCandidates.id, c.id));
    }
    if (rows.length) {
      await audit(
        { actor, action: "academic.approve", entityType: "academic_import", entityId: rows[0].importId, summary: `Approved ${rows.length} imported academic period${rows.length > 1 ? "s" : ""}` },
        tx,
      );
    }
    return { approved: rows.length };
  });
}

export async function rejectCandidates(actor: ActorUser, candidateIds: string[]) {
  assertAdmin(actor);
  if (!candidateIds.length) return;
  await db
    .update(importCandidates)
    .set({ status: "rejected", reviewedBy: actor.id, reviewedAt: new Date() })
    .where(and(inArray(importCandidates.id, candidateIds), eq(importCandidates.status, "pending")));
}

/** Withdraws an approval: the verified entry is removed and the row goes back to review. */
export async function unapproveCandidate(actor: ActorUser, candidateId: string) {
  assertAdmin(actor);
  await db.transaction(async (tx) => {
    await tx.delete(academicEntries).where(eq(academicEntries.candidateId, candidateId));
    await tx.update(importCandidates).set({ status: "pending", reviewedBy: null, reviewedAt: null }).where(eq(importCandidates.id, candidateId));
  });
}

export async function deleteImport(actor: ActorUser, importId: string, removeEntries: boolean) {
  assertAdmin(actor);
  const [imp] = await db.select().from(academicImports).where(eq(academicImports.id, importId));
  if (!imp) return;
  await db.transaction(async (tx) => {
    if (removeEntries) {
      const ids = await tx.select({ id: importCandidates.id }).from(importCandidates).where(eq(importCandidates.importId, importId));
      if (ids.length) await tx.delete(academicEntries).where(inArray(academicEntries.candidateId, ids.map((i) => i.id)));
    }
    await tx.delete(academicImports).where(eq(academicImports.id, importId));
    await audit(
      { actor, action: "academic.import_delete", entityType: "academic_import", entityId: importId, summary: `Deleted import “${imp.filename}”${removeEntries ? " and its approved periods" : ""}` },
      tx,
    );
  });
}
