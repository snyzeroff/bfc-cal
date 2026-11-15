import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarPlus, Download } from "lucide-react";
import { PublicEventView } from "@/components/public-event";
import { buttonClass } from "@/components/button-class";
import { getPublicEvent, serializePublicEvent } from "@/lib/public";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const e = await getPublicEvent((await params).id);
  if (!e) return { title: "Event not found" };
  return { title: e.title, description: e.description.slice(0, 160) || `${e.categoryName} — ${e.title}` };
}

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  // Only published events exist here: anything else is a plain 404, whether or not it exists privately.
  const e = await getPublicEvent((await params).id);
  if (!e) notFound();
  const event = serializePublicEvent(e);
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/" className="mb-8 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="h-3.5 w-3.5" /> All events</Link>
      <PublicEventView event={event} />
      {event.status !== "cancelled" && (
        <div className="mt-10 flex flex-wrap items-center gap-2 border-t border-line pt-6">
          <a href={`/events/${event.id}/calendar.ics`} className={buttonClass("outline")}><Download className="h-4 w-4" /> Add this event to my calendar</a>
          <Link href="/subscribe" className={buttonClass("ghost")}><CalendarPlus className="h-4 w-4" /> Subscribe to all events</Link>
        </div>
      )}
    </div>
  );
}
