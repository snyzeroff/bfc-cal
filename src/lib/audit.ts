import "server-only";
import { db, type Tx } from "@/db";
import { auditLog } from "@/db/schema";

export type AuditInput = {
  actor: { id: string; name: string } | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  changes?: Record<string, [unknown, unknown]>;
  reason?: string | null;
};

export async function audit(input: AuditInput, tx: Tx | typeof db = db) {
  await tx.insert(auditLog).values({
    actorId: input.actor?.id ?? null,
    actorName: input.actor?.name ?? "System",
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    summary: input.summary,
    changes: input.changes && Object.keys(input.changes).length ? input.changes : null,
    reason: input.reason ?? null,
  });
}

const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v === undefined ? null : v);

/** Field-level before/after for the keys present in `patch`. */
export function diff<T extends Record<string, unknown>>(
  before: T,
  patch: Partial<T>,
  ignore: string[] = [],
): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (ignore.includes(k) || v === undefined) continue;
    const a = norm(before[k]);
    const b = norm(v);
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = [a, b];
  }
  return out;
}
