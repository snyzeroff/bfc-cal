"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { CalendarX2, MapPin } from "lucide-react";
import { CategoryIcon } from "@/components/category-icon";
import { Button, Segmented } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { PublicEventJson } from "@/lib/public";
import { formatTime, parisDay } from "@/lib/time";

// FullCalendar is only needed for the month grid: load it when a visitor asks for that view.
const MembersMonth = dynamic(() => import("./members-month").then((m) => m.MembersMonth), {
  ssr: false,
  loading: () => <div className="grid h-[420px] place-items-center rounded-xl border border-line bg-surface text-[13px] text-ink-3">Loading the month view…</div>,
});

const MONTH = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", month: "long", year: "numeric" });
const WEEKDAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", weekday: "short" });
const MON = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", month: "short" });

export function MembersCalendar({ events, defaultView, weekStartsOn, today }: { events: PublicEventJson[]; defaultView: "agenda" | "month"; weekStartsOn: 0 | 1; today: string }) {
  const [view, setView] = useState(defaultView);
  const [category, setCategory] = useState("");
  const [showPast, setShowPast] = useState(false);

  const categories = useMemo(() => [...new Map(events.map((e) => [e.category.name, e.category])).values()], [events]);
  const filtered = useMemo(() => events.filter((e) => !category || e.category.name === category), [events, category]);
  const upcoming = filtered.filter((e) => parisDay(new Date(e.end)) >= today);
  const past = filtered.filter((e) => parisDay(new Date(e.end)) < today).reverse();

  const groups = useMemo(() => {
    const m = new Map<string, PublicEventJson[]>();
    for (const e of upcoming) {
      const k = MONTH.format(new Date(e.start));
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.entries()];
  }, [upcoming]);

  return (
    <section aria-label="Events">
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          <FilterChip on={!category} onClick={() => setCategory("")}>All</FilterChip>
          {categories.map((c) => (
            <FilterChip key={c.name} on={category === c.name} color={c.color} onClick={() => setCategory(category === c.name ? "" : c.name)}>{c.name}</FilterChip>
          ))}
        </div>
        <div className="ml-auto">
          <Segmented label="View" value={view} onChange={setView} options={[{ value: "agenda", label: "Agenda" }, { value: "month", label: "Month" }]} />
        </div>
      </div>

      {view === "agenda" ? (
        <>
          {groups.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong px-6 py-16 text-center">
              <CalendarX2 className="h-6 w-6 text-ink-3" />
              <p className="mt-3 font-display text-2xl">No upcoming events yet</p>
              <p className="mt-1 max-w-sm text-[13px] text-ink-3">New conferences are announced here first. Subscribe to the calendar and they will appear in yours automatically.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-10">
              {groups.map(([month, list]) => (
                <div key={month} className="grid grid-cols-1 gap-4 md:grid-cols-[160px_minmax(0,1fr)]">
                  <h2 className="font-display text-[22px] leading-none text-ink md:sticky md:top-20 md:self-start">{month}</h2>
                  <ul className="flex min-w-0 flex-col gap-3">{list.map((e) => <li key={e.id} className="min-w-0"><EventRow e={e} /></li>)}</ul>
                </div>
              ))}
            </div>
          )}
          {past.length > 0 && (
            <div className="mt-12">
              <Button variant="ghost" onClick={() => setShowPast((v) => !v)} aria-expanded={showPast}>{showPast ? "Hide" : "Show"} past events ({past.length})</Button>
              {showPast && <ul className="mt-4 flex flex-col gap-3 opacity-80">{past.slice(0, 30).map((e) => <li key={e.id}><EventRow e={e} /></li>)}</ul>}
            </div>
          )}
        </>
      ) : (
        <MembersMonth events={filtered} weekStartsOn={weekStartsOn} />
      )}
    </section>
  );
}

function FilterChip({ on, onClick, children, color }: { on: boolean; onClick: () => void; children: React.ReactNode; color?: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors", on ? "border-ink bg-ink text-bg" : "border-line-strong text-ink-2 hover:bg-surface-2")}>
      {color && <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />}
      {children}
    </button>
  );
}

function EventRow({ e }: { e: PublicEventJson }) {
  const start = new Date(e.start);
  const cancelled = e.status === "cancelled";
  return (
    <Link href={`/events/${e.id}`} className="press group flex gap-4 rounded-2xl bg-surface p-4 shadow-sm ring-1 ring-line hover:shadow-md sm:gap-5 sm:p-5">
      <div className="flex w-[60px] shrink-0 flex-col items-center justify-center rounded-2xl bg-surface-2 py-2.5 text-center">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-brand-ink">{WEEKDAY.format(start)}</span>
        <span className="font-display text-[30px] leading-none">{Number(parisDay(start).slice(8))}</span>
        <span className="text-[10px] uppercase tracking-wider text-ink-3">{MON.format(start)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium">
          <span className="tint inline-flex items-center gap-1.5" style={{ "--c": e.category.color } as React.CSSProperties}>
            <CategoryIcon name={e.category.icon} className="h-3 w-3" />
            {e.category.name}
          </span>
          {cancelled && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-danger">Cancelled</span>}
          {e.status === "postponed" && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-warn">Postponed</span>}
        </p>
        <h3 className={cn("mt-1 font-display text-[21px] leading-[1.15] tracking-[-0.02em]", cancelled && "text-ink-3 line-through decoration-1")}>{e.title}</h3>
        {e.speaker && <p className="mt-1 truncate text-[13px] text-ink-2">with {e.speaker.name}{e.speaker.organization ? ` · ${e.speaker.organization}` : ""}</p>}
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
          <span className="tabular">{e.allDay ? "All day" : `${formatTime(start)} – ${formatTime(new Date(e.end))}`}</span>
          {e.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{e.location}</span>}
        </p>
      </div>
    </Link>
  );
}
