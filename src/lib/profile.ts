import "server-only";
import { and, eq, ne, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users, type Role } from "@/db/schema";
import { audit } from "@/lib/audit";
import { MIN_PASSWORD_LENGTH, hashPassword, verifyPassword } from "@/lib/auth/crypto";
import { assertNotThrottled, countActiveSessions, recordAttempt, revokeOtherSessions } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";

/**
 * Self-service account changes. Every function acts on the user whose id is
 * passed in — callers take that id from the session, never from the client —
 * and only ever writes name, email or password: role and active are out of reach.
 */

export const NAME_MAX = 80;
const EMAIL_MAX = 200;
const PASSWORD_MAX = 200;

const nameRule = z.string().trim().min(1, "Enter a name.").max(NAME_MAX, `Use at most ${NAME_MAX} characters.`);
const emailRule = z.string().trim().toLowerCase().max(EMAIL_MAX, "This email is too long.").email("Enter a valid email address.");
const newPasswordRule = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters.`);

function check<T>(rule: z.ZodType<T>, value: unknown): T {
  const res = rule.safeParse(value);
  if (!res.success) throw new AppError("invalid", res.error.issues[0]?.message ?? "Invalid input.");
  return res.data;
}

export type Profile = {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: Date;
  lastLoginAt: Date | null;
  activeSessions: number;
};

/** What the profile page shows. The password hash is never selected. */
export async function getProfile(userId: string): Promise<Profile> {
  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, createdAt: users.createdAt, lastLoginAt: users.lastLoginAt })
    .from(users)
    .where(eq(users.id, userId));
  if (!row) throw new AppError("not_found", "This account no longer exists.");
  return { ...row, activeSessions: await countActiveSessions(userId) };
}

async function loadAccount(userId: string) {
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email, passwordHash: users.passwordHash, active: users.active })
    .from(users)
    .where(eq(users.id, userId));
  if (!user || !user.active) throw new AppError("unauthorized", "Your session has expired. Please sign in again.");
  return user;
}

/** One answer for every failure (wrong password, no password set), so nothing else can be learnt from it. */
async function assertCurrentPassword(user: { id: string; passwordHash: string | null }, password: unknown) {
  // A stolen session must not be able to guess the password without limit.
  const key = `password|${user.id}`;
  await assertNotThrottled(key);
  const ok = typeof password === "string" && password.length <= PASSWORD_MAX && (await verifyPassword(password, user.passwordHash));
  if (!ok) {
    await recordAttempt(key, false);
    throw new AppError("invalid", "Current password is incorrect.");
  }
}

const isUniqueViolation = (err: unknown) =>
  (err as { code?: string } | null)?.code === "23505" || (err as { cause?: { code?: string } } | null)?.cause?.code === "23505";

export async function updateName(userId: string, input: { name: string }): Promise<{ name: string }> {
  const name = check(nameRule, input.name);
  const user = await loadAccount(userId);
  if (name === user.name) return { name };
  await db.transaction(async (tx) => {
    await tx.update(users).set({ name, updatedAt: new Date() }).where(eq(users.id, user.id));
    await audit(
      { actor: { id: user.id, name: user.name }, action: "user.name_change", entityType: "user", entityId: user.id, summary: `Changed their display name from “${user.name}” to “${name}”`, changes: { name: [user.name, name] } },
      tx,
    );
  });
  return { name };
}

export async function changeEmail(userId: string, input: { email: string; currentPassword: string }): Promise<{ email: string }> {
  const email = check(emailRule, input.email);
  const user = await loadAccount(userId);
  // The password comes first: without it, this must not reveal which addresses have an account.
  await assertCurrentPassword(user, input.currentPassword);
  if (email === user.email) return { email };
  const taken = new AppError("invalid", "This email is already used by another account.");
  const [other] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(dsql`lower(${users.email}) = ${email}`, ne(users.id, user.id)));
  if (other) throw taken;
  try {
    await db.transaction(async (tx) => {
      await tx.update(users).set({ email, updatedAt: new Date() }).where(eq(users.id, user.id));
      await audit(
        { actor: { id: user.id, name: user.name }, action: "user.email_change", entityType: "user", entityId: user.id, summary: `Changed their email to ${email}`, changes: { email: [user.email, email] } },
        tx,
      );
    });
  } catch (err) {
    // Two people claiming the same address at the same moment: the unique index decides.
    if (isUniqueViolation(err)) throw taken;
    throw err;
  }
  return { email };
}

/** Sets a new password and signs the user out everywhere except the session identified by `keepTokenHash`. */
export async function changePassword(
  userId: string,
  input: { currentPassword: string; newPassword: string },
  keepTokenHash: string,
): Promise<{ revokedSessions: number }> {
  const newPassword = check(newPasswordRule, input.newPassword);
  const user = await loadAccount(userId);
  await assertCurrentPassword(user, input.currentPassword);
  if (newPassword === input.currentPassword) throw new AppError("invalid", "Choose a password different from the current one.");
  const passwordHash = await hashPassword(newPassword);
  const revokedSessions = await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, user.id));
    const revoked = await revokeOtherSessions(user.id, keepTokenHash, tx);
    await audit(
      { actor: { id: user.id, name: user.name }, action: "user.password_change", entityType: "user", entityId: user.id, summary: `Changed their password — ${revoked} other ${revoked === 1 ? "session" : "sessions"} signed out` },
      tx,
    );
    return revoked;
  });
  return { revokedSessions };
}

export async function signOutOtherSessions(userId: string, keepTokenHash: string): Promise<{ revokedSessions: number }> {
  const user = await loadAccount(userId);
  return { revokedSessions: await revokeOtherSessions(user.id, keepTokenHash) };
}
