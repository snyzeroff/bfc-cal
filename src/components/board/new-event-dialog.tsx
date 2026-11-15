"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ShieldAlert, Trash2, TriangleAlert } from "lucide-react";
import { createEventAction } from "@/app/actions/events";
import { Button, Callout, Dialog, Field, Input, Segmented, Select, Switch } from "@/components/ui";
import type { BoardCategory, BoardSpeakerLite, BoardWindow, CalendarData } from "@/lib/board-types";
import { addDays } from "@/lib/time";
import { useMutate } from "./context";

export function windowsFor(windows: BoardWindow[], kind: string, startDay: string, endDay = startDay) {
  return windows.filter((w) => w.appliesTo.includes(kind) && w.end >= startDay && w.start <= endDay);
}

export function RestrictionHints({ windows, kind, days }: { windows: BoardWindow[]; kind: string; days: { start: string; end?: string }[] }) {
  const hits = useMemo(() => {
    const seen = new Map<string, BoardWindow>();
    for (const d of days) if (d.start) for (const w of windowsFor(windows, kind, d.start, d.end ?? d.start)) seen.set(`${w.ruleId}${w.start}${w.title}`, w);
    return [...seen.values()];
  }, [windows, kind, days]);
  if (!hits.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {hits.slice(0, 3).map((w) =>
        w.severity === "hard" ? (
          <Callout key={w.key} tone="danger" icon={<ShieldAlert />} title="Restricted period">
            {w.message}
          </Callout>
        ) : (
          <Callout key={w.key} tone="warn" icon={<TriangleAlert />} title="Potential conflict">
            {w.message}
          </Callout>
        ),
      )}
    </div>
  );
}

type Mode = "none" | "options" | "set";
type Row = { date: string; start: string; end: string };

