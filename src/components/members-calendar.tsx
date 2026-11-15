"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import { CalendarX2, ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { Button, Segmented } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { PublicEventJson } from "@/lib/public";
import { formatTime, instantToWall, parisDay } from "@/lib/time";

const MONTH = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", month: "long", year: "numeric" });
const WEEKDAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", weekday: "short" });
const MON = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", month: "short" });

export function MembersCalendar({ events, defaultView, weekStartsOn, today }: { events: PublicEventJson[]; defaultView: "agenda" | "month"; weekStartsOn: 0 | 1; today: string }) {
  const router = useRouter();
  const cal = useRef<FullCalendar>(null);
  const [view, setView] = useState(defaultView);
  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
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
      <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-line pb-4">
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
                <div key={month} className="grid gap-4 md:grid-cols-[160px_1fr]">
                  <h2 className="font-display text-2xl leading-none text-ink-3 md:sticky md:top-20 md:self-start">{month}</h2>
                  <ul className="flex flex-col gap-3">{list.map((e) => <li key={e.id}><EventRow e={e} /></li>)}</ul>
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
        <div>
          <div className="mb-3 flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => cal.current?.getApi().today()}>Today</Button>
            <Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => cal.current?.getApi().prev()}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" aria-label="Next month" onClick={() => cal.current?.getApi().next()}><ChevronRight className="h-4 w-4" /></Button>
            <h2 className="ml-2 font-display text-2xl" aria-live="polite">{title}</h2>
          </div>
          <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
            <FullCalendar
              ref={cal}
              plugins={[dayGridPlugin]}
              initialView="dayGridMonth"
              headerToolbar={false}
              timeZone="UTC"
              now={() => `${instantToWall(new Date())}:00Z`}
              firstDay={weekStartsOn}
              height="auto"
              dayMaxEvents={3}
              displayEventTime={false}
              datesSet={(a) => setTitle(a.view.title)}
              events={filtered.map((e) => {
                const s = instantToWall(new Date(e.start));
                const en = instantToWall(new Date(e.end));
                return { id: e.id, title: e.title, start: e.allDay ? s.slice(0, 10) : `${s}:00Z`, end: e.allDay ? en.slice(0, 10) : `${en}:00Z`, allDay: e.allDay, extendedProps: { e, time: s.slice(11) } };
              })}
              eventClick={(a) => router.push(`/events/${a.event.id}`)}
              eventContent={(a) => {
                const e = a.event.extendedProps.e as PublicEventJson;
                return (
                  <div className={cn("ev-chip", e.status === "cancelled" && "ev-cancelled")} style={{ "--c": e.category.color } as React.CSSProperties} title={e.title}>
                    {!e.allDay && <span className="ev-time">{a.event.extendedProps.time}</span>}
                    <span className="ev-title">{e.title}</span>
                  </div>
                );
              }}
            />
          </div>
        </div>
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
    <Link href={`/events/${e.id}`} className="group flex gap-4 rounded-2xl border border-line bg-surface p-4 shadow-sm transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-line-strong hover:shadow-md sm:gap-5 sm:p-5">
      <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-surface-2 py-2 text-center">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-brand-ink">{WEEKDAY.format(start)}</span>
        <span className="font-display text-[30px] leading-none">{Number(parisDay(start).slice(8))}</span>
        <span className="text-[10px] uppercase tracking-wider text-ink-3">{MON.format(start)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium">
          <span className="inline-flex items-center gap-1.5" style={{ color: `color-mix(in oklab, ${e.category.color} 75%, var(--ink))` }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: e.category.color }} />
            {e.category.name}
          </span>
          {cancelled && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-danger">Cancelled</span>}
          {e.status === "postponed" && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-warn">Postponed</span>}
        </p>
        <h3 className={cn("mt-1 font-display text-[24px] leading-[1.12] group-hover:text-brand-ink", cancelled && "text-ink-3 line-through decoration-1")}>{e.title}</h3>
        {e.speaker && <p className="mt-1 truncate text-[13px] text-ink-2">with {e.speaker.name}{e.speaker.organization ? ` · ${e.speaker.organization}` : ""}</p>}
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
          <span className="tabular">{e.allDay ? "All day" : `${formatTime(start)} – ${formatTime(new Date(e.end))}`}</span>
          {e.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{e.location}</span>}
        </p>
      </div>
    </Link>
  );
}
