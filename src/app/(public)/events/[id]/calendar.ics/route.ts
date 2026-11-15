import { appUrl } from "@/lib/feeds";
import { buildCalendar, icsResponseHeaders } from "@/lib/ics";
import { getPublicEvent } from "@/lib/public";
import { addDays, eventDays } from "@/lib/time";

export const dynamic = "force-dynamic";

/** One-off export of a single published event ("Add to my calendar"). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const e = await getPublicEvent((await params).id);
  if (!e) return new Response("Not found", { status: 404 });
  const d = eventDays(e.startAt, e.endAt);
  const ics = buildCalendar({
    name: e.title,
    events: [
      {
        uid: `event-${e.id}@bfc-calendar`,
        title: e.title,
        description: [e.description, `Details: ${appUrl()}/events/${e.id}`].filter(Boolean).join("\n\n"),
        location: e.location,
        url: `${appUrl()}/events/${e.id}`,
        start: e.startAt,
        end: e.endAt,
        allDay: e.allDay,
        startDay: d.start,
        endDayExclusive: addDays(d.end, 1),
        status: e.status === "cancelled" ? "CANCELLED" : "CONFIRMED",
        sequence: e.sequence,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
        categories: [e.categoryName],
      },
    ],
  });
  return new Response(ics, { headers: { ...icsResponseHeaders("event.ics", false), "Content-Disposition": 'attachment; filename="bfc-event.ics"' } });
}
