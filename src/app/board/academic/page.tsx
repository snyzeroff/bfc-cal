import { asc, desc, eq, sql as dsql } from "drizzle-orm";
import { AcademicManager } from "@/components/board/academic";
import { db } from "@/db";
import { academicEntries, academicImports, academicLayers, importCandidates, users } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";

export const metadata = { title: "Academic calendars" };

export default async function AcademicPage() {
  await requireUser();
  const [layers, entries, imports] = await Promise.all([
    db.select().from(academicLayers).orderBy(asc(academicLayers.sortOrder), asc(academicLayers.name)),
    db
      .select({ e: academicEntries, verifier: users.name })
      .from(academicEntries)
      .leftJoin(users, eq(users.id, academicEntries.verifiedBy))
      .orderBy(asc(academicEntries.startDate)),
    db
      .select({
        i: academicImports,
        uploader: users.name,
        pending: dsql<number>`(select count(*)::int from ${importCandidates} c where c.import_id = ${academicImports.id} and c.status = 'pending')`,
        approved: dsql<number>`(select count(*)::int from ${importCandidates} c where c.import_id = ${academicImports.id} and c.status = 'approved')`,
        total: dsql<number>`(select count(*)::int from ${importCandidates} c where c.import_id = ${academicImports.id})`,
      })
      .from(academicImports)
      .leftJoin(users, eq(users.id, academicImports.uploadedBy))
      .orderBy(desc(academicImports.createdAt)),
  ]);
  return (
    <AcademicManager
      layers={layers.map((l) => ({ id: l.id, key: l.key, name: l.name, program: l.program, yearGroup: l.yearGroup, color: l.color, visibleByDefault: l.visibleByDefault }))}
      entries={entries.map(({ e, verifier }) => ({
        id: e.id,
        layerId: e.layerId,
        label: e.label,
        kind: e.kind,
        start: e.startDate,
        end: e.endDate,
        verifiedBy: verifier,
        source: e.source.filename ? `${e.source.filename}${e.source.page ? `, p. ${e.source.page}` : ""}` : (e.source.text ?? ""),
      }))}
      imports={imports.map(({ i, uploader, pending, approved, total }) => ({
        id: i.id,
        filename: i.filename,
        title: i.title,
        versionLabel: i.versionLabel,
        format: i.format,
        createdAt: i.createdAt.toISOString(),
        uploader,
        pending,
        approved,
        total,
      }))}
    />
  );
}
