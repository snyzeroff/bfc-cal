import { TasksBoard } from "@/components/board/tasks-board";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { loadCalendarData } from "@/lib/board-data";

export const metadata = { title: "Tasks" };

export default async function TasksPage() {
  const user = await requireUser();
  const data = await loadCalendarData(user);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Tasks" description="Preparation steps and internal deadlines. They show on the board calendar and in private subscriptions — never publicly." />
      <TasksBoard tasks={data.tasks} users={data.users} />
    </div>
  );
}
