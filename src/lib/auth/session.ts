import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, lt, ne, sql as dsql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { loginAttempts, sessions, users, type Role, type User } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { atLeast } from "@/lib/permissions";
import { hashPassword, hashToken, newToken, verifyPassword } from "./crypto";

const COOKIE = "bfc_session";
const SESSION_DAYS = 30;
const MAX_FAILURES = 8;
const MAX_FAILURES_PER_ACCOUNT = 20;
const WINDOW_MINUTES = 15;

export type SessionUser = Pick<User, "id" | "email" | "name" | "role" | "active">;

/** Never matches: a full-length hash of a random secret, used to keep response time constant. */
const DUMMY_HASH = hashPassword(newToken());

const windowStart = () => new Date(Date.now() - WINDOW_MINUTES * 60_000);
const tooMany = () => new AppError("rate_limited", `Too many attempts. Try again in ${WINDOW_MINUTES} minutes.`);

/** Refuses once `max` failures are on record for the key in the current window. */
export async function assertNotThrottled(key: string, max = MAX_FAILURES) {
  const [{ n }] = await db
    .select({ n: dsql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.key, key), eq(loginAttempts.success, false), gt(loginAttempts.at, windowStart())));
  if (n >= max) throw tooMany();
}

export async function recordAttempt(key: string, success: boolean) {
  await db.insert(loginAttempts).values({ key, success });
  // Keeps the table small even when nobody ever signs in successfully.
  await db.delete(loginAttempts).where(lt(loginAttempts.at, new Date(Date.now() - 86_400_000)));
}

export async function login(email: string, password: string): Promise<SessionUser> {
  const address = email.toLowerCase().trim();
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  const key = `${address}|${ip}`;
  await assertNotThrottled(key);
  // Whatever the source address: a cap per account, so rotating IPs does not give unlimited guesses.
  const [{ n }] = await db
    .select({ n: dsql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(dsql`starts_with(${loginAttempts.key}, ${address + "|"})`, eq(loginAttempts.success, false), gt(loginAttempts.at, windowStart())));
  if (n >= MAX_FAILURES_PER_ACCOUNT) throw tooMany();

  const [user] = await db.select().from(users).where(eq(users.email, address));
  // Always run the KDF so response time does not reveal whether the account exists.
  // An account without a password (invitation not accepted yet) can never sign in.
  const ok = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : (await verifyPassword(password, await DUMMY_HASH), false);
  await recordAttempt(key, ok && !!user?.active);
  if (!ok || !user || !user.active) throw new AppError("unauthorized", "Incorrect email or password.");

  await createSession(user.id);
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
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

/** Hash of the session token carried by the current request, or null when there is none. */
export async function currentSessionTokenHash(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  return token ? hashToken(token) : null;
}

/** Ends every session of the user except the one whose token hash is given. Returns how many were ended. */
export async function revokeOtherSessions(userId: string, keepTokenHash: string, tx: Tx | typeof db = db): Promise<number> {
  const gone = await tx
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.tokenHash, keepTokenHash)))
    .returning({ id: sessions.id });
  return gone.length;
}

/** Sessions of the user that have not expired. */
export async function countActiveSessions(userId: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: dsql<number>`count(*)::int` })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())));
  return n;
}
