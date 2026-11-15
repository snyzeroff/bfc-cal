import { asc, isNotNull } from "drizzle-orm";
import { SpeakerDirectory } from "@/components/board/speakers";
import { db } from "@/db";
import { events, speakers } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { loadCalendarData } from "@/lib/board-data";
import { instantToWall } from "@/lib/time";

export const metadata = { title: "Speakers" };

export default async function SpeakersPage() {
  const user = await requireUser();
  const [rows, linked, data] = await Promise.all([
    db.select().from(speakers).orderBy(asc(speakers.name)),
    db.select({ id: events.id, title: events.title, speakerId: events.speakerId, startAt: events.startAt, status: events.status }).from(events).where(isNotNull(events.speakerId)),
    loadCalendarData(user),
  ]);
  return (
    <SpeakerDirectory
      speakers={rows.map((s) => ({
        id: s.id,
        name: s.name,
        organization: s.organization,
        position: s.position,
        bio: s.bio,
        email: s.email,
        phone: s.phone,
        linkedin: s.linkedin,
        contactStatus: s.contactStatus,
        ownerId: s.ownerId,
        notes: s.notes,
        lastContactedAt: s.lastContactedAt,
        archived: s.archived,
        events: linked.filter((e) => e.speakerId === s.id).map((e) => ({ id: e.id, title: e.title, start: e.startAt ? instantToWall(e.startAt) : null, status: e.status })),
      }))}
      users={data.users}
      categories={data.categories}
      windows={data.windows}
      templates={data.templates}
      today={data.today}
    />
  );
}
