import { and, eq, gt, isNull } from "drizzle-orm";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { buttonClass } from "@/components/button-class";
import { Callout } from "@/components/ui";
import { db } from "@/db";
import { inviteTokens, users } from "@/db/schema";
import { hashToken } from "@/lib/auth/crypto";
import { cn } from "@/lib/cn";
import { InviteForm } from "./invite-form";

export const metadata = { title: "Set your password", robots: { index: false } };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [row] = await db
    .select({ name: users.name, email: users.email, active: users.active })
    .from(inviteTokens)
    .innerJoin(users, eq(users.id, inviteTokens.userId))
    .where(and(eq(inviteTokens.tokenHash, hashToken(token)), isNull(inviteTokens.usedAt), gt(inviteTokens.expiresAt, new Date())));
  if (!row || !row.active) {
    return (
      <AuthShell title="Link expired">
        <div className="flex flex-col gap-4">
          <Callout tone="warn">Expired or already used. Ask a Super Admin for a new link.</Callout>
          <Link href="/login" className={cn(buttonClass("secondary", "lg"), "h-12 w-full text-[15px]")}>Go to sign-in</Link>
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell title={`Welcome, ${row.name.split(" ")[0]}`} subtitle={row.email}>
      <InviteForm token={token} />
    </AuthShell>
  );
}
