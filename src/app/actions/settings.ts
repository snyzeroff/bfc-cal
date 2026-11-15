"use server";

import { and, eq, ne, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { ACADEMIC_KINDS, CATEGORY_KINDS, categories, events, inviteTokens, restrictionRules, users } from "@/db/schema";
import { run } from "@/lib/action";
import { appearanceSchema } from "@/lib/appearance";
import { audit, diff } from "@/lib/audit";
import { hashToken, newToken } from "@/lib/auth/crypto";
import { requireActor, revokeAllSessions } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { findRestrictedEvents } from "@/lib/events/service";
import { appUrl, revokeAllFeedTokens } from "@/lib/feeds";
import { ROLE_LABEL } from "@/lib/permissions";
import { feedSettingsSchema, readSetting, victorialesSchema, writeSetting } from "@/lib/settings";
import { formatIsoDay, isValidDateIso } from "@/lib/time";

const id = z.string().uuid();
const dateIso = z.string().refine(isValidDateIso, "Invalid date");
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/* ------------------------------------------------------------ Victoriales */

export async function saveVictorialesAction(input: { id: string; label: string; date: string | null; endDate: string | null }[]) {
  return run(async () => {
    const actor = await requireActor("super_admin");
    const next = victorialesSchema.parse(input);
    for (const ed of next) {
      if (ed.date && !isValidDateIso(ed.date)) throw new AppError("invalid", "Enter a valid Victoriales date.");
      if (ed.date && ed.endDate && ed.endDate < ed.date) throw new AppError("invalid", "The last day is before the first day.");
    }
    const before = await readSetting("victoriales");
    await writeSetting("victoriales", next, actor.id);
    const fmt = (list: typeof next) => list.map((e) => `${e.label}: ${e.date ? formatIsoDay(e.date, true) : "not set"}`).join("; ");
    await audit({
      actor,
      action: "settings.victoriales",
      entityType: "settings",
      entityId: "victoriales",
      summary: "Changed the Victoriales date — the 21-day restricted period was recalculated",
      changes: { victoriales: [fmt(before), fmt(next)] },
    });
    // Tell the admin which already-scheduled conferences now sit inside the restricted period.
    const affected = await findRestrictedEvents();
    return { affected: affected.map((a) => ({ id: a.event.id, title: a.event.title, overridden: !!a.event.overrideReason })) };
  });
}

/* ------------------------------------------------------------------ rules */

const ruleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(["date_range", "academic_kind"]),
  severity: z.enum(["hard", "soft"]),
  appliesTo: z.array(z.enum(CATEGORY_KINDS)).min(1, "Choose at least one event type"),
  startDate: dateIso.nullable().default(null),
  endDate: dateIso.nullable().default(null),
  kinds: z.array(z.enum(ACADEMIC_KINDS)).default([]),
  layerKeys: z.array(z.string().max(60)).default([]),
  message: z.string().max(300).default(""),
  active: z.boolean().default(true),
});
export type RuleInput = z.input<typeof ruleSchema>;

export async function saveRuleAction(ruleId: string | null, input: RuleInput) {
  return run(async () => {
    const actor = await requireActor("super_admin");
    const r = ruleSchema.parse(input);
    let params = {};
    if (r.type === "date_range") {
      if (!r.startDate || !r.endDate) throw new AppError("invalid", "Choose a start and an end date.");
      if (r.endDate < r.startDate) throw new AppError("invalid", "The end date is before the start date.");
      params = { startDate: r.startDate, endDate: r.endDate };
    } else {
      if (!r.kinds.length) throw new AppError("invalid", "Choose at least one kind of academic period.");
      params = { kinds: r.kinds, layerKeys: r.layerKeys };
    }
    const values = { name: r.name, type: r.type, severity: r.severity, appliesTo: r.appliesTo, params, message: r.message, active: r.active, updatedAt: new Date() };
    if (ruleId) {
      const [cur] = await db.select().from(restrictionRules).where(eq(restrictionRules.id, id.parse(ruleId)));
      if (!cur) throw new AppError("not_found", "This rule no longer exists.");
      if (cur.builtin) throw new AppError("invalid", "The Victoriales rule is built in. Change the Victoriales date instead.");
      await db.update(restrictionRules).set(values).where(eq(restrictionRules.id, cur.id));
      await audit({ actor, action: "rule.update", entityType: "rule", entityId: cur.id, summary: `Updated scheduling rule “${r.name}”`, changes: diff(cur as unknown as Record<string, unknown>, values, ["updatedAt"]) });
      return { id: cur.id };
    }
    const [row] = await db.insert(restrictionRules).values(values).returning();
    await audit({ actor, action: "rule.create", entityType: "rule", entityId: row.id, summary: `Created ${r.severity} scheduling rule “${r.name}”` });
    return { id: row.id };
  });
}

