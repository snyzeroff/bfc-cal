"use client";

import { useState } from "react";
import { changeEmailAction, changePasswordAction, signOutOtherSessionsAction, updateNameAction } from "@/app/actions/profile";
import { useMutate, type MutateOptions } from "@/components/board/context";
import { Avatar, Button, Card, Field, Input } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";

type ProfileView = {
  name: string;
  email: string;
  roleLabel: string;
  roleDescription: string;
  memberSince: string;
  lastSignIn: string | null;
  activeSessions: number;
};

type Section = "name" | "email" | "password" | "sessions";

const NAME_MAX = 80;

export function ProfileForm({ profile, minPasswordLength }: { profile: ProfileView; minPasswordLength: number }) {
  const { mutate } = useMutate();
  const [saving, setSaving] = useState<Section | null>(null);
  const [name, setName] = useState(profile.name);
  const [email, setEmail] = useState(profile.email);
  const [emailPassword, setEmailPassword] = useState("");
  const [password, setPassword] = useState({ current: "", next: "", confirm: "" });

  /** Each section saves on its own; only its button shows progress. */
  async function save<T>(section: Section, fn: () => Promise<ActionResult<T>>, options: MutateOptions<T>) {
    setSaving(section);
    try {
      await mutate(fn, options);
    } finally {
      setSaving(null);
    }
  }
  const busy = saving !== null;

  const cleanName = name.trim();
  const nameReady = cleanName.length > 0 && cleanName !== profile.name;
  const cleanEmail = email.trim().toLowerCase();
  const emailReady = cleanEmail.length > 0 && cleanEmail !== profile.email && emailPassword.length > 0;
  const mismatch = password.confirm.length > 0 && password.confirm !== password.next;
  const passwordReady = password.current.length > 0 && password.next.length >= minPasswordLength && password.confirm === password.next;
  const sessions = Math.max(1, profile.activeSessions);

  return (
    <div className="flex flex-col gap-5">
      <Card className="p-5">
        <div className="flex items-center gap-4">
          <Avatar name={cleanName || profile.name} size={56} />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold leading-tight">{profile.name}</p>
            <p className="mt-0.5 truncate text-[13px] text-ink-3">{profile.email}</p>
          </div>
        </div>
        <form
          aria-label="Display name"
          className="mt-5 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (nameReady) save("name", () => updateNameAction({ name: cleanName }), { success: "Name saved", onOk: (d) => setName(d.name) });
          }}
        >
          <Field label="Display name" className="min-w-0 flex-1">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX} autoComplete="name" required />
          </Field>
          <Button type="submit" variant="primary" loading={saving === "name"} disabled={!nameReady || busy}>Save</Button>
        </form>
        <dl className="mt-5 grid gap-x-6 gap-y-4 border-t border-line pt-4 text-[13px] sm:grid-cols-2">
          <div className="sm:col-span-2">
            <dt className="text-xs text-ink-3">Role</dt>
            <dd className="mt-0.5 font-medium">{profile.roleLabel}</dd>
            <dd className="mt-0.5 text-ink-2">{profile.roleDescription}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">Member since</dt>
            <dd className="mt-0.5">{profile.memberSince}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">Last sign-in</dt>
            <dd className="mt-0.5">{profile.lastSignIn ?? "—"}</dd>
          </div>
        </dl>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold">Email</h2>
        <form
          aria-label="Change email"
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!emailReady) return;
            save("email", () => changeEmailAction({ email: cleanEmail, currentPassword: emailPassword }), {
              success: "Email changed",
              onOk: (d) => {
                setEmail(d.email);
                setEmailPassword("");
              },
            });
          }}
        >
          <Field label="Email" hint="You sign in with this address.">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} autoComplete="email" required />
          </Field>
          <Field label="Current password">
            <Input type="password" value={emailPassword} onChange={(e) => setEmailPassword(e.target.value)} maxLength={200} autoComplete="current-password" required />
          </Field>
          <div>
            <Button type="submit" variant="primary" loading={saving === "email"} disabled={!emailReady || busy}>Change email</Button>
          </div>
        </form>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold">Password</h2>
        <form
          aria-label="Change password"
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!passwordReady) return;
            save("password", () => changePasswordAction({ currentPassword: password.current, newPassword: password.next }), {
              success: (d) => (d.revokedSessions ? "Password changed. Your other devices were signed out." : "Password changed"),
              onOk: () => setPassword({ current: "", next: "", confirm: "" }),
            });
          }}
        >
          <Field label="Current password">
            <Input type="password" value={password.current} onChange={(e) => setPassword({ ...password, current: e.target.value })} maxLength={200} autoComplete="current-password" required />
          </Field>
          <Field label="New password" hint={`At least ${minPasswordLength} characters.`}>
            <Input type="password" value={password.next} onChange={(e) => setPassword({ ...password, next: e.target.value })} minLength={minPasswordLength} maxLength={200} autoComplete="new-password" required />
          </Field>
          <Field label="Confirm new password" error={mismatch ? "The two passwords do not match." : undefined}>
            <Input type="password" value={password.confirm} onChange={(e) => setPassword({ ...password, confirm: e.target.value })} maxLength={200} autoComplete="new-password" aria-invalid={mismatch || undefined} required />
          </Field>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button type="submit" variant="primary" loading={saving === "password"} disabled={!passwordReady || busy}>Change password</Button>
            <p className="text-xs text-ink-3">Signs you out of your other devices.</p>
          </div>
        </form>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold">Sessions</h2>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-ink-2">
            {sessions === 1 ? "1 active session: this device." : `${sessions} active sessions, including this device.`}
          </p>
          <Button
            variant="outline"
            loading={saving === "sessions"}
            disabled={sessions === 1 || busy}
            onClick={() => save("sessions", () => signOutOtherSessionsAction(), { success: "Your other devices were signed out" })}
          >
            Sign out of my other devices
          </Button>
        </div>
      </Card>
    </div>
  );
}
