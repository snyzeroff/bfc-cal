import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { MIN_PASSWORD_LENGTH, hashPassword, hashToken, newToken, verifyPassword } from "@/lib/auth/crypto";
import { countActiveSessions } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { changeEmail, changePassword, getProfile, signOutOtherSessions, updateName } from "@/lib/profile";
import { makeUser, resetDb } from "./helpers";

const PASSWORD = "correct horse battery";
const NEW_PASSWORD = "staple-battery-horse-42";

type TestUser = Awaited<ReturnType<typeof makeUser>>;
let me: TestUser, other: TestUser;

/** Resolves to "ok", or to "<code>: <message>" of the AppError that was thrown. */
const outcome = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? `${e.code}: ${e.message}` : `unexpected: ${e}`));
const WRONG_PASSWORD = "invalid: Current password is incorrect.";

const row = async (id: string) => (await db.select().from(s.users).where(eq(s.users.id, id)))[0];
const auditRows = (userId: string) => db.select().from(s.auditLog).where(eq(s.auditLog.entityId, userId));
const sessionHashes = async (userId: string) => (await db.select().from(s.sessions).where(eq(s.sessions.userId, userId))).map((r) => r.tokenHash).sort();

/** A session row as the login flow creates it; returns the token hash that identifies it. */
async function addSession(userId: string, expiresInMs = 86_400_000): Promise<string> {
  const tokenHash = hashToken(newToken());
  await db.insert(s.sessions).values({ userId, tokenHash, expiresAt: new Date(Date.now() + expiresInMs) });
  return tokenHash;
}

beforeEach(async () => {
  await resetDb();
  me = await makeUser("board_member", "Max Member");
  other = await makeUser("board_admin", "Ada Admin");
  // makeUser creates accounts without a password.
  await db.update(s.users).set({ passwordHash: await hashPassword(PASSWORD) }).where(eq(s.users.id, me.id));
  await db.update(s.users).set({ passwordHash: await hashPassword("another password 123") }).where(eq(s.users.id, other.id));
});

describe("profile: read", () => {
  it("returns the account details and session count, never the password hash", async () => {
    await addSession(me.id);
    await addSession(me.id);
    await addSession(me.id, -1000); // expired
    await addSession(other.id);
    const profile = await getProfile(me.id);
    expect(profile).toMatchObject({ id: me.id, name: "Max Member", email: me.email, role: "board_member", lastLoginAt: null, activeSessions: 2 });
    expect(profile.createdAt).toBeInstanceOf(Date);
    expect(Object.keys(profile)).not.toContain("passwordHash");
    expect(JSON.stringify(profile)).not.toContain("scrypt$");
  });
});

describe("profile: display name", () => {
  it("updates the name (trimmed) and writes an audit entry", async () => {
    expect(await updateName(me.id, { name: "  Maxime Member  " })).toEqual({ name: "Maxime Member" });
    expect((await row(me.id)).name).toBe("Maxime Member");
    const log = await auditRows(me.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "user.name_change", entityType: "user", actorId: me.id, changes: { name: ["Max Member", "Maxime Member"] } });
  });

  it("rejects an empty or over-long name and leaves the account unchanged", async () => {
    expect(await outcome(updateName(me.id, { name: "   " }))).toMatch(/^invalid: /);
    expect(await outcome(updateName(me.id, { name: "x".repeat(81) }))).toMatch(/^invalid: /);
    expect(await outcome(updateName(me.id, { name: "x".repeat(80) }))).toBe("ok");
    expect((await row(me.id)).name).toBe("x".repeat(80));
  });

  it("saving the same name is a no-op without an audit entry", async () => {
    await updateName(me.id, { name: "Max Member" });
    expect(await auditRows(me.id)).toHaveLength(0);
  });

  it("touches nothing but the name, and only on that account", async () => {
    const before = await row(me.id);
    const otherBefore = await row(other.id);
    // Extra fields a forged request might carry are ignored.
    await updateName(me.id, { name: "Renamed", role: "super_admin", active: false, id: other.id } as { name: string });
    const after = await row(me.id);
    expect(after).toMatchObject({ name: "Renamed", role: "board_member", active: true, email: before.email, passwordHash: before.passwordHash });
    expect({ ...(await row(other.id)), updatedAt: null }).toEqual({ ...otherBefore, updatedAt: null });
  });
});

