import { beforeEach, describe, expect, it } from "vitest";
import { eq, isNotNull } from "drizzle-orm";
import { db, sql } from "@/db";
import * as s from "@/db/schema";
import { hashToken, verifyPassword } from "@/lib/auth/crypto";
import { AppError } from "@/lib/errors";
import {
  INVALID_LINK_MESSAGE,
  createSignupLink,
  inspectSignupLink,
  listSignupLinks,
  redeemSignupLink,
  revokeSignupLink,
  type LinkActor,
} from "@/lib/signup-links";
import { makeUser, resetDb } from "./helpers";

let superAdmin: LinkActor, admin: LinkActor & { email: string }, member: LinkActor;

const PASSWORD = "correct horse battery";
const person = (n: number | string) => ({ name: `Person ${n}`, email: `person${n}@join.test`, password: PASSWORD });
const tokenOf = (url: string) => url.split("/").pop()!;

/** Resolves with the AppError a refused call threw; anything else fails the test. */
const refusal = (p: Promise<unknown>): Promise<AppError> =>
  p.then(
    () => {
      throw new Error("Expected the call to be refused, but it succeeded.");
    },
    (e) => {
      if (!(e instanceof AppError)) throw e;
      return e;
    },
  );

async function newLink(over: Partial<{ label: string; role: string; maxUses: number; expiresInDays: number }> = {}) {
  const res = await createSignupLink(superAdmin, { label: "Board 2027", role: "board_member", maxUses: 3, expiresInDays: 7, ...over });
  return { id: res.id, url: res.url, token: tokenOf(res.url) };
}
const linkRow = async (id: string) => (await db.select().from(s.signupLinks).where(eq(s.signupLinks.id, id)))[0];
const joinedUsers = () => db.select().from(s.users).where(isNotNull(s.users.signupLinkId));

beforeEach(async () => {
  await resetDb();
  superAdmin = await makeUser("super_admin", "Sam Super");
  admin = await makeUser("board_admin", "Ada Admin");
  member = await makeUser("board_member", "Max Member");
});

describe("creating invitation links", () => {
  it("returns the address once and the new account gets the link's role", async () => {
    const link = await newLink({ role: "board_admin" });
    expect(link.url).toMatch(/^https:\/\/bfc\.test\/join\/[A-Za-z0-9_-]{43}$/);

    const user = await redeemSignupLink(link.token, { name: "  Nina New ", email: " Nina.New@Join.Test ", password: PASSWORD });
    expect(user).toMatchObject({ name: "Nina New", email: "nina.new@join.test", role: "board_admin", signupLinkId: link.id });
    expect(user).not.toHaveProperty("passwordHash");

    const [row] = await db.select().from(s.users).where(eq(s.users.id, user.id));
    expect(row).toMatchObject({ role: "board_admin", active: true, signupLinkId: link.id });
    expect(await verifyPassword(PASSWORD, row.passwordHash)).toBe(true);
    expect((await linkRow(link.id)).uses).toBe(1);
  });

  it("refuses to create a link that grants Super Admin", async () => {
    const err = await refusal(createSignupLink(superAdmin, { label: "Admins", role: "super_admin", maxUses: 2, expiresInDays: 7 }));
    expect(err.code).toBe("invalid");
    expect(err.message).toMatch(/promoted individually/);
    expect((await refusal(createSignupLink(superAdmin, { label: "Odd", role: "owner", maxUses: 2, expiresInDays: 7 }))).code).toBe("invalid");
    expect(await db.select().from(s.signupLinks)).toHaveLength(0);
  });

  it("only an active Super Admin can create, list or revoke", async () => {
    const link = await newLink();
    const deactivated: LinkActor = { ...superAdmin, active: false };
    for (const actor of [admin, member, deactivated]) {
      expect((await refusal(createSignupLink(actor, { label: "Mine", role: "board_member", maxUses: 2, expiresInDays: 7 }))).code).toBe("forbidden");
      expect((await refusal(listSignupLinks(actor))).code).toBe("forbidden");
      expect((await refusal(revokeSignupLink(actor, link.id))).code).toBe("forbidden");
    }
    expect(await db.select().from(s.signupLinks)).toHaveLength(1);
    expect((await linkRow(link.id)).revokedAt).toBeNull();
  });

  it("requires a quota of 1–100 accounts and an expiry of 1–30 days", async () => {
    const base = { label: "Bounds", role: "board_member", maxUses: 5, expiresInDays: 7 };
    for (const bad of [{ maxUses: 0 }, { maxUses: 101 }, { maxUses: 2.5 }, { expiresInDays: 0 }, { expiresInDays: 31 }, { expiresInDays: Number.NaN }, { label: "   " }]) {
      expect((await refusal(createSignupLink(superAdmin, { ...base, ...bad }))).code).toBe("invalid");
    }
    expect(await db.select().from(s.signupLinks)).toHaveLength(0);

    const before = Date.now();
    const { id } = await createSignupLink(superAdmin, { ...base, maxUses: 100, expiresInDays: 30 });
    const row = await linkRow(id);
    expect(row).toMatchObject({ maxUses: 100, uses: 0, revokedAt: null, createdBy: superAdmin.id });
    expect(row.expiresAt.getTime() - before).toBeGreaterThanOrEqual(30 * 86_400_000);
    expect(row.expiresAt.getTime() - before).toBeLessThan(30 * 86_400_000 + 60_000);
  });
});

