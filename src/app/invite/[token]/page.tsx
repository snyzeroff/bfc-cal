import { and, eq, gt, isNull } from "drizzle-orm";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { Callout } from "@/components/ui";
import { db } from "@/db";
import { inviteTokens, users } from "@/db/schema";
import { hashToken } from "@/lib/auth/crypto";
import { ROLE_LABEL } from "@/lib/permissions";
import { getSetting } from "@/lib/settings";
import { InviteForm } from "./invite-form";

export const metadata = { title: "Set your password", robots: { index: false } };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const appearance = await getSetting("appearance");
  const [row] = await db
    .select({ name: users.name, email: users.email, role: users.role, active: users.active })
    .from(inviteTokens)
    .innerJoin(users, eq(users.id, inviteTokens.userId))
    .where(and(eq(inviteTokens.tokenHash, hashToken(token)), isNull(inviteTokens.usedAt), gt(inviteTokens.expiresAt, new Date())));
  return (
    <main className="grid min-h-dvh place-items-center px-6 py-10">
      <div className="w-full max-w-sm">
        <Logo shortName={appearance.shortName} size={40} />
        {row && row.active ? (
          <>
            <h1 className="mt-5 font-display text-4xl leading-tight">Welcome, {row.name.split(" ")[0]}</h1>
            <p className="mt-2 text-[13px] text-ink-3">
              You were invited to the {appearance.shortName} board workspace as <strong className="font-medium text-ink">{ROLE_LABEL[row.role]}</strong>. Choose a password for <span className="text-ink">{row.email}</span>.
            </p>
            <InviteForm token={token} />
          </>
        ) : (
          <>
            <h1 className="mt-5 font-display text-4xl leading-tight">Link expired</h1>
            <Callout tone="warn" className="mt-4">
              This link has expired or was already used. Ask a Super Admin to send you a new one.
            </Callout>
            <Link href="/login" className="mt-6 inline-block text-[13px] text-ink-3 underline underline-offset-2 hover:text-ink">Go to sign-in</Link>
          </>
        )}
      </div>
    </main>
  );
}
