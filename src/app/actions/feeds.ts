"use server";

import { z } from "zod";
import { run } from "@/lib/action";
import { requireActor } from "@/lib/auth/session";
import { createFeedToken, revokeFeedToken, rotateFeedToken } from "@/lib/feeds";

export async function createFeedAction(input: { label?: string; includeTentative: boolean; includeDeadlines: boolean }) {
  return run(async () => {
    const actor = await requireActor();
    const o = z.object({ label: z.string().max(60).optional(), includeTentative: z.boolean(), includeDeadlines: z.boolean() }).parse(input);
    const res = await createFeedToken(actor, o);
    return { id: res.id, url: res.url };
  });
}

export async function revokeFeedAction(tokenId: string) {
  return run(async () => {
    const actor = await requireActor();
    await revokeFeedToken(actor, z.string().uuid().parse(tokenId));
    return undefined;
  });
}

export async function rotateFeedAction(tokenId: string) {
  return run(async () => {
    const actor = await requireActor();
    const res = await rotateFeedToken(actor, z.string().uuid().parse(tokenId));
    return { id: res.id, url: res.url };
  });
}
