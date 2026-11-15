import Link from "next/link";
import { ArrowRight, CalendarDays, CircleDashed, GraduationCap, ListChecks, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import { DashboardActions } from "@/components/board/dashboard-actions";
import { StatusBadge, VisibilityBadge } from "@/components/board/status";
import { TaskList } from "@/components/board/task-list";
import { Card, EmptyState, SectionTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { countPendingCandidates, loadCalendarData } from "@/lib/board-data";
import { diffDays, formatIsoDay, formatIsoRange, formatRange, relativeDays, wallToInstant } from "@/lib/time";

export const metadata = { title: "Overview" };

export default async function Dashboard() {
  const user = await requireUser();
  const [data, pending] = await Promise.all([loadCalendarData(user), countPendingCandidates()]);
  const today = data.today;
  const upcoming = data.events.filter((e) => e.start && e.start.slice(0, 10) >= today && !["cancelled", "postponed", "completed"].includes(e.status));
  const planning = data.events.filter((e) => ["idea", "proposed", "awaiting_confirmation", "tentative"].includes(e.status));
  const awaiting = data.events.filter((e) => e.status === "awaiting_confirmation" || (e.activeProposals > 0 && !e.start));
  const myTasks = data.tasks.filter((t) => t.assigneeId === user.id && !t.done);
  const overdue = data.tasks.filter((t) => !t.done && t.dueDate && t.dueDate < today);
  const violating = data.events.filter((e) => e.violation && !e.overrideReason);
  const readyToPublish = data.events.filter((e) => e.status === "confirmed" && !e.isPublic && e.kind === "conference" && e.start && e.start.slice(0, 10) >= today);
  const upcomingWindows = data.windows.filter((w) => w.severity === "hard" && w.end >= today).slice(0, 4);
  const hasExams = data.academic.some((a) => a.kind === "exam");

  const attention: { key: string; icon: React.ReactNode; tone: string; text: React.ReactNode; href: string }[] = [
    ...violating.map((e) => ({ key: `v${e.id}`, icon: <ShieldAlert />, tone: "text-danger", text: <><strong className="font-medium">{e.title}</strong> is scheduled inside a restricted period.</>, href: `/board/events/${e.id}` })),
    ...(overdue.length ? [{ key: "overdue", icon: <TriangleAlert />, tone: "text-warn", text: <>{overdue.length} task{overdue.length > 1 ? "s are" : " is"} past the deadline.</>, href: "/board/tasks" }] : []),
    ...(user.role !== "board_member" ? readyToPublish.map((e) => ({ key: `p${e.id}`, icon: <CalendarDays />, tone: "text-info", text: <><strong className="font-medium">{e.title}</strong> is confirmed but not published yet.</>, href: `/board/events/${e.id}` })) : []),
    ...(pending && user.role !== "board_member" ? [{ key: "review", icon: <GraduationCap />, tone: "text-warn", text: <>{pending} imported academic period{pending > 1 ? "s" : ""} awaiting review.</>, href: "/board/academic" }] : []),
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs text-ink-3">{formatIsoDay(today, true)}</p>
          <h1 className="font-display text-[38px] leading-[1.05] tracking-[-0.01em]">Hello, {user.name.split(" ")[0]}</h1>
        </div>
        <DashboardActions categories={data.categories} speakers={data.speakers} windows={data.windows} templates={data.templates} />
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Upcoming events" value={upcoming.length} hint={`${upcoming.filter((e) => e.isPublic).length} public`} href="/board/calendar" />
        <Stat label="In planning" value={planning.length} hint="ideas, proposals, tentative" href="/board/events" />
        <Stat label="Awaiting an answer" value={awaiting.length} hint="dates on hold" href="/board/events" />
        <Stat label="My open tasks" value={myTasks.length} hint={myTasks.some((t) => t.dueDate && t.dueDate < today) ? "some overdue" : "assigned to me"} href="/board/tasks" alert={myTasks.some((t) => t.dueDate && t.dueDate < today)} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="flex flex-col gap-6">
          {attention.length > 0 && (
            <section>
              <SectionTitle>Needs attention</SectionTitle>
              <Card className="divide-y divide-line">
                {attention.slice(0, 6).map((a) => (
                  <Link key={a.key} href={a.href} className="group flex items-center gap-3 px-4 py-3 text-[13px] hover:bg-surface-2">
                    <span className={`${a.tone} [&_svg]:h-4 [&_svg]:w-4`}>{a.icon}</span>
                    <span className="min-w-0 flex-1">{a.text}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-ink-3 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                ))}
              </Card>
            </section>
          )}

          <section>
            <SectionTitle action={<Link href="/board/calendar" className="text-xs text-ink-3 hover:text-ink">Open calendar</Link>}>Next up</SectionTitle>
            {upcoming.length === 0 ? (
              <EmptyState icon={<CalendarDays className="h-5 w-5" />} title="Nothing scheduled">Confirmed and tentative events with a date will appear here.</EmptyState>
            ) : (
              <Card className="divide-y divide-line">
                {upcoming.slice(0, 6).map((e) => (
                  <Link key={e.id} href={`/board/events/${e.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-surface-2">
                    <div className="w-11 shrink-0 text-center">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-ink">{formatIsoDay(e.start!.slice(0, 10)).split(" ")[2]}</p>
                      <p className="font-display text-2xl leading-none">{Number(e.start!.slice(8, 10))}</p>
                    </div>
                    <span className="h-9 w-[3px] shrink-0 rounded-full" style={{ background: e.color }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{e.title}</p>
                      <p className="truncate text-xs text-ink-3">
                        {formatRange(wallToInstant(e.start!), e.end ? wallToInstant(e.end) : null, e.allDay).split(", ").slice(-1)[0]} · {relativeDays(e.start!.slice(0, 10), today)}
                        {e.speakerName ? ` · ${e.speakerName}` : ""}
                      </p>
                    </div>
                    <div className="hidden items-center gap-1.5 sm:flex">
                      <StatusBadge status={e.status} />
                      {e.isPublic && <VisibilityBadge isPublic />}
                    </div>
                  </Link>
                ))}
              </Card>
            )}
          </section>

          {awaiting.length > 0 && (
            <section>
              <SectionTitle>Waiting for a date</SectionTitle>
              <Card className="divide-y divide-line">
                {awaiting.slice(0, 5).map((e) => (
                  <Link key={e.id} href={`/board/events/${e.id}?tab=dates`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                    <CircleDashed className="h-4 w-4 shrink-0 text-ink-3" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{e.title}</p>
                      <p className="text-xs text-ink-3">{e.activeProposals} proposed date{e.activeProposals === 1 ? "" : "s"}{e.speakerName ? ` · ${e.speakerName}` : ""}</p>
                    </div>
                    <StatusBadge status={e.status} />
                  </Link>
                ))}
              </Card>
            </section>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <section>
            <SectionTitle>Restricted periods</SectionTitle>
            <Card className="overflow-hidden">
              {upcomingWindows.length > 0 ? (
                <ul className="divide-y divide-line">
                  {upcomingWindows.map((w) => {
                    const active = today >= w.start && today <= w.end;
                    return (
                      <li key={w.key} className={active ? "hatch-danger px-4 py-3" : "px-4 py-3"}>
                        <p className="flex items-center gap-2 text-[13px] font-semibold text-danger"><ShieldAlert className="h-4 w-4 shrink-0" /> {formatIsoRange(w.start, w.end)}</p>
                        <p className="mt-0.5 text-xs text-ink-2">{w.title}{active ? ` — in effect, ${diffDays(today, w.end) + 1} day(s) left` : ` — starts ${relativeDays(w.start, today)}`}</p>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="flex gap-3 px-4 py-4 text-[13px]">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
                  <p className="text-ink-2">
                    {hasExams ? (
                      "No restricted period ahead."
                    ) : (
                      <>
                        <span className="font-medium text-ink">No exam dates approved yet.</span> Conferences are closed during the 21 days before exams; this needs the academic calendars.
                        {user.role !== "board_member" && <Link href="/board/academic" className="ml-1 text-brand-ink underline underline-offset-2">Import them</Link>}
                      </>
                    )}
                  </p>
                </div>
              )}
            </Card>
          </section>

          <section>
            <SectionTitle action={<Link href="/board/tasks" className="text-xs text-ink-3 hover:text-ink">All tasks</Link>}>My tasks</SectionTitle>
            {myTasks.length === 0 ? (
              <EmptyState icon={<ListChecks className="h-5 w-5" />} title="You are all caught up">Tasks assigned to you will show up here.</EmptyState>
            ) : (
              <TaskList tasks={myTasks.slice(0, 6)} users={data.users} canAdd={false} showEvent />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint, href, alert }: { label: string; value: number; hint: string; href: string; alert?: boolean }) {
  return (
    <Link href={href} className="group rounded-xl border border-line bg-surface p-4 shadow-sm transition-colors hover:border-line-strong">
      <p className="text-xs text-ink-3">{label}</p>
      <p className="mt-1 font-display text-[40px] leading-none tabular">{value}</p>
      <p className={`mt-1.5 text-xs ${alert ? "font-medium text-danger" : "text-ink-3"}`}>{hint}</p>
    </Link>
  );
}
