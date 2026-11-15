"use server";

import { z } from "zod";
import { AVAILABILITY, EVENT_STATUSES } from "@/db/schema";
import { run } from "@/lib/action";
import { requireActor } from "@/lib/auth/session";
import {
  addAttachment,
  addComment,
  addProposal,
  confirmProposal,
  createEvent,
  declineProposal,
  deleteComment,
  deleteEvent,
  duplicateEvent,
  publishEvent,
  removeAttachment,
  safeUrl,
  setArchived,
  unpublishEvent,
  updateEvent,
  updateProposal,
  type EventPatch,
} from "@/lib/events/service";
import { addDays, isValidDateIso, parisToInstant, wallToInstant } from "@/lib/time";

const id = z.string().uuid();
const dateIso = z.string().refine(isValidDateIso, "Invalid date");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Invalid time");
const wall = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "Invalid date/time");
const opts = z.object({ expectedVersion: z.number().int().optional(), overrideReason: z.string().max(500).optional() }).default({});

const formSchema = z.object({
  title: z.string().trim().min(1, "A title is required").max(160),
  description: z.string().max(8000).default(""),
  internalNotes: z.string().max(8000).default(""),
  categoryId: id,
  speakerId: id.nullable().default(null),
  status: z.enum(EVENT_STATUSES).optional(),
  date: dateIso.nullable().default(null),
  endDate: dateIso.nullable().default(null),
  startTime: time.default("18:30"),
  endTime: time.default("20:00"),
  allDay: z.boolean().default(false),
  location: z.string().max(200).default(""),
  onlineUrl: z.string().max(500).default(""),
  registrationUrl: z.string().max(500).default(""),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().default(null),
  audience: z.array(z.string().max(60)).max(30).default([]),
  organizerIds: z.array(id).max(30).optional(),
  scheduledPublishAt: wall.nullable().default(null),
});
export type EventFormInput = z.input<typeof formSchema>;

function toPatch(f: z.output<typeof formSchema>): EventPatch {
  let startAt: Date | null = null;
  let endAt: Date | null = null;
  if (f.date) {
    if (f.allDay) {
      startAt = parisToInstant(f.date);
      endAt = parisToInstant(addDays(f.endDate && f.endDate >= f.date ? f.endDate : f.date, 1));
    } else {
      startAt = parisToInstant(f.date, f.startTime);
      // An end time earlier than the start means the event runs past midnight.
      const endDay = f.endDate && f.endDate > f.date ? f.endDate : f.endTime <= f.startTime ? addDays(f.date, 1) : f.date;
      endAt = parisToInstant(endDay, f.endTime);
    }
  }
  return {
    title: f.title,
    description: f.description,
    internalNotes: f.internalNotes,
    categoryId: f.categoryId,
    speakerId: f.speakerId,
    status: f.status,
    startAt,
    endAt,
    allDay: f.allDay,
    location: f.location.trim(),
    onlineUrl: safeUrl(f.onlineUrl),
    registrationUrl: safeUrl(f.registrationUrl),
    color: f.color,
    audience: f.audience,
    organizerIds: f.organizerIds,
    scheduledPublishAt: f.scheduledPublishAt ? wallToInstant(f.scheduledPublishAt) : null,
  };
}

const slim = (r: { event: { id: string; version: number; title: string }; warnings: { message: string }[] }) => ({
  id: r.event.id,
  version: r.event.version,
  title: r.event.title,
  warnings: r.warnings.map((w) => w.message),
});

export async function createEventAction(
  input: EventFormInput & { proposals?: { start: string; end: string }[]; templateId?: string | null },
  o?: z.input<typeof opts>,
) {
  return run(async () => {
    const actor = await requireActor();
    const f = formSchema.parse(input);
    const proposals = z.array(z.object({ start: wall, end: wall })).max(12).default([]).parse(input.proposals ?? []);
    const res = await createEvent(
      actor,
      {
        ...toPatch(f),
        title: f.title,
        categoryId: f.categoryId,
        proposals: proposals.map((p) => ({ startAt: wallToInstant(p.start), endAt: wallToInstant(p.end) })),
        templateId: input.templateId ? id.parse(input.templateId) : undefined,
      },
      opts.parse(o),
    );
    return slim(res);
  });
}

export async function updateEventAction(eventId: string, input: EventFormInput, o?: z.input<typeof opts>) {
  return run(async () => {
    const actor = await requireActor();
    const patch = toPatch(formSchema.parse(input));
    if (!patch.status) delete patch.status;
    return slim(await updateEvent(actor, id.parse(eventId), patch, opts.parse(o)));
  });
}

/** Drag & drop / resize on the calendar. */
export async function moveEventAction(
  eventId: string,
  input: { start: string; end: string; allDay: boolean },
  o?: z.input<typeof opts>,
) {
  return run(async () => {
    const actor = await requireActor();
    const { start, end, allDay } = z.object({ start: wall, end: wall, allDay: z.boolean() }).parse(input);
    return slim(
      await updateEvent(actor, id.parse(eventId), { startAt: wallToInstant(start), endAt: wallToInstant(end), allDay }, opts.parse(o)),
    );
  });
}

