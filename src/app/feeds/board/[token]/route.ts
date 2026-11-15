import { authenticateFeed, buildBoardFeed } from "@/lib/feeds";
import { icsResponseHeaders } from "@/lib/ics";

export const dynamic = "force-dynamic";

/**
 * Private subscription feed. The secret token in the path is the only
 * credential calendar apps can send, so it is long, random, stored hashed,
 * revocable, and re-checked against the owner's account on every request.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const raw = (await params).token.replace(/\.ics$/i, "");
  const auth = await authenticateFeed(raw);
  // Same response for unknown, revoked and deactivated: reveal nothing.
  if (!auth) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(await buildBoardFeed(auth), { headers: icsResponseHeaders("bfc-board.ics", true) });
}