const plusMinutes = (time: string, minutes: number) => {
  const [h, m] = time.split(":").map(Number);
  const t = Math.min(23 * 60 + 59, h * 60 + m + minutes);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

export function NewEventDialog({
  open,
  onOpenChange,
  categories,
  speakers,
  windows,
  templates,
  initial,
  stayOnPage,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  categories: BoardCategory[];
  speakers: BoardSpeakerLite[];
  windows: BoardWindow[];
  templates: CalendarData["templates"];
  initial?: { date?: string; start?: string; end?: string; allDay?: boolean; speakerId?: string };
  /** Calendar: keep the user where they are instead of opening the event page. */
  stayOnPage?: boolean;
}) {
  const router = useRouter();
  const { mutate, busy, dialog } = useMutate();
  const usable = categories.filter((c) => !c.archived);
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState(usable[0]?.id ?? "");
  const [templateId, setTemplateId] = useState("");
  const [speakerId, setSpeakerId] = useState("");
  const [mode, setMode] = useState<Mode>("none");
  const [allDay, setAllDay] = useState(false);
  const [rows, setRows] = useState<Row[]>([{ date: "", start: "18:30", end: "20:00" }]);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setTemplateId("");
    setSpeakerId(initial?.speakerId ?? "");
    setCategoryId(usable[0]?.id ?? "");
    setAllDay(initial?.allDay ?? false);
    setMode(initial?.date ? "set" : "none");
    setRows([{ date: initial?.date ?? "", start: initial?.start ?? "18:30", end: initial?.end ?? "20:00" }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const category = usable.find((c) => c.id === categoryId);
  const kind = category?.kind ?? "other";
  const isConference = kind === "conference";
  const setRow = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    if (t.categoryId && usable.some((c) => c.id === t.categoryId)) setCategoryId(t.categoryId);
    setRows((r) => r.map((x) => ({ ...x, start: t.startTime, end: plusMinutes(t.startTime, t.durationMinutes) })));
  };

  const filled = rows.filter((r) => r.date);
  const canSubmit = title.trim().length > 0 && !!categoryId && (mode === "none" || filled.length > 0);

  const submit = () => {
    const first = filled[0];
    mutate(
      (o) =>
        createEventAction(
          {
            title,
            categoryId,
            speakerId: speakerId || null,
            templateId: templateId || null,
            date: mode === "set" ? first.date : null,
            startTime: first?.start ?? "18:30",
            endTime: first?.end ?? "20:00",
            allDay: mode === "set" && allDay,
            proposals:
              mode === "options"
                ? filled.map((r) => ({
                    start: `${r.date}T${r.start}`,
                    end: `${r.end <= r.start ? addDays(r.date, 1) : r.date}T${r.end}`,
                  }))
                : [],
            status: mode === "options" ? "proposed" : undefined,
          },
          o,
        ),
      {
        success: (d) => `Created “${d.title}”`,
        onOk: (d) => {
          onOpenChange(false);
          if (!stayOnPage) router.push(`/board/events/${d.id}`);
        },
      },
    );
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title="New event"
        description="Start with the essentials — everything can be refined afterwards. Nothing is public until you publish it."
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" onClick={submit} loading={busy} disabled={!canSubmit}>Create event</Button>
          </>
        }
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) submit();
          }}
        >
          <Field label="Title">
            <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. A career in M&A — with …" maxLength={160} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category">
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                {usable.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Speaker" optional>
              <Select value={speakerId} onChange={(e) => setSpeakerId(e.target.value)}>
                <option value="">No speaker yet</option>
                {speakers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}{s.organization ? ` — ${s.organization}` : ""}</option>
                ))}
              </Select>
            </Field>
          </div>
          {templates.length > 0 && (
            <Field label="Template" optional hint={templateId ? `Adds ${templates.find((t) => t.id === templateId)?.taskCount ?? 0} preparation tasks with deadlines relative to the event date.` : undefined}>
              <Select value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">Blank event</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            </Field>
          )}

          <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2/50 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-ink-2">When?</span>
              <Segmented<Mode>
                label="Date mode"
                size="sm"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "none", label: "Not decided" },
                  { value: "options", label: "Propose dates", title: "Hold several candidate dates until the speaker answers" },
                  { value: "set", label: "Date is set" },
                ]}
              />
            </div>
            {mode === "none" && <p className="text-xs text-ink-3">The event starts as an idea. Add candidate dates later from its page.</p>}
            {mode !== "none" && (
              <>
                {(mode === "options" ? rows : rows.slice(0, 1)).map((r, i) => (
                  <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] items-end gap-2">
                    <Field label={i === 0 ? "Date" : `Option ${i + 1}`}>
                      <Input type="date" value={r.date} onChange={(e) => setRow(i, { date: e.target.value })} />
                    </Field>
                    {!(mode === "set" && allDay) && (
                      <>
                        <Field label="From">
                          <Input type="time" value={r.start} onChange={(e) => setRow(i, { start: e.target.value })} className="w-[104px]" />
                        </Field>
                        <Field label="To">
                          <Input type="time" value={r.end} onChange={(e) => setRow(i, { end: e.target.value })} className="w-[104px]" />
                        </Field>
                      </>
                    )}
                    {mode === "options" && rows.length > 1 ? (
                      <Button variant="ghost" size="icon" aria-label="Remove this option" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} className="mb-0.5">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : (
                      <span />
                    )}
                  </div>
                ))}
                {mode === "options" && rows.length < 8 && (
                  <Button variant="ghost" size="sm" className="self-start" onClick={() => setRows((r) => [...r, { date: "", start: r[0].start, end: r[0].end }])}>
                    <Plus className="h-3.5 w-3.5" /> Add another option
                  </Button>
                )}
                {mode === "set" && <Switch checked={allDay} onCheckedChange={setAllDay} label="All day" />}
                {mode === "options" && (
                  <p className="text-xs text-ink-3">Options appear as tentative holds on the board calendar. Confirming one releases the others automatically.</p>
                )}
                <RestrictionHints windows={windows} kind={kind} days={(mode === "options" ? filled : filled.slice(0, 1)).map((r) => ({ start: r.date }))} />
              </>
            )}
            {!isConference && mode !== "none" && kind === "meeting" && (
              <p className="text-xs text-ink-3">Internal meetings are not subject to the Victoriales restriction.</p>
            )}
          </div>
        </form>
      </Dialog>
      {dialog}
    </>
  );
}