describe("quota", () => {
  it("stops creating accounts once the quota is reached", async () => {
    const link = await newLink({ maxUses: 2 });
    await redeemSignupLink(link.token, person(1));
    await redeemSignupLink(link.token, person(2));

    const err = await refusal(redeemSignupLink(link.token, person(3)));
    expect(err).toMatchObject({ code: "invalid", message: INVALID_LINK_MESSAGE });
    expect(await inspectSignupLink(link.token)).toBeNull();
    expect(await joinedUsers()).toHaveLength(2);
    expect((await linkRow(link.id)).uses).toBe(2);
  });

  it("never exceeds the quota when sign-ups arrive at the same time", async () => {
    const maxUses = 5;
    const link = await newLink({ maxUses });
    const results = await Promise.allSettled(Array.from({ length: maxUses + 3 }, (_, i) => redeemSignupLink(link.token, person(i))));

    const created = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason);
    expect(created).toHaveLength(maxUses);
    expect(refused).toHaveLength(3);
    for (const e of refused) expect(e).toMatchObject({ name: "AppError", code: "invalid", message: INVALID_LINK_MESSAGE });

    const users = await joinedUsers();
    expect(users).toHaveLength(maxUses);
    expect(users.every((u) => u.signupLinkId === link.id && u.role === "board_member")).toBe(true);
    expect((await linkRow(link.id)).uses).toBe(maxUses);
  });

  it("the same email submitted several times at once creates one account and uses one place", async () => {
    const link = await newLink({ maxUses: 10 });
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => redeemSignupLink(link.token, person("twin"))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ name: "AppError", code: "invalid" });
    expect(await joinedUsers()).toHaveLength(1);
    expect((await linkRow(link.id)).uses).toBe(1);
  });
});

