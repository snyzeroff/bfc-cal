"use client";

import { useEffect, useMemo, useRef } from "react";
import { ShieldAlert } from "lucide-react";
import { ACADEMIC_KIND_META, type BoardAcademic, type BoardEvent, type BoardLayer, type BoardProposal, type BoardVictoriales, type BoardWindow } from "@/lib/board-types";
import { cn } from "@/lib/cn";
import { addDays, diffDays, eachDay, formatIsoRange, weekdayOf } from "@/lib/time";

const DAY_W = 26;
const LANE_H = 24;
const LABEL_W = 148;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type Bar = { id: string; start: string; end: string; label: string; color: string; title: string; minWidth?: number; /** Draw the true duration as a block and the label beside it. */ marker?: boolean; dashed?: boolean; onClick?: () => void; muted?: boolean; strike?: boolean };

/** Greedy lane packing so overlapping bars stack instead of colliding. */
function pack(bars: Bar[], origin: string, total: number): { bar: Bar; lane: number; left: number; width: number; span: number }[] {
  const laneEnds: number[] = [];
  return bars
    .map((bar) => {
      const s = Math.max(0, diffDays(origin, bar.start));
      const e = Math.min(total - 1, diffDays(origin, bar.end));
      return { bar, s, e };
    })
    .filter((b) => b.e >= 0 && b.s <= total - 1 && b.e >= b.s)
    .sort((a, b) => a.s - b.s || b.e - a.e)
    .map(({ bar, s, e }) => {
      const left = s * DAY_W;
      const span = (e - s + 1) * DAY_W;
      const width = bar.marker ? span + (bar.minWidth ?? 0) : Math.max(span, bar.minWidth ?? 0);
      let lane = laneEnds.findIndex((end) => end <= left);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = left + width + 2;
      return { bar, lane, left, width, span };
    });
}

