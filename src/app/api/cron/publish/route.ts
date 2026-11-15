import { createHash, timingSafeEqual } from "node:crypto";
import { publishDueEvents } from "@/lib/events/service";

export const dynamic = "force-dynamic";

/** Publishes events whose scheduled publication time has passed. Call it from a scheduler (e.g. Vercel Cron). */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const digest = (v: string) => createHash("sha256").update(v).digest();
  const ok = !!secret && timingSafeEqual(digest(given), digest(secret));
  if (!ok) return new Response("Unauthorized", { status: 401 });
  return Response.json({ published: await publishDueEvents() });
}