describe("links that no longer work", () => {
  it("a revoked link is refused with the generic message", async () => {
    const link = await newLink();
    expect(await inspectSignupLink(link.token)).toEqual({ role: "board_member", roleLabel: "Board Member" });
    await revokeSignupLink(superAdmin, link.id);
    await revokeSignupLink(superAdmin, link.id); // revoking twice is harmless

    expect(await inspectSignupLink(link.token)).toBeNull();
    expect(await refusal(redeemSignupLink(link.token, person(1)))).toMatchObject({ code: "invalid", message: INVALID_LINK_MESSAGE });
    expect(await joinedUsers()).toHaveLength(0);
    expect((await linkRow(link.id)).uses).toBe(0);
    expect((await refusal(revokeSignupLink(superAdmin, crypto.randomUUID()))).code).toBe("not_found");
  });

  it("an expired link is refused with the generic message", async () => {
    const link = await newLink();
    await db.update(s.signupLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.signupLinks.id, link.id));

    expect(await inspectSignupLink(link.token)).toBeNull();
    expect(await refusal(redeemSignupLink(link.token, person(1)))).toMatchObject({ code: "invalid", message: INVALID_LINK_MESSAGE });
    expect(await joinedUsers()).toHaveLength(0);
  });

  it("unknown and malformed tokens get the same answer", async () => {
    await newLink();
    for (const token of ["A".repeat(43), "nope", "", "../../etc/passwd", "x".repeat(500)]) {
      expect(await inspectSignupLink(token)).toBeNull();
      expect(await refusal(redeemSignupLink(token, person(1)))).toMatchObject({ code: "invalid", message: INVALID_LINK_MESSAGE });
    }
    expect(await joinedUsers()).toHaveLength(0);
  });
});

describe("account details", () => {
  it("an email that already has an account is refused and does not use a place", async () => {
    const link = await newLink({ maxUses: 2 });
    const err = await refusal(redeemSignupLink(link.token, { name: "Impostor", email: admin.email.toUpperCase(), password: PASSWORD }));
    expect(err.code).toBe("invalid");
    expect(err.message).not.toBe(INVALID_LINK_MESSAGE);
    expect(err.message).not.toContain(admin.email);
    expect((await linkRow(link.id)).uses).toBe(0);
    expect(await joinedUsers()).toHaveLength(0);

    // The link still has both places.
    await redeemSignupLink(link.token, person(1));
    await redeemSignupLink(link.token, person(2));
    expect((await linkRow(link.id)).uses).toBe(2);
  });

  it("rejects a short password, a bad email or an empty name without using a place", async () => {
    const link = await newLink();
    for (const bad of [{ password: "123456789" }, { email: "not-an-email" }, { name: "   " }]) {
      expect((await refusal(redeemSignupLink(link.token, { ...person(1), ...bad }))).code).toBe("invalid");
    }
    expect((await linkRow(link.id)).uses).toBe(0);
    expect(await joinedUsers()).toHaveLength(0);
  });

  it("throttles repeated failures per key, like sign-in", async () => {
    const link = await newLink();
    const opts = { throttleKey: "join|203.0.113.7" };
    for (let i = 0; i < 8; i++) {
      expect((await refusal(redeemSignupLink("B".repeat(43), person(i), opts))).code).toBe("invalid");
    }
    // Even a valid link is now refused from that address…
    expect((await refusal(redeemSignupLink(link.token, person("late"), opts))).code).toBe("rate_limited");
    expect((await linkRow(link.id)).uses).toBe(0);
    // …but not from another one.
    await redeemSignupLink(link.token, person("elsewhere"), { throttleKey: "join|198.51.100.2" });
    expect((await linkRow(link.id)).uses).toBe(1);

    const attempts = await db.select().from(s.loginAttempts);
    expect(attempts.filter((a) => a.key === "join|203.0.113.7" && !a.success)).toHaveLength(8);
    expect(attempts.filter((a) => a.key === "join|198.51.100.2" && a.success)).toHaveLength(1);
  });
});

describe("author", () => {
  it("a link stops working when its author is deactivated or demoted", async () => {
    const link = await newLink();
    await db.update(s.users).set({ active: false }).where(eq(s.users.id, superAdmin.id));
    expect(await inspectSignupLink(link.token)).toBeNull();
    expect((await refusal(redeemSignupLink(link.token, person(1)))).message).toBe(INVALID_LINK_MESSAGE);
    await db.update(s.users).set({ active: true, role: "board_admin" }).where(eq(s.users.id, superAdmin.id));
    expect((await refusal(redeemSignupLink(link.token, person(2)))).message).toBe(INVALID_LINK_MESSAGE);
    await db.update(s.users).set({ role: "super_admin" }).where(eq(s.users.id, superAdmin.id));
    await redeemSignupLink(link.token, person(3));
    expect((await linkRow(link.id)).uses).toBe(1);
  });
});

