"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, ArrowLeft, Check, Clock, Copy, Globe, GlobeLock, Lock, MoreHorizontal, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { archiveEventAction, deleteEventAction, duplicateEventAction, publishEventAction, setStatusAction, updateEventAction, type EventFormInput } from "@/app/actions/events";
import { PublicEventView } from "@/components/public-event";
import { Avatar, Button, Callout, ColorField, Dialog, Field, Input, Menu, MenuItem, MenuSeparator, Select, Switch, TabPanel, Tabs, Textarea } from "@/components/ui";
import type { EventStatus } from "@/db/schema";
import type { BoardCategory, BoardLayer, BoardSpeakerLite, BoardUser, BoardWindow, EventDetail } from "@/lib/board-types";
import { cn } from "@/lib/cn";
import { parseEmbed } from "@/lib/embed";
import { addDays, diffDays, formatDateTime, wallToInstant } from "@/lib/time";
import { useBoard, useMutate } from "./context";
import { DatesPanel } from "./dates-panel";
import { DiscussionPanel, HistoryPanel } from "./discussion-panel";
import { formatWallRange } from "./event-sheet";
import { RestrictionHints } from "./new-event-dialog";
import { StatusMenu, VisibilityBadge } from "./status";
import { TaskList } from "./task-list";

const STEPS: { label: string; statuses: EventStatus[] }[] = [
  { label: "Idea", statuses: ["idea"] },
  { label: "Dates proposed", statuses: ["proposed", "awaiting_confirmation"] },
  { label: "Tentative", statuses: ["tentative"] },
  { label: "Confirmed", statuses: ["confirmed"] },
  { label: "Published", statuses: ["published"] },
  { label: "Done", statuses: ["completed"] },
];

function Stepper({ status }: { status: EventStatus }) {
  const current = STEPS.findIndex((s) => s.statuses.includes(status));
  if (current === -1) return null;
  return (
    <ol className="scroll-thin flex items-center gap-1 overflow-x-auto" aria-label="Conference workflow">
      {STEPS.map((s, i) => (
        <li key={s.label} className="flex shrink-0 items-center gap-1" aria-current={i === current ? "step" : undefined}>
          <span
            className={cn(
              "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium",
              i < current && "bg-ok-soft text-ok",
              i === current && "bg-brand text-on-brand",
              i > current && "bg-surface-2 text-ink-3",
            )}
          >
            {i < current ? <Check className="h-3 w-3" strokeWidth={3} /> : <span className="tabular opacity-70">{i + 1}</span>}
            {s.label}
          </span>
          {i < STEPS.length - 1 && <span className={cn("h-px w-3", i < current ? "bg-ok" : "bg-line-strong")} />}
        </li>
      ))}
    </ol>
  );
}

type FormState = Required<Pick<EventFormInput, "title" | "description" | "internalNotes" | "categoryId" | "location" | "onlineUrl" | "registrationUrl" | "embed">> & {
  featured: boolean;
  speakerId: string;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  color: string | null;
  audience: string[];
  organizerIds: string[];
  scheduledPublishAt: string;
};

