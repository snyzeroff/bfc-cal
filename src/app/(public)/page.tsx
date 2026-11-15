import Link from "next/link";
import { ArrowRight, CalendarPlus } from "lucide-react";
import { MembersCalendar } from "@/components/members-calendar";
import { publishDueEvents } from "@/lib/events/service";
import { listPublicEvents, serializePublicEvent } from "@/lib/public";
import { getSetting } from "@/lib/settings";
import { formatRange, todayParis } from "@/lib/time";

export default async function HomePage() {
  await publishDueEvents().catch(() => 0);
  const [appearance, events] = await Promise.all([getSetting("appearance"), listPublicEvents()]);
  const list = events.map(serializePublicEvent);
  const now = Date.now();
  const next = list.find((e) => new Date(e.end).getTime() >= now && e.status === "published");
  return (
    <div className="flex flex-col gap-10">
      <section className="grid items-end gap-8 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-ink">{appearance.orgName}</p>
          <h1 className="mt-3 font-display text-[48px] leading-[0.98] tracking-[-0.02em] sm:text-[68px]">
            Conferences<br /><span className="italic text-ink-3">&amp; events</span>
          </h1>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-ink-2">{appearance.tagline}. Subscribe once and every new conference, change of room or cancellation reaches your own calendar.</p>
          <Link href="/subscribe" className="mt-6 inline-flex h-11 items-center gap-2 rounded-lg bg-brand px-5 text-sm font-medium text-on-brand shadow-sm transition-colors hover:bg-brand-deep">
            <CalendarPlus className="h-4 w-4" /> Subscribe to the calendar
          </Link>
        </div>
        {next && (
          <Link href={`/events/${next.id}`} className="group relative overflow-hidden rounded-2xl bg-brand-deep p-6 text-white shadow-lg transition-transform hover:-translate-y-0.5">
            <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full border border-white/10" aria-hidden />
            <div className="pointer-events-none absolute -right-2 -top-2 h-28 w-28 rounded-full border border-white/10" aria-hidden />
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">Next up · {next.category.name}</p>
            <p className="mt-3 font-display text-[30px] leading-[1.08]">{next.title}</p>
            {next.speaker && <p className="mt-2 text-sm text-white/75">with {next.speaker.name}{next.speaker.organization ? ` · ${next.speaker.organization}` : ""}</p>}
            <p className="mt-5 text-sm font-medium">{formatRange(new Date(next.start), new Date(next.end), next.allDay)}</p>
            {next.location && <p className="text-sm text-white/70">{next.location}</p>}
            <p className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium">Details <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></p>
          </Link>
        )}
      </section>
      <MembersCalendar events={list} defaultView={appearance.publicDefaultView} weekStartsOn={appearance.weekStartsOn} today={todayParis()} />
    </div>
  );
}