export async function setStatusAction(eventId: string, status: string, o?: z.input<typeof opts>) {
  return run(async () => {
    const actor = await requireActor();
    return slim(await updateEvent(actor, id.parse(eventId), { status: z.enum(EVENT_STATUSES).parse(status) }, opts.parse(o)));
  });
}

export async function publishEventAction(eventId: string, publish: boolean, o?: z.input<typeof opts>) {
  return run(async () => {
    const actor = await requireActor();
    const ev = publish ? await publishEvent(actor, id.parse(eventId), opts.parse(o)) : await unpublishEvent(actor, id.parse(eventId), opts.parse(o));
    return { id: ev.id, version: ev.version, isPublic: ev.isPublic };
  });
}

export async function duplicateEventAction(eventId: string) {
  return run(async () => {
    const actor = await requireActor();
    const ev = await duplicateEvent(actor, id.parse(eventId));
    return { id: ev.id };
  });
}

export async function archiveEventAction(eventId: string, archived: boolean) {
  return run(async () => {
    const actor = await requireActor();
    const ev = await setArchived(actor, id.parse(eventId), archived);
    return { id: ev.id, version: ev.version };
  });
}

export async function deleteEventAction(eventId: string) {
  return run(async () => {
    const actor = await requireActor();
    await deleteEvent(actor, id.parse(eventId));
    return undefined;
  });
}

/* ------------------------------------------------------------- proposals */

export async function addProposalAction(eventId: string, input: { start: string; end: string; note?: string }, o?: z.input<typeof opts>) {
  return run(async () => {
    const actor = await requireActor();
    const p = z.object({ start: wall, end: wall, note: z.string().max(500).optional() }).parse(input);
    const res = await addProposal(actor, id.parse(eventId), { startAt: wallToInstant(p.start), endAt: wallToInstant(p.end), note: p.note }, opts.parse(o));
    return { id: res.proposal.id, warnings: res.warnings.map((w) => w.message) };
  });
}

export async function updateProposalAction(proposalId: string, input: { availability?: string; note?: string }) {
  return run(async () => {
    const actor = await requireActor();
    const patch = z.object({ availability: z.enum(AVAILABILITY).optional(), note: z.string().max(500).optional() }).parse(input);
    await updateProposal(actor, id.parse(proposalId), patch);
    return undefined;
  });
}

export async function declineProposalAction(proposalId: string) {
  return run(async () => {
    const actor = await requireActor();
    await declineProposal(actor, id.parse(proposalId));
    return undefined;
  });
}

export async function confirmProposalAction(proposalId: string, o?: z.input<typeof opts>) {
  return run(async () => {
    const actor = await requireActor();
    return slim(await confirmProposal(actor, id.parse(proposalId), opts.parse(o)));
  });
}

/* ------------------------------------------------ comments & attachments */

export async function addCommentAction(eventId: string, body: string) {
  return run(async () => {
    const actor = await requireActor();
    await addComment(actor, id.parse(eventId), z.string().max(4000).parse(body));
    return undefined;
  });
}

export async function deleteCommentAction(commentId: string) {
  return run(async () => {
    const actor = await requireActor();
    await deleteComment(actor, id.parse(commentId));
    return undefined;
  });
}

export async function addAttachmentAction(eventId: string, input: { name: string; url: string }) {
  return run(async () => {
    const actor = await requireActor();
    const a = z.object({ name: z.string().max(120), url: z.string().min(1).max(1000) }).parse(input);
    await addAttachment(actor, id.parse(eventId), a.name, a.url);
    return undefined;
  });
}

export async function removeAttachmentAction(attachmentId: string) {
  return run(async () => {
    const actor = await requireActor();
    await removeAttachment(actor, id.parse(attachmentId));
    return undefined;
  });
}

/* ------------------------------------------------------ scheduling assistant */

export async function suggestSlotsAction(input: { eventId: string; from: string; to: string; weekdays: number[] }) {
  return run(
    async () => {
      const actor = await requireActor();
      const { eventId, from, to, weekdays } = z
        .object({ eventId: id, from: dateIso, to: dateIso, weekdays: z.array(z.number().int().min(0).max(6)).min(1) })
        .parse(input);
      const { buildAssistantInput } = await import("@/lib/assistant");
      const { assessRange, suggestSlots } = await import("@/lib/scheduling");
      const { diffDays } = await import("@/lib/time");
      if (to < from) throw new (await import("@/lib/errors")).AppError("invalid", "The end of the range is before its start.");
      if (diffDays(from, to) > 200) throw new (await import("@/lib/errors")).AppError("invalid", "Choose a range of at most 200 days.");
      void actor;
      const assistant = await buildAssistantInput(eventId, from, to, weekdays);
      return { days: assessRange(assistant), suggestions: suggestSlots(assistant, 6), pendingReview: assistant.pendingReview };
    },
    { revalidate: false },
  );
}
