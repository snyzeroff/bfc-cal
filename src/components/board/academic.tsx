"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowRight, FileUp, GraduationCap, Pencil, Plus, ShieldCheck, Trash2, Upload } from "lucide-react";
import { deleteEntryAction, deleteImportAction, deleteLayerAction, importCalendarAction, saveEntryAction, saveLayerAction } from "@/app/actions/academic";
import { Badge, Button, Callout, ColorField, Dialog, EmptyState, Field, Input, PageHeader, SectionTitle, Select, Switch } from "@/components/ui";
import { ACADEMIC_KINDS, type AcademicKind } from "@/db/schema";
import { ACADEMIC_KIND_META, type BoardLayer } from "@/lib/board-types";
import { cn } from "@/lib/cn";
import { formatDateTime, formatIsoRange } from "@/lib/time";
import { useBoard, useMutate } from "./context";

type Entry = { id: string; layerId: string; label: string; kind: AcademicKind; start: string; end: string; verifiedBy: string | null; source: string };
type ImportRow = { id: string; filename: string; title: string; versionLabel: string; format: string; createdAt: string; uploader: string | null; pending: number; approved: number; total: number };

export function AcademicManager({ layers, entries, imports }: { layers: BoardLayer[]; entries: Entry[]; imports: ImportRow[] }) {
  const { me } = useBoard();
  const router = useRouter();
  const { mutate, busy } = useMutate();
  const [layerId, setLayerId] = useState(layers[0]?.id ?? "");
  const [kind, setKind] = useState("");
  const [importing, setImporting] = useState(false);
  const [layerForm, setLayerForm] = useState<{ id: string | null; name: string; color: string; visibleByDefault: boolean } | null>(null);
  const [entryForm, setEntryForm] = useState<{ id: string | null; layerId: string; label: string; kind: AcademicKind; startDate: string; endDate: string } | null>(null);
  const [uploading, startUpload] = useTransition();
  const [layerName, setLayerName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const layer = layers.find((l) => l.id === layerId) ?? layers[0];
  const shown = useMemo(() => entries.filter((e) => e.layerId === layer?.id && (!kind || e.kind === kind)), [entries, layer, kind]);
  const pendingImports = imports.filter((i) => i.pending > 0);
  const count = (id: string) => entries.filter((e) => e.layerId === id).length;

  const upload = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return void toast.error("Choose a file first.");
    const fd = new FormData();
    fd.set("file", file);
    fd.set("layerName", layerName);
    startUpload(async () => {
      const res = await importCalendarAction(fd);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${res.data.count} periods extracted. Review them before use.`);
      setImporting(false);
      router.push(`/board/academic/imports/${res.data.id}`);
    });
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Academic calendars"
        description="Only approved periods are used."
        actions={
          me.isAdmin && (
            <>
              <Button variant="outline" onClick={() => setLayerForm({ id: null, name: "", color: "#2F6FB5", visibleByDefault: true })}><Plus className="h-4 w-4" /> New layer</Button>
              <Button variant="primary" onClick={() => setImporting(true)}><Upload className="h-4 w-4" /> Import calendar</Button>
            </>
          )
        }
      />

      {me.isAdmin && pendingImports.length > 0 && (
        <div className="mb-6 flex flex-col gap-2">
          {pendingImports.map((i) => (
            <Callout key={i.id} tone="warn" icon={<FileUp />} title={`${i.pending} period${i.pending > 1 ? "s" : ""} from “${i.filename}” await review`} action={<Link href={`/board/academic/imports/${i.id}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-ink underline-offset-2 hover:underline">Review <ArrowRight className="h-3.5 w-3.5" /></Link>}>
              Nothing is used until approved.
            </Callout>
          ))}
        </div>
      )}

      {layers.length === 0 ? (
        <EmptyState icon={<GraduationCap className="h-5 w-5" />} title="No academic calendar yet" action={me.isAdmin && <Button variant="primary" onClick={() => setImporting(true)}><Upload className="h-4 w-4" /> Import a calendar</Button>} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
          <section>
            <SectionTitle>Layers</SectionTitle>
            <ul className="flex flex-col gap-1.5">
              {layers.map((l) => (
                <li key={l.id} className={cn("group flex items-center gap-2.5 rounded-lg border px-3 py-2.5 transition-colors", l.id === layer?.id ? "border-line-strong bg-surface shadow-sm" : "border-transparent hover:bg-surface-2")}>
                  <button onClick={() => setLayerId(l.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: l.color }} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">{l.name}</span>
                      <span className="block text-xs text-ink-3">{count(l.id)} period{count(l.id) === 1 ? "" : "s"}{l.visibleByDefault ? "" : " · hidden by default"}</span>
                    </span>
                  </button>
                  {me.isAdmin && (
                    <button aria-label={`Edit layer ${l.name}`} onClick={() => setLayerForm({ id: l.id, name: l.name, color: l.color, visibleByDefault: l.visibleByDefault })} className="grid h-7 w-7 place-items-center rounded-md text-ink-3 opacity-0 hover:bg-surface-3 hover:text-ink focus:opacity-100 group-hover:opacity-100 max-lg:opacity-100">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="min-w-0">
            <SectionTitle
              action={
                <div className="flex items-center gap-2">
                  <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind" className="h-8 w-[170px]">
                    <option value="">All kinds</option>
                    {ACADEMIC_KINDS.map((k) => <option key={k} value={k}>{ACADEMIC_KIND_META[k].label}</option>)}
                  </Select>
                  {me.isAdmin && layer && <Button size="sm" variant="outline" className="h-8" onClick={() => setEntryForm({ id: null, layerId: layer.id, label: "", kind: "exam", startDate: "", endDate: "" })}><Plus className="h-3.5 w-3.5" /> Add period</Button>}
                </div>
              }
            >
              {layer?.name}
            </SectionTitle>
            {shown.length === 0 ? (
              <EmptyState title="No verified periods" />
            ) : (
              <div className="overflow-hidden rounded-xl border border-line bg-surface">
                <ul className="divide-y divide-line">
                  {shown.map((e) => (
                    <li key={e.id} className="group flex items-center gap-3 px-3.5 py-2.5">
                      <span className="h-8 w-[3px] shrink-0 rounded-full" style={{ background: ACADEMIC_KIND_META[e.kind].color }} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium">{e.label}</p>
                        <p className="truncate text-xs text-ink-3">
                          {formatIsoRange(e.start, e.end)}
                          {e.source && <span title={e.source}> · source: {e.source}</span>}
                        </p>
                      </div>
                      <Badge color={ACADEMIC_KIND_META[e.kind].color} className="hidden sm:inline-flex">{ACADEMIC_KIND_META[e.kind].label}</Badge>
                      <span className="hidden items-center gap-1 text-xs text-ok md:inline-flex" title={e.verifiedBy ? `Verified by ${e.verifiedBy}` : "Verified"}><ShieldCheck className="h-3.5 w-3.5" /> Verified</span>
                      {me.isAdmin && (
                        <span className="flex opacity-0 focus-within:opacity-100 group-hover:opacity-100 max-lg:opacity-100">
                          <button aria-label={`Edit ${e.label}`} onClick={() => setEntryForm({ id: e.id, layerId: e.layerId, label: e.label, kind: e.kind, startDate: e.start, endDate: e.end })} className="grid h-7 w-7 place-items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink"><Pencil className="h-3.5 w-3.5" /></button>
                          <button aria-label={`Delete ${e.label}`} onClick={() => confirm(`Delete “${e.label}” from this calendar?`) && mutate(() => deleteEntryAction(e.id), { success: "Period deleted" })} className="grid h-7 w-7 place-items-center rounded-md text-ink-3 hover:bg-danger-soft hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      )}

      {imports.length > 0 && (
        <section className="mt-10">
          <SectionTitle>Imported documents</SectionTitle>
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            <ul className="divide-y divide-line">
              {imports.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3.5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{i.filename}</p>
                    <p className="truncate text-xs text-ink-3">{[i.title, i.versionLabel].filter(Boolean).join(" · ")}{i.title || i.versionLabel ? " · " : ""}imported {formatDateTime(new Date(i.createdAt))}{i.uploader ? ` by ${i.uploader}` : ""}</p>
                  </div>
                  <span className="text-xs tabular text-ink-3">{i.approved}/{i.total} approved</span>
                  {i.pending > 0 && <Badge tone="warn">{i.pending} to review</Badge>}
                  {me.isAdmin && (
                    <>
                      <Link href={`/board/academic/imports/${i.id}`} className="text-[13px] font-medium text-brand-ink underline-offset-2 hover:underline">{i.pending ? "Review" : "Open"}</Link>
                      <button aria-label={`Delete import ${i.filename}`} title="Delete this import (approved periods are kept)" onClick={() => confirm(`Delete the import “${i.filename}”? Periods already approved are kept; rows still to review are discarded.`) && mutate(() => deleteImportAction(i.id, false), { success: "Import deleted — approved periods were kept" })} className="grid h-7 w-7 place-items-center rounded-md text-ink-3 hover:bg-danger-soft hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Import dialog */}
      <Dialog
        open={importing}
        onOpenChange={setImporting}
        title="Import an academic calendar"
        description="Nothing is added to the calendar until approved."
        footer={
          <>
            <Button variant="ghost" onClick={() => setImporting(false)}>Cancel</Button>
            <Button variant="primary" loading={uploading} onClick={upload}>{uploading ? "Reading the document…" : "Extract dates"}</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="File" hint="PDF, .ics or .csv. 8 MB max.">
            <input ref={fileRef} type="file" accept=".pdf,.ics,.csv,application/pdf,text/calendar,text/csv" className="block w-full rounded-lg border border-dashed border-line-strong bg-surface-2/50 p-3 text-[13px] file:mr-3 file:rounded-md file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-[13px] file:font-medium file:text-ink file:shadow-sm" />
          </Field>
          <Field label="Layer name" optional hint="For .ics and .csv only. PDFs create one layer per program and year.">
            <Input value={layerName} onChange={(e) => setLayerName(e.target.value)} placeholder="e.g. School-wide events" maxLength={80} />
          </Field>
          <Callout tone="info">
            PDF extraction can shift a date. Check each period against the document before approving.
          </Callout>
        </div>
      </Dialog>

      {/* Layer dialog */}
      {layerForm && (
        <Dialog
          open
          onOpenChange={(o) => !o && setLayerForm(null)}
          size="sm"
          title={layerForm.id ? "Edit layer" : "New layer"}
          footer={
            <>
              {layerForm.id && <Button variant="danger" className="mr-auto" onClick={() => confirm("Delete this layer and all its periods?") && mutate(() => deleteLayerAction(layerForm.id!), { success: "Layer deleted", onOk: () => setLayerForm(null) })}>Delete</Button>}
              <Button variant="ghost" onClick={() => setLayerForm(null)}>Cancel</Button>
              <Button variant="primary" loading={busy} disabled={!layerForm.name.trim()} onClick={() => mutate(() => saveLayerAction(layerForm.id, layerForm), { success: "Layer saved", onOk: () => setLayerForm(null) })}>Save</Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <Field label="Name"><Input value={layerForm.name} onChange={(e) => setLayerForm({ ...layerForm, name: e.target.value })} autoFocus maxLength={80} /></Field>
            <div><p className="mb-2 text-xs font-medium text-ink-2">Colour</p><ColorField label="Layer colour" value={layerForm.color} onChange={(c) => setLayerForm({ ...layerForm, color: c })} /></div>
            <Switch checked={layerForm.visibleByDefault} onCheckedChange={(v) => setLayerForm({ ...layerForm, visibleByDefault: v })} label="Shown by default" description="Each member can still toggle it." />
          </div>
        </Dialog>
      )}

      {/* Entry dialog */}
      {entryForm && (
        <Dialog
          open
          onOpenChange={(o) => !o && setEntryForm(null)}
          size="sm"
          title={entryForm.id ? "Edit period" : "Add period"}
          description="Saving records you as the verifier."
          footer={
            <>
              <Button variant="ghost" onClick={() => setEntryForm(null)}>Cancel</Button>
              <Button variant="primary" loading={busy} disabled={!entryForm.label.trim() || !entryForm.startDate} onClick={() => mutate(() => saveEntryAction(entryForm.id, { ...entryForm, endDate: entryForm.endDate || entryForm.startDate }), { success: "Period saved", onOk: () => setEntryForm(null) })}>Save</Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <Field label="Label"><Input value={entryForm.label} onChange={(e) => setEntryForm({ ...entryForm, label: e.target.value })} autoFocus placeholder="e.g. Midterms" maxLength={200} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Layer">
                <Select value={entryForm.layerId} onChange={(e) => setEntryForm({ ...entryForm, layerId: e.target.value })}>{layers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
              </Field>
              <Field label="Kind">
                <Select value={entryForm.kind} onChange={(e) => setEntryForm({ ...entryForm, kind: e.target.value as AcademicKind })}>{ACADEMIC_KINDS.map((k) => <option key={k} value={k}>{ACADEMIC_KIND_META[k].label}</option>)}</Select>
              </Field>
              <Field label="First day"><Input type="date" value={entryForm.startDate} onChange={(e) => setEntryForm({ ...entryForm, startDate: e.target.value })} /></Field>
              <Field label="Last day"><Input type="date" value={entryForm.endDate} min={entryForm.startDate} onChange={(e) => setEntryForm({ ...entryForm, endDate: e.target.value })} /></Field>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
