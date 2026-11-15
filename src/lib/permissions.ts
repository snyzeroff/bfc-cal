import type { Role } from "@/db/schema";

/** Minimal shape so this module stays pure and testable. */
export type Actor = { id: string; role: Role; active: boolean };

const RANK: Record<Role, number> = { board_member: 1, board_admin: 2, super_admin: 3 };

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super Admin",
  board_admin: "Board Admin",
  board_member: "Board Member",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  super_admin: "Full access: users, settings, restrictions, feeds, overrides and audit log.",
  board_admin: "Manages every conference and speaker, assigns tasks and approves publication.",
  board_member: "Proposes conferences and speakers, edits their own events and assigned tasks.",
};

export const atLeast = (actor: Actor, role: Role) => actor.active && RANK[actor.role] >= RANK[role];
export const isAdmin = (actor: Actor) => atLeast(actor, "board_admin");
export const isSuperAdmin = (actor: Actor) => atLeast(actor, "super_admin");

export type EventAccess = { createdBy: string | null; organizerIds: string[] };

/** Board members may edit events they created or organise; admins edit everything. */
export function canEditEvent(actor: Actor, ev: EventAccess): boolean {
  if (!actor.active) return false;
  if (isAdmin(actor)) return true;
  return ev.createdBy === actor.id || ev.organizerIds.includes(actor.id);
}

export const canPublish = isAdmin;
export const canArchiveEvent = isAdmin;
export const canDeleteEvent = isSuperAdmin;
export const canOverrideRestriction = isSuperAdmin;
export const canManageSpeakers = isAdmin;
export const canManageAcademic = isAdmin;
export const canManageSettings = isSuperAdmin;
export const canManageUsers = isSuperAdmin;
export const canViewAudit = isSuperAdmin;
export const canAssignTasks = isAdmin;

export function canEditSpeaker(actor: Actor, sp: { ownerId: string | null }): boolean {
  return actor.active && (isAdmin(actor) || sp.ownerId === actor.id);
}

export function canEditTask(
  actor: Actor,
  task: { assigneeId: string | null; createdBy: string | null },
): boolean {
  return actor.active && (isAdmin(actor) || task.assigneeId === actor.id || task.createdBy === actor.id);
}
