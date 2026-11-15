"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import { CalendarDays, CheckSquare, ExternalLink, GraduationCap, LayoutDashboard, LogOut, Mic2, MoreHorizontal, Rss, Settings, Ticket } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui";
import type { Me } from "@/lib/board-types";
import { cn } from "@/lib/cn";
import { ROLE_LABEL } from "@/lib/permissions";

const NAV = [
  { href: "/board", label: "Overview", icon: LayoutDashboard, exact: true, key: "g o" },
  { href: "/board/calendar", label: "Calendar", icon: CalendarDays, key: "g c" },
  { href: "/board/events", label: "Conferences", icon: Ticket, key: "g e" },
  { href: "/board/speakers", label: "Speakers", icon: Mic2, key: "g s" },
  { href: "/board/tasks", label: "Tasks", icon: CheckSquare, key: "g t" },
  { href: "/board/academic", label: "Academic", icon: GraduationCap, key: "g a" },
] as const;

export function BoardShell({
  me,
  orgName,
  shortName,
  pendingReview,
  children,
}: {
  me: Me;
  orgName: string;
  shortName: string;
  pendingReview: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const active = (href: string, exact?: boolean) => (exact ? pathname === href : pathname.startsWith(href));

  useEffect(() => {
    if (params.get("denied")) {
      toast.error("You do not have access to that page.");
      router.replace(pathname);
    }
  }, [params, pathname, router]);

  // "g" then a letter jumps between sections, Linear-style.
  useEffect(() => {
    let armed = 0;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === "g") {
        armed = Date.now();
        return;
      }
      if (Date.now() - armed < 900) {
        const hit = NAV.find((n) => n.key.endsWith(e.key));
        if (hit) router.push(hit.href);
        armed = 0;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const more = [
    { href: "/board/subscriptions", label: "Subscriptions", icon: Rss },
    ...(me.isSuperAdmin ? [{ href: "/board/settings", label: "Settings", icon: Settings }] : []),
  ];

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-[224px] shrink-0 flex-col border-r border-line bg-surface-2/50 px-3 py-4 lg:flex">
        <Link href="/board" className="mb-5 flex items-center gap-2.5 rounded-lg px-2 py-1">
          <Logo shortName={shortName} />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold leading-tight">{shortName} Calendar</span>
            <span className="block truncate text-[11px] leading-tight text-ink-3">Board workspace</span>
          </span>
        </Link>
        <nav className="flex flex-col gap-0.5" aria-label="Board">
          {NAV.map((n) => (
            <NavLink key={n.href} href={n.href} active={active(n.href, "exact" in n && n.exact)} icon={<n.icon />} badge={n.href === "/board/academic" && me.isAdmin ? pendingReview : 0}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <p className="mb-1 mt-6 px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">Workspace</p>
        <nav className="flex flex-col gap-0.5" aria-label="Workspace">
          {more.map((n) => (
            <NavLink key={n.href} href={n.href} active={active(n.href)} icon={<n.icon />}>
              {n.label}
            </NavLink>
          ))}
          <NavLink href="/" icon={<ExternalLink />} external>
            Members calendar
          </NavLink>
        </nav>
        <div className="mt-auto flex items-center gap-2 rounded-xl border border-line bg-surface p-2">
          <Avatar name={me.name} size={30} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium leading-tight">{me.name}</p>
            <p className="truncate text-[11px] leading-tight text-ink-3">{ROLE_LABEL[me.role]}</p>
          </div>
          <ThemeToggle />
          <form action={logoutAction}>
            <button aria-label="Sign out" title="Sign out" className="grid h-8 w-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink">
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-line bg-bg/90 px-4 backdrop-blur lg:hidden">
          <Logo shortName={shortName} size={24} />
          <span className="flex-1 truncate text-[13px] font-semibold">{orgName}</span>
          <ThemeToggle />
          <Menu trigger={<button aria-label="Account"><Avatar name={me.name} size={28} /></button>}>
            <MenuLabel>{me.name} · {ROLE_LABEL[me.role]}</MenuLabel>
            <MenuItem icon={<ExternalLink />} onSelect={() => router.push("/")}>Members calendar</MenuItem>
            <MenuSeparator />
            <MenuItem icon={<LogOut />} onSelect={() => logoutAction()}>Sign out</MenuItem>
          </Menu>
        </header>

        <main className="flex-1 px-4 pb-24 pt-5 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">{children}</main>

        {/* Mobile bottom navigation */}
        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Board">
          {NAV.slice(0, 4).map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n.href, "exact" in n && n.exact) ? "page" : undefined} className={cn("flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium", active(n.href, "exact" in n && n.exact) ? "text-brand-ink" : "text-ink-3")}>
              <n.icon className="h-5 w-5" />
              {n.label}
            </Link>
          ))}
          <Menu
            align="end"
            trigger={
              <button className={cn("flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium", [...NAV.slice(4), ...more].some((n) => active(n.href)) ? "text-brand-ink" : "text-ink-3")}>
                <MoreHorizontal className="h-5 w-5" />
                More
              </button>
            }
          >
            {[...NAV.slice(4), ...more].map((n) => (
              <MenuItem key={n.href} icon={<n.icon />} onSelect={() => router.push(n.href)} hint={n.href === "/board/academic" && pendingReview && me.isAdmin ? `${pendingReview} to review` : undefined}>
                {n.label}
              </MenuItem>
            ))}
          </Menu>
        </nav>
      </div>
    </div>
  );
}

function NavLink({ href, active, icon, children, badge, external }: { href: string; active?: boolean; icon: React.ReactNode; children: React.ReactNode; badge?: number; external?: boolean }) {
  return (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors [&_svg]:h-4 [&_svg]:w-4",
        active ? "bg-surface text-ink shadow-sm ring-1 ring-line [&_svg]:text-brand-ink" : "text-ink-2 hover:bg-surface-3/60 hover:text-ink [&_svg]:text-ink-3",
      )}
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {!!badge && <span className="rounded-full bg-warn-soft px-1.5 text-[11px] font-semibold tabular text-warn">{badge}</span>}
    </Link>
  );
}