export async function toggleRuleAction(ruleId: string, active: boolean) {
  return run(async () => {
    const actor = await requireActor("super_admin");
    const [row] = await db.update(restrictionRules).set({ active, updatedAt: new Date() }).where(eq(restrictionRules.id, id.parse(ruleId))).returning();
    if (!row) throw new AppError("not_found", "This rule no longer exists.");
    await audit({ actor, action: active ? "rule.enable" : "rule.disable", entityType: "rule", entityId: row.id, summary: `${active ? "Enabled" : "Disabled"} scheduling rule “${row.name}”` });
    return undefined;
  });
}

export async function deleteRuleAction(ruleId: string) {
  return run(async () => {
    const actor = await requireActor("super_admin");
    const [cur] = await db.select().from(restrictionRules).where(eq(restrictionRules.id, id.parse(ruleId)));
    if (!cur) return undefined;
    if (cur.builtin) throw new AppError("invalid", "The Victoriales rule cannot be deleted.");
    await db.delete(restrictionRules).where(eq(restrictionRules.id, cur.id));
    await audit({ actor, action: "rule.delete", entityType: "rule", entityId: cur.id, summary: `Deleted scheduling rule “${cur.name}”` });
    return undefined;
  });
}

/* ------------------------------------------------------------- appearance */

export async function saveAppearanceAction(input: unknown) {
  return run(async () => {
    const actor = await requireActor("super_admin");
    const next = appearanceSchema.parse(input);
    if (next.dayEndHour <= next.dayStartHour) throw new AppError("invalid", "The day must end after it starts.");
    await writeSetting("appearance", next, actor.id);
    await audit({ actor, action: "settings.appearance", entityType: "settings", entityId: "appearance", summary: "Updated appearance settings" });
    return undefined;
  });
}

export async function saveFeedSettingsAction(input: { cancelledRetentionDays: number; refreshMinutes: number }) {
  return run(async () => {
    const actor = await requireActor("super_admin");
    await writeSetting("feed", feedSettingsSchema.parse(input), actor.id);
    await audit({ actor, action: "settings.feed", entityType: "settings", entityId: "feed", summary: "Updated calendar feed settings" });
    return undefined;
  });
}

/* ------------------------------------------------------------- categories */

const categorySchema = z.object({
  name: z.string().trim().min(1).max(40),
  kind: z.enum(CATEGORY_KINDS),
  color: hex,
  icon: z.string().max(30).default("calendar"),
});

export async function saveCategoryAction(categoryId: string | null, input: z.input<typeof categorySchema>) {
  return run(async () => {
    const actor = await requireActor("super_admin");
    const data = categorySchema.parse(input);
    const [clash] = await db
      .select()
      .from(categories)
      .where(and(dsql`lower(${categories.name}) = ${data.name.toLowerCase()}`, categoryId ? ne(categories.id, id.parse(categoryId)) : undefined));
    if (clash) throw new AppError("invalid", "A category with this name already exists.");
    if (categoryId) {
      await db.update(categories).set(data).where(eq(categories.id, categoryId));
      await audit({ actor, action: "category.update", entityType: "category", entityId: categoryId, summary: `Updated category “${data.name}”` });
      return { id: categoryId };
    }
    const [row] = await db.insert(categories).values({ ...data, sortOrder: 99 }).returning();
    await audit({ actor, action: "category.create", entityType: "category", entityId: row.id, summary: `Created category “${row.name}”` });
    return { id: row.id };
  });
}