describe("secrecy and traceability", () => {
  it("stores only the hash of the secret and never writes it to the audit log", async () => {
    const link = await newLink({ label: "Spring recruits" });
    const user = await redeemSignupLink(link.token, person(1), { throttleKey: "join|203.0.113.7" });
    await revokeSignupLink(superAdmin, link.id);

    expect((await linkRow(link.id)).tokenHash).toBe(hashToken(link.token));
    for (const table of ["signup_links", "audit_log", "users", "login_attempts", "sessions", "invite_tokens"]) {
      const dump = JSON.stringify(await sql.unsafe(`select * from ${table}`));
      expect(dump, table).not.toContain(link.token);
    }

    const audit = await db.select().from(s.auditLog);
    expect(JSON.stringify(audit)).not.toContain(hashToken(link.token));
    const created = audit.find((a) => a.action === "signup_link.create")!;
    expect(created).toMatchObject({ actorId: superAdmin.id, entityType: "signup_link", entityId: link.id });
    expect(created.summary).toContain("Spring recruits");
    expect(created.summary).toContain("Board Member");
    expect(created.summary).toContain("up to 3 accounts");
    expect(created.summary).toMatch(/expires \d{1,2} \w+ \d{4}/);
    expect(audit.find((a) => a.action === "signup_link.revoke")).toMatchObject({ actorId: superAdmin.id, entityId: link.id });
    const joined = audit.find((a) => a.action === "user.join")!;
    expect(joined).toMatchObject({ actorId: user.id, actorName: "Person 1", entityType: "user", entityId: user.id });
    expect(joined.summary).toContain("Spring recruits");
    expect(joined.summary).toContain("Board Member");
  });

  it("the public check discloses the role and nothing else", async () => {
    const link = await newLink({ label: "Secret name", role: "board_admin", maxUses: 7 });
    expect(await inspectSignupLink(link.token)).toEqual({ role: "board_admin", roleLabel: "Board Admin" });
  });

  it("lists links with their usage, status, creator and who joined", async () => {
    const full = await newLink({ label: "Full", maxUses: 1 });
    const expired = await newLink({ label: "Expired" });
    const revoked = await newLink({ label: "Revoked" });
    const active = await newLink({ label: "Active", role: "board_admin", maxUses: 10 });
    await redeemSignupLink(full.token, person("f"));
    await redeemSignupLink(active.token, person("a1"));
    await redeemSignupLink(active.token, person("a2"));
    await db.update(s.signupLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.signupLinks.id, expired.id));
    await revokeSignupLink(superAdmin, revoked.id);

    const list = await listSignupLinks(superAdmin);
    expect(list).toHaveLength(4);
    const byLabel = Object.fromEntries(list.map((l) => [l.label, l]));
    expect(byLabel.Full).toMatchObject({ status: "full", uses: 1, maxUses: 1, role: "board_member", createdByName: "Sam Super" });
    expect(byLabel.Full.members.map((m) => m.name)).toEqual(["Person f"]);
    expect(byLabel.Expired).toMatchObject({ status: "expired", uses: 0 });
    expect(byLabel.Revoked).toMatchObject({ status: "revoked", uses: 0 });
    expect(byLabel.Active).toMatchObject({ status: "active", uses: 2, maxUses: 10, role: "board_admin" });
    expect(byLabel.Active.members.map((m) => m.name).sort()).toEqual(["Person a1", "Person a2"]);
    expect(JSON.stringify(list)).not.toContain(hashToken(active.token));
  });
});
