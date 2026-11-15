import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { signupLinks, users, type Role, type SignupLink } from "@/db/schema";
import { appUrl } from "@/lib/app-url";
import { audit } from "@/lib/audit";
import { MIN_PASSWORD_LENGTH, hashPassword, hashToken, newToken } from "@/lib/auth/crypto";
import { assertNotThrottled, recordAttempt } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { ROLE_LABEL, isSuperAdmin, type Actor } from "@/lib/permissions";
import { formatDayYear } from "@/lib/time";

/**
 * Shareable invitation links. Anyone who holds the link can create one account
 * with the link's role, until the quota is used up, the link expires or a Super
 * Admin revokes it. Every rule is enforced here, not in the interface.
 */

export type LinkActor = Actor & { name: string };

/** Roles a link may grant. Super Admin is deliberately absent. */
export const LINK_ROLES = ["board_member", "board_admin"] as const;
export type LinkRole = (typeof LINK_ROLES)[number];

export const MAX_LINK_USES = 100;
export const MAX_LINK_DAYS = 30;

/** One message for unknown, expired, revoked and full links: the caller learns nothing more. */
export const INVALID_LINK_MESSAGE = "This invitation link is no longer valid.";
const EMAIL_UNAVAILABLE_MESSAGE = "An account could not be created with this email. If you already have one, sign in instead.";

export type SignupLinkStatus = "active" | "expired" | "full" | "revoked";

export type SignupLinkInfo = {
  id: string;
  label: string;
  role: Role;
  maxUses: number;
  uses: number;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  createdByName: string | null;
  status: SignupLinkStatus;
  /** Accounts created through this link, oldest first. */
  members: { id: string; name: string }[];
};

export type JoinedUser = { id: string; name: string; email: string; role: Role; signupLinkId: string | null };

function assertSuperAdmin(actor: LinkActor) {
  if (!isSuperAdmin(actor)) throw new AppError("forbidden", "Only a Super Admin can manage invitation links.");
}

/** Validation failures become AppError("invalid") with a message that can be shown as is. */
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const res = schema.safeParse(input);
  if (!res.success) throw new AppError("invalid", res.error.issues[0]?.message ?? "Invalid input.");
  return res.data;
}

const createSchema = z.object({
  label: z.string("Give the link a name.").trim().min(1, "Give the link a name.").max(60, "The name is too long (60 characters at most)."),
  role: z.enum(LINK_ROLES, "Choose Board Member or Board Admin."),
  maxUses: z
    .number("Enter a number of accounts.")
    .int("Enter a whole number of accounts.")
    .min(1, "A link must allow at least 1 account.")
    .max(MAX_LINK_USES, `A link can create ${MAX_LINK_USES} accounts at most.`),
  expiresInDays: z
    .number("Enter a validity in days.")
    .int("Enter a whole number of days.")
    .min(1, "A link must be valid for at least 1 day.")
    .max(MAX_LINK_DAYS, `A link can be valid for ${MAX_LINK_DAYS} days at most.`),
});

const redeemSchema = z.object({
  name: z.string("Enter your name.").trim().min(1, "Enter your name.").max(80, "This name is too long."),
  email: z.string("Enter a valid email.").trim().toLowerCase().email("Enter a valid email.").max(200, "Enter a valid email."),
  password: z.string("Choose a password.").max(200, "This password is too long."),
});

const statusOf = (l: Pick<SignupLink, "revokedAt" | "expiresAt" | "uses" | "maxUses">, now = new Date()): SignupLinkStatus =>
  l.revokedAt ? "revoked" : l.expiresAt <= now ? "expired" : l.uses >= l.maxUses ? "full" : "active";

/** Null for anything that cannot be one of our tokens, so junk never reaches the database. */
const tokenHashOf = (token: unknown) => (typeof token === "string" && /^[A-Za-z0-9_-]{30,64}$/.test(token) ? hashToken(token) : null);

/** The conditions under which a link may still create an account, evaluated by the database. */
const usable = (tokenHash: string) =>
  and(
    eq(signupLinks.tokenHash, tokenHash),
    isNull(signupLinks.revokedAt),
    gt(signupLinks.expiresAt, dsql`now()`),
    lt(signupLinks.uses, signupLinks.maxUses),
    // A link stops working when its author is deactivated, demoted or deleted.
    dsql`exists (select 1 from ${users} where ${users.id} = ${signupLinks.createdBy} and ${users.active} and ${users.role} = 'super_admin')`,
  );

/* ------------------------------------------------------------- management */

export async function createSignupLink(
  actor: LinkActor,
  input: { label: string; role: string; maxUses: number; expiresInDays: number },
): Promise<{ id: string; url: string }> {
  assertSuperAdmin(actor);
  if (input?.role === "super_admin") {
    throw new AppError("invalid", "A link cannot grant the Super Admin role. Super Admins must be promoted individually.");
  }
  const data = parse(createSchema, input);
  const token = newToken();
  const expiresAt = new Date(Date.now() + data.expiresInDays * 86_400_000);
  const [row] = await db
    .insert(signupLinks)
    .values({ tokenHash: hashToken(token), label: data.label, role: data.role, maxUses: data.maxUses, expiresAt, createdBy: actor.id })
    .returning();
  await audit({
    actor,
    action: "signup_link.create",
    entityType: "signup_link",
    entityId: row.id,
    summary: `Created invitation link “${row.label}”: ${ROLE_LABEL[row.role]}, up to ${row.maxUses} account${row.maxUses === 1 ? "" : "s"}, expires ${formatDayYear(expiresAt)}`,
  });
  // The secret is returned once and never stored in clear text.
  return { id: row.id, url: `${appUrl()}/join/${token}` };
}

