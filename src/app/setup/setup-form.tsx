"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setupAction } from "@/app/actions/auth";
import { authButton, authInput } from "@/components/auth-shell";
import { Button, Callout, Field, Input } from "@/components/ui";

export function SetupForm({ needsCode }: { needsCode: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const password = String(fd.get("password"));
        if (password !== String(fd.get("confirm"))) return setError("The two passwords do not match.");
        setError(null);
        start(async () => {
          const res = await setupAction({ name: String(fd.get("name")), email: String(fd.get("email")), password, setupToken: String(fd.get("setupToken") ?? "") });
          if (!res.ok) return setError(res.error);
          router.replace("/board");
          router.refresh();
        });
      }}
    >
      {error && <Callout tone="danger">{error}</Callout>}
      {needsCode && (
        <Field label="Setup code" hint="The SETUP_TOKEN value of this deployment.">
          <Input name="setupToken" type="password" autoComplete="off" required className={authInput} />
        </Field>
      )}
      <Field label="Your name">
        <Input name="name" autoComplete="name" required autoFocus className={authInput} maxLength={80} />
      </Field>
      <Field label="Email">
        <Input name="email" type="email" autoComplete="username" spellCheck={false} required className={authInput} />
      </Field>
      <Field label="Password" hint="At least 10 characters.">
        <Input name="password" type="password" autoComplete="new-password" required minLength={10} className={authInput} />
      </Field>
      <Field label="Confirm password">
        <Input name="confirm" type="password" autoComplete="new-password" required minLength={10} className={authInput} />
      </Field>
      <Button type="submit" variant="primary" size="lg" loading={pending} className={authButton}>
        Create account
      </Button>
    </form>
  );
}
