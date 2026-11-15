import { asc, desc } from "drizzle-orm";
import { SettingsPanel } from "@/components/board/settings";
import { db } from "@/db";
import { academicLayers, auditLog, categories, restrictionRules, users } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { findRestrictedEvents } from "@/lib/events/service";
import { getSetting } from "@/lib/settings";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireUser("super_admin");
  const [{ tab }, victoriales, appearance, feed, rules, cats, people, audit, layers, affected] = await Promise.all([
    searchParams,
    getSetting("victoriales"),
    getSetting("appearance"),
    getSetting("feed"),
    db.select().from(restrictionRules).orderBy(desc(restrictionRules.builtin), asc(restrictionRules.createdAt)),
    db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name)),
    db.select().from(users).orderBy(asc(users.name)),
    db.select().from(auditLog).orderBy(desc(auditLog.at)).limit(300),
    db.select().from(academicLayers).orderBy(asc(academicLayers.name)),
    findRestrictedEvents(),
  ]);
  return (
    <SettingsPanel
      initialTab={tab}
      victoriales={victoriales}
      appearance={appearance}
      feed={feed}
      rules={rules.map((r) => ({ id: r.id, name: r.name, type: r.type, severity: r.severity, appliesTo: r.appliesTo, params: r.params, message: r.message, active: r.active, builtin: r.builtin }))}
      categories={cats.map((c) => ({ id: c.id, name: c.name, kind: c.kind, color: c.color, icon: c.icon, archived: c.archived }))}
      users={people.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, hasPassword: !!u.passwordHash, lastLoginAt: u.lastLoginAt?.toISOString() ?? null }))}
      audit={audit.map((a) => ({ id: a.id, actorName: a.actorName, action: a.action, entityType: a.entityType, entityId: a.entityId, summary: a.summary, reason: a.reason, at: a.at.toISOString() }))}
      layers={layers.map((l) => ({ key: l.key, name: l.name }))}
      affected={affected.map((a) => ({ id: a.event.id, title: a.event.title, overridden: !!a.event.overrideReason }))}
    />
  );
}
