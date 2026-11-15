import "server-only";
import { publicSql } from "@/db";
import type { EventStatus } from "@/db/schema";

/**
 * Read model for unauthenticated visitors. Every query here goes through the
 * `public_events` view (and, when configured, a database role that can read
 * nothing else), so private columns are structurally out of reach.
 */
export type PublicEvent = {
  id: string;
  title: string;
  description: string;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  location: string;
  onlineUrl: string;
  registrationUrl: string;
  status: EventStatus;
  sequence: number;
  color: string | null;
  audience: string[];
  publishedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  categoryName: string;
  categoryKind: string;
  categoryColor: string;
  categoryIcon: string;
  speakerName: string | null;
  speakerOrganization: string | null;
  speakerPosition: string | null;
  speakerBio: string | null;
};

const COLS = publicSql`
  id, title, description, start_at as "startAt", end_at as "endAt", all_day as "allDay",
  location, online_url as "onlineUrl", registration_url as "registrationUrl", status, sequence,
  color, audience, published_at as "publishedAt", cancelled_at as "cancelledAt",
  created_at as "createdAt", updated_at as "updatedAt",
  category_name as "categoryName", category_kind as "categoryKind", category_color as "categoryColor",
  category_icon as "categoryIcon", speaker_name as "speakerName",
  speaker_organization as "speakerOrganization", speaker_position as "speakerPosition", speaker_bio as "speakerBio"`;

/** The shared client may hand timestamps back as text (the ORM installs its own parsers), so normalise here. */
function toDate(v: unknown): Date {
  if (v instanceof Date) return v;
  let s = String(v).replace(" ", "T");
  if (/[+-]\d{2}$/.test(s)) s += ":00";
  return new Date(s);
}
const DATE_COLS = ["startAt", "endAt", "publishedAt", "cancelledAt", "createdAt", "updatedAt"] as const;
function normalise(row: PublicEvent): PublicEvent {
  const out = { ...row } as Record<string, unknown>;
  for (const k of DATE_COLS) if (out[k] !== null && out[k] !== undefined) out[k] = toDate(out[k]);
  return out as PublicEvent;
}

export async function listPublicEvents(range?: { from?: Date; to?: Date }): Promise<PublicEvent[]> {
  const from = range?.from ?? new Date("2000-01-01");
  const to = range?.to ?? new Date("2100-01-01");
  const rows = await publicSql<PublicEvent[]>`
    select ${COLS} from public_events
    where end_at >= ${from.toISOString()}::timestamptz and start_at <= ${to.toISOString()}::timestamptz
    order by start_at asc`;
  return rows.map(normalise);
}

export async function getPublicEvent(id: string): Promise<PublicEvent | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const rows = await publicSql<PublicEvent[]>`select ${COLS} from public_events where id = ${id}`;
  return rows[0] ? normalise(rows[0]) : null;
}

/** JSON-safe shape for the public API and client components. */
export function serializePublicEvent(e: PublicEvent) {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    start: e.startAt.toISOString(),
    end: e.endAt.toISOString(),
    allDay: e.allDay,
    location: e.location,
    onlineUrl: e.onlineUrl,
    registrationUrl: e.registrationUrl,
    status: e.status,
    category: { name: e.categoryName, kind: e.categoryKind, color: e.color ?? e.categoryColor, icon: e.categoryIcon },
    speaker: e.speakerName
      ? { name: e.speakerName, organization: e.speakerOrganization ?? "", position: e.speakerPosition ?? "", bio: e.speakerBio ?? "" }
      : null,
    updatedAt: e.updatedAt.toISOString(),
  };
}
export type PublicEventJson = ReturnType<typeof serializePublicEvent>;
