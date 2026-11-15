"use client";

import { useMemo, useState } from "react";
import { Segmented, Select } from "@/components/ui";
import type { BoardTask, BoardUser } from "@/lib/board-types";
import { todayParis } from "@/lib/time";
import { useBoard } from "./context";
import { TaskList } from "./task-list";

export function TasksBoard({ tasks, users }: { tasks: BoardTask[]; users: BoardUser[] }) {
  const { me } = useBoard();
  const [scope, setScope] = useState<"mine" | "all" | "done">("mine");
  const [assignee, setAssignee] = useState("");
  const today = todayParis();

  const filtered = useMemo(
    () =>
      tasks.filter((t) => {
        if (scope === "done") return t.done;
        if (t.done) return false;
        if (scope === "mine") return t.assigneeId === me.id;
        return !assignee || (assignee === "none" ? !t.assigneeId : t.assigneeId === assignee);
      }),
    [tasks, scope, assignee, me.id],
  );

  const groups: { title: string; items: BoardTask[] }[] =
    scope === "done"
      ? [{ title: "Completed", items: filtered }]
      : [
          { title: "Overdue", items: filtered.filter((t) => t.dueDate && t.dueDate < today) },
          { title: "This week", items: filtered.filter((t) => t.dueDate && t.dueDate >= today && t.dueDate <= addWeek(today)) },
          { title: "Later", items: filtered.filter((t) => t.dueDate && t.dueDate > addWeek(today)) },
          { title: "No deadline", items: filtered.filter((t) => !t.dueDate) },
        ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Scope" value={scope} onChange={setScope} options={[{ value: "mine", label: "Assigned to me" }, { value: "all", label: "Everyone" }, { value: "done", label: "Completed" }]} />
        {scope === "all" && (
          <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Assignee" className="w-[170px]">
            <option value="">Any assignee</option>
            <option value="none">Unassigned</option>
            {users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        )}
      </div>
      {groups.filter((g) => g.items.length > 0).map((g) => (
        <section key={g.title}>
          <h2 className={`mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] ${g.title === "Overdue" ? "text-danger" : "text-ink-3"}`}>{g.title} · {g.items.length}</h2>
          <TaskList tasks={g.items} users={users} canAdd={false} showEvent />
        </section>
      ))}
      <section>
        {filtered.length === 0 && scope !== "done" && <p className="mb-4 rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-[13px] text-ink-3">{scope === "mine" ? "Nothing assigned to you." : "No open tasks."}</p>}
        {scope !== "done" && (
          <>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">Add a general task</h2>
            <p className="mb-2 text-xs text-ink-3">Conference tasks go in the conference’s Tasks tab.</p>
            <TaskListAdder users={users} />
          </>
        )}
      </section>
    </div>
  );
}

const addWeek = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);

/** Reuses the TaskList add form without rendering a list. */
function TaskListAdder({ users }: { users: BoardUser[] }) {
  return <div className="[&>div>div:first-child]:hidden"><TaskList tasks={[]} users={users} canAdd /></div>;
}
