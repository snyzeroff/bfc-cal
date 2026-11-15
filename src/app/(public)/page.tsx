import Link from "next/link";
import { ArrowRight, CalendarPlus, MapPin } from "lucide-react";
import { EventEmbed } from "@/components/event-embed";
import { MembersCalendar } from "@/components/members-calendar";
import { cn } from "@/lib/cn";
import { publishDueEvents } from "@/lib/events/service";
import { listPublicEvents, serializePublicEvent } from "@/lib/public";
import { getSetting } from "@/lib/settings";
import { formatRange, nowMs, todayParis } from "@/lib/time";

export default async function HomePage() {
  await publishDueEvents().catch(() => 0);
  const [appearance, events] = await Promise.all([getSetting("appearance"), listPublicEvents()]);
  const list = events.map(serializePublicEvent);
  const now = nowMs();
  const upcoming = list.filter((e) => new Date(e.end).getTime() >= now && e.status === "published");
  // An event the board chose to feature takes the top of the page; otherwise the next one does.
  const next = upcoming.find((e) => e.featured) ?? upcoming[0];

  return (
    <div className="flex flex-col gap-14 sm:gap-20">
      {/* Headline: one idea, one action. */}
      <section className="rise mx-auto flex max-w-3xl flex-col items-center pt-6 text-center sm:pt-12">
        <p className="text-[13px] font-semibold text-brand-ink">{appearance.orgName}</p>
        <h1 className="mt-3 font-display text-[clamp(2.6rem,7.2vw,4.75rem)] leading-[1.03] tracking-[-0.035em]">
          Conferences &amp; events.
        </h1>
        <p className="mt-5 max-w-xl text-[clamp(1.05rem,2.1vw,1.3rem)] leading-snug text-ink-2">
          {appearance.tagline}.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/subscribe" className="press inline-flex h-12 items-center gap-2 rounded-full bg-brand px-6 text-[15px] font-medium text-on-brand hover:bg-brand-deep">
            <CalendarPlus className="h-[18px] w-[18px]" /> Subscribe to the calendar
          </Link>
          <a href="#events" className="press inline-flex h-12 items-center gap-1.5 rounded-full px-5 text-[15px] font-medium text-brand-ink hover:bg-brand-soft">
            See all events <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>

      {/* The event that matters now. */}
      {next && (
        <section aria-label={next.featured ? "Featured event" : "Next event"} className="rise rise-2 overflow-hidden rounded-3xl bg-surface shadow-md ring-1 ring-line">
          {/* With a registration widget, the text sits in a band above it so the widget can unfold across the card. */}
          <div className={cn("flex flex-col p-7 sm:p-11", next.embedUrl && "lg:flex-row lg:items-end lg:justify-between lg:gap-10 lg:py-9")}>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-brand-ink">{next.featured ? "Featured" : "Next up"} · {next.category.name}</p>
              <h2 className="mt-3 font-display text-[clamp(1.8rem,4vw,2.75rem)] leading-[1.08] tracking-[-0.03em]">{next.title}</h2>
              {next.speaker && (
                <p className="mt-3 text-[17px] text-ink-2">
                  with <span className="font-medium text-ink">{next.speaker.name}</span>
                  {(next.speaker.position || next.speaker.organization) && <span className="text-ink-3"> — {[next.speaker.position, next.speaker.organization].filter(Boolean).join(", ")}</span>}
                </p>
              )}
            </div>
            <div className={cn("flex flex-col", next.embedUrl && "lg:shrink-0 lg:items-end lg:text-right")}>
              <dl className={cn("mt-7 flex flex-col gap-1 text-[15px]", next.embedUrl && "lg:mt-0 lg:items-end")}>
                <dt className="sr-only">When</dt>
                <dd className="font-medium">{formatRange(new Date(next.start), new Date(next.end), next.allDay)}</dd>
                {next.location && (
                  <>
                    <dt className="sr-only">Where</dt>
                    <dd className="flex items-center gap-1.5 text-ink-2"><MapPin className="h-4 w-4 text-ink-3" />{next.location}</dd>
                  </>
                )}
              </dl>
              <Link href={`/events/${next.id}`} className={cn("press mt-8 inline-flex h-11 items-center gap-1.5 self-start rounded-full bg-ink px-5 text-sm font-medium text-bg hover:opacity-90", next.embedUrl && "lg:mt-5 lg:self-end")}>
                Event details <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
          {next.embedUrl && (
            <div className="border-t border-line bg-surface-2 p-4 sm:p-6">
              <EventEmbed url={next.embedUrl} title={next.title} layout="wide" className="rounded-2xl border-0 shadow-sm ring-1 ring-line" />
            </div>
          )}
        </section>
      )}

      <div id="events" className="rise rise-3 scroll-mt-24">
        <MembersCalendar events={list} defaultView={appearance.publicDefaultView} weekStartsOn={appearance.weekStartsOn} today={todayParis()} />
      </div>
    </div>
  );
}
