"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { eventOrganizers, events, tasks } from "@/db/schema";
import { run } from "@/lib/action";
import { audit } from "@/lib/audit";
import { requireActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { canAssignTasks, canEditEvent, canEditTask, isAdmin } from "@/lib/permissions";
import { isValidDateIso } from "@/lib/time";

const id = z.string().uuid();
const taskSchema = z.object({
  eventId: id.nullable().default(null),
  title: z.string().trim().min(1, "A title is required").max(200),
  notes: z.string().max(2000).default(""),
  dueDate: z.string().refine(isValidDateIso, "Invalid date").nullable().default(null),
  assigneeId: id.nullable().default(null),
});

export async function createTaskAction(input: z.input<typeof taskSchema>) {
  return run(async () => {
    const actor = await requireActor();
    const t = taskSchema.parse(input);
    if (t.assigneeId && t.assigneeId !== actor.id && !canAssignTasks(actor)) {
      throw new AppError("forbidden", "Only a Board Admin can assign tasks to other people.");
    }
    if (t.eventId && !isAdmin(actor)) {
      const [ev] = await db.select().from(events).where(eq(events.id, t.eventId));
      if (!ev) throw new AppError("not_found", "This event no longer exists.");
      const orgs = await db.select().from(eventOrganizers).where(eq(eventOrganizers.eventId, t.eventId));
      if (!canEditEvent(actor, { createdBy: ev.createdBy, organizerIds: orgs.map((o) => o.userId) })) {
        throw new AppError("forbidden", "You can only add tasks to events you organise.");
      }
    }
    const [row] = await db.insert(tasks).values({ ...t, createdBy: actor.id }).returning();
    await audit({ actor, action: "task.create", entityType: "task", entityId: row.id, summary: `Added task “${row.title}”` });
    return { id: row.id };
  });
}

export async function updateTaskAction(taskId: string, input: Partial<z.input<typeof taskSchema>>) {
  return run(async () => {
    const actor = await requireActor();
    const patch = taskSchema.partial().parse(input);
    const [task] = await db.select().from(tasks).where(eq(tasks.id, id.parse(taskId)));
    if (!task) throw new AppError("not_found", "This task no longer exists.");
    if (!canEditTask(actor, task)) throw new AppError("forbidden", "You can only edit tasks assigned to you.");
    if (patch.assigneeId !== undefined && patch.assigneeId !== task.assigneeId && patch.assigneeId !== actor.id && !canAssignTasks(actor)) {
      throw new AppError("forbidden", "Only a Board Admin can assign tasks to other people.");
    }
    delete patch.eventId;
    await db.update(tasks).set({ ...patch, updatedAt: new Date() }).where(eq(tasks.id, task.id));
    return undefined;
  });
}

export async function toggleTaskAction(taskId: string, done: boolean) {
  return run(async () => {
    const actor = await requireActor();
    const [task] = await db.select().from(tasks).where(eq(tasks.id, id.parse(taskId)));
    if (!task) throw new AppError("not_found", "This task no longer exists.");
    if (!canEditTask(actor, task) && task.assigneeId !== null) {
      throw new AppError("forbidden", "This task is assigned to someone else.");
    }
    await db
      .update(tasks)
      .set({ doneAt: done ? new Date() : null, doneBy: done ? actor.id : null, updatedAt: new Date() })
      .where(eq(tasks.id, task.id));
    await audit({ actor, action: done ? "task.complete" : "task.reopen", entityType: "task", entityId: task.id, summary: `${done ? "Completed" : "Reopened"} task “${task.title}”` });
    return undefined;
  });
}

export async function deleteTaskAction(taskId: string) {
  return run(async () => {
    const actor = await requireActor();
    const [task] = await db.select().from(tasks).where(eq(tasks.id, id.parse(taskId)));
    if (!task) return undefined;
    if (!isAdmin(actor) && task.createdBy !== actor.id) throw new AppError("forbidden", "Only the author or a Board Admin can delete this task.");
    await db.delete(tasks).where(eq(tasks.id, task.id));
    await audit({ actor, action: "task.delete", entityType: "task", entityId: task.id, summary: `Deleted task “${task.title}”` });
    return undefined;
  });
}
