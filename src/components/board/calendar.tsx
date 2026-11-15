"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import type { DateSelectArg, EventClickArg, EventContentArg, EventDropArg, EventInput } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, { type DateClickArg, type EventResizeDoneArg } from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import timeGridPlugin from "@fullcalendar/timegrid";
import { Check, ChevronLeft, ChevronRight, CircleDashed, Filter, Globe, Layers, Plus, Search, ShieldAlert, Square, X } from "lucide-react";
import { moveEventAction } from "@/app/actions/events";
import { toggleTaskAction } from "@/app/actions/tasks";
import { Badge, Button, Input, Kbd, Popover, Segmented, Select, Switch } from "@/components/ui";
import { EVENT_STATUSES, type EventStatus } from "@/db/schema";
import { statusColor, statusLabel } from "@/lib/appearance";
import { ACADEMIC_KIND_META, KIND_GROUPS, type BoardEvent, type CalendarData } from "@/lib/board-types";
import { cn } from "@/lib/cn";
import { addDays, formatIsoDay, formatIsoRange, instantToWall } from "@/lib/time";
import { useBoard, useMutate } from "./context";
import { EventSheet, formatWallRange } from "./event-sheet";
import { NewEventDialog, windowsFor } from "./new-event-dialog";
import { Timeline } from "./timeline";

type View = "month" | "week" | "day" | "agenda" | "timeline";
const FC_VIEW: Record<Exclude<View, "timeline">, string> = { month: "dayGridMonth", week: "timeGridWeek", day: "timeGridDay", agenda: "listMonth" };

type Filters = { categories: string[]; statuses: EventStatus[]; visibility: "all" | "public" | "private"; organizer: string; speaker: string; program: string; q: string };
const NO_FILTERS: Filters = { categories: [], statuses: [], visibility: "all", organizer: "", speaker: "", program: "", q: "" };
type Show = { restrictions: boolean; soft: boolean; proposals: boolean; tasks: boolean };
type Prefs = { view: View; layers: string[] | null; groups: string[]; show: Show };

const STORE = "bfc.calendar.v2";
const loadPrefs = (): Partial<Prefs> => {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "{}");
  } catch {
    return {};
  }
};

const toIso = (d: Date) => d.toISOString().slice(0, 16);
const utc = (wall: string) => `${wall}:00Z`;

