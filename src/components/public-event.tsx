import { CalendarDays, ExternalLink, MapPin, Mic2, Video } from "lucide-react";
import { CategoryIcon } from "@/components/category-icon";
import { EventEmbed } from "@/components/event-embed";
import { cn } from "@/lib/cn";
import type { PublicEventJson } from "@/lib/public";
import { formatRange } from "@/lib/time";

const STATE: Record<string, { label: string; cls: string } | undefined> = {
  cancelled: { label: "Cancelled", cls: "bg-danger-soft text-danger" },
  postponed: { label: "Postponed — new date to be announced", cls: "bg-warn-soft text-warn" },
  completed: { label: "Past event", cls: "bg-surface-2 text-ink-3" },
};

/** Exactly what members see. Used by the public page and by the board's preview. */
export function PublicEventView({ event, compact }: { event: PublicEventJson; compact?: boolean }) {
  const state = STATE[event.status];
  const cancelled = event.status === "cancelled";
  return (
    <article className={cn("flex flex-col", compact ? "gap-5" : "gap-8")}>
      <header>
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
          <span className="tint tint-bg inline-flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ "--c": event.category.color } as React.CSSProperties}>
            <CategoryIcon name={event.category.icon} className="h-3 w-3" />
            {event.category.name}
          </span>
          {state && <span className={cn("rounded-full px-2.5 py-1", state.cls)}>{state.label}</span>}
        </div>
        <h1 className={cn("mt-4 font-display leading-[1.05] tracking-[-0.01em]", compact ? "text-3xl" : "text-[40px] sm:text-[52px]", cancelled && "text-ink-3 line-through decoration-1")}>{event.title}</h1>
        {event.speaker && (
          <p className={cn("mt-3 text-ink-2", compact ? "text-sm" : "text-lg")}>
            with <span className="font-medium text-ink">{event.speaker.name}</span>
            {(event.speaker.position || event.speaker.organization) && (
              <span className="text-ink-3"> — {[event.speaker.position, event.speaker.organization].filter(Boolean).join(", ")}</span>
            )}
          </p>
        )}
      </header>

      <dl className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2">
        <Fact icon={<CalendarDays />} label="When">
          <span className={cn(cancelled && "line-through")}>{formatRange(new Date(event.start), new Date(event.end), event.allDay)}</span>
          <span className="block text-xs text-ink-3">Paris time</span>
        </Fact>
        <Fact icon={<MapPin />} label="Where">
          {event.location || <span className="text-ink-3">To be announced</span>}
          {event.onlineUrl && !cancelled && (
            <a href={event.onlineUrl} target="_blank" rel="noopener noreferrer" className="mt-0.5 flex items-center gap-1 text-xs text-brand-ink underline-offset-2 hover:underline">
              <Video className="h-3 w-3" /> Join online
            </a>
          )}
        </Fact>
      </dl>

      {event.embedUrl && !cancelled && event.status !== "completed" && (
        <section aria-label="Registration">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">Register</h2>
          <EventEmbed url={event.embedUrl} title={event.title} className="max-w-[600px]" />
        </section>
      )}

      {event.registrationUrl && !event.embedUrl && !cancelled && event.status !== "completed" && (
        <a href={event.registrationUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center justify-center gap-2 self-start rounded-lg bg-brand px-5 text-sm font-medium text-on-brand shadow-sm transition-colors hover:bg-brand-deep">
          Register <ExternalLink className="h-4 w-4" />
        </a>
      )}

      {event.description && (
        <div className={cn("max-w-prose whitespace-pre-line leading-relaxed text-ink-2", compact ? "text-[13px]" : "text-[15px]")}>{event.description}</div>
      )}

      {event.speaker?.bio && (
        <section className="rounded-xl bg-surface-2 p-5">
          <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
            <Mic2 className="h-3.5 w-3.5" /> About the speaker
          </h2>
          <p className="mt-2 max-w-prose whitespace-pre-line text-[13px] leading-relaxed text-ink-2">{event.speaker.bio}</p>
        </section>
      )}
    </article>
  );
}

function Fact({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface p-4">
      <dt className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
        <span className="text-brand-ink [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
        {label}
      </dt>
      <dd className="mt-1 pl-6 text-sm font-medium text-ink">{children}</dd>
    </div>
  );
}
