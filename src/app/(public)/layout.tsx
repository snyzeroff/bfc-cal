import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { getUser } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const [appearance, user] = await Promise.all([getSetting("appearance"), getUser()]);
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-lg">Skip to content</a>
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <Logo shortName={appearance.shortName} />
            <span className="truncate text-sm font-semibold">{appearance.orgName}</span>
          </Link>
          <nav className="ml-auto flex items-center gap-1 text-[13px] font-medium" aria-label="Main">
            <Link href="/" className="hidden rounded-lg px-3 py-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink sm:block">Calendar</Link>
            <Link href="/subscribe" className="rounded-lg px-3 py-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink">Subscribe</Link>
            <ThemeToggle />
            <Link href={user ? "/board" : "/login"} className="ml-1 rounded-lg border border-line-strong px-3 py-1.5 text-ink hover:bg-surface-2">{user ? "Board" : "Board sign-in"}</Link>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-ink-3 sm:px-6">
          <span>{appearance.orgName} · CentraleSupélec</span>
          <span>All times are Paris time (Europe/Paris)</span>
        </div>
      </footer>
    </div>
  );
}
