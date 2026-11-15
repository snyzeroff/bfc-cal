import { publishDueEvents } from "@/lib/events/service";
import { buildPublicFeed } from "@/lib/feeds";
import { icsResponseHeaders } from "@/lib/ics";

export const dynamic = "force-dynamic";

/** Public subscription feed: published events only, generated at each request. */
export async function GET() {
  await publishDueEvents().catch(() => 0);
  return new Response(await buildPublicFeed(), { headers: icsResponseHeaders("bfc-events.ics", false) });
}
