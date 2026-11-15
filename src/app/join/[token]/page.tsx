import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { buttonClass } from "@/components/button-class";
import { Callout } from "@/components/ui";
import { getUser } from "@/lib/auth/session";
import { cn } from "@/lib/cn";
import { getSetting } from "@/lib/settings";
import { inspectSignupLink } from "@/lib/signup-links";
import { JoinForm } from "./join-form";

// The address carries a secret: keep it out of search engines and out of Referer headers.
export const metadata = { title: "Join the board", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [user, appearance, link] = await Promise.all([getUser(), getSetting("appearance"), inspectSignupLink(token)]);
  if (user) redirect("/board");
  if (!link) {
    return (
      <AuthShell title="Link expired">
        <div className="flex flex-col gap-4">
          <Callout tone="warn">This invitation link is no longer valid. Ask a Super Admin for a new one.</Callout>
          <Link href="/login" className={cn(buttonClass("secondary", "lg"), "h-12 w-full text-[15px]")}>Go to sign-in</Link>
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Join the board" subtitle={<>{appearance.orgName} · you join as <strong className="font-medium text-ink">{link.roleLabel}</strong></>}>
      <JoinForm token={token} />
    </AuthShell>
  );
}
