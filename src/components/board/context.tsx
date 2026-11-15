"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";
import { Button, Callout, Dialog, Field, Textarea } from "@/components/ui";
import type { Appearance } from "@/lib/appearance";
import type { Me } from "@/lib/board-types";
import type { ActionResult } from "@/lib/errors";

type Ctx = { me: Me; appearance: Appearance };
const BoardContext = createContext<Ctx | null>(null);

export function BoardProvider({ me, appearance, children }: Ctx & { children: React.ReactNode }) {
  return <BoardContext.Provider value={{ me, appearance }}>{children}</BoardContext.Provider>;
}

export function useBoard(): Ctx {
  const ctx = useContext(BoardContext);
  if (!ctx) throw new Error("useBoard must be used inside <BoardProvider>");
  return ctx;
}

type Violation = { title: string; message: string; start: string; end: string; type: string };
type Pending = {
  violations: Violation[];
  canOverride: boolean;
  retry: (reason: string) => Promise<void>;
  cancel: () => void;
};

export type MutateOptions<T> = {
  /** Shown as a success toast. */
  success?: string | ((data: T) => string);
  onOk?: (data: T) => void;
  /** Called on any failure, including a dismissed restriction dialog (use it to revert optimistic UI). */
  onFail?: () => void;
  undo?: () => void;
  refresh?: boolean;
};

/**
 * Runs a server action with consistent feedback. When the server refuses a
 * date because of a hard restriction, a dialog explains why and — for Super
 * Admins only — offers an explicit override that requires a written reason.
 */
export function useMutate() {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const mutate = useCallback(
    async <T,>(fn: (opts: { overrideReason?: string }) => Promise<ActionResult<T>>, o: MutateOptions<T> = {}): Promise<boolean> => {
      const attempt = async (reason?: string): Promise<boolean> => {
        setBusy(true);
        let res: ActionResult<T>;
        try {
          res = await fn(reason ? { overrideReason: reason } : {});
        } catch {
          res = { ok: false, code: "error", error: "Network error. Try again." };
        } finally {
          setBusy(false);
        }
        if (res.ok) {
          setPending(null);
          const msg = typeof o.success === "function" ? o.success(res.data) : o.success;
          const warnings = (res.data as { warnings?: string[] } | undefined)?.warnings ?? [];
          if (msg) toast.success(msg, o.undo ? { action: { label: "Undo", onClick: o.undo } } : undefined);
          for (const w of warnings.slice(0, 2)) toast.warning("Heads-up", { description: w, duration: 8000 });
          o.onOk?.(res.data);
          if (o.refresh !== false) router.refresh();
          return true;
        }
        if (res.code === "restricted") {
          const d = (res.details ?? {}) as { violations?: Violation[]; canOverride?: boolean };
          setPending({
            violations: d.violations ?? [{ title: "Restricted period", message: res.error, start: "", end: "", type: "" }],
            canOverride: !!d.canOverride,
            retry: async (r) => {
              await attempt(r);
            },
            cancel: () => {
              setPending(null);
              o.onFail?.();
            },
          });
          return false;
        }
        if (res.code === "conflict") {
          toast.error("Someone else changed this", { description: res.error, action: { label: "Reload", onClick: () => router.refresh() }, duration: 10000 });
          router.refresh();
        } else if (res.code === "unauthorized") {
          toast.error(res.error);
          router.push("/login");
        } else {
          toast.error(res.error);
        }
        o.onFail?.();
        return false;
      };
      return attempt();
    },
    [router],
  );

  const dialog = pending ? <RestrictionDialog pending={pending} busy={busy} /> : null;
  return { mutate, busy, dialog };
}

function RestrictionDialog({ pending, busy }: { pending: Pending; busy: boolean }) {
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && pending.cancel()}
      title="This date is restricted"
      footer={
        pending.canOverride && confirming ? (
          <>
            <Button variant="ghost" onClick={pending.cancel}>Cancel</Button>
            <Button variant="danger" loading={busy} disabled={reason.trim().length < 5} onClick={() => pending.retry(reason.trim())}>
              Override and schedule
            </Button>
          </>
        ) : (
          <>
            {pending.canOverride && (
              <Button variant="ghost" onClick={() => setConfirming(true)}>Override as Super Admin…</Button>
            )}
            <Button variant="primary" onClick={pending.cancel}>Choose another date</Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {pending.violations.map((v, i) => (
          <Callout key={i} tone="danger" icon={<ShieldAlert />} title={v.title}>
            {v.message}
          </Callout>
        ))}
        {!pending.canOverride && (
          <p className="text-[13px] text-ink-3">Only a Super Admin can make an exception.</p>
        )}
        {pending.canOverride && confirming && (
          <Field label="Reason for the exception" hint="Required. Recorded in the audit log.">
            <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Speaker only available this week" />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
