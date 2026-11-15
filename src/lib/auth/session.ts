import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, lt, sql as dsql } from "drizzle-orm";
import { db } from "@/db";
import { loginAttempts, sessions, users, type Role, type User } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { atLeast } from "@/lib/permissions";
import { hashToken, newToken, verifyPassword } from "./crypto";

const COOKIE = "bfc_session";
const SESSION_DAYS = 30;
const MAX_FAILURES = 8;
const WINDOW_MINUTES = 15;

export type SessionUser = Pick<User, "id" | "email" | "name" | "role" | "active">;

async function clientKey(email: string): Promise<string> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  return `${email.toLowerCase()}|${ip}`;
}

export async function login(email: string, password: string): Promise<SessionUser> {
  const key = await clientKey(email);
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);
  const [{ n }] = await db
    .select({ n: dsql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.key, key), eq(loginAttempts.success, false), gt(loginAttempts.at, since)));
  if (n >= MAX_FAILURES) {
    throw new AppError("rate_limited", `Too many attempts. Try again in ${WINDOW_MINUTES} minutes.`);
  }

  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim()));
  // Always run the KDF so response time does not reveal whether the account exists.
  const ok = await verifyPassword(password, user?.passwordHash ?? "scrypt$AAAAAAAAAAAAAAAAAAAAAA$AAAA");
  await db.insert(loginAttempts).values({ key, success: ok && !!user?.active });
  if (!ok || !user || !user.active) throw new AppError("unauthorized", "Incorrect email or password.");

  await createSession(user.id);
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  // Opportunistic clean-up of old rows.
  await db.delete(loginAttempts).where(lt(loginAttempts.at, new Date(Date.now() - 86_400_000)));
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  return user;
}

export async function createSession(userId: string) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  jar.delete(COOKIE);
}

/** The signed-in board user, re-read from the database on every request. */
export const getUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name, role: users.role, active: users.active })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())));
  if (!row || !row.active) return null;
  return row;
});

/** For pages: redirects to the login screen when there is no valid session. */
export async function requireUser(role: Role = "board_member"): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  if (!atLeast(user, role)) redirect("/board?denied=1");
  return user;
}

/** For server actions and route handlers: throws instead of redirecting. */
export async function requireActor(role: Role = "board_member"): Promise<SessionUser> {
  const user = await getUser();
  if (!user) throw new AppError("unauthorized", "Your session has expired. Please sign in again.");
  if (!atLeast(user, role)) throw new AppError("forbidden", "You do not have permission to do this.");
  return user;
}

export async function revokeAllSessions(userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
