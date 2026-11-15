"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setupAction } from "@/app/actions/auth";
import { Button, Callout, Field, Input } from "@/components/ui";

export function SetupForm() {
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
          const res = await setupAction({ name: String(fd.get("name")), email: String(fd.get("email")), password });
          if (!res.ok) return setError(res.error);
          router.replace("/board");
          router.refresh();
        });
      }}
    >
      {error && <Callout tone="danger">{error}</Callout>}
      <Field label="Your name">
        <Input name="name" autoComplete="name" required autoFocus className="h-11" maxLength={80} />
      </Field>
      <Field label="Email">
        <Input name="email" type="email" autoComplete="username" spellCheck={false} required className="h-11" />
      </Field>
      <Field label="Password" hint="At least 10 characters.">
        <Input name="password" type="password" autoComplete="new-password" required minLength={10} className="h-11" />
      </Field>
      <Field label="Confirm password">
        <Input name="confirm" type="password" autoComplete="new-password" required minLength={10} className="h-11" />
      </Field>
      <Button type="submit" variant="primary" size="lg" loading={pending} className="mt-2">
        Create account and open the board
      </Button>
    </form>
  );
}
