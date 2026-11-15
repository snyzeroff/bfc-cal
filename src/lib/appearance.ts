import { z } from "zod";
import { EVENT_STATUSES, type EventStatus } from "@/db/schema";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const STATUS_META: Record<EventStatus, { label: string; color: string; hint: string }> = {
  idea: { label: "Idea", color: "#8b8f98", hint: "A lead worth exploring" },
  proposed: { label: "Proposed", color: "#7c6bd6", hint: "Proposal written, dates being collected" },
  awaiting_confirmation: { label: "Awaiting confirmation", color: "#c98a1b", hint: "Waiting for the speaker to answer" },
  tentative: { label: "Tentative", color: "#2f8fb5", hint: "Date pencilled in, not final" },
  confirmed: { label: "Confirmed", color: "#2f9461", hint: "Date agreed — not public yet" },
  published: { label: "Published", color: "#841e21", hint: "Visible on the members calendar" },
  postponed: { label: "Postponed", color: "#b5622f", hint: "New date to be found" },
  cancelled: { label: "Cancelled", color: "#c0392b", hint: "Will not take place" },
  completed: { label: "Completed", color: "#5b6470", hint: "Took place" },
};

export const appearanceSchema = z.object({
  orgName: z.string().min(1).max(60).default("Bachelor Finance Club"),
  shortName: z.string().min(1).max(12).default("BFC"),
  tagline: z.string().max(120).default("Conferences and events at CentraleSupélec"),
  brand: z
    .object({ primary: hex, deep: hex, accent: hex })
    .default({ primary: "#841E21", deep: "#6D071A", accent: "#CF2B36" }),
  defaultTheme: z.enum(["system", "light", "dark"]).default("system"),
  density: z.enum(["comfortable", "compact"]).default("comfortable"),
  defaultView: z.enum(["month", "week", "day", "agenda", "timeline"]).default("month"),
  publicDefaultView: z.enum(["month", "agenda"]).default("agenda"),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]).default(1),
  showWeekends: z.boolean().default(true),
  eventStyle: z.enum(["solid", "soft", "outline"]).default("soft"),
  colorEventsBy: z.enum(["category", "status"]).default("category"),
  dayStartHour: z.number().int().min(0).max(12).default(8),
  dayEndHour: z.number().int().min(13).max(24).default(23),
  statusColors: z.partialRecord(z.enum(EVENT_STATUSES), hex).default({}),
  statusLabels: z.partialRecord(z.enum(EVENT_STATUSES), z.string().min(1).max(30)).default({}),
});
export type Appearance = z.infer<typeof appearanceSchema>;
export const DEFAULT_APPEARANCE: Appearance = appearanceSchema.parse({});

export const statusColor = (a: Pick<Appearance, "statusColors">, s: EventStatus) =>
  a.statusColors?.[s] ?? STATUS_META[s].color;
export const statusLabel = (a: Pick<Appearance, "statusLabels">, s: EventStatus) =>
  a.statusLabels?.[s] ?? STATUS_META[s].label;