export function Timeline({
  from,
  months,
  today,
  layers,
  academic,
  windows,
  victoriales,
  events,
  proposals,
  onOpenEvent,
  onPickDay,
}: {
  /** First day shown (YYYY-MM-01). */
  from: string;
  months: number;
  today: string;
  layers: BoardLayer[];
  academic: BoardAcademic[];
  windows: BoardWindow[];
  victoriales: BoardVictoriales[];
  events: BoardEvent[];
  proposals: BoardProposal[];
  onOpenEvent: (id: string) => void;
  onPickDay: (day: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const { days, monthSpans, to } = useMemo(() => {
    const [y, m] = from.split("-").map(Number);
    const endDate = new Date(Date.UTC(y, m - 1 + months, 0));
    const to = endDate.toISOString().slice(0, 10);
    const days = eachDay(from, to);
    const monthSpans: { label: string; count: number }[] = [];
    for (const d of days) {
      const label = `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
      const last = monthSpans[monthSpans.length - 1];
      if (last?.label === label) last.count++;
      else monthSpans.push({ label, count: 1 });
    }
    return { days, monthSpans, to };
  }, [from, months]);
  const total = days.length;
  const width = total * DAY_W;

  useEffect(() => {
    const idx = diffDays(from, today);
    if (scroller.current && idx > 3 && idx < total) scroller.current.scrollLeft = Math.max(0, (idx - 4) * DAY_W);
  }, [from, today, total]);

  const hard = windows.filter((w) => w.severity === "hard");
  const soft = windows.filter((w) => w.severity === "soft" && w.type !== "academic_kind");

  const restrictionBars: Bar[] = [
    ...hard.map((w) => ({ id: w.key, start: w.start, end: w.end, label: w.title, color: "var(--danger)", title: w.message })),
    ...soft.map((w) => ({ id: w.key, start: w.start, end: w.end, label: w.title, color: "var(--warn)", title: w.message, dashed: true })),
    ...victoriales
      .filter((v) => v.date)
      .map((v) => ({ id: `v-${v.id}`, start: v.date!, end: v.endDate ?? v.date!, label: v.label, color: "var(--brand-accent)", title: `${v.label}: ${formatIsoRange(v.date!, v.endDate ?? v.date!)}`, minWidth: v.label.length * 6.4 + 20 })),
  ];

  const eventBars: Bar[] = [
    ...events
      .filter((e) => e.start)
      .map((e) => {
        const start = e.start!.slice(0, 10);
        const endWall = e.end ?? e.start!;
        const end = e.allDay || endWall.slice(11) === "00:00" ? addDays(endWall.slice(0, 10), -1) : endWall.slice(0, 10);
        return {
          id: e.id,
          start,
          end: end < start ? start : end,
          label: e.title,
          color: e.color,
          title: `${e.title} — ${formatIsoRange(start, end < start ? start : end)}`,
          minWidth: Math.min(240, e.title.length * 6.1 + 14),
          marker: true,
          dashed: ["idea", "proposed", "awaiting_confirmation", "tentative"].includes(e.status),
          strike: e.status === "cancelled",
          onClick: () => onOpenEvent(e.id),
        };
      }),
    ...proposals.map((p) => ({
      id: `p-${p.id}`,
      start: p.start.slice(0, 10),
      end: p.start.slice(0, 10),
      label: `Option · ${p.eventTitle}`,
      color: p.color,
      title: `Proposed date for ${p.eventTitle}`,
      minWidth: Math.min(240, (p.eventTitle.length + 9) * 6.1 + 14),
      marker: true,
      dashed: true,
      onClick: () => onOpenEvent(p.eventId),
    })),
  ];

  const rows: { key: string; label: React.ReactNode; bars: Bar[]; tone?: "danger" }[] = [
    { key: "restrictions", label: <span className="inline-flex items-center gap-1.5 text-danger"><ShieldAlert className="h-3.5 w-3.5" />Restrictions</span>, bars: restrictionBars, tone: "danger" },
    { key: "events", label: "BFC events", bars: eventBars },
    ...layers.map((l) => ({
      key: l.id,
      label: (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: l.color }} />
          {l.name}
        </span>
      ),
      bars: academic
        .filter((a) => a.layerId === l.id)
        .map((a) => ({
          id: a.id,
          start: a.start,
          end: a.end,
          label: a.label,
          color: ACADEMIC_KIND_META[a.kind].color,
          title: `${l.name} · ${ACADEMIC_KIND_META[a.kind].label}: ${a.label} (${formatIsoRange(a.start, a.end)})`,
          muted: a.kind === "teaching",
        })),
    })),
  ];

  const todayIdx = diffDays(from, today);

  return (
    <div ref={scroller} className="scroll-thin relative overflow-auto" style={{ maxHeight: "calc(100dvh - 190px)" }} role="region" aria-label={`Planning timeline, ${formatIsoRange(from, to)}`} tabIndex={0}>
      <div style={{ width: width + LABEL_W }} className="relative">
        {/* Header */}
        <div className="sticky top-0 z-20 flex bg-surface">
          <div className="sticky left-0 z-10 shrink-0 border-b border-r border-line bg-surface" style={{ width: LABEL_W }} />
          <div>
            <div className="flex border-b border-line">
              {monthSpans.map((m) => (
                <div key={m.label} style={{ width: m.count * DAY_W }} className="border-r border-line py-1.5 text-xs font-semibold text-ink">
                  <span className="sticky inline-block whitespace-nowrap px-2" style={{ left: LABEL_W }}>{m.label}</span>
                </div>
              ))}
            </div>
            <div className="flex border-b border-line">
              {days.map((d) => {
                const wd = weekdayOf(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => onPickDay(d)}
                    title={`New event on ${d}`}
                    style={{ width: DAY_W }}
                    className={cn(
                      "flex h-9 flex-col items-center justify-center text-[10px] leading-tight tabular hover:bg-brand-soft",
                      (wd === 0 || wd === 6) && "bg-surface-2 text-ink-3",
                      d === today && "font-bold text-brand-ink",
                      d.endsWith("-01") && "border-l border-line-strong",
                    )}
                  >
                    <span className="text-ink-3">{"SMTWTFS"[wd]}</span>
                    <span>{Number(d.slice(8))}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Rows */}
        {rows.map((row) => {
          const packed = pack(row.bars, from, total);
          const lanes = Math.max(1, ...packed.map((p) => p.lane + 1));
          return (
            <div key={row.key} className="flex border-b border-line">
              <div className="sticky left-0 z-10 flex shrink-0 items-start border-r border-line bg-surface px-3 py-2 text-xs font-medium text-ink-2" style={{ width: LABEL_W }}>
                <span className="truncate">{row.label}</span>
              </div>
              <div className="relative" style={{ width, height: lanes * LANE_H + 10 }}>
                {/* weekend shading + month separators */}
                <div className="pointer-events-none absolute inset-0 flex" aria-hidden>
                  {days.map((d) => {
                    const wd = weekdayOf(d);
                    return <div key={d} style={{ width: DAY_W }} className={cn((wd === 0 || wd === 6) && "bg-surface-2/70", d.endsWith("-01") && "border-l border-line-strong")} />;
                  })}
                </div>
                {packed.map(({ bar, lane, left, width: w, span }) => {
                  if (bar.marker) {
                    return (
                      <button
                        key={bar.id}
                        type="button"
                        onClick={bar.onClick}
                        title={bar.title}
                        style={{ left, width: w - 2, top: lane * LANE_H + 5, height: LANE_H - 4, "--c": bar.color } as React.CSSProperties}
                        className={cn("group absolute flex items-center gap-1.5 text-left text-[11px] font-medium leading-none text-ink-2 hover:text-ink", bar.strike && "line-through opacity-60")}
                      >
                        <span
                          style={{ width: span - 3 }}
                          className={cn(
                            "h-full shrink-0 rounded-[5px]",
                            bar.dashed ? "border border-dashed border-[var(--c)] bg-[color-mix(in_oklab,var(--c)_10%,var(--surface))]" : "bg-[var(--c)] group-hover:brightness-110",
                          )}
                        />
                        <span className="truncate">{bar.label}</span>
                      </button>
                    );
                  }
                  const style = { left, width: w - 2, top: lane * LANE_H + 5, height: LANE_H - 4, "--c": bar.color } as React.CSSProperties;
                  const cls = cn(
                    "absolute flex items-center overflow-hidden rounded-[5px] px-1.5 text-left text-[11px] font-medium leading-none",
                    row.tone === "danger" && !bar.dashed && bar.color === "var(--danger)"
                      ? "hatch-danger text-danger ring-1 ring-inset ring-danger/40"
                      : bar.dashed
                        ? "tint border border-dashed border-[var(--c)] bg-[color-mix(in_oklab,var(--c)_8%,var(--surface))]"
                        : bar.muted
                          ? "bg-[color-mix(in_oklab,var(--c)_14%,var(--surface))] text-ink-2"
                          : "tint bg-[color-mix(in_oklab,var(--c)_20%,var(--surface))] shadow-[inset_3px_0_0_var(--c)]",
                    bar.strike && "line-through opacity-60",
                    bar.onClick && "cursor-pointer hover:brightness-95",
                  );
                  const content = <span className="truncate pl-0.5">{bar.label}</span>;
                  return bar.onClick ? (
                    <button key={bar.id} type="button" onClick={bar.onClick} title={bar.title} style={style} className={cls}>
                      {content}
                    </button>
                  ) : (
                    <div key={bar.id} title={bar.title} style={style} className={cls}>
                      {content}
                    </div>
                  );
                })}
                {packed.length === 0 && row.key !== "restrictions" && row.key !== "events" && (
                  <span className="absolute left-3 top-2 text-[11px] text-ink-3">No verified periods in this range</span>
                )}
              </div>
            </div>
          );
        })}

        {/* Today marker */}
        {todayIdx >= 0 && todayIdx < total && (
          <div className="pointer-events-none absolute bottom-0 top-[30px] z-10 w-px bg-brand-accent" style={{ left: LABEL_W + todayIdx * DAY_W + DAY_W / 2 }} aria-hidden />
        )}
      </div>
    </div>
  );
}
