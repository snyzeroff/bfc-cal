import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ImportReview } from "@/components/board/import-review";
import { db } from "@/db";
import { academicImports, academicLayers, importCandidates } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";

export const metadata = { title: "Review import" };

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("board_admin");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [[imp], candidates, layers] = await Promise.all([
    db.select().from(academicImports).where(eq(academicImports.id, id)),
    db.select().from(importCandidates).where(eq(importCandidates.importId, id)).orderBy(asc(importCandidates.startDate), asc(importCandidates.layerKey)),
    db.select().from(academicLayers).orderBy(asc(academicLayers.name)),
  ]);
  if (!imp) notFound();
  return (
    <ImportReview
      imp={{ id: imp.id, filename: imp.filename, title: imp.title, versionLabel: imp.versionLabel, format: imp.format, warnings: imp.warnings, sha256: imp.sha256, createdAt: imp.createdAt.toISOString() }}
      candidates={candidates.map((c) => ({
        id: c.id,
        layerKey: c.layerKey,
        layerName: c.layerName,
        label: c.label,
        kind: c.kind,
        start: c.startDate,
        end: c.endDate,
        confidence: c.confidence,
        issues: c.issues,
        status: c.status,
        edited: c.edited,
        sourceText: c.source.text ?? "",
        sourcePage: c.source.page ?? null,
        sourceBox: c.source.bbox ?? null,
      }))}
      existingLayers={layers.map((l) => ({ key: l.key, name: l.name }))}
    />
  );
}
