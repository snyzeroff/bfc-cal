import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { DEFAULT_APPEARANCE, appearanceSchema, type Appearance } from "./appearance";

export const victorialesSchema = z.array(
  z.object({
    id: z.string(),
    label: z.string().min(1).max(60),
    /** First day of the Victoriales. Null until an administrator sets it. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    /** Optional last day, for display only. */
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  }),
);
export type VictorialesEdition = z.infer<typeof victorialesSchema>[number];

export const feedSettingsSchema = z.object({
  /** Cancelled events stay in feeds this long so every client sees the cancellation. */
  cancelledRetentionDays: z.number().int().min(0).max(365).default(30),
  /** Hint sent to calendar clients; they are free to ignore it. */
  refreshMinutes: z.number().int().min(15).max(1440).default(60),
});
export type FeedSettings = z.infer<typeof feedSettingsSchema>;

const DEFAULTS = {
  victoriales: [{ id: "2026-2027", label: "Victoriales 2027", date: null, endDate: null }] as VictorialesEdition[],
  appearance: DEFAULT_APPEARANCE as Appearance,
  feed: { cancelledRetentionDays: 30, refreshMinutes: 60 } as FeedSettings,
};
const SCHEMAS = { victoriales: victorialesSchema, appearance: appearanceSchema, feed: feedSettingsSchema };

type Key = keyof typeof DEFAULTS;

async function read<K extends Key>(key: K): Promise<(typeof DEFAULTS)[K]> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  if (!row) return DEFAULTS[key];
  const parsed = SCHEMAS[key].safeParse(row.value);
  return (parsed.success ? parsed.data : DEFAULTS[key]) as (typeof DEFAULTS)[K];
}

export const getSetting = cache(read) as typeof read;
/** Uncached variant for code running outside a React request (tests, feeds). */
export const readSetting = read;

export async function writeSetting<K extends Key>(key: K, value: (typeof DEFAULTS)[K], userId: string | null) {
  const parsed = SCHEMAS[key].parse(value);
  await db
    .insert(settings)
    .values({ key, value: parsed, updatedBy: userId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: parsed, updatedBy: userId, updatedAt: new Date() } });
}
