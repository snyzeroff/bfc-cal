"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { CONTACT_STATUSES, speakers } from "@/db/schema";
import { run } from "@/lib/action";
import { audit, diff } from "@/lib/audit";
import { requireActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { canEditSpeaker, canManageSpeakers } from "@/lib/permissions";
import { isValidDateIso } from "@/lib/time";

const id = z.string().uuid();
const schema = z.object({
  name: z.string().trim().min(1, "A name is required").max(120),
  organization: z.string().trim().max(120).default(""),
  position: z.string().trim().max(120).default(""),
  bio: z.string().max(4000).default(""),
  email: z.union([z.literal(""), z.string().email("Invalid email").max(200)]).default(""),
  phone: z.string().max(40).default(""),
  linkedin: z.string().max(300).default(""),
  contactStatus: z.enum(CONTACT_STATUSES).default("prospect"),
  ownerId: id.nullable().default(null),
  notes: z.string().max(8000).default(""),
  lastContactedAt: z.string().refine(isValidDateIso).nullable().default(null),
});
export type SpeakerInput = z.input<typeof schema>;

export async function saveSpeakerAction(speakerId: string | null, input: SpeakerInput) {
  return run(async () => {
    const actor = await requireActor();
    const data = schema.parse(input);
    if (!speakerId) {
      // Any board member may suggest a speaker; they become its owner unless an admin picks someone.
      const ownerId = canManageSpeakers(actor) ? (data.ownerId ?? actor.id) : actor.id;
      const [row] = await db.insert(speakers).values({ ...data, ownerId }).returning();
      await audit({ actor, action: "speaker.create", entityType: "speaker", entityId: row.id, summary: `Added speaker “${row.name}”` });
      return { id: row.id };
    }
    const [current] = await db.select().from(speakers).where(eq(speakers.id, id.parse(speakerId)));
    if (!current) throw new AppError("not_found", "This speaker no longer exists.");
    if (!canEditSpeaker(actor, current)) throw new AppError("forbidden", "Only the assigned board member or a Board Admin can edit this speaker.");
    if (!canManageSpeakers(actor)) data.ownerId = current.ownerId;
    const changes = diff(current as unknown as Record<string, unknown>, data);
    // Contact details are private: record that they changed, not their values.
    for (const k of ["email", "phone", "notes"]) if (changes[k]) changes[k] = ["(hidden)", "(changed)"];
    await db.update(speakers).set({ ...data, updatedAt: new Date() }).where(eq(speakers.id, current.id));
    if (Object.keys(changes).length) {
      await audit({ actor, action: "speaker.update", entityType: "speaker", entityId: current.id, summary: `Updated speaker “${data.name}”`, changes });
    }
    return { id: current.id };
  });
}

export async function archiveSpeakerAction(speakerId: string, archived: boolean) {
  return run(async () => {
    const actor = await requireActor("board_admin");
    const [row] = await db.update(speakers).set({ archived, updatedAt: new Date() }).where(eq(speakers.id, id.parse(speakerId))).returning();
    if (!row) throw new AppError("not_found", "This speaker no longer exists.");
    await audit({ actor, action: archived ? "speaker.archive" : "speaker.restore", entityType: "speaker", entityId: row.id, summary: `${archived ? "Archived" : "Restored"} speaker “${row.name}”` });
    return undefined;
  });
}