export async function archiveCategoryAction(categoryId: string, archived: boolean) {
  return run(async () => {
    const actor = await requireActor("super_admin");
    const [row] = await db.update(categories).set({ archived }).where(eq(categories.id, id.parse(categoryId))).returning();
    if (!row) throw new AppError("not_found", "This category no longer exists.");
    if (!archived) return undefined;
    const [{ n }] = await db.select({ n: dsql<number>`count(*)::int` }).from(events).where(eq(events.categoryId, row.id));
    await audit({ actor, action: "category.archive", entityType: "category", entityId: row.id, summary: `Archived category “${row.name}” (${n} existing events keep it)` });
    return undefined;
  });
}

/* ------------------------------------------------------------------ users */

const INVITE_DAYS = 7;

async function issueInvite(userId: string) {
  const token = newToken();
  await db.delete(inviteTokens).where(eq(inviteTokens.userId, userId));
  await db.insert(inviteTokens).values({ userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) });
  return `${appUrl()}/invite/${token}`;
}

export async function inviteUserAction(input: { name: string; email: string; role: string }) {
  return run(async () => {
    const actor = await requireActor("super_admin");
    const data = z
      .object({ name: z.string().trim().min(1).max(80), email: z.string().trim().toLowerCase().email().max(200), role: z.enum(["super_admin", "board_admin", "board_member"]) })
      .parse(input);
    const [existing] = await db.select().from(users).where(eq(users.email, data.email));
    if (existing) throw new AppError("invalid", "Someone with this email already has an account.");
    const [user] = await db.insert(users).values(data).returning();
    const link = await issueInvite(user.id);
    await audit({ actor, action: "user.invite", entityType: "user", entityId: user.id, summary: `Invited ${user.name} as ${ROLE_LABEL[user.role]}` });
    return { id: user.id, link, expiresInDays: INVITE_DAYS };
  });
}

/** New one-time link for someone who lost their invitation or password. */
export async function resetLinkAction(userId: string) {
  return run(async () => {
    const actor = await requireActor("super_admin");
    const [user] = await db.select().from(users).where(eq(users.id, id.parse(userId)));
    if (!user) throw new AppError("not_found", "This user no longer exists.");
    if (!user.active) throw new AppError("invalid", "Reactivate this account first.");
    const link = await issueInvite(user.id);
    await audit({ actor, action: "user.reset_link", entityType: "user", entityId: user.id, summary: `Issued a password link for ${user.name}` });
    return { link, expiresInDays: INVITE_DAYS };
  });
}

async function assertNotLastSuperAdmin(userId: string) {
  const [{ n }] = await db
    .select({ n: dsql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, "super_admin"), eq(users.active, true), ne(users.id, userId)));
  if (n === 0) throw new AppError("invalid", "There must always be at least one active Super Admin.");
}

export async function updateUserAction(userId: string, input: { role?: string; active?: boolean; name?: string }) {
  return run(async () => {
    const actor = await requireActor("super_admin");
    const patch = z
      .object({ role: z.enum(["super_admin", "board_admin", "board_member"]).optional(), active: z.boolean().optional(), name: z.string().trim().min(1).max(80).optional() })
      .parse(input);
    const [user] = await db.select().from(users).where(eq(users.id, id.parse(userId)));
    if (!user) throw new AppError("not_found", "This user no longer exists.");
    const demoting = user.role === "super_admin" && ((patch.role && patch.role !== "super_admin") || patch.active === false);
    if (demoting) await assertNotLastSuperAdmin(user.id);
    await db.update(users).set({ ...patch, updatedAt: new Date() }).where(eq(users.id, user.id));
    if (patch.active === false) {
      // Losing access is immediate: sessions end and every private feed stops working.
      await revokeAllSessions(user.id);
      await revokeAllFeedTokens(user.id);
      await db.delete(inviteTokens).where(eq(inviteTokens.userId, user.id));
    }
    const changes = diff(user as unknown as Record<string, unknown>, patch);
    if (Object.keys(changes).length) {
      await audit({
        actor,
        action: patch.active === false ? "user.deactivate" : patch.active ? "user.reactivate" : "user.update",
        entityType: "user",
        entityId: user.id,
        summary:
          patch.active === false
            ? `Deactivated ${user.name} — sessions and private feeds revoked`
            : patch.role
              ? `Changed ${user.name}'s role to ${ROLE_LABEL[patch.role]}`
              : `Updated ${user.name}`,
        changes,
      });
    }
    return undefined;
  });
}
