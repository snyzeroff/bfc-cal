"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptInviteAction } from "@/app/actions/auth";
import { Button, Callout, Field, Input } from "@/components/ui";

export function InviteForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="mt-8 flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const password = String(fd.get("password"));
        if (password !== String(fd.get("confirm"))) return setError("The two passwords do not match.");
        setError(null);
        start(async () => {
          const res = await acceptInviteAction({ token, password });
          if (!res.ok) return setError(res.error);
          router.replace("/board");
          router.refresh();
        });
      }}
    >
      {error && <Callout tone="danger">{error}</Callout>}
      <Field label="New password" hint="At least 10 characters.">
        <Input name="password" type="password" autoComplete="new-password" required minLength={10} className="h-11" autoFocus />
      </Field>
      <Field label="Confirm password">
        <Input name="confirm" type="password" autoComplete="new-password" required minLength={10} className="h-11" />
      </Field>
      <Button type="submit" variant="primary" size="lg" loading={pending} className="mt-2">
        Set password and continue
      </Button>
    </form>
  );
}
