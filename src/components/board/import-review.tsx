"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, Check, CircleAlert, FileText, RotateCcw, ShieldCheck, X } from "lucide-react";
import { editCandidateAction, reviewCandidatesAction } from "@/app/actions/academic";
import { Badge, Button, Callout, EmptyState, Segmented, Select } from "@/components/ui";
import { ACADEMIC_KINDS, type AcademicKind } from "@/db/schema";
import { ACADEMIC_KIND_META } from "@/lib/board-types";
import { cn } from "@/lib/cn";
import { diffDays, formatDateTime, formatIsoDay } from "@/lib/time";
import { useMutate } from "./context";

type Candidate = {
  id: string;
  layerKey: string;
  layerName: string;
  label: string;
  kind: AcademicKind;
  start: string;
  end: string;
  confidence: number;
  issues: string[];
  status: "pending" | "approved" | "rejected";
  edited: boolean;
  sourceText: string;
  sourcePage: number | null;
  sourceBox: [number, number, number, number] | null;
};

const HIGH = 85;
type View = "pending" | "attention" | "approved" | "rejected" | "all";

export function ImportReview({
  imp,
  candidates,
  existingLayers,
}: {
  imp: { id: string; filename: string; title: string; versionLabel: string; format: string; warnings: string[]; sha256: string; createdAt: string };
  candidates: Candidate[];
  existingLayers: { key: string; name: string }[];
}) {
  const { mutate, busy } = useMutate();
  const [view, setView] = useState<View>("pending");
  const [layer, setLayer] = useState("");
  const [kind, setKind] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const layers = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of existingLayers) m.set(l.key, l.name);
    for (const c of candidates) if (!m.has(c.layerKey)) m.set(c.layerKey, c.layerName);
    return [...m.entries()].map(([key, name]) => ({ key, name }));
  }, [candidates, existingLayers]);

  const counts = {
    pending: candidates.filter((c) => c.status === "pending").length,
    attention: candidates.filter((c) => c.status === "pending" && c.confidence < HIGH).length,
    approved: candidates.filter((c) => c.status === "approved").length,
    rejected: candidates.filter((c) => c.status === "rejected").length,
  };

  const rows = candidates.filter((c) => {
    if (layer && c.layerKey !== layer) return false;
    if (kind && c.kind !== kind) return false;
    if (view === "pending") return c.status === "pending";
    if (view === "attention") return c.status === "pending" && c.confidence < HIGH;
    if (view === "approved") return c.status === "approved";
    if (view === "rejected") return c.status === "rejected";
    return true;
  });
  const selectable = rows.filter((r) => r.status !== "approved");
  const chosen = selectable.filter((r) => selected.has(r.id)).map((r) => r.id);
  const allChosen = selectable.length > 0 && chosen.length === selectable.length;

  const decide = (ids: string[], decision: "approve" | "reject" | "reset", msg: string) =>
    mutate(() => reviewCandidatesAction(ids, decision), { success: msg, onOk: () => setSelected(new Set()) });
  const edit = (id: string, patch: Parameters<typeof editCandidateAction>[1]) => mutate(() => editCandidateAction(id, patch));

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/board/academic" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> Academic calendars
      </Link>
      <header className="mb-5">
        <h1 className="font-display text-[32px] leading-[1.1]">Review imported dates</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-3">
          <FileText className="h-3.5 w-3.5" />
          <span className="font-medium text-ink">{imp.filename}</span>
          {imp.title && <span>· {imp.title}</span>}
          {imp.versionLabel && <Badge>{imp.versionLabel}</Badge>}
          <span>· imported {formatDateTime(new Date(imp.createdAt))}</span>
          <span className="font-mono text-[11px]" title={`SHA-256 ${imp.sha256}`}>· {imp.sha256.slice(0, 10)}</span>
        </p>
      </header>

      <div className="mb-5 flex flex-col gap-2">
        <Callout tone="info" icon={<ShieldCheck />} title="Compare with the original document before approving">
          Dates were read automatically and may be wrong. Only approved rows are used. Edits save immediately.
        </Callout>
        {imp.warnings.map((w, i) => (
          <Callout key={i} tone="warn" icon={<CircleAlert />}>{w}</Callout>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented<View>
          label="Rows"
          value={view}
          onChange={(v) => (setView(v), setSelected(new Set()))}
          options={[
            { value: "pending", label: `To review ${counts.pending}` },
            { value: "attention", label: `Needs attention ${counts.attention}`, title: `Confidence below ${HIGH}%` },
            { value: "approved", label: `Approved ${counts.approved}` },
            { value: "rejected", label: `Rejected ${counts.rejected}` },
            { value: "all", label: "All" },
          ]}
        />
        <Select value={layer} onChange={(e) => setLayer(e.target.value)} aria-label="Layer" className="h-8 w-[160px]">
          <option value="">All layers</option>
          {layers.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
        </Select>
        <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind" className="h-8 w-[160px]">
          <option value="">All kinds</option>
          {ACADEMIC_KINDS.map((k) => <option key={k} value={k}>{ACADEMIC_KIND_META[k].label}</option>)}
        </Select>
      </div>

      {/* Bulk bar */}
      <div className="sticky top-12 z-10 mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface/95 px-3 py-2 shadow-sm backdrop-blur lg:top-2">
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={allChosen} onChange={() => setSelected(allChosen ? new Set() : new Set(selectable.map((r) => r.id)))} className="h-4 w-4 accent-[var(--brand)]" aria-label="Select all shown" />
          {chosen.length ? `${chosen.length} selected` : `${rows.length} row${rows.length === 1 ? "" : "s"}`}
        </label>
        <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(selectable.filter((r) => r.confidence >= HIGH).map((r) => r.id)))}>Select high-confidence ({selectable.filter((r) => r.confidence >= HIGH).length})</Button>
        <span className="flex-1" />
        <Button size="sm" variant="outline" disabled={!chosen.length} loading={busy} onClick={() => decide(chosen, "reject", "Rows rejected")}><X className="h-3.5 w-3.5" /> Reject</Button>
        <Button size="sm" variant="primary" disabled={!chosen.length} loading={busy} onClick={() => decide(chosen, "approve", `Approved ${chosen.length} period${chosen.length > 1 ? "s" : ""}`)}><Check className="h-3.5 w-3.5" /> Approve selected</Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<Check className="h-5 w-5" />} title={view === "pending" ? "Everything has been reviewed" : "No rows here"} />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((c) => {
            const locked = c.status === "approved";
            const days = diffDays(c.start, c.end) + 1;
            return (
              <li key={c.id} className={cn("cv-auto rounded-xl border bg-surface px-3 py-2.5", c.status === "approved" ? "border-ok/30" : c.status === "rejected" ? "border-line opacity-60" : c.confidence < HIGH ? "border-warn/40" : "border-line")}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <input type="checkbox" disabled={locked} checked={selected.has(c.id)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} className="h-4 w-4 accent-[var(--brand)]" aria-label={`Select ${c.label}`} />
                  <input
                    key={`l${c.label}`}
                    defaultValue={c.label}
                    disabled={locked}
                    aria-label="Label"
                    onBlur={(e) => e.target.value.trim() && e.target.value !== c.label && edit(c.id, { label: e.target.value })}
                    className="h-8 min-w-[140px] flex-1 rounded-md border border-transparent bg-transparent px-2 text-[13px] font-medium hover:border-line focus:border-brand-ink focus:outline-none disabled:hover:border-transparent"
                  />
                  <Select value={c.layerKey} disabled={locked} aria-label="Layer" onChange={(e) => edit(c.id, { layerKey: e.target.value, layerName: layers.find((l) => l.key === e.target.value)?.name ?? e.target.value })} className="h-8 w-[136px] text-xs">
                    {layers.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
                  </Select>
                  <Select value={c.kind} disabled={locked} aria-label="Kind" onChange={(e) => edit(c.id, { kind: e.target.value })} className="h-8 w-[136px] text-xs">
                    {ACADEMIC_KINDS.map((k) => <option key={k} value={k}>{ACADEMIC_KIND_META[k].label}</option>)}
                  </Select>
                  <span className="flex items-center gap-1">
                    <input key={`s${c.start}`} type="date" defaultValue={c.start} disabled={locked} aria-label="First day" onBlur={(e) => e.target.value && e.target.value !== c.start && edit(c.id, { startDate: e.target.value, ...(e.target.value > c.end ? { endDate: e.target.value } : {}) })} className="h-8 rounded-md border border-line-strong bg-surface px-2 text-xs tabular disabled:bg-surface-2" />
                    <span className="text-ink-3">→</span>
                    <input key={`e${c.end}`} type="date" defaultValue={c.end} min={c.start} disabled={locked} aria-label="Last day" onBlur={(e) => e.target.value && e.target.value !== c.end && edit(c.id, { endDate: e.target.value })} className="h-8 rounded-md border border-line-strong bg-surface px-2 text-xs tabular disabled:bg-surface-2" />
                  </span>
                  <span className="w-[92px] text-xs text-ink-3">{formatIsoDay(c.start).split(" ")[0]}–{formatIsoDay(c.end).split(" ")[0]} · {days}d</span>
                  <Badge tone={c.confidence >= HIGH ? "ok" : c.confidence >= 60 ? "warn" : "danger"} className="tabular">{c.confidence}%</Badge>
                  <span className="ml-auto flex items-center gap-1">
                    {c.status === "pending" && (
                      <>
                        <Button size="icon" variant="ghost" aria-label={`Reject ${c.label}`} title="Reject" onClick={() => decide([c.id], "reject", "Row rejected")}><X className="h-4 w-4" /></Button>
                        <Button size="sm" variant="outline" onClick={() => decide([c.id], "approve", "Period approved")}><Check className="h-3.5 w-3.5" /> Approve</Button>
                      </>
                    )}
                    {c.status === "approved" && (
                      <>
                        <Badge tone="ok"><ShieldCheck className="h-3 w-3" /> Approved</Badge>
                        <Button size="icon" variant="ghost" aria-label="Withdraw approval" title="Withdraw approval (removes the period from the calendar)" onClick={() => decide([c.id], "reset", "Approval withdrawn")}><RotateCcw className="h-3.5 w-3.5" /></Button>
                      </>
                    )}
                    {c.status === "rejected" && <Button size="sm" variant="ghost" onClick={() => decide([c.id], "approve", "Period approved")}>Approve anyway</Button>}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 pl-7 text-xs text-ink-3">
                  <span title={c.sourceBox ? `PDF box ${c.sourceBox.map((n) => Math.round(n)).join(", ")}` : undefined}>
                    Source{c.sourcePage ? ` p. ${c.sourcePage}` : ""}: <span className="font-mono text-[11px] text-ink-2">“{c.sourceText || c.label}”</span>
                  </span>
                  {c.edited && <span className="text-info">Edited by a reviewer</span>}
                  {c.issues.map((issue, i) => (
                    <span key={i} className="flex items-center gap-1 text-warn"><CircleAlert className="h-3 w-3" /> {issue}</span>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
