"use server";

import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { run } from "@/lib/action";
import { createSession, requireActor } from "@/lib/auth/session";
import { createSignupLink, redeemSignupLink, revokeSignupLink } from "@/lib/signup-links";

/* The rules (roles a link may grant, quota, expiry, throttling…) live in the service; these schemas only check shapes. */

const createInput = z.object({ label: z.string().max(200), role: z.string().max(40), maxUses: z.number(), expiresInDays: z.number() });
const redeemInput = z.object({ token: z.string().max(100), name: z.string().max(200), email: z.string().max(300), password: z.string().max(200) });

export async function createSignupLinkAction(input: { label: string; role: string; maxUses: number; expiresInDays: number }) {
  return run(async () => {
    const actor = await requireActor("super_admin");
    return createSignupLink(actor, createInput.parse(input));
  });
}

export async function revokeSignupLinkAction(linkId: string) {
  return run(async () => {
    const actor = await requireActor("super_admin");
    await revokeSignupLink(actor, z.string().uuid().parse(linkId));
    return undefined;
  });
}

/** Public: creates an account through an invitation link and signs the new user in. */
export async function redeemSignupLinkAction(input: { token: string; name: string; email: string; password: string }) {
  return run(async () => {
    const { token, ...account } = redeemInput.parse(input);
    const ip = ((await headers()).get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
    const user = await redeemSignupLink(token, account, { throttleKey: `join|${ip}` });
    await createSession(user.id);
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    return { name: user.name };
  });
}