export async function listSignupLinks(actor: LinkActor): Promise<SignupLinkInfo[]> {
  assertSuperAdmin(actor);
  const rows = await db
    .select({ link: signupLinks, createdByName: users.name })
    .from(signupLinks)
    .leftJoin(users, eq(users.id, signupLinks.createdBy))
    .orderBy(desc(signupLinks.createdAt))
    .limit(100);
  if (!rows.length) return [];
  const joined = await db
    .select({ id: users.id, name: users.name, linkId: users.signupLinkId })
    .from(users)
    .where(inArray(users.signupLinkId, rows.map((r) => r.link.id)))
    .orderBy(asc(users.createdAt), asc(users.name));
  const now = new Date();
  return rows.map(({ link, createdByName }) => ({
    id: link.id,
    label: link.label,
    role: link.role,
    maxUses: link.maxUses,
    uses: link.uses,
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt,
    createdAt: link.createdAt,
    createdByName,
    status: statusOf(link, now),
    members: joined.filter((u) => u.linkId === link.id).map((u) => ({ id: u.id, name: u.name })),
  }));
}

export async function revokeSignupLink(actor: LinkActor, linkId: string): Promise<void> {
  assertSuperAdmin(actor);
  const id = parse(z.string().uuid("This invitation link no longer exists."), linkId);
  const [row] = await db
    .update(signupLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(signupLinks.id, id), isNull(signupLinks.revokedAt)))
    .returning();
  if (!row) {
    const [existing] = await db.select({ id: signupLinks.id }).from(signupLinks).where(eq(signupLinks.id, id));
    if (!existing) throw new AppError("not_found", "This invitation link no longer exists.");
    return; // already revoked
  }
  await audit({
    actor,
    action: "signup_link.revoke",
    entityType: "signup_link",
    entityId: row.id,
    summary: `Revoked invitation link “${row.label}” (${row.uses} / ${row.maxUses} used)`,
  });
}

/* ----------------------------------------------------------------- public */

/**
 * What the public page may know about a link: that it works, and the role it
 * grants. Not its name, who made it, or how many places are left.
 */
export async function inspectSignupLink(token: string): Promise<{ role: Role; roleLabel: string } | null> {
  const hash = tokenHashOf(token);
  if (!hash) return null;
  const [row] = await db.select({ role: signupLinks.role }).from(signupLinks).where(usable(hash));
  return row ? { role: row.role, roleLabel: ROLE_LABEL[row.role] } : null;
}

/** Drizzle wraps the driver error, so look through `cause` for the unique-email violation. */
function isEmailTaken(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; constraint_name?: string; cause?: unknown };
  return (e.code === "23505" && e.constraint_name === "users_email_unique") || isEmailTaken(e.cause);
}

/**
 * Creates an account through a link. `throttleKey` (e.g. `join|<ip>`) limits
 * failed attempts the way sign-in does; the caller supplies it so this function
 * does not depend on the request.
 */
export async function redeemSignupLink(
  token: string,
  input: { name: string; email: string; password: string },
  opts: { throttleKey?: string } = {},
): Promise<JoinedUser> {
  const data = parse(redeemSchema, input);
  if (data.password.length < MIN_PASSWORD_LENGTH) {
    throw new AppError("invalid", `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  const key = opts.throttleKey;
  if (key) await assertNotThrottled(key);
  const record = async (success: boolean) => {
    if (key) await recordAttempt(key, success);
  };

  // Cheap refusal before the (deliberately slow) password hash. Not the guarantee: see the UPDATE below.
  const hash = tokenHashOf(token);
  const [candidate] = hash ? await db.select({ id: signupLinks.id }).from(signupLinks).where(usable(hash)) : [];
  if (!hash || !candidate) {
    await record(false);
    throw new AppError("invalid", INVALID_LINK_MESSAGE);
  }
  const passwordHash = await hashPassword(data.password);

  let user: JoinedUser;
  try {
    user = await db.transaction(async (tx) => {
      // Takes one place atomically: concurrent sign-ups queue on this row and the
      // last place can only be taken once. Any error below rolls the counter back.
      const [link] = await tx
        .update(signupLinks)
        .set({ uses: dsql`${signupLinks.uses} + 1` })
        .where(usable(hash))
        .returning();
      if (!link) throw new AppError("invalid", INVALID_LINK_MESSAGE);
      const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, data.email));
      if (existing) throw new AppError("invalid", EMAIL_UNAVAILABLE_MESSAGE);
      const [row] = await tx
        .insert(users)
        .values({ name: data.name, email: data.email, passwordHash, role: link.role, signupLinkId: link.id })
        .returning({ id: users.id, name: users.name, email: users.email, role: users.role, signupLinkId: users.signupLinkId });
      await audit(
        {
          actor: row,
          action: "user.join",
          entityType: "user",
          entityId: row.id,
          summary: `${row.name} created an account as ${ROLE_LABEL[row.role]} with invitation link “${link.label}”`,
        },
        tx,
      );
      return row;
    });
  } catch (err) {
    // Two sign-ups with the same email at the same instant: the unique constraint decides.
    const known = err instanceof AppError ? err : isEmailTaken(err) ? new AppError("invalid", EMAIL_UNAVAILABLE_MESSAGE) : null;
    if (!known) throw err;
    await record(false);
    throw known;
  }
  await record(true);
  return user;
}
