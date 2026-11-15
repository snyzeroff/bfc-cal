import { listPublicEvents, serializePublicEvent } from "@/lib/public";

export const dynamic = "force-dynamic";

/** Read-only JSON API of published events (e.g. for the club website). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parse = (v: string | null) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v) : undefined);
  const events = await listPublicEvents({ from: parse(url.searchParams.get("from")), to: parse(url.searchParams.get("to")) });
  return Response.json(
    { events: events.map(serializePublicEvent) },
    { headers: { "Cache-Control": "public, max-age=0, must-revalidate", "Access-Control-Allow-Origin": "*" } },
  );
}