describe("profile: email", () => {
  it("changes the email with the current password and stores it in lowercase", async () => {
    expect(await changeEmail(me.id, { email: "  Max.NEW@Example.COM ", currentPassword: PASSWORD })).toEqual({ email: "max.new@example.com" });
    expect((await row(me.id)).email).toBe("max.new@example.com");
    const [entry] = await auditRows(me.id);
    expect(entry).toMatchObject({ action: "user.email_change", actorId: me.id, changes: { email: [me.email, "max.new@example.com"] } });
  });

  it("rejects a wrong current password and changes nothing", async () => {
    expect(await outcome(changeEmail(me.id, { email: "new@example.com", currentPassword: "not the password" }))).toBe(WRONG_PASSWORD);
    expect(await outcome(changeEmail(me.id, { email: "new@example.com", currentPassword: "" }))).toBe(WRONG_PASSWORD);
    expect((await row(me.id)).email).toBe(me.email);
    expect(await auditRows(me.id)).toHaveLength(0);
  });

  it("rejects an email already used by another account, whatever the letter case", async () => {
    await db.update(s.users).set({ email: "Ada.Admin@Example.com" }).where(eq(s.users.id, other.id));
    for (const email of ["Ada.Admin@Example.com", "ada.admin@example.com", "ADA.ADMIN@EXAMPLE.COM"]) {
      expect(await outcome(changeEmail(me.id, { email, currentPassword: PASSWORD }))).toBe("invalid: This email is already used by another account.");
    }
    expect((await row(me.id)).email).toBe(me.email);
    expect(await auditRows(me.id)).toHaveLength(0);
  });

  it("does not reveal that an email is taken to someone who does not know the password", async () => {
    // makeUser builds addresses from the name, which may contain a space.
    await db.update(s.users).set({ email: "ada@example.com" }).where(eq(s.users.id, other.id));
    expect(await outcome(changeEmail(me.id, { email: "ada@example.com", currentPassword: "not the password" }))).toBe(WRONG_PASSWORD);
    expect(await outcome(changeEmail(me.id, { email: "free@example.com", currentPassword: "not the password" }))).toBe(WRONG_PASSWORD);
  });

  it("rejects an invalid email", async () => {
    expect(await outcome(changeEmail(me.id, { email: "not-an-email", currentPassword: PASSWORD }))).toBe("invalid: Enter a valid email address.");
    expect((await row(me.id)).email).toBe(me.email);
  });

  it("an account without a password cannot change its email", async () => {
    const fresh = await makeUser("board_member", "No Password");
    expect(await outcome(changeEmail(fresh.id, { email: "fresh@example.com", currentPassword: "" }))).toBe(WRONG_PASSWORD);
  });
});

