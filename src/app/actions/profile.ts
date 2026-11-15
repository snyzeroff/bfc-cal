"use server";

import { z } from "zod";
import { run } from "@/lib/action";
import { currentSessionTokenHash, requireActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { changeEmail, changePassword, signOutOtherSessions, updateName } from "@/lib/profile";

/*
 * Every action here edits the signed-in user's own account: the id always
 * comes from the session. Inputs are strict objects, so nothing but the
 * expected fields (no id, role or active) is accepted.
 */

const text = z.string().max(500);
const nameInput = z.strictObject({ name: text });
const emailInput = z.strictObject({ email: text, currentPassword: text });
const passwordInput = z.strictObject({ currentPassword: text, newPassword: text });

/** The session making this request, so it can be kept while the others are ended. */
async function currentSession(): Promise<string> {
  const hash = await currentSessionTokenHash();
  if (!hash) throw new AppError("unauthorized", "Your session has expired. Please sign in again.");
  return hash;
}

export async function updateNameAction(input: { name: string }) {
  return run(async () => {
    const actor = await requireActor();
    return updateName(actor.id, nameInput.parse(input));
  });
}

export async function changeEmailAction(input: { email: string; currentPassword: string }) {
  return run(async () => {
    const actor = await requireActor();
    return changeEmail(actor.id, emailInput.parse(input));
  });
}

export async function changePasswordAction(input: { currentPassword: string; newPassword: string }) {
  return run(async () => {
    const actor = await requireActor();
    return changePassword(actor.id, passwordInput.parse(input), await currentSession());
  });
}

export async function signOutOtherSessionsAction() {
  return run(async () => {
    const actor = await requireActor();
    return signOutOtherSessions(actor.id, await currentSession());
  });
}
