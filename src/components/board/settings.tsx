"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { KeyRound, Pencil, Plus, ShieldAlert, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { archiveCategoryAction, deleteRuleAction, inviteUserAction, resetLinkAction, saveAppearanceAction, saveCategoryAction, saveFeedSettingsAction, saveExamRuleAction, saveRuleAction, toggleRuleAction, updateUserAction, type RuleInput } from "@/app/actions/settings";
import { CATEGORY_ICONS, CategoryIcon } from "@/components/category-icon";
import { CopyField } from "@/components/subscribe";
import { Avatar, Badge, Button, Callout, Card, ColorField, Dialog, Field, Input, PageHeader, Segmented, Select, Switch, TabPanel, Tabs } from "@/components/ui";
import { ACADEMIC_KINDS, CATEGORY_KINDS, EVENT_STATUSES, type AcademicKind, type CategoryKind, type Role } from "@/db/schema";
import { STATUS_META, type Appearance } from "@/lib/appearance";
import { ACADEMIC_KIND_META, type BoardCategory } from "@/lib/board-types";
import { cn } from "@/lib/cn";
import { ROLE_DESCRIPTION, ROLE_LABEL } from "@/lib/permissions";
import { formatDateTime, formatIsoRange } from "@/lib/time";
import { useBoard, useMutate } from "./context";

type Rule = { id: string; name: string; type: "victoriales" | "date_range" | "academic_kind"; severity: "hard" | "soft"; appliesTo: string[]; params: { startDate?: string; endDate?: string; kinds?: string[]; layerKeys?: string[]; daysBefore?: number }; message: string; active: boolean; builtin: boolean };
type UserRow = { id: string; name: string; email: string; role: Role; active: boolean; hasPassword: boolean; lastLoginAt: string | null };
type AuditRow = { id: string; actorName: string; action: string; entityType: string; entityId: string | null; summary: string; reason: string | null; at: string };
type Affected = { id: string; title: string; overridden: boolean };

const KIND_LABEL: Record<CategoryKind, string> = { conference: "Conferences", meeting: "Internal meetings", deadline: "Deadlines", social: "Social events", other: "Other" };

export function SettingsPanel(props: {
  initialTab?: string;
  appearance: Appearance;
  feed: { cancelledRetentionDays: number; refreshMinutes: number };
  rules: Rule[];
  categories: BoardCategory[];
  users: UserRow[];
  audit: AuditRow[];
  layers: { key: string; name: string }[];
  affected: Affected[];
}) {
  const [tab, setTab] = useState(props.initialTab && ["rules", "appearance", "categories", "users", "feeds", "audit"].includes(props.initialTab) ? props.initialTab : "rules");
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Settings" description="Super Admin area. Every change here is recorded in the audit log." />
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v);
          // Keep the tab in the URL so it survives a reload and can be shared.
          window.history.replaceState(null, "", `?tab=${v}`);
        }}
        tabs={[
          { value: "rules", label: "Scheduling rules" },
          { value: "appearance", label: "Appearance" },
          { value: "categories", label: "Categories" },
          { value: "users", label: "People & roles" },
          { value: "feeds", label: "Feeds" },
          { value: "audit", label: "Audit log" },
        ]}
      >
        <TabPanel value="rules"><RulesTab rules={props.rules} layers={props.layers} affected={props.affected} /></TabPanel>
        <TabPanel value="appearance"><AppearanceTab appearance={props.appearance} /></TabPanel>
        <TabPanel value="categories"><CategoriesTab categories={props.categories} /></TabPanel>
        <TabPanel value="users"><UsersTab users={props.users} /></TabPanel>
        <TabPanel value="feeds"><FeedsTab feed={props.feed} /></TabPanel>
        <TabPanel value="audit"><AuditTab audit={props.audit} /></TabPanel>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------ rules */

