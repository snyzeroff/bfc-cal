"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { ACADEMIC_KINDS, academicEntries, academicLayers } from "@/db/schema";
import { run } from "@/lib/action";
import { audit } from "@/lib/audit";
import { requireActor } from "@/lib/auth/session";
import { approveCandidates, deleteImport, editCandidate, importCalendar, rejectCandidates, unapproveCandidate } from "@/lib/academic/service";
import { AppError } from "@/lib/errors";
import { isValidDateIso } from "@/lib/time";

const id = z.string().uuid();
const dateIso = z.string().refine(isValidDateIso, "Invalid date");
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export async function importCalendarAction(form: FormData) {
  return run(async () => {
    const actor = await requireActor("board_admin");
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("invalid", "Choose a file to import.");
    const layerName = String(form.get("layerName") ?? "").slice(0, 80);
    const bytes = new Uint8Array(await file.arrayBuffer());
    return importCalendar(actor, file.name.slice(0, 200), bytes, layerName);
  });
}

export async function editCandidateAction(
  candidateId: string,
  input: { label?: string; kind?: string; startDate?: string; endDate?: string; layerKey?: string; layerName?: string },
) {
  return run(async () => {
    const actor = await requireActor("board_admin");
    const patch = z
      .object({
        label: z.string().trim().min(1).max(200).optional(),
        kind: z.enum(ACADEMIC_KINDS).optional(),
        startDate: dateIso.optional(),
        endDate: dateIso.optional(),
        layerKey: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
        layerName: z.string().min(1).max(80).optional(),
      })
      .parse(input);
    await editCandidate(actor, id.parse(candidateId), patch);
    return undefined;
  });
}

export async function reviewCandidatesAction(candidateIds: string[], decision: "approve" | "reject" | "reset") {
  return run(async () => {
    const actor = await requireActor("board_admin");
    const ids = z.array(id).max(2000).parse(candidateIds);
    if (decision === "approve") return approveCandidates(actor, ids);
    if (decision === "reject") await rejectCandidates(actor, ids);
    else for (const c of ids) await unapproveCandidate(actor, c);
    return { approved: 0 };
  });
}

export async function deleteImportAction(importId: string, removeEntries: boolean) {
  return run(async () => {
    const actor = await requireActor("board_admin");
    await deleteImport(actor, id.parse(importId), removeEntries);
    return undefined;
  });
}

/* ---------------------------------------------------------------- layers */

export async function saveLayerAction(layerId: string | null, input: { name: string; color: string; visibleByDefault: boolean; program?: string; yearGroup?: string }) {
  return run(async () => {
    const actor = await requireActor("board_admin");
    const data = z
      .object({ name: z.string().trim().min(1).max(80), color: hex, visibleByDefault: z.boolean(), program: z.string().max(40).default(""), yearGroup: z.string().max(20).default("") })
      .parse(input);
    if (layerId) {
      await db.update(academicLayers).set(data).where(eq(academicLayers.id, id.parse(layerId)));
      return { id: layerId };
    }
    const key = data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "layer";
    const [clash] = await db.select().from(academicLayers).where(eq(academicLayers.key, key));
    if (clash) throw new AppError("invalid", "A layer with this name already exists.");
    const [row] = await db.insert(academicLayers).values({ ...data, key }).returning();
    await audit({ actor, action: "academic.layer_create", entityType: "academic_layer", entityId: row.id, summary: `Created calendar layer “${row.name}”` });
    return { id: row.id };
  });
}

export async function deleteLayerAction(layerId: string) {
  return run(async () => {
    const actor = await requireActor("board_admin");
    const [row] = await db.delete(academicLayers).where(eq(academicLayers.id, id.parse(layerId))).returning();
    if (row) await audit({ actor, action: "academic.layer_delete", entityType: "academic_layer", entityId: row.id, summary: `Deleted calendar layer “${row.name}” and its periods` });
    return undefined;
  });
}

/* --------------------------------------------------------------- entries */

const entrySchema = z.object({
  layerId: id,
  label: z.string().trim().min(1, "A label is required").max(200),
  kind: z.enum(ACADEMIC_KINDS),
  startDate: dateIso,
  endDate: dateIso,
});

export async function saveEntryAction(entryId: string | null, input: z.input<typeof entrySchema>) {
  return run(async () => {
    const actor = await requireActor("board_admin");
    const data = entrySchema.parse(input);
    if (data.endDate < data.startDate) throw new AppError("invalid", "The end date is before the start date.");
    if (entryId) {
      // Editing is itself a human verification of the new values.
      await db.update(academicEntries).set({ ...data, verified: true, verifiedBy: actor.id, updatedAt: new Date() }).where(eq(academicEntries.id, id.parse(entryId)));
      await audit({ actor, action: "academic.entry_update", entityType: "academic_entry", entityId: entryId, summary: `Edited academic period “${data.label}”` });
      return { id: entryId };
    }
    const [row] = await db
      .insert(academicEntries)
      .values({ ...data, verified: true, verifiedBy: actor.id, source: { text: `Entered manually by ${actor.name}` } })
      .returning();
    await audit({ actor, action: "academic.entry_create", entityType: "academic_entry", entityId: row.id, summary: `Added academic period “${row.label}”` });
    return { id: row.id };
  });
}

export async function deleteEntryAction(entryId: string) {
  return run(async () => {
    const actor = await requireActor("board_admin");
    const [row] = await db.delete(academicEntries).where(eq(academicEntries.id, id.parse(entryId))).returning();
    if (row) await audit({ actor, action: "academic.entry_delete", entityType: "academic_entry", entityId: row.id, summary: `Deleted academic period “${row.label}”` });
    return undefined;
  });
}
