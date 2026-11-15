"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarCheck, CalendarPlus, CircleDashed, HelpCircle, Info, Sparkles, X } from "lucide-react";
import { addProposalAction, confirmProposalAction, declineProposalAction, suggestSlotsAction, updateProposalAction } from "@/app/actions/events";
import { Badge, Button, Callout, EmptyState, Field, Input, SectionTitle, Select } from "@/components/ui";
import type { BoardWindow, EventDetail, SlotAssessment } from "@/lib/board-types";
import { cn } from "@/lib/cn";
import { addDays, formatIsoDay, todayParis, weekdayOf } from "@/lib/time";
import { useMutate } from "./context";
import { formatWallRange } from "./event-sheet";
import { RestrictionHints } from "./new-event-dialog";

const SLOT: Record<SlotAssessment["status"], { label: string; tone: "ok" | "warn" | "danger" | "neutral" | "info"; dot: string }> = {
  available: { label: "Available", tone: "ok", dot: "bg-ok" },
  conflict: { label: "Potential conflict", tone: "warn", dot: "bg-warn" },
  restricted: { label: "Restricted", tone: "danger", dot: "hatch-danger ring-1 ring-danger/50" },
  unavailable: { label: "Unavailable", tone: "danger", dot: "bg-danger" },
  unknown: { label: "Unknown", tone: "neutral", dot: "bg-line-strong" },
};

const WEEKDAYS = [
  { v: 1, l: "Mon" },
  { v: 2, l: "Tue" },
  { v: 3, l: "Wed" },
  { v: 4, l: "Thu" },
  { v: 5, l: "Fri" },
  { v: 6, l: "Sat" },
  { v: 0, l: "Sun" },
];

