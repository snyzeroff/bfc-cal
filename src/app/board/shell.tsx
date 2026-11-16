"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import { CalendarDays, CheckSquare, ChevronsUpDown, ExternalLink, GraduationCap, LayoutDashboard, LogOut, Mic2, MoreHorizontal, Rss, Settings, Ticket, UserRound } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { Logo } from "@/components/logo";
import { ThemeMenuItems } from "@/components/theme-toggle";
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

const PROFILE_HREF = "/board/profile";

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
  const onProfile = active(PROFILE_HREF);
  const onSettings = active("/board/settings");
  const onAccount = onProfile;

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

  // One account menu, opened from the name (desktop) or the avatar (phone).
  const account = (
    <>
      <p className="max-w-[240px] truncate px-2.5 pb-1 pt-1.5 text-xs text-ink-3">{me.email}</p>
      <MenuItem icon={<UserRound />} checked={onProfile} onSelect={() => router.push(PROFILE_HREF)}>My profile</MenuItem>
      {me.isSuperAdmin && <MenuItem icon={<Settings />} checked={onSettings} onSelect={() => router.push("/board/settings")}>Settings</MenuItem>}
      <MenuItem icon={<Rss />} onSelect={() => router.push("/board/subscriptions")}>Subscriptions</MenuItem>
      <MenuSeparator />
      <MenuLabel>Theme</MenuLabel>
      <ThemeMenuItems />
      <MenuSeparator />
      <MenuItem icon={<LogOut />} danger onSelect={() => logoutAction()}>Sign out</MenuItem>
    </>
  );

  const more = [
    { href: "/board/subscriptions", label: "Subscriptions", icon: Rss },
    ...(me.isSuperAdmin ? [{ href: "/board/settings", label: "Settings", icon: Settings }] : []),
  ];

  return (
    <div className="flex min-h-dvh">
      <a href="#board-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-lg">Skip to content</a>
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-[224px] shrink-0 flex-col border-r border-line bg-surface px-3 py-4 lg:flex">
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
        <div className="mt-auto">
          <Menu
            side="top"
            align="start"
            fitTrigger
            trigger={
              <button className={cn("flex w-full items-center gap-2 rounded-xl border border-line bg-surface p-1.5 text-left transition-colors hover:bg-surface-2 data-[state=open]:bg-surface-2", onAccount && "bg-surface-2")}>
                <span aria-hidden className="flex shrink-0">
                  <Avatar name={me.name} size={30} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="sr-only">Account: </span>
                  <span className="block truncate text-[13px] font-medium leading-tight">{me.name}</span>
                  <span className="block truncate text-[11px] leading-tight text-ink-3">{ROLE_LABEL[me.role]}</span>
                </span>
                <ChevronsUpDown className="mr-1 h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
              </button>
            }
          >
            {account}
          </Menu>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="material sticky top-0 z-30 flex h-12 items-center gap-2 px-4 lg:hidden">
          <Logo shortName={shortName} size={24} />
          <span className="flex-1 truncate text-[13px] font-semibold">{orgName}</span>
          <Menu trigger={<button aria-label="Account" className={cn("rounded-full", onAccount && "ring-2 ring-brand-ink")}><Avatar name={me.name} size={28} /></button>}>
            {account}
          </Menu>
        </header>

        <main id="board-main" className="flex-1 px-4 pb-24 pt-5 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">{children}</main>

        {/* Mobile bottom navigation */}
        <nav className="material fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Board">
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
        active ? "bg-surface-2 text-ink [&_svg]:text-brand-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink [&_svg]:text-ink-3",
      )}
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {!!badge && <span className="rounded-full bg-warn-soft px-1.5 text-[11px] font-semibold tabular text-warn">{badge}</span>}
    </Link>
  );
}
