"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loginAction } from "@/app/actions/auth";
import { authButton, authInput } from "@/components/auth-shell";
import { Button, Callout, Field, Input } from "@/components/ui";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const res = await loginAction({ email: String(fd.get("email")), password: String(fd.get("password")) });
          if (!res.ok) return setError(res.error);
          router.replace(next);
          router.refresh();
        });
      }}
    >
      {error && <Callout tone="danger">{error}</Callout>}
      <Field label="Email">
        <Input name="email" type="email" autoComplete="username" spellCheck={false} required autoFocus placeholder="you@student-cs.fr" className={authInput} />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required className={authInput} />
      </Field>
      <Button type="submit" variant="primary" size="lg" loading={pending} className={authButton}>
        Sign in
      </Button>
    </form>
  );
}
