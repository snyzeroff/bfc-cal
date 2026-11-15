"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { createSignupLinkAction, revokeSignupLinkAction } from "@/app/actions/signup-links";
import { CopyField } from "@/components/subscribe";
import { Badge, Button, Callout, Card, Dialog, Field, Input, Select } from "@/components/ui";
import type { Role } from "@/db/schema";
import { cn } from "@/lib/cn";
import { ROLE_DESCRIPTION, ROLE_LABEL } from "@/lib/permissions";
import { formatDayYear } from "@/lib/time";
import { useMutate } from "./context";

export type SignupLinkRow = {
  id: string;
  label: string;
  role: Role;
  maxUses: number;
  uses: number;
  expiresAt: string;
  status: "active" | "expired" | "full" | "revoked";
  createdByName: string | null;
  /** Names of the people who created their account with this link. */
  members: string[];
};

/** A link never grants Super Admin; the server refuses it too. */
const LINK_ROLES = ["board_member", "board_admin"] as const satisfies readonly Role[];

const STATUS: Record<SignupLinkRow["status"], { label: string; tone: "ok" | "neutral" | "warn" | "danger" }> = {
  active: { label: "Active", tone: "ok" },
  full: { label: "Full", tone: "neutral" },
  expired: { label: "Expired", tone: "warn" },
  revoked: { label: "Revoked", tone: "danger" },
};

const EMPTY = { label: "", role: "board_member" as (typeof LINK_ROLES)[number], maxUses: "10", days: "7" };
const within = (value: string, min: number, max: number) => /^\d+$/.test(value.trim()) && Number(value) >= min && Number(value) <= max;

export function SignupLinks({ links }: { links: SignupLinkRow[] }) {
  const { mutate, busy } = useMutate();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [created, setCreated] = useState<{ url: string; role: Role } | null>(null);
  const valid = form.label.trim().length > 0 && within(form.maxUses, 1, 100) && within(form.days, 1, 30);

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Invitation links</h2>
          <p className="mt-0.5 max-w-xl text-xs text-ink-3">One link, several accounts, one role.</p>
        </div>
        <Button variant="outline" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New link</Button>
      </div>

      {links.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong px-4 py-5 text-center text-[13px] text-ink-3">No invitation link yet.</p>
      ) : (
        <Card className="divide-y divide-line">
          {links.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              <div className={cn("min-w-0 flex-1", l.status !== "active" && "opacity-60")}>
                <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
                  <span className="truncate">{l.label}</span>
                  <Badge tone={STATUS[l.status].tone}>{STATUS[l.status].label}</Badge>
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {[
                    ROLE_LABEL[l.role],
                    `${l.uses} / ${l.maxUses} used`,
                    l.status === "revoked" ? null : `${l.status === "expired" ? "expired" : "expires"} ${formatDayYear(new Date(l.expiresAt))}`,
                    l.createdByName ? `created by ${l.createdByName}` : null,
                  ].filter(Boolean).join(" · ")}
                </p>
                {l.members.length > 0 && <p className="mt-0.5 text-xs text-ink-3">Joined: {l.members.join(", ")}</p>}
              </div>
              {l.status === "active" && (
                <Button size="sm" variant="danger" onClick={() => confirm(`Revoke “${l.label}”? Nobody will be able to join with this link any more. Accounts already created are kept.`) && mutate(() => revokeSignupLinkAction(l.id), { success: "Link revoked — it no longer works" })}>
                  <Trash2 className="h-3.5 w-3.5" /> Revoke
                </Button>
              )}
            </div>
          ))}
        </Card>
      )}

      <Dialog
        open={creating}
        onOpenChange={setCreating}
        size="sm"
        title="New invitation link"
        description="Each person who opens it creates one account."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!valid}
              onClick={() =>
                mutate(() => createSignupLinkAction({ label: form.label, role: form.role, maxUses: Number(form.maxUses), expiresInDays: Number(form.days) }), {
                  onOk: (d) => (setCreating(false), setCreated({ url: d.url, role: form.role }), setForm(EMPTY)),
                })
              }
            >
              Create link
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Name" hint="Only you see it, e.g. “Board 2027”.">
            <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} autoFocus maxLength={60} />
          </Field>
          <Field label="Role" hint={ROLE_DESCRIPTION[form.role]}>
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as typeof form.role })}>
              {LINK_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Number of accounts" hint="1 to 100.">
              <Input type="number" inputMode="numeric" min={1} max={100} step={1} value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} />
            </Field>
            <Field label="Valid for (days)" hint="1 to 30.">
              <Input type="number" inputMode="numeric" min={1} max={30} step={1} value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} />
            </Field>
          </div>
        </div>
      </Dialog>

      <Dialog open={!!created} onOpenChange={(o) => !o && setCreated(null)} title="Your invitation link" description="Copy it now — it will not be shown again." footer={<Button variant="primary" onClick={() => setCreated(null)}>Done</Button>}>
        {created && (
          <div className="flex flex-col gap-4">
            <CopyField value={created.url} label="Invitation link" secret />
            <Callout tone="warn">Anyone with this link can create a {ROLE_LABEL[created.role]} account.</Callout>
          </div>
        )}
      </Dialog>
    </section>
  );
}
