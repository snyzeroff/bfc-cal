"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { Check, ListChecks, Plus, Trash2 } from "lucide-react";
import { createTaskAction, deleteTaskAction, toggleTaskAction, updateTaskAction } from "@/app/actions/tasks";
import { Avatar, Button, EmptyState, Input, Select } from "@/components/ui";
import type { BoardTask, BoardUser } from "@/lib/board-types";
import { cn } from "@/lib/cn";
import { diffDays, formatIsoDay, relativeDays, todayParis } from "@/lib/time";
import { useBoard, useMutate } from "./context";

export function dueTone(dueDate: string | null, done: boolean) {
  if (!dueDate || done) return "text-ink-3";
  const n = diffDays(todayParis(), dueDate);
  return n < 0 ? "text-danger font-medium" : n <= 2 ? "text-warn font-medium" : "text-ink-3";
}

export function TaskList({
  tasks,
  users,
  eventId,
  canAdd,
  showEvent,
  anchorDate,
  emptyText,
}: {
  tasks: BoardTask[];
  users: BoardUser[];
  eventId?: string;
  canAdd: boolean;
  showEvent?: boolean;
  /** Event day, shown as context next to deadlines. */
  anchorDate?: string;
  emptyText?: string;
}) {
  const { me } = useBoard();
  const { mutate, busy, dialog } = useMutate();
  const [, start] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(tasks, (state, patch: { id: string; done: boolean }) => state.map((t) => (t.id === patch.id ? { ...t, done: patch.done } : t)));
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [assignee, setAssignee] = useState(me.isAdmin ? "" : me.id);
  const done = optimistic.filter((t) => t.done).length;
  const mayEdit = (t: BoardTask) => me.isAdmin || t.assigneeId === me.id || t.createdBy === me.id;
  const sorted = [...optimistic].sort((a, b) => Number(a.done) - Number(b.done) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));

  const toggle = (t: BoardTask) =>
    start(async () => {
      setOptimistic({ id: t.id, done: !t.done });
      await mutate(() => toggleTaskAction(t.id, !t.done));
    });

  return (
    <div className="flex flex-col gap-4">
      {optimistic.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={optimistic.length} aria-valuenow={done} aria-label="Preparation progress">
            <div className="h-full rounded-full bg-ok transition-[width] duration-300" style={{ width: `${(done / optimistic.length) * 100}%` }} />
          </div>
          <span className="text-xs tabular text-ink-3">{done}/{optimistic.length} done</span>
        </div>
      )}

      {optimistic.length === 0 ? (
        <EmptyState icon={<ListChecks className="h-5 w-5" />} title="No tasks yet">
          {emptyText ?? "Break the preparation into small steps with an owner and a deadline. Deadlines appear on the board calendar only."}
        </EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
          {sorted.map((t) => {
            const user = users.find((u) => u.id === t.assigneeId);
            const editable = mayEdit(t);
            return (
              <li key={t.id} className="group flex items-start gap-3 px-3.5 py-2.5">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={t.done}
                  aria-label={`${t.done ? "Reopen" : "Complete"} “${t.title}”`}
                  disabled={!editable && t.assigneeId !== null}
                  onClick={() => toggle(t)}
                  className={cn("mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border transition-colors disabled:opacity-40", t.done ? "border-ok bg-ok text-white" : "border-line-strong hover:border-ok")}
                >
                  {t.done && <Check className="h-3 w-3" strokeWidth={3} />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-[13px]", t.done && "text-ink-3 line-through")}>{t.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
                    {showEvent && t.eventId && <Link href={`/board/events/${t.eventId}?tab=tasks`} className="max-w-[220px] truncate underline-offset-2 hover:text-ink hover:underline">{t.eventTitle}</Link>}
                    {t.dueDate && (
                      <span className={dueTone(t.dueDate, t.done)}>
                        Due {formatIsoDay(t.dueDate)}{!t.done && ` · ${relativeDays(t.dueDate)}`}
                        {anchorDate && !t.done && ` · D${diffDays(anchorDate, t.dueDate) >= 0 ? "+" : ""}${diffDays(anchorDate, t.dueDate)}`}
                      </span>
                    )}
                    {!t.dueDate && !t.done && <span>No deadline</span>}
                  </p>
                </div>
                {editable && me.isAdmin ? (
                  <Select aria-label="Assignee" value={t.assigneeId ?? ""} onChange={(e) => mutate(() => updateTaskAction(t.id, { assigneeId: e.target.value || null }))} className="h-7 w-[132px] text-xs">
                    <option value="">Unassigned</option>
                    {users.filter((u) => u.active || u.id === t.assigneeId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </Select>
                ) : user ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-ink-2"><Avatar name={user.name} size={20} /><span className="hidden sm:inline">{user.name.split(" ")[0]}</span></span>
                ) : (
                  <span className="text-xs text-ink-3">Unassigned</span>
                )}
                {(me.isAdmin || t.createdBy === me.id) && (
                  <button aria-label={`Delete “${t.title}”`} onClick={() => confirm(`Delete the task “${t.title}”?`) && mutate(() => deleteTaskAction(t.id), { success: "Task deleted" })} className="grid h-7 w-7 place-items-center rounded-md text-ink-3 opacity-0 hover:bg-danger-soft hover:text-danger focus:opacity-100 group-hover:opacity-100 max-sm:opacity-100">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canAdd && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            mutate(() => createTaskAction({ eventId: eventId ?? null, title, dueDate: due || null, assigneeId: assignee || null }), {
              onOk: () => {
                setTitle("");
                setDue("");
              },
            });
          }}
        >
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task…" aria-label="New task" className="min-w-[180px] flex-1" maxLength={200} />
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Deadline" className="w-[150px]" />
          {me.isAdmin && (
            <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Assign to" className="w-[150px]">
              <option value="">Unassigned</option>
              {users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.id === me.id ? "Me" : u.name}</option>)}
            </Select>
          )}
          <Button type="submit" variant="outline" disabled={!title.trim()} loading={busy}><Plus className="h-4 w-4" /> Add</Button>
        </form>
      )}
      {dialog}
    </div>
  );
}
