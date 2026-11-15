"use client";

import { useState } from "react";
import { Globe, KeyRound, Lock, Plus, RefreshCw, Trash2 } from "lucide-react";
import { createFeedAction, revokeFeedAction, rotateFeedAction } from "@/app/actions/feeds";
import { CopyField, SubscribeGuide } from "@/components/subscribe";
import { Button, Callout, Card, Dialog, EmptyState, Field, Input, Switch } from "@/components/ui";
import { formatDateTime } from "@/lib/time";
import { useMutate } from "./context";

type Token = { id: string; label: string; includeTentative: boolean; includeDeadlines: boolean; createdAt: string; lastUsedAt: string | null };

export function Subscriptions({ publicUrl, shortName, tokens, retentionDays }: { publicUrl: string; shortName: string; tokens: Token[]; retentionDays: number }) {
  const { mutate, busy } = useMutate();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ label: "", includeTentative: true, includeDeadlines: true });
  const [revealed, setRevealed] = useState<{ url: string; rotated?: boolean } | null>(null);

  return (
    <div className="flex flex-col gap-10">
      <section>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold"><Lock className="h-4 w-4 text-ink-3" /> Board calendar <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-3">private</span></h2>
        <p className="mb-4 text-[13px] text-ink-3">Everything on the board calendar: confirmed and tentative events, and optionally proposed dates and task deadlines. Each address is personal and stops working the moment it is revoked or your access ends.</p>
        {tokens.length === 0 ? (
          <EmptyState icon={<KeyRound className="h-5 w-5" />} title="No private subscription yet" action={<Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Create my private address</Button>}>
            Create a personal, secret address to follow the board calendar from your phone or laptop.
          </EmptyState>
        ) : (
          <>
            <Card className="divide-y divide-line">
              {tokens.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">{t.label}</p>
                    <p className="text-xs text-ink-3">
                      {[t.includeTentative ? "with proposed dates" : "confirmed events only", t.includeDeadlines ? "with deadlines" : null].filter(Boolean).join(" · ")} · created {formatDateTime(new Date(t.createdAt))} · {t.lastUsedAt ? `last fetched ${formatDateTime(new Date(t.lastUsedAt))}` : "never fetched yet"}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" loading={busy} title="Issue a new address and disable the old one" onClick={() => confirm(`Rotate “${t.label}”? The current address stops working immediately.`) && mutate(() => rotateFeedAction(t.id), { onOk: (d) => setRevealed({ url: d.url, rotated: true }) })}><RefreshCw className="h-3.5 w-3.5" /> Rotate</Button>
                  <Button size="sm" variant="danger" onClick={() => confirm(`Revoke “${t.label}”? Calendars using this address will stop updating.`) && mutate(() => revokeFeedAction(t.id), { success: "Subscription revoked — the address no longer works" })}><Trash2 className="h-3.5 w-3.5" /> Revoke</Button>
                </div>
              ))}
            </Card>
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setCreating(true)}><Plus className="h-3.5 w-3.5" /> Another address (e.g. a second device)</Button>
            <p className="mt-2 text-xs text-ink-3">For your security the address is shown only once. Lost it? Rotate to get a new one.</p>
          </>
        )}
      </section>

      <section>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold"><Globe className="h-4 w-4 text-ink-3" /> Members calendar <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-ink">public</span></h2>
        <p className="mb-4 text-[13px] text-ink-3">Published events only. Safe to share with every member.</p>
        <Card className="flex flex-col gap-5 p-4">
          <CopyField value={publicUrl} label="Public calendar address" />
          <SubscribeGuide url={publicUrl} name={`${shortName} events`} />
        </Card>
      </section>

      <Callout tone="neutral" title="How updates reach calendars">
        When an event is edited, moved, cancelled, published or unpublished, the feeds change immediately. Each calendar app then picks up the change at its next refresh (Apple: as often as every 5 minutes to hourly; Outlook: every few hours; Google: up to a day). Cancelled events stay in the feed, marked as cancelled, for {retentionDays} days so that every app notices; unpublished events simply disappear from the public feed.
      </Callout>

      <Dialog
        open={creating}
        onOpenChange={setCreating}
        size="sm"
        title="New private subscription"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={() => mutate(() => createFeedAction(form), { onOk: (d) => (setCreating(false), setRevealed({ url: d.url })) })}>Create address</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Name" optional hint="Helps you tell your devices apart."><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. iPhone" maxLength={60} /></Field>
          <Switch checked={form.includeTentative} onCheckedChange={(v) => setForm({ ...form, includeTentative: v })} label="Include proposed dates" description="Shown as tentative, prefixed with [Option]." />
          <Switch checked={form.includeDeadlines} onCheckedChange={(v) => setForm({ ...form, includeDeadlines: v })} label="Include task deadlines" description="Open tasks, as all-day entries." />
        </div>
      </Dialog>

      <Dialog open={!!revealed} onOpenChange={(o) => !o && setRevealed(null)} size="lg" title={revealed?.rotated ? "Your new private address" : "Your private address"} description="Copy it now — it will not be shown again." footer={<Button variant="primary" onClick={() => setRevealed(null)}>Done</Button>}>
        {revealed && (
          <div className="flex flex-col gap-5">
            {revealed.rotated && <Callout tone="warn">The previous address has stopped working. Re-subscribe on each device with this one.</Callout>}
            <CopyField value={revealed.url} label="Private calendar address" secret />
            <SubscribeGuide url={revealed.url} name={`${shortName} board`} isPrivate />
          </div>
        )}
      </Dialog>
    </div>
  );
}