function RulesTab({ rules, layers, affected }: { rules: Rule[]; layers: { key: string; name: string }[]; affected: Affected[] }) {
  const { mutate, busy } = useMutate();
  const builtin = rules.find((r) => r.builtin);
  const saved = { daysBefore: builtin?.params.daysBefore ?? 21, midterms: (builtin?.params.kinds ?? []).includes("midterm"), active: builtin?.active ?? true };
  const [exam, setExam] = useState(saved);
  const [newlyAffected, setNewlyAffected] = useState<Affected[] | null>(null);
  const [ruleForm, setRuleForm] = useState<{ id: string | null; form: RuleInput } | null>(null);
  const dirty = JSON.stringify(exam) !== JSON.stringify(saved);
  const list = newlyAffected ?? affected;

  const blankRule: RuleInput = { name: "", type: "date_range", severity: "soft", appliesTo: ["conference"], startDate: null, endDate: null, kinds: [], layerKeys: [], message: "", active: true };

  return (
    <div className="flex flex-col gap-10 pb-10">
      <section>
        <h2 className="flex items-center gap-2 text-sm font-semibold"><ShieldAlert className="h-4 w-4 text-danger" /> Exams</h2>
        <p className="mb-4 mt-1 max-w-2xl text-[13px] text-ink-3">
          No BFC conference may be scheduled during an exam session or in the days immediately before it. The restricted periods are calculated from the exam dates approved in <Link href="/board/academic" className="underline underline-offset-2">Academic calendars</Link>, for every program, and move by themselves if those dates change. Internal board meetings are not affected.
        </p>
        <Card className="flex flex-col gap-4 p-4">
          <Field label="Days closed before each exam session" hint="Calendar days before the first exam. The exam days themselves are always closed too.">
            <Input type="number" min={1} max={60} value={exam.daysBefore} onChange={(e) => setExam({ ...exam, daysBefore: Number(e.target.value) })} className="max-w-[120px]" />
          </Field>
          <Switch checked={exam.midterms} onCheckedChange={(v) => setExam({ ...exam, midterms: v })} label="Also apply to midterms" description="Off: only periods marked as exams (including retakes) count." />
          <Switch checked={exam.active} onCheckedChange={(v) => setExam({ ...exam, active: v })} label="Enforce this rule" description="Leave on. Turning it off removes the block for everyone and is recorded in the audit log." />
          <div className="flex items-center gap-2">
            <Button variant="primary" disabled={!dirty} loading={busy} onClick={() => mutate(() => saveExamRuleAction(exam), { success: "Exam rule saved — restricted periods recalculated", onOk: (d) => setNewlyAffected(d.affected) })}>Save exam rule</Button>
            {dirty && <Button variant="ghost" onClick={() => setExam(saved)}>Discard</Button>}
          </div>
        </Card>
        {list.length > 0 && (
          <Callout tone="danger" icon={<ShieldAlert />} className="mt-4" title={`${list.length} scheduled event${list.length > 1 ? "s" : ""} inside a restricted period`}>
            <ul className="mt-1 flex flex-col gap-0.5">
              {list.map((a) => (
                <li key={a.id}>
                  <Link href={`/board/events/${a.id}`} className="underline underline-offset-2">{a.title}</Link>
                  {a.overridden ? " — covered by a recorded exception" : " — needs a new date or an exception"}
                </li>
              ))}
            </ul>
          </Callout>
        )}
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Other rules</h2>
          <Button size="sm" variant="outline" onClick={() => setRuleForm({ id: null, form: blankRule })}><Plus className="h-3.5 w-3.5" /> New rule</Button>
        </div>
        <p className="mb-4 max-w-2xl text-[13px] text-ink-3">
          <strong className="font-medium text-ink-2">Hard</strong> rules block scheduling (a Super Admin can override with a written reason). <strong className="font-medium text-ink-2">Soft</strong> rules only show a warning. Rules based on the academic calendar only use verified periods.
        </p>
        <Card className="divide-y divide-line">
          {rules.filter((r) => !r.builtin).map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className={cn("text-[13px] font-medium", !r.active && "text-ink-3 line-through")}>{r.name}</p>
                <p className="text-xs text-ink-3">
                  {r.type === "date_range" ? formatIsoRange(r.params.startDate!, r.params.endDate!) : `Academic: ${(r.params.kinds ?? []).map((k) => ACADEMIC_KIND_META[k as AcademicKind]?.label ?? k).join(", ")}${r.params.layerKeys?.length ? ` · ${r.params.layerKeys.length} layer(s)` : " · all layers"}`}
                  {" · applies to "}{r.appliesTo.map((k) => KIND_LABEL[k as CategoryKind]?.toLowerCase() ?? k).join(", ")}
                </p>
              </div>
              <Badge tone={r.severity === "hard" ? "danger" : "warn"}>{r.severity === "hard" ? "Hard block" : "Soft warning"}</Badge>
              <Switch checked={r.active} onCheckedChange={(v) => mutate(() => toggleRuleAction(r.id, v))} label={`Rule “${r.name}” enabled`} hideLabel />
              <Button size="icon" variant="ghost" aria-label={`Edit ${r.name}`} onClick={() => setRuleForm({ id: r.id, form: { name: r.name, type: r.type as "date_range" | "academic_kind", severity: r.severity, appliesTo: r.appliesTo as CategoryKind[], startDate: r.params.startDate ?? null, endDate: r.params.endDate ?? null, kinds: (r.params.kinds ?? []) as AcademicKind[], layerKeys: r.params.layerKeys ?? [], message: r.message, active: r.active } })}><Pencil className="h-3.5 w-3.5" /></Button>
              <Button size="icon" variant="ghost" aria-label={`Delete ${r.name}`} onClick={() => confirm(`Delete the rule “${r.name}”?`) && mutate(() => deleteRuleAction(r.id), { success: "Rule deleted" })}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
          {rules.filter((r) => !r.builtin).length === 0 && <p className="px-4 py-6 text-center text-[13px] text-ink-3">No additional rules.</p>}
        </Card>
      </section>

      {ruleForm && (
        <Dialog
          open
          onOpenChange={(o) => !o && setRuleForm(null)}
          title={ruleForm.id ? "Edit rule" : "New scheduling rule"}
          footer={
            <>
              <Button variant="ghost" onClick={() => setRuleForm(null)}>Cancel</Button>
              <Button variant="primary" loading={busy} disabled={!ruleForm.form.name.trim()} onClick={() => mutate(() => saveRuleAction(ruleForm.id, ruleForm.form), { success: "Rule saved", onOk: () => setRuleForm(null) })}>Save rule</Button>
            </>
          }
        >
          <RuleFields form={ruleForm.form} onChange={(form) => setRuleForm({ ...ruleForm, form })} layers={layers} />
        </Dialog>
      )}
    </div>
  );
}

function RuleFields({ form, onChange, layers }: { form: RuleInput; onChange: (f: RuleInput) => void; layers: { key: string; name: string }[] }) {
  const set = <K extends keyof RuleInput>(k: K, v: RuleInput[K]) => onChange({ ...form, [k]: v });
  const toggle = <T,>(list: T[] | undefined, v: T) => ((list ?? []).includes(v) ? (list ?? []).filter((x) => x !== v) : [...(list ?? []), v]);
  return (
    <div className="flex flex-col gap-4">
      <Field label="Name"><Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Integration week" autoFocus maxLength={80} /></Field>
      <div className="flex flex-wrap gap-4">
        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-2">Based on</p>
          <Segmented label="Rule type" value={form.type} onChange={(v) => set("type", v)} options={[{ value: "date_range", label: "Fixed dates" }, { value: "academic_kind", label: "Academic calendar" }]} />
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-2">Effect</p>
          <Segmented label="Severity" value={form.severity} onChange={(v) => set("severity", v)} options={[{ value: "soft", label: "Soft warning" }, { value: "hard", label: "Hard block" }]} />
        </div>
      </div>
      {form.type === "date_range" ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><Input type="date" value={form.startDate ?? ""} onChange={(e) => set("startDate", e.target.value || null)} /></Field>
          <Field label="To"><Input type="date" value={form.endDate ?? ""} min={form.startDate ?? undefined} onChange={(e) => set("endDate", e.target.value || null)} /></Field>
        </div>
      ) : (
        <>
          <ChipGroup label="During">
            {ACADEMIC_KINDS.filter((k) => k !== "teaching" && k !== "other").map((k) => (
              <Pill key={k} on={(form.kinds ?? []).includes(k)} onClick={() => set("kinds", toggle(form.kinds, k))}>{ACADEMIC_KIND_META[k].label}</Pill>
            ))}
          </ChipGroup>
          {layers.length > 0 && (
            <ChipGroup label="Of these calendars (none selected = all)">
              {layers.map((l) => <Pill key={l.key} on={(form.layerKeys ?? []).includes(l.key)} onClick={() => set("layerKeys", toggle(form.layerKeys, l.key))}>{l.name}</Pill>)}
            </ChipGroup>
          )}
        </>
      )}
      <ChipGroup label="Applies to">
        {CATEGORY_KINDS.map((k) => <Pill key={k} on={form.appliesTo.includes(k)} onClick={() => set("appliesTo", toggle(form.appliesTo, k))}>{KIND_LABEL[k]}</Pill>)}
      </ChipGroup>
      <Field label="Message shown to users" optional><Input value={form.message ?? ""} onChange={(e) => set("message", e.target.value)} maxLength={300} placeholder="Leave empty for an automatic message" /></Field>
    </div>
  );
}

function ChipGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-ink-2">{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}
function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn("h-7 rounded-full border px-2.5 text-xs", on ? "border-brand-line bg-brand-soft text-brand-ink" : "border-line text-ink-2 hover:bg-surface-2")}>
      {children}
    </button>
  );
}

/* ------------------------------------------------------------- appearance */

function AppearanceTab({ appearance }: { appearance: Appearance }) {
  const { mutate, busy } = useMutate();
  const [a, setA] = useState(appearance);
  const dirty = JSON.stringify(a) !== JSON.stringify(appearance);
  const set = <K extends keyof Appearance>(k: K, v: Appearance[K]) => setA((x) => ({ ...x, [k]: v }));
  const preview = { "--brand": a.brand.primary, "--brand-deep": a.brand.deep, "--brand-accent": a.brand.accent } as React.CSSProperties;

  return (
    <div className="flex flex-col gap-8 pb-24">
      <Group title="Identity">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Organisation name"><Input value={a.orgName} onChange={(e) => set("orgName", e.target.value)} maxLength={60} /></Field>
          <Field label="Short name" hint="Used in the logo mark and calendar names."><Input value={a.shortName} onChange={(e) => set("shortName", e.target.value)} maxLength={12} /></Field>
          <Field label="Tagline" className="sm:col-span-2"><Input value={a.tagline} onChange={(e) => set("tagline", e.target.value)} maxLength={120} /></Field>
        </div>
      </Group>

      <Group title="Brand colours" description="Applied to buttons, highlights and the public site after saving.">
        <div className="grid gap-5 sm:grid-cols-[1fr_220px]">
          <div className="flex flex-col gap-4">
            {(["primary", "deep", "accent"] as const).map((k) => (
              <div key={k}>
                <p className="mb-1.5 text-xs font-medium capitalize text-ink-2">{k === "deep" ? "Deep (hover, dark areas)" : k}</p>
                <ColorField label={`Brand ${k}`} value={a.brand[k]} onChange={(c) => set("brand", { ...a.brand, [k]: c })} />
              </div>
            ))}
            <Button variant="ghost" size="sm" className="self-start" onClick={() => set("brand", { primary: "#841E21", deep: "#6D071A", accent: "#CF2B36" })}>Reset to BFC burgundy</Button>
          </div>
          <div style={preview} className="flex flex-col gap-2 rounded-xl border border-line p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Preview</p>
            <span className="inline-flex h-9 items-center justify-center rounded-lg bg-brand px-3 text-[13px] font-medium text-white">Primary button</span>
            <span className="inline-flex h-9 items-center justify-center rounded-lg bg-brand-deep px-3 text-[13px] font-medium text-white">Hover state</span>
            <div className="ev-chip" style={{ "--c": a.brand.primary } as React.CSSProperties}><span className="ev-time">18:30</span><span className="ev-title">Conference</span></div>
            <span className="inline-flex h-6 items-center self-start rounded-full bg-brand-accent px-2 text-[11px] font-semibold text-white">Accent</span>
          </div>
        </div>
      </Group>

      <Group title="Calendar display">
        <div className="grid gap-5 sm:grid-cols-2">
          <Choice label="Default theme"><Segmented label="Theme" value={a.defaultTheme} onChange={(v) => set("defaultTheme", v)} options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} /></Choice>
          <Choice label="Density"><Segmented label="Density" value={a.density} onChange={(v) => set("density", v)} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} /></Choice>
          <Choice label="Event appearance"><Segmented label="Event style" value={a.eventStyle} onChange={(v) => set("eventStyle", v)} options={[{ value: "soft", label: "Soft" }, { value: "solid", label: "Solid" }, { value: "outline", label: "Outline" }]} /></Choice>
          <Choice label="Colour events by"><Segmented label="Colour by" value={a.colorEventsBy} onChange={(v) => set("colorEventsBy", v)} options={[{ value: "category", label: "Category" }, { value: "status", label: "Status" }]} /></Choice>
          <Field label="Board default view">
            <Select value={a.defaultView} onChange={(e) => set("defaultView", e.target.value as Appearance["defaultView"])}>
              {["month", "week", "day", "agenda", "timeline"].map((v) => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}
            </Select>
          </Field>
          <Field label="Members calendar default view">
            <Select value={a.publicDefaultView} onChange={(e) => set("publicDefaultView", e.target.value as Appearance["publicDefaultView"])}>
              <option value="agenda">Agenda (list)</option>
              <option value="month">Month</option>
            </Select>
          </Field>
          <Choice label="Week starts on"><Segmented label="Week start" value={String(a.weekStartsOn) as "0" | "1"} onChange={(v) => set("weekStartsOn", Number(v) as 0 | 1)} options={[{ value: "1", label: "Monday" }, { value: "0", label: "Sunday" }]} /></Choice>
          <div className="flex items-end"><Switch checked={a.showWeekends} onCheckedChange={(v) => set("showWeekends", v)} label="Show weekends" /></div>
          <Field label="Day view starts at"><Select value={a.dayStartHour} onChange={(e) => set("dayStartHour", Number(e.target.value))}>{Array.from({ length: 13 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</Select></Field>
          <Field label="Day view ends at"><Select value={a.dayEndHour} onChange={(e) => set("dayEndHour", Number(e.target.value))}>{Array.from({ length: 12 }, (_, i) => i + 13).map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</Select></Field>
        </div>
      </Group>

      <Group title="Statuses" description="Rename statuses and choose their colours. The workflow itself stays the same.">
        <div className="flex flex-col divide-y divide-line rounded-xl border border-line">
          {EVENT_STATUSES.map((s) => (
            <div key={s} className="grid items-center gap-3 px-3.5 py-2.5 sm:grid-cols-[200px_1fr]">
              <Input aria-label={`Label for ${STATUS_META[s].label}`} value={a.statusLabels[s] ?? STATUS_META[s].label} onChange={(e) => set("statusLabels", { ...a.statusLabels, [s]: e.target.value })} maxLength={30} className="h-8" />
              <ColorField label={`${STATUS_META[s].label} colour`} value={a.statusColors[s] ?? STATUS_META[s].color} onChange={(c) => set("statusColors", { ...a.statusColors, [s]: c })} />
            </div>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setA((x) => ({ ...x, statusColors: {}, statusLabels: {} }))}>Reset statuses</Button>
      </Group>

      <div className={cn("fixed inset-x-0 bottom-14 z-20 flex justify-center px-4 transition-all duration-200 lg:bottom-5 lg:left-[224px]", dirty ? "opacity-100" : "pointer-events-none translate-y-4 opacity-0")}>
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface py-2 pl-4 pr-2 shadow-lg">
          <span className="text-[13px] text-ink-2">Unsaved changes</span>
          <Button variant="ghost" size="sm" onClick={() => setA(appearance)}>Discard</Button>
          <Button variant="primary" size="sm" loading={busy} onClick={() => mutate(() => saveAppearanceAction(a), { success: "Appearance saved" })}>Save appearance</Button>
        </div>
      </div>
    </div>
  );
}

function Group({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-ink-3">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
function Choice({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-ink-2">{label}</p>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------- categories */

function CategoriesTab({ categories }: { categories: BoardCategory[] }) {
  const { mutate, busy } = useMutate();
  const [form, setForm] = useState<{ id: string | null; name: string; kind: CategoryKind; color: string; icon: string } | null>(null);
  return (
    <div className="pb-10">
      <div className="mb-4 flex items-start justify-between gap-4">
        <p className="max-w-xl text-[13px] text-ink-3">Categories give events their colour. The <strong className="font-medium text-ink-2">type</strong> decides which scheduling rules apply — the Victoriales restriction applies to the “Conferences” type only.</p>
        <Button variant="outline" onClick={() => setForm({ id: null, name: "", kind: "conference", color: "#841E21", icon: "calendar" })}><Plus className="h-4 w-4" /> New category</Button>
      </div>
      <Card className="divide-y divide-line">
        {categories.map((c) => (
          <div key={c.id} className={cn("flex items-center gap-3 px-4 py-3", c.archived && "opacity-55")}>
            <span className="grid h-7 w-7 place-items-center rounded-lg text-white" style={{ background: c.color }}><CategoryIcon name={c.icon} /></span>
            <span className="flex-1 text-[13px] font-medium">{c.name}</span>
            <Badge>{KIND_LABEL[c.kind]}</Badge>
            {c.archived && <Badge tone="warn">Archived</Badge>}
            <Button size="icon" variant="ghost" aria-label={`Edit ${c.name}`} onClick={() => setForm({ id: c.id, name: c.name, kind: c.kind, color: c.color, icon: c.icon })}><Pencil className="h-3.5 w-3.5" /></Button>
            <Button size="sm" variant="ghost" onClick={() => mutate(() => archiveCategoryAction(c.id, !c.archived), { success: c.archived ? "Category restored" : "Category archived — existing events keep it" })}>{c.archived ? "Restore" : "Archive"}</Button>
          </div>
        ))}
      </Card>
      {form && (
        <Dialog
          open
          onOpenChange={(o) => !o && setForm(null)}
          size="sm"
          title={form.id ? "Edit category" : "New category"}
          footer={
            <>
              <Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
              <Button variant="primary" loading={busy} disabled={!form.name.trim()} onClick={() => mutate(() => saveCategoryAction(form.id, form), { success: "Category saved", onOk: () => setForm(null) })}>Save</Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus maxLength={40} /></Field>
            <Field label="Type" hint="Scheduling rules are applied by type.">
              <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as CategoryKind })}>{CATEGORY_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select>
            </Field>
            <div><p className="mb-2 text-xs font-medium text-ink-2">Colour</p><ColorField label="Category colour" value={form.color} onChange={(c) => setForm({ ...form, color: c })} /></div>
            <div>
              <p className="mb-2 text-xs font-medium text-ink-2">Icon</p>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Category icon">
                {Object.entries(CATEGORY_ICONS).map(([key, { label }]) => (
                  <button key={key} type="button" role="radio" aria-checked={form.icon === key} aria-label={label} title={label} onClick={() => setForm({ ...form, icon: key })} className={cn("grid h-8 w-8 place-items-center rounded-lg border", form.icon === key ? "border-brand-ink bg-brand-soft text-brand-ink" : "border-line text-ink-2 hover:bg-surface-2")}>
                    <CategoryIcon name={key} className="h-4 w-4" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ users */

function UsersTab({ users }: { users: UserRow[] }) {
  const { me } = useBoard();
  const { mutate, busy } = useMutate();
  const [inviting, setInviting] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "board_member" as Role });
  const [link, setLink] = useState<{ link: string; name: string; days: number } | null>(null);
  return (
    <div className="pb-10">
      <div className="mb-4 flex items-start justify-between gap-4">
        <p className="max-w-xl text-[13px] text-ink-3">Invite board members and choose what they can do. Deactivating someone signs them out immediately and disables their private calendar subscriptions.</p>
        <Button variant="primary" onClick={() => setInviting(true)}><UserPlus className="h-4 w-4" /> Invite</Button>
      </div>
      <Card className="divide-y divide-line">
        {users.map((u) => (
          <div key={u.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3", !u.active && "opacity-60")}>
            <Avatar name={u.name} size={32} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{u.name}{u.id === me.id && <span className="ml-1.5 font-normal text-ink-3">(you)</span>}</p>
              <p className="truncate text-xs text-ink-3">{u.email} · {!u.active ? "deactivated" : !u.hasPassword ? "invitation pending" : u.lastLoginAt ? `last sign-in ${formatDateTime(new Date(u.lastLoginAt))}` : "never signed in"}</p>
            </div>
            <Select aria-label={`Role of ${u.name}`} value={u.role} disabled={!u.active} onChange={(e) => mutate(() => updateUserAction(u.id, { role: e.target.value }), { success: `${u.name} is now ${ROLE_LABEL[e.target.value as Role]}` })} className="h-8 w-[150px]">
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </Select>
            {u.active && <Button size="sm" variant="ghost" title="Create a one-time link to set a new password" onClick={() => mutate(() => resetLinkAction(u.id), { onOk: (d) => setLink({ link: d.link, name: u.name, days: d.expiresInDays }) })}><KeyRound className="h-3.5 w-3.5" /> Sign-in link</Button>}
            {u.id !== me.id && (
              <Button size="sm" variant={u.active ? "danger" : "outline"} onClick={() => mutate(() => updateUserAction(u.id, { active: !u.active }), { success: u.active ? `${u.name} deactivated — sessions and private feeds revoked` : `${u.name} reactivated` })}>
                {u.active ? "Deactivate" : "Reactivate"}
              </Button>
            )}
          </div>
        ))}
      </Card>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
          <div key={r} className="rounded-xl bg-surface-2 p-3.5">
            <p className="flex items-center gap-1.5 text-[13px] font-medium"><ShieldCheck className="h-3.5 w-3.5 text-ink-3" />{ROLE_LABEL[r]}</p>
            <p className="mt-1 text-xs text-ink-3">{ROLE_DESCRIPTION[r]}</p>
          </div>
        ))}
      </div>

      <Dialog
        open={inviting}
        onOpenChange={setInviting}
        size="sm"
        title="Invite a board member"
        description="You will get a one-time link to send them. No email is sent automatically."
        footer={
          <>
            <Button variant="ghost" onClick={() => setInviting(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={!form.name.trim() || !form.email.trim()} onClick={() => mutate(() => inviteUserAction(form), { onOk: (d) => (setInviting(false), setLink({ link: d.link, name: form.name, days: d.expiresInDays }), setForm({ name: "", email: "", role: "board_member" })) })}>Create invitation</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Full name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus maxLength={80} /></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Role" hint={ROLE_DESCRIPTION[form.role]}>
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select>
          </Field>
        </div>
      </Dialog>

      <Dialog open={!!link} onOpenChange={(o) => !o && setLink(null)} title={`Link for ${link?.name ?? ""}`} description={`Send this link privately. It works once and expires in ${link?.days ?? 7} days.`} footer={<Button variant="primary" onClick={() => setLink(null)}>Done</Button>}>
        {link && <CopyField value={link.link} label="One-time link" secret />}
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ feeds */

function FeedsTab({ feed }: { feed: { cancelledRetentionDays: number; refreshMinutes: number } }) {
  const { mutate, busy } = useMutate();
  const [f, setF] = useState(feed);
  const dirty = JSON.stringify(f) !== JSON.stringify(feed);
  return (
    <div className="flex max-w-xl flex-col gap-5 pb-10">
      <Field label="Keep cancelled events in feeds for (days)" hint="During this time the event stays in the subscription, marked CANCELLED, so every calendar app has a chance to pick up the cancellation. Afterwards it is removed.">
        <Input type="number" min={0} max={365} value={f.cancelledRetentionDays} onChange={(e) => setF({ ...f, cancelledRetentionDays: Number(e.target.value) })} className="max-w-[120px]" />
      </Field>
      <Field label="Suggested refresh interval (minutes)" hint="A hint included in the feed. Apple Calendar tends to respect it; Google Calendar and Outlook use their own schedule.">
        <Input type="number" min={15} max={1440} step={15} value={f.refreshMinutes} onChange={(e) => setF({ ...f, refreshMinutes: Number(e.target.value) })} className="max-w-[120px]" />
      </Field>
      <Button variant="primary" className="self-start" disabled={!dirty} loading={busy} onClick={() => mutate(() => saveFeedSettingsAction(f), { success: "Feed settings saved" })}>Save feed settings</Button>
      <Callout tone="neutral" title="Private feed addresses">
        Each board member manages their own private addresses under <Link href="/board/subscriptions" className="underline underline-offset-2">Subscriptions</Link>. Deactivating a member in “People & roles” revokes all of theirs at once.
      </Callout>
    </div>
  );
}

/* ------------------------------------------------------------------ audit */

function AuditTab({ audit }: { audit: AuditRow[] }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const types = useMemo(() => [...new Set(audit.map((a) => a.entityType))].sort(), [audit]);
  const rows = audit.filter((a) => (!type || a.entityType === type) && (!q || `${a.summary} ${a.actorName} ${a.action} ${a.reason ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="pb-10">
      <div className="mb-3 flex flex-wrap gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the log" aria-label="Search the audit log" className="max-w-xs" />
        <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type" className="w-[170px]">
          <option value="">Everything</option>
          {types.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
        </Select>
        <span className="self-center text-xs text-ink-3">Latest {audit.length} entries</span>
      </div>
      <Card className="divide-y divide-line">
        {rows.map((a) => (
          <div key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5">
            <span className="w-[132px] shrink-0 text-xs tabular text-ink-3">{formatDateTime(new Date(a.at))}</span>
            <span className="min-w-0 flex-1 text-[13px]">
              {a.entityType === "event" && a.entityId && a.action !== "event.delete" ? <Link href={`/board/events/${a.entityId}`} className="hover:underline">{a.summary}</Link> : a.summary}
              {a.reason && <span className="mt-0.5 block rounded bg-warn-soft px-2 py-0.5 text-xs text-ink-2">Reason: {a.reason}</span>}
            </span>
            <span className="text-xs text-ink-3">{a.actorName}</span>
            <span className={cn("rounded px-1.5 py-0.5 font-mono text-[10px]", a.action === "restriction.override" ? "bg-danger-soft text-danger" : "bg-surface-2 text-ink-3")}>{a.action}</span>
          </div>
        ))}
        {rows.length === 0 && <p className="px-4 py-8 text-center text-[13px] text-ink-3">No matching entries.</p>}
      </Card>
    </div>
  );
}
