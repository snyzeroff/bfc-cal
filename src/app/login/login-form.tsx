"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loginAction } from "@/app/actions/auth";
import { Button, Callout, Field, Input } from "@/components/ui";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="mt-8 flex flex-col gap-4"
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
        <Input name="email" type="email" autoComplete="username" required autoFocus placeholder="you@student-cs.fr" className="h-11" />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required className="h-11" />
      </Field>
      <Button type="submit" variant="primary" size="lg" loading={pending} className="mt-2">
        Sign in
      </Button>
    </form>
  );
}