describe("profile: password", () => {
  it("changes the password and revokes every other session, keeping the current one", async () => {
    const current = await addSession(me.id);
    await addSession(me.id);
    await addSession(me.id);
    const othersSession = await addSession(other.id);

    expect(await changePassword(me.id, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, current)).toEqual({ revokedSessions: 2 });

    const { passwordHash } = await row(me.id);
    expect(await verifyPassword(NEW_PASSWORD, passwordHash)).toBe(true);
    expect(await verifyPassword(PASSWORD, passwordHash)).toBe(false);
    expect(await sessionHashes(me.id)).toEqual([current]);
    // Other people's sessions are untouched.
    expect(await sessionHashes(other.id)).toEqual([othersSession]);
    expect(await countActiveSessions(me.id)).toBe(1);
  });

  it("rejects a wrong current password: password and sessions stay as they were", async () => {
    const current = await addSession(me.id);
    const second = await addSession(me.id);
    expect(await outcome(changePassword(me.id, { currentPassword: "not the password", newPassword: NEW_PASSWORD }, current))).toBe(WRONG_PASSWORD);
    expect(await verifyPassword(PASSWORD, (await row(me.id)).passwordHash)).toBe(true);
    expect(await sessionHashes(me.id)).toEqual([current, second].sort());
    expect(await auditRows(me.id)).toHaveLength(0);
  });

  it(`rejects a new password shorter than ${MIN_PASSWORD_LENGTH} characters, or identical to the current one`, async () => {
    const current = await addSession(me.id);
    expect(await outcome(changePassword(me.id, { currentPassword: PASSWORD, newPassword: "x".repeat(MIN_PASSWORD_LENGTH - 1) }, current))).toMatch(/^invalid: Choose a password of at least/);
    expect(await outcome(changePassword(me.id, { currentPassword: PASSWORD, newPassword: PASSWORD }, current))).toMatch(/^invalid: /);
    expect(await verifyPassword(PASSWORD, (await row(me.id)).passwordHash)).toBe(true);
  });

  it("cannot be used on an account that is deactivated", async () => {
    const current = await addSession(me.id);
    await db.update(s.users).set({ active: false }).where(eq(s.users.id, me.id));
    expect(await outcome(changePassword(me.id, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, current))).toMatch(/^unauthorized: /);
    expect(await verifyPassword(PASSWORD, (await row(me.id)).passwordHash)).toBe(true);
  });
});

describe("profile: sessions", () => {
  it("signs out the other devices only", async () => {
    const current = await addSession(me.id);
    await addSession(me.id);
    const othersSession = await addSession(other.id);
    expect(await signOutOtherSessions(me.id, current)).toEqual({ revokedSessions: 1 });
    expect(await sessionHashes(me.id)).toEqual([current]);
    expect(await sessionHashes(other.id)).toEqual([othersSession]);
    expect(await signOutOtherSessions(me.id, current)).toEqual({ revokedSessions: 0 });
  });
});

describe("profile: audit trail", () => {
  it("records name, email and password changes without any secret", async () => {
    const current = await addSession(me.id);
    await updateName(me.id, { name: "Maxime Member" });
    await changeEmail(me.id, { email: "maxime@example.com", currentPassword: PASSWORD });
    await changePassword(me.id, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, current);

    const log = await auditRows(me.id);
    expect(log.map((r) => r.action).sort()).toEqual(["user.email_change", "user.name_change", "user.password_change"]);
    expect(log.every((r) => r.actorId === me.id && r.entityType === "user")).toBe(true);
    expect(log.find((r) => r.action === "user.password_change")!.changes).toBeNull();

    const dump = JSON.stringify(log);
    const { passwordHash } = await row(me.id);
    for (const secret of [PASSWORD, NEW_PASSWORD, passwordHash!, "scrypt$", current]) expect(dump).not.toContain(secret);
  });
});

describe("password guessing", () => {
  it("locks the password check after repeated wrong answers, even with the right one afterwards", async () => {
    const keep = await addSession(me.id);
    for (let i = 0; i < 8; i++) {
      expect(await outcome(changePassword(me.id, { currentPassword: `wrong guess ${i}`, newPassword: NEW_PASSWORD }, keep))).toBe(WRONG_PASSWORD);
    }
    expect(await outcome(changePassword(me.id, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, keep))).toMatch(/^rate_limited/);
    expect(await verifyPassword(PASSWORD, (await row(me.id)).passwordHash)).toBe(true);
    // Someone else's account is not affected.
    expect(await outcome(changeEmail(other.id, { email: "ada.new@bfc.test", currentPassword: "another password 123" }))).toBe("ok");
  });
});
