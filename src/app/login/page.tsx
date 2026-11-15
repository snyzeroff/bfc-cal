import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/logo";
import { getUser } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";
import { LoginForm } from "./login-form";

export const metadata = { title: "Board sign-in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const [user, appearance, sp] = await Promise.all([getUser(), getSetting("appearance"), searchParams]);
  const next = sp.next && sp.next.startsWith("/board") ? sp.next : "/board";
  if (user) redirect(next);
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-brand-deep p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "repeating-linear-gradient(90deg,#fff 0 1px,transparent 1px 96px),repeating-linear-gradient(0deg,#fff 0 1px,transparent 1px 96px)" }} aria-hidden />
        <div className="relative flex items-center gap-3">
          <Logo shortName={appearance.shortName} size={34} className="bg-white/12 shadow-none ring-1 ring-white/25" />
          <span className="text-sm font-medium tracking-wide text-white/85">{appearance.orgName}</span>
        </div>
        <div className="relative">
          <p className="font-display text-[56px] leading-[1.02] tracking-[-0.015em]">
            Plan every conference<br />
            <span className="italic text-white/70">around the academic year.</span>
          </p>
          <p className="mt-6 max-w-md text-[15px] leading-relaxed text-white/65">
            The board workspace: tentative dates, speaker follow-up, exam periods, the Victoriales restriction and one calendar your members can subscribe to.
          </p>
        </div>
        <p className="relative text-xs text-white/45">CentraleSupélec · Europe/Paris</p>
      </section>
      <section className="flex flex-col px-6 py-8 sm:px-12">
        <Link href="/" className="inline-flex items-center gap-1.5 self-start text-[13px] text-ink-3 hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> Members calendar
        </Link>
        <div className="m-auto w-full max-w-sm py-10">
          <Logo shortName={appearance.shortName} size={40} className="lg:hidden" />
          <h1 className="mt-5 font-display text-4xl leading-tight lg:mt-0">Board sign-in</h1>
          <p className="mt-2 text-[13px] text-ink-3">For {appearance.shortName} board members. Accounts are created by a Super Admin.</p>
          <LoginForm next={next} />
          <p className="mt-8 text-xs leading-relaxed text-ink-3">
            Forgot your password? Ask a Super Admin for a new sign-in link.<br />
            Members do not need an account — the <Link href="/" className="underline underline-offset-2 hover:text-ink">public calendar</Link> is open to everyone.
          </p>
        </div>
      </section>
    </main>
  );
}
