"use server";

import { redirect } from "next/navigation";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { inviteTokens, users } from "@/db/schema";
import { run } from "@/lib/action";
import { audit } from "@/lib/audit";
import { MIN_PASSWORD_LENGTH, hashPassword, hashToken } from "@/lib/auth/crypto";
import { createSession, login, logout } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";

const loginSchema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

export async function loginAction(input: { email: string; password: string }) {
  return run(async () => {
    const { email, password } = loginSchema.parse(input);
    const user = await login(email, password);
    return { name: user.name };
  });
}

export async function logoutAction() {
  await logout();
  redirect("/");
}

export async function acceptInviteAction(input: { token: string; password: string }) {
  return run(async () => {
    const { token, password } = z.object({ token: z.string().min(20).max(100), password: z.string().max(200) }).parse(input);
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new AppError("invalid", `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    const [row] = await db
      .select({ invite: inviteTokens, user: users })
      .from(inviteTokens)
      .innerJoin(users, eq(users.id, inviteTokens.userId))
      .where(and(eq(inviteTokens.tokenHash, hashToken(token)), isNull(inviteTokens.usedAt), gt(inviteTokens.expiresAt, new Date())));
    if (!row || !row.user.active) throw new AppError("invalid", "This link has expired or was already used. Ask an administrator for a new one.");
    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash: await hashPassword(password), updatedAt: new Date() }).where(eq(users.id, row.user.id));
      await tx.update(inviteTokens).set({ usedAt: new Date() }).where(eq(inviteTokens.userId, row.user.id));
      await audit({ actor: row.user, action: "user.password_set", entityType: "user", entityId: row.user.id, summary: `${row.user.name} set their password` }, tx);
    });
    await createSession(row.user.id);
    return { name: row.user.name };
  });
}

/**
 * First-run setup: creates the first Super Admin. Only works while the
 * database has no user at all; afterwards accounts come from invitations.
 */
export async function setupAction(input: { name: string; email: string; password: string }) {
  return run(async () => {
    const data = z
      .object({ name: z.string().trim().min(1, "Enter your name").max(80), email: z.string().trim().toLowerCase().email("Enter a valid email").max(200), password: z.string().max(200) })
      .parse(input);
    if (data.password.length < MIN_PASSWORD_LENGTH) throw new AppError("invalid", `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
    const { ensureBaseData } = await import("@/lib/bootstrap");
    const res = await ensureBaseData(data);
    if (!res.createdAdmin) throw new AppError("forbidden", "This site is already set up. Ask a Super Admin for an invitation.");
    const [user] = await db.select().from(users).where(eq(users.email, data.email));
    await audit({ actor: user, action: "user.setup", entityType: "user", entityId: user.id, summary: `${user.name} created the first Super Admin account` });
    await createSession(user.id);
    return { name: user.name };
  });
}