export function BoardCalendar({ data }: { data: CalendarData }) {
  const { me, appearance } = useBoard();
  const router = useRouter();
  const { mutate, dialog } = useMutate();
  const cal = useRef<FullCalendar>(null);

  const [view, setView] = useState<View>(appearance.defaultView);
  const [title, setTitle] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [layersOn, setLayersOn] = useState<string[]>(() => data.layers.filter((l) => l.visibleByDefault).map((l) => l.id));
  const [groups, setGroups] = useState<string[]>(() => KIND_GROUPS.filter((g) => g.defaultOn).map((g) => g.key));
  const [show, setShow] = useState<Show>({ restrictions: true, soft: false, proposals: true, tasks: true });
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ date?: string; start?: string; end?: string; allDay?: boolean } | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [tlFrom, setTlFrom] = useState(() => `${data.today.slice(0, 7)}-01`);
  const [ready, setReady] = useState(false);

  /* ---- preferences (per browser) ---- */
  // Preferences live in localStorage, which the server cannot see: the first render uses the
  // defaults (so it matches the server HTML) and the stored values are applied right after.
  useEffect(() => {
    const mq = matchMedia("(max-width: 640px)");
    const restore = () => {
      const p = loadPrefs();
      setIsMobile(mq.matches);
      if (p.view) setView(p.view);
      if (p.layers) setLayersOn(p.layers.filter((id) => data.layers.some((l) => l.id === id)));
      if (p.groups) setGroups(p.groups);
      if (p.show) setShow((s) => ({ ...s, ...p.show }));
      setReady(true);
    };
    restore();
    const on = () => setIsMobile(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORE, JSON.stringify({ view, layers: layersOn, groups, show } satisfies Prefs));
    } catch {}
  }, [ready, view, layersOn, groups, show]);

  useEffect(() => {
    if (view !== "timeline") cal.current?.getApi().changeView(FC_VIEW[view]);
  }, [view]);

  /* ---- filtering ---- */
  const events = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return data.events.filter((e) => {
      if (filters.categories.length && !filters.categories.includes(e.categoryId)) return false;
      if (filters.statuses.length && !filters.statuses.includes(e.status)) return false;
      if (filters.visibility === "public" && !e.isPublic) return false;
      if (filters.visibility === "private" && e.isPublic) return false;
      if (filters.organizer && !e.organizerIds.includes(filters.organizer)) return false;
      if (filters.speaker && e.speakerId !== filters.speaker) return false;
      if (filters.program && e.audience.length > 0 && !e.audience.some((a) => a.startsWith(filters.program))) return false;
      if (q && !`${e.title} ${e.speakerName ?? ""} ${e.location} ${e.categoryName}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data.events, filters]);
  const eventIds = useMemo(() => new Set(events.map((e) => e.id)), [events]);
  const proposals = useMemo(() => (show.proposals ? data.proposals.filter((p) => eventIds.has(p.eventId)) : []), [data.proposals, eventIds, show.proposals]);
  const filterCount =
    filters.categories.length + filters.statuses.length + (filters.visibility !== "all" ? 1 : 0) + (filters.organizer ? 1 : 0) + (filters.speaker ? 1 : 0) + (filters.program ? 1 : 0);

  const programs = useMemo(() => [...new Set(data.layers.map((l) => l.program).filter(Boolean))], [data.layers]);
  const visibleLayers = useMemo(() => data.layers.filter((l) => layersOn.includes(l.id) && (!filters.program || l.program === filters.program)), [data.layers, layersOn, filters.program]);
  const academic = useMemo(() => {
    const ids = new Set(visibleLayers.map((l) => l.id));
    return data.academic.filter((a) => ids.has(a.layerId) && groups.includes(ACADEMIC_KIND_META[a.kind].group));
  }, [data.academic, visibleLayers, groups]);
  const windows = useMemo(
    () => data.windows.filter((w) => (w.severity === "hard" ? show.restrictions : show.soft)),
    [data.windows, show.restrictions, show.soft],
  );

  /* ---- FullCalendar sources ---- */
  const fcEvents = useMemo<EventInput[]>(() => {
    const out: EventInput[] = [];
    const colorOf = (e: BoardEvent) => (appearance.colorEventsBy === "status" ? statusColor(appearance, e.status) : e.color);
    for (const e of events) {
      if (!e.start || !e.end) continue;
      out.push({
        id: `e:${e.id}`,
        title: e.title,
        start: e.allDay ? e.start.slice(0, 10) : utc(e.start),
        end: e.allDay ? e.end.slice(0, 10) : utc(e.end),
        allDay: e.allDay,
        editable: e.canEdit && !(e.isPublic && !me.isAdmin),
        extendedProps: { type: "event", ev: e, color: colorOf(e), order: 1 },
      });
    }
    for (const p of proposals) {
      out.push({ id: `p:${p.id}`, title: p.eventTitle, start: utc(p.start), end: utc(p.end), editable: false, extendedProps: { type: "proposal", p, color: p.color, order: 2 } });
    }
    if (show.tasks) {
      for (const t of data.tasks) {
        if (!t.dueDate || t.done) continue;
        if (t.eventId && !eventIds.has(t.eventId)) continue;
        out.push({ id: `t:${t.id}`, title: t.title, start: t.dueDate, allDay: true, editable: false, extendedProps: { type: "task", t, order: 3 } });
      }
    }
    const layerById = new Map(data.layers.map((l) => [l.id, l]));
    for (const a of academic) {
      const layer = layerById.get(a.layerId)!;
      out.push({ id: `a:${a.id}`, title: a.label, start: a.start, end: addDays(a.end, 1), allDay: true, editable: false, extendedProps: { type: "academic", a, layer, order: 5 } });
    }
    for (const v of data.victoriales) {
      if (!v.date) continue;
      out.push({ id: `v:${v.id}`, title: v.label, start: v.date, end: addDays(v.endDate ?? v.date, 1), allDay: true, editable: false, extendedProps: { type: "victoriales", order: 0 } });
    }
    for (const w of windows) {
      out.push({ id: `w:${w.key}`, title: w.title, start: w.start, end: addDays(w.end, 1), allDay: true, display: "background", classNames: [w.severity === "hard" ? "bg-restricted" : "bg-soft-rule"], extendedProps: { type: "window", w } });
    }
    return out;
  }, [events, proposals, show.tasks, data.tasks, data.layers, data.victoriales, academic, windows, eventIds, appearance, me.isAdmin]);

  /* ---- interactions ---- */
  const applyMove = useCallback(
    (info: EventDropArg | EventResizeDoneArg) => {
      const ev = info.event.extendedProps.ev as BoardEvent;
      const start = info.event.start!;
      const end = info.event.end ?? new Date(start.getTime() + (info.event.allDay ? 86_400_000 : 3_600_000));
      const next = { start: toIso(start), end: toIso(end), allDay: info.event.allDay };
      const prev = { start: ev.start!, end: ev.end!, allDay: ev.allDay };
      mutate((o) => moveEventAction(ev.id, next, { ...o, expectedVersion: ev.version }), {
        success: `Moved to ${formatWallRange(next.start, next.end, next.allDay)}`,
        onFail: () => info.revert(),
        undo: () => mutate((o) => moveEventAction(ev.id, prev, o), { success: "Move undone" }),
      });
    },
    [mutate],
  );

  const onEventClick = useCallback(
    (arg: EventClickArg) => {
      const x = arg.event.extendedProps;
      if (x.type === "event") setOpenId((x.ev as BoardEvent).id);
      else if (x.type === "proposal") setOpenId(x.p.eventId);
      else if (x.type === "task") router.push(x.t.eventId ? `/board/events/${x.t.eventId}?tab=tasks` : "/board/tasks");
    },
    [router],
  );

  const onSelect = useCallback((arg: DateSelectArg) => {
    const start = toIso(arg.start);
    const endInc = arg.allDay ? toIso(new Date(arg.end.getTime() - 86_400_000)) : toIso(arg.end);
    setCreating(
      arg.allDay
        ? { date: start.slice(0, 10), start: "18:30", end: "20:00", allDay: false }
        : { date: start.slice(0, 10), start: start.slice(11), end: endInc.slice(11), allDay: false },
    );
    arg.view.calendar.unselect();
  }, []);

  const onDateClick = useCallback(
    (arg: DateClickArg) => {
      if (isMobile) setSelectedDay(arg.dateStr.slice(0, 10));
    },
    [isMobile],
  );

  const renderContent = useCallback(
    (arg: EventContentArg) => {
      const x = arg.event.extendedProps;
      const block = arg.view.type.startsWith("timeGrid") && !arg.event.allDay;
      const time = arg.event.allDay || !arg.event.start ? "" : arg.event.start.toISOString().slice(11, 16);
      if (x.type === "window") return <span className="bg-label">{x.w.severity === "hard" ? "⛔ " : ""}{x.w.title}</span>;
      if (x.type === "academic") {
        const meta = ACADEMIC_KIND_META[x.a.kind as keyof typeof ACADEMIC_KIND_META];
        return (
          <div className="flex h-[17px] items-center gap-1 overflow-hidden rounded-[4px] px-1.5 text-[10.5px] font-medium leading-none" style={{ background: `color-mix(in oklab, ${meta.color} 16%, var(--surface))`, color: `color-mix(in oklab, ${meta.color} 70%, var(--ink))`, boxShadow: `inset 2px 0 0 ${x.layer.color}` }} title={`${x.layer.name} · ${meta.label}: ${x.a.label} (${formatIsoRange(x.a.start, x.a.end)})`}>
            <span className="truncate">
              <span className="opacity-70">{x.layer.name} · </span>
              {x.a.label}
            </span>
          </div>
        );
      }
      if (x.type === "victoriales") {
        return <div className="flex h-[19px] items-center gap-1 overflow-hidden rounded-[4px] bg-brand-accent px-1.5 text-[11px] font-semibold text-white"><span className="truncate">★ {arg.event.title}</span></div>;
      }
      if (x.type === "task") {
        return (
          <div className="ev-chip ev-task" title={`Deadline: ${arg.event.title}${x.t.eventTitle ? ` (${x.t.eventTitle})` : ""}`}>
            <Square className="h-3 w-3 shrink-0 text-ink-3" />
            <span className="ev-title">{arg.event.title}</span>
          </div>
        );
      }
      if (x.type === "proposal") {
        return (
          <div className={cn("ev-chip ev-tentative", block && "ev-block")} style={{ "--c": x.color } as React.CSSProperties} title={`Proposed date — ${arg.event.title}`}>
            <span className="flex min-w-0 items-center gap-1">
              <CircleDashed className="h-3 w-3 shrink-0" />
              {!block && <span className="ev-time">{time}</span>}
              <span className="ev-title">{arg.event.title}</span>
            </span>
            {block && <span className="ev-time">Option · {time}</span>}
          </div>
        );
      }
      const e = x.ev as BoardEvent;
      const tentative = ["idea", "proposed", "awaiting_confirmation", "tentative", "postponed"].includes(e.status);
      return (
        <div
          className={cn("ev-chip", block && "ev-block", tentative && "ev-tentative", e.status === "cancelled" && "ev-cancelled")}
          style={{ "--c": x.color } as React.CSSProperties}
          title={`${e.title} — ${statusLabel(appearance, e.status)}${e.isPublic ? " · public" : ""}`}
        >
          <span className="flex min-w-0 items-center gap-1">
            {e.violation && !e.overrideReason && <ShieldAlert className="h-3 w-3 shrink-0 text-danger" aria-label="Inside a restricted period" />}
            {e.isPublic && <Globe className="h-3 w-3 shrink-0 opacity-70" aria-label="Public" />}
            {!block && time && <span className="ev-time">{time}</span>}
            <span className="ev-title">{e.title}</span>
          </span>
          {block && (
            <span className="ev-time">
              {time} · {statusLabel(appearance, e.status)}
            </span>
          )}
        </div>
      );
    },
    [appearance],
  );

  /* ---- navigation & shortcuts ---- */
  const shiftMonths = (n: number) => {
    const [y, m] = tlFrom.split("-").map(Number);
    setTlFrom(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10));
  };
  const nav = useCallback(
    (dir: -1 | 0 | 1) => {
      if (view === "timeline") {
        if (dir === 0) setTlFrom(`${data.today.slice(0, 7)}-01`);
        else shiftMonths(dir * 2);
        return;
      }
      const api = cal.current?.getApi();
      if (!api) return;
      if (dir === 0) api.today();
      else if (dir === 1) api.next();
      else api.prev();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, tlFrom, data.today],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || document.querySelector("[role=dialog]")) return;
      const map: Record<string, () => void> = {
        t: () => nav(0),
        ArrowLeft: () => nav(-1),
        ArrowRight: () => nav(1),
        j: () => nav(1),
        k: () => nav(-1),
        m: () => setView("month"),
        w: () => setView("week"),
        d: () => setView("day"),
        a: () => setView("agenda"),
        l: () => setView("timeline"),
        n: () => setCreating({}),
      };
      const fn = map[e.key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav]);

  const timelineTitle = useMemo(() => {
    const [y, m] = tlFrom.split("-").map(Number);
    const end = new Date(Date.UTC(y, m + 4, 0)).toISOString().slice(0, 10);
    return formatIsoRange(tlFrom, end).replace(/\b\w{3} (\d)/g, "$1");
  }, [tlFrom]);

  const openEvent = data.events.find((e) => e.id === openId) ?? null;
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const hardCount = data.windows.filter((w) => w.severity === "hard").length;
  const victorialesMissing = data.victoriales.every((v) => !v.date);

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-8" onClick={() => nav(0)}>Today</Button>
          <Button variant="ghost" size="icon" aria-label="Previous" onClick={() => nav(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" aria-label="Next" onClick={() => nav(1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <h2 className="mr-auto min-w-0 truncate font-display text-[26px] leading-none" aria-live="polite">{view === "timeline" ? timelineTitle : title}</h2>

        <div className="relative hidden md:block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
          <Input value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} placeholder="Search events" aria-label="Search events" className="h-8 w-44 pl-8" />
        </div>

        <Popover
          align="end"
          className="w-80"
          trigger={
            <Button variant="outline" size="sm" className="h-8">
              <Filter className="h-3.5 w-3.5" /> Filter
              {filterCount > 0 && <span className="rounded-full bg-brand px-1.5 text-[10px] text-on-brand">{filterCount}</span>}
            </Button>
          }
        >
          <div className="flex max-h-[70dvh] flex-col gap-4 overflow-y-auto pr-1 scroll-thin">
            <FilterGroup title="Category">
              {data.categories.filter((c) => !c.archived).map((c) => (
                <Chip key={c.id} on={filters.categories.includes(c.id)} color={c.color} onClick={() => setFilters((f) => ({ ...f, categories: toggle(f.categories, c.id) }))}>{c.name}</Chip>
              ))}
            </FilterGroup>
            <FilterGroup title="Status">
              {EVENT_STATUSES.map((s) => (
                <Chip key={s} on={filters.statuses.includes(s)} color={statusColor(appearance, s)} onClick={() => setFilters((f) => ({ ...f, statuses: toggle(f.statuses, s) }))}>{statusLabel(appearance, s)}</Chip>
              ))}
            </FilterGroup>
            <FilterGroup title="Visibility">
              <Segmented label="Visibility" size="sm" value={filters.visibility} onChange={(v) => setFilters((f) => ({ ...f, visibility: v }))} options={[{ value: "all", label: "All" }, { value: "public", label: "Public" }, { value: "private", label: "Board only" }]} />
            </FilterGroup>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                Organiser
                <Select value={filters.organizer} onChange={(e) => setFilters((f) => ({ ...f, organizer: e.target.value }))} className="h-8 font-normal normal-case tracking-normal">
                  <option value="">Anyone</option>
                  <option value={me.id}>Me</option>
                  {data.users.filter((u) => u.active && u.id !== me.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                Speaker
                <Select value={filters.speaker} onChange={(e) => setFilters((f) => ({ ...f, speaker: e.target.value }))} className="h-8 font-normal normal-case tracking-normal">
                  <option value="">Any</option>
                  {data.speakers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </label>
            </div>
            {programs.length > 0 && (
              <FilterGroup title="Academic program">
                <Chip on={!filters.program} onClick={() => setFilters((f) => ({ ...f, program: "" }))}>All</Chip>
                {programs.map((p) => <Chip key={p} on={filters.program === p} onClick={() => setFilters((f) => ({ ...f, program: f.program === p ? "" : p }))}>{p}</Chip>)}
              </FilterGroup>
            )}
            {filterCount > 0 && <Button variant="ghost" size="sm" className="self-start" onClick={() => setFilters((f) => ({ ...NO_FILTERS, q: f.q }))}><X className="h-3.5 w-3.5" /> Clear filters</Button>}
          </div>
        </Popover>

        <Popover
          align="end"
          className="w-80"
          trigger={
            <Button variant="outline" size="sm" className="h-8">
              <Layers className="h-3.5 w-3.5" /> Layers
            </Button>
          }
        >
          <div className="flex max-h-[70dvh] flex-col gap-4 overflow-y-auto pr-1 scroll-thin">
            <div className="flex flex-col gap-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Planning</p>
              <Switch checked={show.restrictions} onCheckedChange={(v) => setShow((s) => ({ ...s, restrictions: v }))} label="Restricted periods" description={`Hard rules, incl. Victoriales (${hardCount} period${hardCount === 1 ? "" : "s"})`} />
              <Switch checked={show.soft} onCheckedChange={(v) => setShow((s) => ({ ...s, soft: v }))} label="Soft warnings" description="Periods that warn but do not block" />
              <Switch checked={show.proposals} onCheckedChange={(v) => setShow((s) => ({ ...s, proposals: v }))} label="Proposed dates" description="Tentative holds awaiting an answer" />
              <Switch checked={show.tasks} onCheckedChange={(v) => setShow((s) => ({ ...s, tasks: v }))} label="Task deadlines" />
            </div>
            <div className="flex flex-col gap-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Academic calendars</p>
              {data.layers.length === 0 && <p className="text-xs text-ink-3">No academic calendar yet. Import one from the Academic section.</p>}
              {data.layers.map((l) => (
                <LayerToggle key={l.id} on={layersOn.includes(l.id)} color={l.color} onClick={() => setLayersOn((x) => toggle(x, l.id))}>{l.name}</LayerToggle>
              ))}
            </div>
            {data.layers.length > 0 && (
              <div className="flex flex-col gap-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Show in those calendars</p>
                {KIND_GROUPS.map((g) => (
                  <LayerToggle key={g.key} on={groups.includes(g.key)} onClick={() => setGroups((x) => toggle(x, g.key))}>{g.label}</LayerToggle>
                ))}
              </div>
            )}
          </div>
        </Popover>

        <div className="order-last w-full sm:order-none sm:w-auto">
          <Segmented<View>
            label="Calendar view"
            value={view}
            onChange={setView}
            options={[
              { value: "month", label: "Month", title: "Month (M)" },
              { value: "week", label: "Week", title: "Week (W)" },
              { value: "day", label: "Day", title: "Day (D)" },
              { value: "agenda", label: "Agenda", title: "Agenda (A)" },
              { value: "timeline", label: "Timeline", title: "Timeline (L)" },
            ]}
          />
        </div>
        <Button variant="primary" className="h-8" onClick={() => setCreating({})}>
          <Plus className="h-4 w-4" /> New
        </Button>
      </div>

      {victorialesMissing && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-warn/30 bg-warn-soft px-3.5 py-2.5 text-[13px]">
          <ShieldAlert className="h-4 w-4 shrink-0 text-warn" />
          <span className="min-w-0 flex-1">
            <strong className="font-medium">The Victoriales date is not set.</strong> The 21-day no-conference period cannot be enforced until a Super Admin enters it.
          </span>
          {me.isSuperAdmin && <Button size="sm" variant="outline" onClick={() => router.push("/board/settings?tab=rules")}>Set the date</Button>}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-ink-3">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm bg-brand/20 shadow-[inset_3px_0_0_var(--brand)]" /> Confirmed</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm border border-dashed border-brand/60" /> Tentative / proposed</span>
        <span className="inline-flex items-center gap-1.5"><Globe className="h-3 w-3" /> Public</span>
        {show.restrictions && <span className="inline-flex items-center gap-1.5"><span className="hatch-danger h-3 w-5 rounded-sm ring-1 ring-danger/40" /> Restricted (no conferences)</span>}
        {visibleLayers.map((l) => (
          <span key={l.id} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: l.color }} /> {l.name}</span>
        ))}
        <span className="ml-auto hidden items-center gap-1 xl:inline-flex"><Kbd>N</Kbd> new <Kbd>T</Kbd> today <Kbd>←</Kbd><Kbd>→</Kbd> navigate</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
        <div className={cn(view === "timeline" && "hidden")}>
          <FullCalendar
            ref={cal}
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
            initialView={FC_VIEW[view === "timeline" ? "month" : view]}
            headerToolbar={false}
            timeZone="UTC"
            now={() => utc(instantToWall(new Date()))}
            nowIndicator
            firstDay={appearance.weekStartsOn}
            weekends={appearance.showWeekends}
            height="auto"
            events={fcEvents}
            eventContent={renderContent}
            eventOrder="order,start,-duration,title"
            eventClick={onEventClick}
            editable
            eventStartEditable
            eventDurationEditable
            eventDrop={applyMove}
            eventResize={applyMove}
            selectable={!isMobile}
            selectMirror
            select={onSelect}
            dateClick={onDateClick}
            datesSet={(arg) => setTitle(arg.view.title)}
            dayMaxEvents={isMobile ? 3 : 5}
            displayEventTime={false}
            slotMinTime={`${String(appearance.dayStartHour).padStart(2, "0")}:00:00`}
            slotMaxTime={`${String(appearance.dayEndHour).padStart(2, "0")}:00:00`}
            slotLabelFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
            allDayText=""
            scrollTime="16:00:00"
            listDayFormat={{ weekday: "long", day: "numeric", month: "long" }}
            listDaySideFormat={false}
            noEventsContent={<div className="px-6 py-14 text-center text-[13px] text-ink-3">Nothing scheduled in this period.</div>}
            dayHeaderFormat={view === "month" ? { weekday: "short" } : { weekday: "short", day: "numeric" }}
            longPressDelay={350}
          />
        </div>
        {view === "timeline" && (
          <Timeline
            from={tlFrom}
            months={5}
            today={data.today}
            layers={visibleLayers}
            academic={academic}
            windows={windows}
            victoriales={data.victoriales}
            events={events}
            proposals={proposals}
            onOpenEvent={setOpenId}
            onPickDay={(d) => setCreating({ date: d })}
          />
        )}
      </div>

      {/* Mobile: tap a day to see what is on it */}
      {isMobile && selectedDay && view === "month" && (
        <DayPanel day={selectedDay} data={data} events={events} proposals={proposals} academic={academic} onOpen={setOpenId} onClose={() => setSelectedDay(null)} onNew={() => setCreating({ date: selectedDay })} />
      )}

      <EventSheet event={openEvent} proposals={data.proposals} users={data.users} onClose={() => setOpenId(null)} />
      <NewEventDialog open={!!creating} onOpenChange={(o) => !o && setCreating(null)} categories={data.categories} speakers={data.speakers} windows={data.windows} templates={data.templates} initial={creating ?? undefined} stayOnPage />
      {dialog}
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">{title}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({ on, onClick, children, color }: { on: boolean; onClick: () => void; children: React.ReactNode; color?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs transition-colors", on ? "border-brand-line bg-brand-soft text-brand-ink" : "border-line text-ink-2 hover:bg-surface-2")}
    >
      {color && <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />}
      {children}
    </button>
  );
}

function LayerToggle({ on, onClick, children, color }: { on: boolean; onClick: () => void; children: React.ReactNode; color?: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} onClick={onClick} className="flex items-center gap-2.5 text-left text-[13px] text-ink">
      <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", on ? "border-transparent text-white" : "border-line-strong")} style={on ? { background: color ?? "var(--brand)" } : undefined}>
        {on && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
      {children}
    </button>
  );
}

function DayPanel({
  day,
  data,
  events,
  proposals,
  academic,
  onOpen,
  onClose,
  onNew,
}: {
  day: string;
  data: CalendarData;
  events: BoardEvent[];
  proposals: CalendarData["proposals"];
  academic: CalendarData["academic"];
  onOpen: (id: string) => void;
  onClose: () => void;
  onNew: () => void;
}) {
  const { mutate } = useMutate();
  const dayEvents = events.filter((e) => e.start && e.start.slice(0, 10) <= day && (e.end ?? e.start).slice(0, 10) >= day);
  const dayProps = proposals.filter((p) => p.start.slice(0, 10) === day);
  const dayTasks = data.tasks.filter((t) => t.dueDate === day && !t.done);
  const dayAcademic = academic.filter((a) => a.start <= day && a.end >= day);
  const hard = windowsFor(data.windows, "conference", day).filter((w) => w.severity === "hard");
  const layerName = (id: string) => data.layers.find((l) => l.id === id)?.name ?? "";
  const empty = !dayEvents.length && !dayProps.length && !dayTasks.length && !dayAcademic.length && !hard.length;
  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-sm animate-up" aria-label={`Details for ${formatIsoDay(day, true)}`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-xl">{formatIsoDay(day, true)}</h3>
        <div className="flex gap-1">
          <Button size="sm" variant="primary" onClick={onNew}><Plus className="h-3.5 w-3.5" /> New</Button>
          <Button size="icon" variant="ghost" aria-label="Close" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
      </div>
      <ul className="flex flex-col gap-2 text-[13px]">
        {hard.map((w) => (
          <li key={w.key} className="hatch-danger rounded-lg px-3 py-2 font-medium text-danger ring-1 ring-inset ring-danger/30">{w.title}</li>
        ))}
        {dayEvents.map((e) => (
          <li key={e.id}>
            <button onClick={() => onOpen(e.id)} className="flex w-full items-center gap-3 rounded-lg bg-surface-2 px-3 py-2 text-left">
              <span className="h-8 w-1 rounded-full" style={{ background: e.color }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{e.title}</span>
                <span className="block text-xs text-ink-3">{e.allDay ? "All day" : `${e.start!.slice(11)} – ${e.end!.slice(11)}`}{e.location ? ` · ${e.location}` : ""}</span>
              </span>
              {e.isPublic && <Badge tone="brand">Public</Badge>}
            </button>
          </li>
        ))}
        {dayProps.map((p) => (
          <li key={p.id}>
            <button onClick={() => onOpen(p.eventId)} className="flex w-full items-center gap-3 rounded-lg border border-dashed border-line-strong px-3 py-2 text-left">
              <CircleDashed className="h-4 w-4 text-ink-3" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{p.eventTitle}</span>
                <span className="block text-xs text-ink-3">Proposed · {p.start.slice(11)} – {p.end.slice(11)}</span>
              </span>
            </button>
          </li>
        ))}
        {dayTasks.map((t) => (
          <li key={t.id} className="flex items-center gap-3 px-1 py-1">
            <button aria-label={`Mark “${t.title}” as done`} onClick={() => mutate(() => toggleTaskAction(t.id, true), { success: "Task completed" })} className="grid h-4 w-4 place-items-center rounded border border-line-strong" />
            <span className="min-w-0 flex-1 truncate">{t.title}</span>
          </li>
        ))}
        {dayAcademic.map((a) => (
          <li key={a.id} className="flex items-center gap-2 px-1 text-xs text-ink-2">
            <span className="h-2 w-2 rounded-full" style={{ background: ACADEMIC_KIND_META[a.kind].color }} />
            {layerName(a.layerId)} · {a.label}
          </li>
        ))}
        {empty && <li className="py-3 text-center text-ink-3">Nothing on this day.</li>}
      </ul>
    </section>
  );
}