const initialForm = (d: EventDetail): FormState => {
  const e = d.event;
  const endWall = e.end ?? "";
  // All-day events are stored with an exclusive end: show the last day instead.
  const lastDay = e.allDay && endWall ? new Date(Date.parse(`${endWall.slice(0, 10)}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10) : endWall.slice(0, 10);
  const startDay = e.start?.slice(0, 10) ?? "";
  // A timed event that simply runs past midnight needs no "last day": the end time says it.
  const overnight = !e.allDay && !!startDay && lastDay === addDays(startDay, 1) && endWall.slice(11) <= (e.start?.slice(11) ?? "");
  return {
    title: e.title,
    description: e.description,
    internalNotes: e.internalNotes,
    categoryId: e.categoryId,
    speakerId: e.speakerId ?? "",
    date: e.start?.slice(0, 10) ?? "",
    endDate: lastDay && lastDay !== startDay && !overnight ? lastDay : "",
    startTime: e.start && !e.allDay ? e.start.slice(11) : "18:30",
    endTime: e.end && !e.allDay ? e.end.slice(11) : "20:00",
    allDay: e.allDay,
    location: e.location,
    onlineUrl: e.onlineUrl,
    registrationUrl: e.registrationUrl,
    embed: e.embedUrl,
    featured: e.featured,
    color: e.customColor,
    audience: e.audience,
    organizerIds: e.organizerIds,
    scheduledPublishAt: e.scheduledPublishAt ?? "",
  };
};

export function EventEditor({
  detail,
  categories,
  speakers,
  users,
  layers,
  windows,
  initialTab,
}: {
  detail: EventDetail;
  categories: BoardCategory[];
  speakers: BoardSpeakerLite[];
  users: BoardUser[];
  layers: BoardLayer[];
  windows: BoardWindow[];
  initialTab?: string;
}) {
  const { me } = useBoard();
  const router = useRouter();
  const { mutate, busy, dialog } = useMutate();
  const e = detail.event;
  const readOnly = !e.canEdit || e.archived;
  const [tab, setTab] = useState(initialTab && ["details", "dates", "tasks", "discussion", "history", "preview"].includes(initialTab) ? initialTab : "details");
  const [form, setForm] = useState<FormState>(() => initialForm(detail));
  const [baseline, setBaseline] = useState(() => JSON.stringify(initialForm(detail)));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty = JSON.stringify(form) !== baseline;

  // When the server sends a newer version (after a save or someone else's change), adopt it
  // unless there are unsaved edits. Adjusted during render, as React recommends for derived state.
  // `formVersion` is the version the form was built from: saving against it (not against the
  // latest one received) is what lets the server detect someone else's change.
  const [seenVersion, setSeenVersion] = useState(e.version);
  const [formVersion, setFormVersion] = useState(e.version);
  const adopt = () => {
    const next = initialForm(detail);
    setForm(next);
    setBaseline(JSON.stringify(next));
    setFormVersion(e.version);
  };
  if (seenVersion !== e.version) {
    setSeenVersion(e.version);
    if (!dirty) adopt();
  }

  useEffect(() => {
    if (!dirty) return;
    const warn = (ev: BeforeUnloadEvent) => ev.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const category = categories.find((c) => c.id === form.categoryId);
  const kind = category?.kind ?? e.kind;
  const openTasks = detail.tasks.filter((t) => !t.done).length;
  const activeOptions = detail.proposals.filter((p) => p.state === "active").length;

  const save = () =>
    mutate(
      (o) =>
        updateEventAction(
          e.id,
          {
            ...form,
            speakerId: form.speakerId || null,
            date: form.date || null,
            endDate: form.endDate || null,
            scheduledPublishAt: form.scheduledPublishAt || null,
          },
          { ...o, expectedVersion: formVersion },
        ),
      {
        success: "Changes saved",
        onOk: (d) => {
          setBaseline(JSON.stringify(form));
          setFormVersion(d.version);
        },
      },
    );

  const embedPreview = useMemo(() => parseEmbed(form.embed), [form.embed]);
  const preview = useMemo(() => {
    const speaker = speakers.find((s) => s.id === form.speakerId);
    const start = form.date ? wallToInstant(`${form.date}T${form.allDay ? "00:00" : form.startTime}`) : new Date();
    const end = form.date ? wallToInstant(`${form.endDate || form.date}T${form.allDay ? "23:59" : form.endTime}`) : new Date();
    return {
      id: e.id,
      title: form.title || "Untitled",
      description: form.description,
      start: start.toISOString(),
      end: end.toISOString(),
      allDay: form.allDay,
      location: form.location,
      onlineUrl: form.onlineUrl,
      registrationUrl: form.registrationUrl,
      embedUrl: embedPreview.ok ? embedPreview.url : "",
      featured: form.featured,
      status: e.isPublic ? e.status : ("published" as EventStatus),
      category: { name: category?.name ?? e.categoryName, kind, color: form.color ?? category?.color ?? e.color, icon: category?.icon ?? "calendar" },
      speaker: speaker ? { name: speaker.name, organization: speaker.organization, position: form.speakerId === e.speakerId ? (e.speakerPosition ?? "") : "", bio: form.speakerId === e.speakerId ? (e.speakerBio ?? "") : "" } : null,
      updatedAt: e.updatedAt,
    };
  }, [form, speakers, category, kind, e, embedPreview]);

  const canPublish = me.isAdmin && !!e.start && ["confirmed", "postponed", "cancelled", "completed"].includes(e.status) && !e.archived;

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/board/events" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> Conferences
      </Link>

      <header className="mb-5 flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-ink-3">{e.categoryName}{e.speakerName ? ` · ${e.speakerName}` : ""}</p>
            <h1 className="mt-0.5 font-display text-[34px] leading-[1.1] tracking-[-0.01em]">{e.title}</h1>
          </div>
          <div className="flex items-center gap-2">
            {me.isAdmin &&
              !e.archived &&
              (e.isPublic ? (
                <Button variant="outline" loading={busy} onClick={() => mutate(() => publishEventAction(e.id, false, { expectedVersion: e.version }), { success: "Removed from the members calendar" })}>
                  <GlobeLock className="h-4 w-4" /> Unpublish
                </Button>
              ) : (
                <Button variant="primary" loading={busy} disabled={!canPublish || dirty} title={dirty ? "Save your changes first" : canPublish ? "Show this event on the members calendar" : "Confirm a date before publishing"} onClick={() => mutate(() => publishEventAction(e.id, true, { expectedVersion: e.version }), { success: "Published — members and subscribers can now see it" })}>
                  <Globe className="h-4 w-4" /> Publish
                </Button>
              ))}
            <Menu trigger={<Button variant="outline" size="icon" aria-label="More actions" className="h-9 w-9"><MoreHorizontal className="h-4 w-4" /></Button>}>
              <MenuItem icon={<Copy />} onSelect={() => mutate(() => duplicateEventAction(e.id), { success: "Duplicated", onOk: (d) => router.push(`/board/events/${d.id}`) })}>Duplicate</MenuItem>
              {me.isAdmin && (
                <MenuItem
                  icon={e.archived ? <ArchiveRestore /> : <Archive />}
                  onSelect={() =>
                    (e.archived || confirm(`Archive “${e.title}”?${e.isPublic ? " It will also be removed from the members calendar." : ""} You can restore it later from Conferences → Archived.`)) &&
                    mutate(() => archiveEventAction(e.id, !e.archived), {
                      success: e.archived ? "Restored" : "Archived",
                      undo: () => mutate(() => archiveEventAction(e.id, e.archived), { success: "Undone" }),
                    })
                  }
                >
                  {e.archived ? "Restore from archive" : "Archive"}
                </MenuItem>
              )}
              {me.isSuperAdmin && (
                <>
                  <MenuSeparator />
                  <MenuItem icon={<Trash2 />} danger onSelect={() => setConfirmDelete(true)}>Delete permanently…</MenuItem>
                </>
              )}
            </Menu>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <StatusMenu
            status={e.status}
            isPublic={e.isPublic}
            disabled={readOnly || (e.isPublic && !me.isAdmin)}
            onChange={(s) => {
              const prev = e.status;
              mutate((o) => setStatusAction(e.id, s, { ...o, expectedVersion: e.version }), {
                success: "Status updated",
                undo: () => mutate((o) => setStatusAction(e.id, prev, o), { success: "Status restored" }),
              });
            }}
          />
          <VisibilityBadge isPublic={e.isPublic} />
          <span className="text-[13px] text-ink-2">
            {e.start ? formatWallRange(e.start, e.end, e.allDay) : activeOptions ? `${activeOptions} proposed date${activeOptions > 1 ? "s" : ""}, none confirmed` : "No date yet"}
          </span>
        </div>
        {e.kind === "conference" && !["cancelled", "postponed"].includes(e.status) && <Stepper status={e.status} />}
      </header>

      <div className="mb-5 flex flex-col gap-2">
        {e.archived && <Callout tone="neutral" icon={<Archive />} title="This event is archived">Hidden from calendars and feeds. Restore it to edit.</Callout>}
        {!e.canEdit && !e.archived && <Callout tone="neutral" icon={<Lock />}>You can view this event and comment, but only its organisers and Board Admins can edit it.</Callout>}
        {e.violation && !e.overrideReason && (
          <Callout tone="danger" icon={<ShieldAlert />} title="Inside a restricted period">
            {e.violation} Move it, or ask a Super Admin for an exception.
          </Callout>
        )}
        {e.overrideReason && (
          <Callout tone="warn" icon={<ShieldCheck />} title="Scheduled inside a restricted period by Super Admin exception">
            Reason: {e.overrideReason}
          </Callout>
        )}
        {e.scheduledPublishAt && !e.isPublic && (
          <Callout tone="info" icon={<Clock />} title="Publication scheduled">
            Publishes on {formatDateTime(wallToInstant(e.scheduledPublishAt))} (Paris time).
          </Callout>
        )}
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v);
          // Keep the tab in the URL so it survives a reload and can be shared.
          window.history.replaceState(null, "", `?tab=${v}`);
        }}
        tabs={[
          { value: "details", label: "Details" },
          { value: "dates", label: "Dates", count: activeOptions },
          { value: "tasks", label: "Tasks", count: openTasks },
          { value: "discussion", label: "Discussion", count: detail.comments.length + detail.attachments.length },
          { value: "history", label: "History" },
          { value: "preview", label: "Public preview" },
        ]}
      >
        <TabPanel value="details">
          <form
            className="flex flex-col gap-8 pb-24"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (dirty && !readOnly) save();
            }}
          >
            <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
              <legend className="sr-only">Basics</legend>
              <Field label="Title" className="sm:col-span-2">
                <Input value={form.title} onChange={(ev) => set("title", ev.target.value)} maxLength={160} required />
              </Field>
              <Field label="Category">
                <Select value={form.categoryId} onChange={(ev) => set("categoryId", ev.target.value)}>
                  {categories.filter((c) => !c.archived || c.id === form.categoryId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Speaker" hint={<Link href="/board/speakers" className="underline underline-offset-2">Manage speakers</Link>}>
                <Select value={form.speakerId} onChange={(ev) => set("speakerId", ev.target.value)}>
                  <option value="">No speaker</option>
                  {speakers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.organization ? ` — ${s.organization}` : ""}</option>)}
                </Select>
              </Field>
            </fieldset>

            <Section title="Date and place" description="The confirmed date. Candidate dates go in the Dates tab.">
              <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-4">
                <Field label="Date" className="sm:col-span-2">
                  <Input
                    type="date"
                    value={form.date}
                    onChange={(ev) => {
                      const date = ev.target.value;
                      // A multi-day event keeps its length when its first day moves.
                      setForm((f) => ({ ...f, date, endDate: f.endDate && f.date && date ? addDays(date, diffDays(f.date, f.endDate)) : f.endDate }));
                    }}
                  />
                </Field>
                {!form.allDay && form.endDate && (
                  <Field label="Last day" className="sm:col-span-2" hint="Clear it for an event that ends the same day.">
                    <Input type="date" value={form.endDate} min={form.date} onChange={(ev) => set("endDate", ev.target.value)} />
                  </Field>
                )}
                {form.allDay ? (
                  <Field label="Last day" optional className="sm:col-span-2">
                    <Input type="date" value={form.endDate} min={form.date} onChange={(ev) => set("endDate", ev.target.value)} />
                  </Field>
                ) : (
                  <>
                    <Field label="From">
                      <Input type="time" value={form.startTime} onChange={(ev) => set("startTime", ev.target.value)} />
                    </Field>
                    <Field label="To">
                      <Input type="time" value={form.endTime} onChange={(ev) => set("endTime", ev.target.value)} />
                    </Field>
                  </>
                )}
                <div className="sm:col-span-4">
                  <Switch checked={form.allDay} onCheckedChange={(v) => set("allDay", v)} label="All day" disabled={readOnly} />
                </div>
                {form.date && (
                  <div className="sm:col-span-4">
                    <RestrictionHints windows={windows} kind={kind} days={[{ start: form.date, end: form.endDate || form.date }]} />
                  </div>
                )}
                <Field label="Location" className="sm:col-span-2">
                  <Input value={form.location} onChange={(ev) => set("location", ev.target.value)} placeholder="Building, room" maxLength={200} />
                </Field>
                <Field label="Online meeting link" optional className="sm:col-span-2">
                  <Input value={form.onlineUrl} onChange={(ev) => set("onlineUrl", ev.target.value)} placeholder="https://" inputMode="url" />
                </Field>
              </fieldset>
            </Section>

            <Section title="Public information" description="Shown to members once published.">
              <fieldset disabled={readOnly} className="grid gap-4">
                <Field label="Description">
                  <Textarea value={form.description} onChange={(ev) => set("description", ev.target.value)} rows={6} maxLength={8000} placeholder="What is it about, and who is it for?" />
                </Field>
                <Field label="Registration link" optional>
                  <Input value={form.registrationUrl} onChange={(ev) => set("registrationUrl", ev.target.value)} placeholder="https://" inputMode="url" />
                </Field>
                <Field
                  label="Luma registration widget"
                  optional
                  error={embedPreview.ok ? undefined : embedPreview.error}
                  hint={embedPreview.ok && embedPreview.url ? `Will embed ${embedPreview.url}` : "Paste the embed code from Luma (Event → Share → Embed). It replaces the registration button."}
                >
                  <Textarea value={form.embed} onChange={(ev) => set("embed", ev.target.value)} rows={2} className="min-h-[60px] font-mono text-xs" placeholder={'<iframe src="https://luma.com/embed/event/evt-…/simple" …></iframe>'} spellCheck={false} />
                </Field>
                {me.isAdmin && (
                  <Switch checked={form.featured} onCheckedChange={(v) => set("featured", v)} disabled={readOnly} label="Feature at the top of the members site" description="Takes the headline spot while published and upcoming." />
                )}
              </fieldset>
            </Section>

            <Section title="Board only" description="Never shown to members or in the public feed." icon={<Lock className="h-3.5 w-3.5" />}>
              <fieldset disabled={readOnly} className="grid gap-5">
                <Field label="Internal notes">
                  <Textarea value={form.internalNotes} onChange={(ev) => set("internalNotes", ev.target.value)} rows={4} maxLength={8000} placeholder="Speaker constraints, budget, who knows whom…" />
                </Field>
                <div>
                  <p className="mb-2 text-xs font-medium text-ink-2">Organisers</p>
                  <div className="flex flex-wrap gap-2">
                    {users.filter((u) => u.active || form.organizerIds.includes(u.id)).map((u) => {
                      const on = form.organizerIds.includes(u.id);
                      return (
                        <button
                          key={u.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => set("organizerIds", on ? form.organizerIds.filter((x) => x !== u.id) : [...form.organizerIds, u.id])}
                          className={cn("inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs transition-colors disabled:opacity-60", on ? "border-brand-line bg-brand-soft text-brand-ink" : "border-line text-ink-2 hover:bg-surface-2")}
                        >
                          <Avatar name={u.name} size={20} /> {u.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {layers.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-ink-2">Audience</p>
                    <p className="mb-2 text-xs text-ink-3">Only these calendars are checked. None selected = everyone.</p>
                    <div className="flex flex-wrap gap-2">
                      {layers.map((l) => {
                        const on = form.audience.includes(l.key);
                        return (
                          <button key={l.id} type="button" aria-pressed={on} onClick={() => set("audience", on ? form.audience.filter((x) => x !== l.key) : [...form.audience, l.key])} className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs", on ? "border-brand-line bg-brand-soft text-brand-ink" : "border-line text-ink-2 hover:bg-surface-2")}>
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: l.color }} /> {l.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div>
                  <p className="mb-2 text-xs font-medium text-ink-2">Colour</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <ColorField label="Event colour" value={form.color ?? category?.color ?? "#841E21"} onChange={(c) => set("color", c)} />
                    {form.color && <Button size="sm" variant="ghost" onClick={() => set("color", null)}>Use category colour</Button>}
                  </div>
                </div>
                {me.isAdmin && !e.isPublic && (
                  <Field label="Schedule publication" optional hint="Paris time. Publishes only if confirmed by then.">
                    <Input type="datetime-local" value={form.scheduledPublishAt} onChange={(ev) => set("scheduledPublishAt", ev.target.value)} className="max-w-xs" />
                  </Field>
                )}
              </fieldset>
            </Section>

            {!readOnly && (
              <div className={cn("fixed inset-x-0 bottom-14 z-20 flex justify-center px-4 transition-all duration-200 lg:bottom-5 lg:left-[224px]", dirty ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0")}>
                <div className="flex items-center gap-3 rounded-xl border border-line bg-surface py-2 pl-4 pr-2 shadow-lg">
                  <span className="text-[13px] text-ink-2">Unsaved changes</span>
                  <Button variant="ghost" size="sm" onClick={adopt}>Discard</Button>
                  <Button type="submit" variant="primary" size="sm" loading={busy}>Save changes</Button>
                </div>
              </div>
            )}
          </form>
        </TabPanel>

        <TabPanel value="dates">
          <DatesPanel detail={detail} windows={windows} readOnly={readOnly} />
        </TabPanel>
        <TabPanel value="tasks">
          <TaskList tasks={detail.tasks} users={users} eventId={e.id} canAdd={!readOnly} anchorDate={e.start?.slice(0, 10)} />
        </TabPanel>
        <TabPanel value="discussion">
          <DiscussionPanel detail={detail} readOnly={readOnly} />
        </TabPanel>
        <TabPanel value="history">
          <HistoryPanel detail={detail} />
        </TabPanel>
        <TabPanel value="preview">
          <Callout tone={e.isPublic ? "ok" : "neutral"} icon={e.isPublic ? <Globe /> : <Lock />} className="mb-5" title={e.isPublic ? "Live on the members calendar" : "Not public yet"}>
            {e.isPublic ? (
              <><Link href={`/events/${e.id}`} target="_blank" className="underline underline-offset-2">Open the public page</Link></>
            ) : (
              "Internal notes, organisers, tasks and proposed dates are never shown."
            )}
            {dirty && " Includes your unsaved changes."}
          </Callout>
          <div className="rounded-2xl border border-line bg-surface p-6 sm:p-10">
            <PublicEventView event={preview} compact />
          </div>
        </TabPanel>
      </Tabs>

      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        size="sm"
        title="Delete this event permanently?"
        description="Its tasks, comments, proposed dates and attachments are deleted too. This cannot be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" loading={busy} onClick={() => mutate(() => deleteEventAction(e.id), { success: "Event deleted", onOk: () => router.push("/board/events") })}>Delete permanently</Button>
          </>
        }
      />
      {dialog}
    </div>
  );
}

function Section({ title, description, icon, children }: { title: string; description?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-6">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">{icon}{title}</h2>
      {description && <p className="mb-4 mt-0.5 text-xs text-ink-3">{description}</p>}
      {children}
    </section>
  );
}