export function DatesPanel({ detail, windows, readOnly }: { detail: EventDetail; windows: BoardWindow[]; readOnly: boolean }) {
  const e = detail.event;
  const { mutate, busy, dialog } = useMutate();
  const active = detail.proposals.filter((p) => p.state === "active");
  const past = detail.proposals.filter((p) => p.state !== "active");
  const lastTimes = active[0] ?? detail.proposals[0];
  const [date, setDate] = useState("");
  const [start, setStart] = useState(lastTimes?.start.slice(11) ?? e.start?.slice(11) ?? "18:30");
  const [end, setEnd] = useState(lastTimes?.end.slice(11) ?? e.end?.slice(11) ?? "20:00");

  const add = (day: string) =>
    mutate((o) => addProposalAction(e.id, { start: `${day}T${start}`, end: `${end <= start ? addDays(day, 1) : day}T${end}` }, o), {
      success: `Added ${formatIsoDay(day, true)} as an option`,
      onOk: () => setDate(""),
    });

  return (
    <div className="flex flex-col gap-8 pb-10">
      {/* Confirmed date */}
      <section>
        <SectionTitle>Confirmed date</SectionTitle>
        {e.start ? (
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-ok-soft text-ok"><CalendarCheck className="h-4 w-4" /></span>
            <div>
              <p className="text-sm font-medium">{formatWallRange(e.start, e.end, e.allDay)}</p>
              <p className="text-xs text-ink-3">Change it in the Details tab.</p>
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-ink-3">None yet. Confirming an option releases the others.</p>
        )}
      </section>

      {/* Options */}
      <section>
        <SectionTitle>Proposed dates</SectionTitle>
        {active.length === 0 ? (
          <EmptyState icon={<CircleDashed className="h-5 w-5" />} title="No dates on hold" />
        ) : (
          <ul className="flex flex-col gap-2">
            {active.map((p) => (
              <li key={p.id} className="flex flex-col gap-3 rounded-xl border border-dashed border-line-strong bg-surface p-3.5 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{formatWallRange(p.start, p.end)}</p>
                  <input
                    aria-label="Note"
                    defaultValue={p.note}
                    disabled={readOnly}
                    placeholder="Add a note…"
                    onBlur={(ev) => ev.target.value !== p.note && mutate(() => updateProposalAction(p.id, { note: ev.target.value }))}
                    className="mt-0.5 w-full bg-transparent text-xs text-ink-3 placeholder:text-ink-3/70 focus:text-ink focus:outline-none"
                  />
                  <RestrictionHintsInline windows={windows} kind={e.kind} day={p.start.slice(0, 10)} />
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    aria-label="Speaker availability"
                    value={p.availability}
                    disabled={readOnly}
                    onChange={(ev) => mutate(() => updateProposalAction(p.id, { availability: ev.target.value }), { success: "Availability recorded" })}
                    className={cn("h-8 w-[190px]", p.availability === "available" && "border-ok/50 text-ok", p.availability === "unavailable" && "border-danger/50 text-danger")}
                  >
                    <option value="unknown">Speaker: not asked / no answer</option>
                    <option value="available">Speaker: available</option>
                    <option value="unavailable">Speaker: unavailable</option>
                  </Select>
                  {!readOnly && (
                    <>
                      <Button size="sm" variant="primary" loading={busy} disabled={p.availability === "unavailable"} title={p.availability === "unknown" ? "The speaker has not confirmed this date yet" : undefined} onClick={() => mutate((o) => confirmProposalAction(p.id, { ...o, expectedVersion: e.version }), { success: "Date confirmed — the other options were released" })}>
                        Confirm
                      </Button>
                      <Button size="icon" variant="ghost" aria-label="Withdraw this option" title="Withdraw" onClick={() => mutate(() => declineProposalAction(p.id), { success: "Option withdrawn" })}>
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {!readOnly && (
          <form
            className="mt-3 flex flex-col gap-3 rounded-xl bg-surface-2/60 p-3.5"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (date) add(date);
            }}
          >
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Add an option" className="min-w-[150px] flex-1">
                <Input type="date" value={date} onChange={(ev) => setDate(ev.target.value)} />
              </Field>
              <Field label="From"><Input type="time" value={start} onChange={(ev) => setStart(ev.target.value)} className="w-[108px]" /></Field>
              <Field label="To"><Input type="time" value={end} onChange={(ev) => setEnd(ev.target.value)} className="w-[108px]" /></Field>
              <Button type="submit" variant="outline" disabled={!date} loading={busy}><CalendarPlus className="h-4 w-4" /> Add</Button>
            </div>
            {date && <RestrictionHints windows={windows} kind={e.kind} days={[{ start: date }]} />}
          </form>
        )}
      </section>

      {!readOnly && <Assistant eventId={e.id} onAdd={add} taken={active.map((p) => p.start.slice(0, 10))} />}

      {past.length > 0 && (
        <section>
          <SectionTitle>Earlier options</SectionTitle>
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
            {past.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 text-[13px]">
                <span className={cn("flex-1", p.state !== "confirmed" && "text-ink-3 line-through")}>{formatWallRange(p.start, p.end)}</span>
                <Badge tone={p.state === "confirmed" ? "ok" : "neutral"}>{p.state === "confirmed" ? "Confirmed" : p.state === "released" ? "Released" : "Withdrawn"}</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}
      {dialog}
    </div>
  );
}

function RestrictionHintsInline({ windows, kind, day }: { windows: BoardWindow[]; kind: string; day: string }) {
  const hit = windows.find((w) => w.appliesTo.includes(kind) && w.start <= day && w.end >= day && w.severity === "hard") ?? windows.find((w) => w.appliesTo.includes(kind) && w.start <= day && w.end >= day);
  if (!hit) return null;
  return <p className={cn("mt-1 text-xs", hit.severity === "hard" ? "text-danger" : "text-warn")}>{hit.severity === "hard" ? "Restricted: " : "Heads-up: "}{hit.title}</p>;
}

/** Scheduling assistant: explains every suggestion and never presents missing data as availability. */
function Assistant({ eventId, onAdd, taken }: { eventId: string; onAdd: (day: string) => void; taken: string[] }) {
  const today = todayParis();
  const [from, setFrom] = useState(addDays(today, 7));
  const [to, setTo] = useState(addDays(today, 70));
  const [weekdays, setWeekdays] = useState([1, 2, 3, 4]);
  const [result, setResult] = useState<{ days: SlotAssessment[]; suggestions: SlotAssessment[]; pendingReview: number } | null>(null);
  const [focus, setFocus] = useState<SlotAssessment | null>(null);
  const [pending, start] = useTransition();

  const runIt = () =>
    start(async () => {
      const res = await suggestSlotsAction({ eventId, from, to, weekdays });
      if (!res.ok) return void toast.error(res.error);
      setResult(res.data);
      setFocus(null);
    });

  return (
    <section>
      <SectionTitle>Find a suitable date</SectionTitle>
      <div className="rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Between"><Input type="date" value={from} onChange={(ev) => setFrom(ev.target.value)} /></Field>
          <Field label="and"><Input type="date" value={to} min={from} onChange={(ev) => setTo(ev.target.value)} /></Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-2">On</span>
            <div className="flex gap-1" role="group" aria-label="Weekdays">
              {WEEKDAYS.map((d) => {
                const on = weekdays.includes(d.v);
                return (
                  <button key={d.v} type="button" aria-pressed={on} onClick={() => setWeekdays((w) => (on ? w.filter((x) => x !== d.v) : [...w, d.v]))} className={cn("h-9 w-10 rounded-lg border text-xs font-medium", on ? "border-brand-line bg-brand-soft text-brand-ink" : "border-line text-ink-3 hover:bg-surface-2")}>
                    {d.l}
                  </button>
                );
              })}
            </div>
          </div>
          <Button variant="primary" onClick={runIt} loading={pending} disabled={!weekdays.length}><Sparkles className="h-4 w-4" /> Suggest dates</Button>
        </div>

        {result && (
          <div className="mt-5 flex flex-col gap-5">
            {result.pendingReview > 0 && (
              <Callout tone="warn" icon={<Info />}>
                {result.pendingReview} imported academic period{result.pendingReview > 1 ? "s" : ""} in this range {result.pendingReview > 1 ? "are" : "is"} still awaiting review and {result.pendingReview > 1 ? "were" : "was"} not taken into account.
              </Callout>
            )}

            {/* Day strip */}
            <div>
              <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3">
                {(Object.keys(SLOT) as SlotAssessment["status"][]).map((s) => (
                  <span key={s} className="inline-flex items-center gap-1.5"><span className={cn("h-2.5 w-2.5 rounded-sm", SLOT[s].dot)} /> {SLOT[s].label}</span>
                ))}
              </div>
              <div className="scroll-thin flex gap-[3px] overflow-x-auto pb-2">
                {result.days.map((d) => {
                  const wd = weekdayOf(d.day);
                  return (
                    <button
                      key={d.day}
                      type="button"
                      onClick={() => setFocus(d)}
                      title={`${formatIsoDay(d.day, true)} — ${SLOT[d.status].label}`}
                      aria-label={`${formatIsoDay(d.day, true)}: ${SLOT[d.status].label}`}
                      className={cn("flex w-[18px] shrink-0 flex-col items-center gap-1 rounded py-0.5", focus?.day === d.day && "bg-surface-3", !weekdays.includes(wd) && "opacity-35")}
                    >
                      <span className="text-[9px] leading-none text-ink-3">{d.day.endsWith("-01") || d.day === result.days[0].day ? d.day.slice(5, 7) : ""}&nbsp;</span>
                      <span className={cn("h-6 w-3.5 rounded-sm", SLOT[d.status].dot)} />
                      <span className="text-[9px] leading-none tabular text-ink-3">{Number(d.day.slice(8))}</span>
                    </button>
                  );
                })}
              </div>
              {focus && <SlotCard slot={focus} onAdd={onAdd} taken={taken.includes(focus.day)} highlight />}
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-ink-2">Best options</p>
              {result.suggestions.length === 0 ? (
                <EmptyState icon={<HelpCircle className="h-5 w-5" />} title="No suitable date in this range">Try a wider range or other weekdays.</EmptyState>
              ) : (
                <ul className="grid gap-2 md:grid-cols-2">
                  {result.suggestions.map((s) => (
                    <li key={s.day}><SlotCard slot={s} onAdd={onAdd} taken={taken.includes(s.day)} /></li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-ink-3">
                Only what is recorded here is taken into account.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function SlotCard({ slot, onAdd, taken, highlight }: { slot: SlotAssessment; onAdd: (day: string) => void; taken: boolean; highlight?: boolean }) {
  const blocked = slot.status === "restricted" || slot.status === "unavailable";
  return (
    <div className={cn("flex h-full flex-col gap-2 rounded-lg border border-line p-3", highlight && "mt-2 bg-surface-2/60")}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm font-medium">{formatIsoDay(slot.day, true)}</p>
        <Badge tone={SLOT[slot.status].tone}>{SLOT[slot.status].label}</Badge>
        <Badge tone={slot.speaker === "confirmed" ? "ok" : slot.speaker === "unavailable" ? "danger" : "neutral"}>
          Speaker {slot.speaker === "confirmed" ? "confirmed" : slot.speaker === "unavailable" ? "unavailable" : "not confirmed"}
        </Badge>
      </div>
      <ul className="flex flex-1 flex-col gap-1 text-xs text-ink-2">
        {slot.reasons.map((r, i) => (
          <li key={i} className="flex gap-2">
            <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", r.tone === "good" && "bg-ok", r.tone === "warn" && "bg-warn", r.tone === "bad" && "bg-danger", r.tone === "info" && "bg-line-strong")} />
            {r.text}
          </li>
        ))}
      </ul>
      {!blocked && (
        <Button size="sm" variant="outline" className="self-start" disabled={taken} onClick={() => onAdd(slot.day)}>
          {taken ? "Already an option" : "Add as an option"}
        </Button>
      )}
    </div>
  );
}
