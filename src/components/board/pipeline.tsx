"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Archive, CalendarClock, CircleDashed, Globe, ListChecks, Search, ShieldAlert, Ticket } from "lucide-react";
import { Avatar, EmptyState, Input, Segmented, Select } from "@/components/ui";
import type { EventStatus } from "@/db/schema";
import { statusColor, statusLabel } from "@/lib/appearance";
import type { BoardCategory, BoardEvent, BoardUser } from "@/lib/board-types";
import { cn } from "@/lib/cn";
import { useBoard } from "./context";
import { formatWallRange } from "./event-sheet";
import { StatusBadge } from "./status";

const COLUMNS: EventStatus[] = ["idea", "proposed", "awaiting_confirmation", "tentative", "confirmed", "published"];
const CLOSED: EventStatus[] = ["postponed", "cancelled", "completed"];

export function Pipeline({ events, users, categories }: { events: BoardEvent[]; users: BoardUser[]; categories: BoardCategory[] }) {
  const { me, appearance } = useBoard();
  const [layout, setLayout] = useState<"board" | "list">("board");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [scope, setScope] = useState<"all" | "mine" | "archived">("all");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return events.filter((e) => {
      if (scope === "archived" ? !e.archived : e.archived) return false;
      if (scope === "mine" && !e.organizerIds.includes(me.id) && e.createdBy !== me.id) return false;
      if (category && e.categoryId !== category) return false;
      if (needle && !`${e.title} ${e.speakerName ?? ""} ${e.speakerOrg ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [events, q, category, scope, me.id]);

  const closed = filtered.filter((e) => CLOSED.includes(e.status));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title or speaker" aria-label="Search events" className="pl-8" />
        </div>
        <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" className="w-[160px]">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Segmented label="Scope" value={scope} onChange={setScope} options={[{ value: "all", label: "All" }, { value: "mine", label: "Mine" }, { value: "archived", label: "Archived" }]} />
        <div className="ml-auto hidden md:block">
          <Segmented label="Layout" value={layout} onChange={setLayout} options={[{ value: "board", label: "Board" }, { value: "list", label: "List" }]} />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={scope === "archived" ? <Archive className="h-5 w-5" /> : <Ticket className="h-5 w-5" />} title={scope === "archived" ? "The archive is empty" : events.length ? "No event matches these filters" : "No events yet"}>
          {events.length ? "Try another search or scope." : "Create the first conference proposal with “New event”."}
        </EmptyState>
      ) : layout === "board" && scope !== "archived" ? (
        <>
          <div className="scroll-thin -mx-4 hidden gap-3 overflow-x-auto px-4 pb-3 md:flex lg:-mx-8 lg:px-8">
            {COLUMNS.map((s) => {
              const items = filtered.filter((e) => e.status === s);
              return (
                <section key={s} className="flex w-[270px] shrink-0 flex-col rounded-xl bg-surface-2/60 p-2" aria-label={statusLabel(appearance, s)}>
                  <h2 className="flex items-center gap-2 px-2 pb-2 pt-1 text-xs font-semibold text-ink-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: statusColor(appearance, s) }} />
                    {statusLabel(appearance, s)}
                    <span className="tabular font-normal text-ink-3">{items.length}</span>
                  </h2>
                  <ul className="flex flex-col gap-2">
                    {items.map((e) => <li key={e.id}><EventCard e={e} users={users} /></li>)}
                    {items.length === 0 && <li className="rounded-lg border border-dashed border-line-strong px-3 py-5 text-center text-xs text-ink-3">Empty</li>}
                  </ul>
                </section>
              );
            })}
          </div>
          {/* Mobile: grouped list */}
          <div className="flex flex-col gap-5 md:hidden">
            {COLUMNS.map((s) => {
              const items = filtered.filter((e) => e.status === s);
              if (!items.length) return null;
              return (
                <section key={s}>
                  <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: statusColor(appearance, s) }} />
                    {statusLabel(appearance, s)} <span className="font-normal text-ink-3">{items.length}</span>
                  </h2>
                  <ul className="flex flex-col gap-2">{items.map((e) => <li key={e.id}><EventCard e={e} users={users} /></li>)}</ul>
                </section>
              );
            })}
          </div>
          {closed.length > 0 && (
            <details className="rounded-xl border border-line bg-surface">
              <summary className="px-4 py-3 text-[13px] font-medium text-ink-2">Postponed, cancelled and completed <span className="font-normal text-ink-3">({closed.length})</span></summary>
              <Rows events={closed} users={users} />
            </details>
          )}
        </>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <Rows events={filtered} users={users} />
        </div>
      )}
    </div>
  );
}

function Meta({ e }: { e: BoardEvent }) {
  return (
    <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-3">
      {e.start ? (
        <><CalendarClock className="h-3 w-3 shrink-0" /><span className="truncate">{formatWallRange(e.start, e.end, e.allDay).replace(/^\w+ /, "")}</span></>
      ) : e.activeProposals ? (
        <><CircleDashed className="h-3 w-3 shrink-0" />{e.activeProposals} date{e.activeProposals > 1 ? "s" : ""} on hold</>
      ) : (
        "No date yet"
      )}
    </p>
  );
}

function EventCard({ e, users }: { e: BoardEvent; users: BoardUser[] }) {
  const orgs = users.filter((u) => e.organizerIds.includes(u.id));
  return (
    <Link href={`/board/events/${e.id}`} className="block rounded-lg border border-line bg-surface p-3 shadow-sm transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-md">
      <p className="tint flex items-center gap-1.5 text-[11px] font-medium" style={{ "--c": e.color } as React.CSSProperties}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: e.color }} />
        {e.categoryName}
        {e.isPublic && <Globe className="ml-auto h-3 w-3 text-brand-ink" aria-label="Public" />}
        {e.violation && !e.overrideReason && <ShieldAlert className={cn("h-3 w-3 text-danger", !e.isPublic && "ml-auto")} aria-label="Inside a restricted period" />}
      </p>
      <p className="mt-1 text-[13px] font-medium leading-snug">{e.title}</p>
      {e.speakerName && <p className="mt-0.5 truncate text-xs text-ink-2">{e.speakerName}{e.speakerOrg ? ` · ${e.speakerOrg}` : ""}</p>}
      <Meta e={e} />
      {(orgs.length > 0 || e.totalTasks > 0) && (
        <div className="mt-2.5 flex items-center justify-between">
          <span className="flex -space-x-1.5">{orgs.slice(0, 4).map((u) => <Avatar key={u.id} name={u.name} size={20} className="ring-2 ring-surface" />)}</span>
          {e.totalTasks > 0 && <span className="inline-flex items-center gap-1 text-[11px] tabular text-ink-3"><ListChecks className="h-3 w-3" />{e.totalTasks - e.openTasks}/{e.totalTasks}</span>}
        </div>
      )}
    </Link>
  );
}

function Rows({ events, users }: { events: BoardEvent[]; users: BoardUser[] }) {
  return (
    <ul className="divide-y divide-line">
      {events.map((e) => (
        <li key={e.id}>
          <Link href={`/board/events/${e.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
            <span className="h-9 w-[3px] shrink-0 rounded-full" style={{ background: e.color }} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{e.title}</p>
              <p className="truncate text-xs text-ink-3">
                {e.categoryName}{e.speakerName ? ` · ${e.speakerName}` : ""} · {e.start ? formatWallRange(e.start, e.end, e.allDay) : e.activeProposals ? `${e.activeProposals} dates on hold` : "no date"}
              </p>
            </div>
            <span className="hidden -space-x-1.5 sm:flex">{users.filter((u) => e.organizerIds.includes(u.id)).slice(0, 3).map((u) => <Avatar key={u.id} name={u.name} size={22} className="ring-2 ring-surface" />)}</span>
            {e.isPublic && <Globe className="h-3.5 w-3.5 text-brand-ink" aria-label="Public" />}
            <StatusBadge status={e.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
