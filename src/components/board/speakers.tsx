"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Archive, ArchiveRestore, CalendarPlus, Lock, Mail, Mic2, Phone, Plus, Search } from "lucide-react";
import { archiveSpeakerAction, saveSpeakerAction, type SpeakerInput } from "@/app/actions/speakers";
import { Avatar, Badge, Button, Dialog, EmptyState, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { CONTACT_STATUSES, type EventStatus } from "@/db/schema";
import type { BoardCategory, BoardUser, BoardWindow, CalendarData } from "@/lib/board-types";
import { formatIsoDay } from "@/lib/time";
import { useBoard, useMutate } from "./context";
import { NewEventDialog } from "./new-event-dialog";
import { StatusBadge } from "./status";

type ContactStatus = (typeof CONTACT_STATUSES)[number];
export const CONTACT_META: Record<ContactStatus, { label: string; tone: "neutral" | "info" | "warn" | "ok" | "danger" | "brand" }> = {
  prospect: { label: "Prospect", tone: "neutral" },
  to_contact: { label: "To contact", tone: "info" },
  contacted: { label: "Contacted", tone: "warn" },
  in_discussion: { label: "In discussion", tone: "warn" },
  accepted: { label: "Accepted", tone: "ok" },
  declined: { label: "Declined", tone: "danger" },
  past_speaker: { label: "Past speaker", tone: "brand" },
};

export type SpeakerRow = Required<Omit<SpeakerInput, "contactStatus" | "ownerId" | "lastContactedAt">> & {
  id: string;
  contactStatus: ContactStatus;
  ownerId: string | null;
  lastContactedAt: string | null;
  archived: boolean;
  events: { id: string; title: string; start: string | null; status: EventStatus }[];
};

const blank = (ownerId: string): SpeakerInput => ({ name: "", organization: "", position: "", bio: "", email: "", phone: "", linkedin: "", contactStatus: "prospect", ownerId, notes: "", lastContactedAt: null });

export function SpeakerDirectory({
  speakers,
  users,
  categories,
  windows,
  templates,
  today,
}: {
  speakers: SpeakerRow[];
  users: BoardUser[];
  categories: BoardCategory[];
  windows: BoardWindow[];
  templates: CalendarData["templates"];
  today: string;
}) {
  const { me } = useBoard();
  const { mutate, busy } = useMutate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null; form: SpeakerInput } | null>(null);
  const [planFor, setPlanFor] = useState<string | null>(null);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return speakers.filter((s) => s.archived === showArchived && (!status || s.contactStatus === status) && (!needle || `${s.name} ${s.organization} ${s.position}`.toLowerCase().includes(needle)));
  }, [speakers, q, status, showArchived]);

  const current = editing?.id ? speakers.find((s) => s.id === editing.id) : null;
  const canEdit = !current || me.isAdmin || current.ownerId === me.id;
  const set = <K extends keyof SpeakerInput>(k: K, v: SpeakerInput[K]) => setEditing((e) => (e ? { ...e, form: { ...e.form, [k]: v } } : e));

  return (
    <div>
      <PageHeader
        title="Speakers"
        description="Prospective and past speakers. Contact details and notes stay inside the board; only the name, role, organisation and biography appear on published events."
        actions={<Button variant="primary" onClick={() => setEditing({ id: null, form: blank(me.id) })}><Plus className="h-4 w-4" /> Add speaker</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or organisation" aria-label="Search speakers" className="pl-8" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Contact status" className="w-[170px]">
          <option value="">Any contact status</option>
          {CONTACT_STATUSES.map((s) => <option key={s} value={s}>{CONTACT_META[s].label}</option>)}
        </Select>
        <Button variant={showArchived ? "secondary" : "ghost"} size="sm" onClick={() => setShowArchived((v) => !v)}><Archive className="h-3.5 w-3.5" /> {showArchived ? "Showing archived" : "Archived"}</Button>
      </div>

      {list.length === 0 ? (
        <EmptyState icon={<Mic2 className="h-5 w-5" />} title={speakers.length ? "No speaker matches" : "No speakers yet"} action={!speakers.length && <Button variant="outline" onClick={() => setEditing({ id: null, form: blank(me.id) })}>Add the first speaker</Button>}>
          {speakers.length ? "Try another search or status." : "Track people you would like to invite — even before there is an event."}
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((s) => {
            const owner = users.find((u) => u.id === s.ownerId);
            const upcoming = s.events.filter((e) => !e.start || e.start.slice(0, 10) >= today).length;
            return (
              <li key={s.id}>
                <button onClick={() => setEditing({ id: s.id, form: { ...s } })} className="flex h-full w-full flex-col rounded-xl border border-line bg-surface p-4 text-left shadow-sm transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-md">
                  <div className="flex items-start gap-3">
                    <Avatar name={s.name} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{s.name}</p>
                      <p className="truncate text-xs text-ink-3">{[s.position, s.organization].filter(Boolean).join(" · ") || "No organisation yet"}</p>
                    </div>
                    <Badge tone={CONTACT_META[s.contactStatus].tone}>{CONTACT_META[s.contactStatus].label}</Badge>
                  </div>
                  <div className="mt-4 flex items-center justify-between text-xs text-ink-3">
                    <span>{s.events.length ? `${s.events.length} conference${s.events.length > 1 ? "s" : ""}${upcoming ? ` · ${upcoming} upcoming` : ""}` : "No conference yet"}</span>
                    {owner ? <span className="inline-flex items-center gap-1.5"><Avatar name={owner.name} size={18} />{owner.name.split(" ")[0]}</span> : <span>Unassigned</span>}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <Dialog
          open
          onOpenChange={(o) => !o && setEditing(null)}
          side="right"
          title={editing.id ? editing.form.name || "Speaker" : "Add speaker"}
          description={editing.id ? undefined : "You can add someone as a prospect without creating any event."}
          footer={
            <div className="flex w-full flex-wrap items-center gap-2">
              {current && me.isAdmin && (
                <Button variant="ghost" size="icon" title={current.archived ? "Restore" : "Archive"} aria-label={current.archived ? "Restore" : "Archive"} onClick={() => (current.archived || confirm(`Archive ${current.name}? They will no longer be offered when creating events. You can restore them from the Archived filter.`)) && mutate(() => archiveSpeakerAction(current.id, !current.archived), { success: current.archived ? "Speaker restored" : "Speaker archived", onOk: () => setEditing(null) })}>
                  {current.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                </Button>
              )}
              {current && <Button variant="outline" onClick={() => setPlanFor(current.id)}><CalendarPlus className="h-4 w-4" /> Plan a conference</Button>}
              <span className="flex-1" />
              <Button variant="ghost" onClick={() => setEditing(null)}>Close</Button>
              {canEdit && (
                <Button variant="primary" loading={busy} disabled={!editing.form.name?.trim()} onClick={() => mutate(() => saveSpeakerAction(editing.id, editing.form), { success: editing.id ? "Speaker saved" : "Speaker added", onOk: () => setEditing(null) })}>
                  Save
                </Button>
              )}
            </div>
          }
        >
          <fieldset disabled={!canEdit} className="flex flex-col gap-4">
            <Field label="Name"><Input value={editing.form.name} onChange={(e) => set("name", e.target.value)} autoFocus={!editing.id} maxLength={120} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Organisation"><Input value={editing.form.organization ?? ""} onChange={(e) => set("organization", e.target.value)} maxLength={120} /></Field>
              <Field label="Position"><Input value={editing.form.position ?? ""} onChange={(e) => set("position", e.target.value)} maxLength={120} /></Field>
            </div>
            <Field label="Biography" hint="Public once an event with this speaker is published.">
              <Textarea value={editing.form.bio ?? ""} onChange={(e) => set("bio", e.target.value)} rows={4} maxLength={4000} />
            </Field>

            <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface-2/50 p-3.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-2"><Lock className="h-3.5 w-3.5" /> Private — board only</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Contact status">
                  <Select value={editing.form.contactStatus ?? "prospect"} onChange={(e) => set("contactStatus", e.target.value as ContactStatus)}>
                    {CONTACT_STATUSES.map((s) => <option key={s} value={s}>{CONTACT_META[s].label}</option>)}
                  </Select>
                </Field>
                <Field label="Assigned to">
                  <Select value={editing.form.ownerId ?? ""} onChange={(e) => set("ownerId", e.target.value || null)} disabled={!me.isAdmin}>
                    <option value="">Unassigned</option>
                    {users.filter((u) => u.active || u.id === editing.form.ownerId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </Select>
                </Field>
                <Field label="Email"><Input type="email" value={editing.form.email ?? ""} onChange={(e) => set("email", e.target.value)} /></Field>
                <Field label="Phone"><Input type="tel" value={editing.form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} /></Field>
                <Field label="LinkedIn" className="col-span-2"><Input value={editing.form.linkedin ?? ""} onChange={(e) => set("linkedin", e.target.value)} placeholder="https://linkedin.com/in/…" /></Field>
                <Field label="Last contacted" className="col-span-2"><Input type="date" value={editing.form.lastContactedAt ?? ""} onChange={(e) => set("lastContactedAt", e.target.value || null)} className="max-w-[180px]" /></Field>
              </div>
              {current && (current.email || current.phone) && (
                <div className="flex flex-wrap gap-2">
                  {current.email && <a href={`mailto:${current.email}`} className="inline-flex items-center gap-1.5 rounded-lg bg-surface px-2.5 py-1 text-xs ring-1 ring-line hover:bg-surface-3"><Mail className="h-3 w-3" /> Write an email</a>}
                  {current.phone && <a href={`tel:${current.phone}`} className="inline-flex items-center gap-1.5 rounded-lg bg-surface px-2.5 py-1 text-xs ring-1 ring-line hover:bg-surface-3"><Phone className="h-3 w-3" /> Call</a>}
                </div>
              )}
              <Field label="Internal notes"><Textarea value={editing.form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} rows={3} maxLength={8000} placeholder="How we know them, preferences, who introduced them…" /></Field>
            </div>
          </fieldset>

          {current && (
            <div className="mt-5">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Conferences</p>
              {current.events.length === 0 ? (
                <p className="text-xs text-ink-3">No conference with this speaker yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
                  {current.events.map((e) => (
                    <li key={e.id}>
                      <Link href={`/board/events/${e.id}`} className="flex items-center gap-2 px-3 py-2 text-[13px] hover:bg-surface-2">
                        <span className="min-w-0 flex-1 truncate">{e.title}</span>
                        <span className="text-xs text-ink-3">{e.start ? formatIsoDay(e.start.slice(0, 10), true) : "no date"}</span>
                        <StatusBadge status={e.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Dialog>
      )}

      <NewEventDialog open={!!planFor} onOpenChange={(o) => !o && setPlanFor(null)} categories={categories} speakers={speakers.map((s) => ({ id: s.id, name: s.name, organization: s.organization }))} windows={windows} templates={templates} initial={{ speakerId: planFor ?? undefined }} />
    </div>
  );
}
