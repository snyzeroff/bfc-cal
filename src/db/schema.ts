import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/* ----------------------------------------------------------------- enums */

export const roleEnum = pgEnum("user_role", ["super_admin", "board_admin", "board_member"]);

export const EVENT_STATUSES = [
  "idea",
  "proposed",
  "awaiting_confirmation",
  "tentative",
  "confirmed",
  "published",
  "postponed",
  "cancelled",
  "completed",
] as const;
export const eventStatusEnum = pgEnum("event_status", EVENT_STATUSES);

export const CATEGORY_KINDS = ["conference", "meeting", "deadline", "social", "other"] as const;
export const categoryKindEnum = pgEnum("category_kind", CATEGORY_KINDS);

export const proposalStateEnum = pgEnum("proposal_state", [
  "active",
  "confirmed",
  "released",
  "declined",
]);

export const AVAILABILITY = ["unknown", "available", "unavailable"] as const;
export const availabilityEnum = pgEnum("speaker_availability", AVAILABILITY);

export const CONTACT_STATUSES = [
  "prospect",
  "to_contact",
  "contacted",
  "in_discussion",
  "accepted",
  "declined",
  "past_speaker",
] as const;
export const contactStatusEnum = pgEnum("contact_status", CONTACT_STATUSES);

export const ACADEMIC_KINDS = [
  "teaching",
  "exam",
  "midterm",
  "reading",
  "vacation",
  "holiday",
  "internship",
  "sport",
  "school_event",
  "other",
] as const;
export const academicKindEnum = pgEnum("academic_kind", ACADEMIC_KINDS);

export const candidateStatusEnum = pgEnum("candidate_status", ["pending", "approved", "rejected"]);
export const severityEnum = pgEnum("restriction_severity", ["hard", "soft"]);
export const ruleTypeEnum = pgEnum("restriction_type", [
  "victoriales",
  "date_range",
  "academic_kind",
]);

/* ----------------------------------------------------------------- users */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  role: roleEnum("role").notNull().default("board_member"),
  active: boolean("active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  /** The shareable invitation link this account was created through, if any. */
  signupLinkId: uuid("signup_link_id").references((): AnyPgColumn => signupLinks.id, { onDelete: "set null" }),
  ...timestamps,
});

/**
 * Shareable invitation links: anyone holding the link can create an account
 * with `role` until `max_uses` accounts exist. Only the hash of the secret is stored.
 */
export const signupLinks = pgTable("signup_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  label: text("label").notNull(),
  role: roleEnum("role").notNull(),
  maxUses: integer("max_uses").notNull(),
  uses: integer("uses").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdBy: uuid("created_by").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** One-time links used to set a password (invitation or reset). */
export const inviteTokens = pgTable("invite_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    success: boolean("success").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_attempts_key_idx").on(t.key, t.at)],
);

/** Secret tokens for private calendar subscriptions. Only the hash is stored. */
export const feedTokens = pgTable(
  "feed_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    label: text("label").notNull().default("Board calendar"),
    includeTentative: boolean("include_tentative").notNull().default(true),
    includeDeadlines: boolean("include_deadlines").notNull().default(true),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("feed_tokens_user_idx").on(t.userId)],
);

/* ------------------------------------------------------- events & people */

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  kind: categoryKindEnum("kind").notNull().default("other"),
  color: text("color").notNull().default("#841E21"),
  icon: text("icon").notNull().default("calendar"),
  sortOrder: integer("sort_order").notNull().default(0),
  archived: boolean("archived").notNull().default(false),
});

export const speakers = pgTable("speakers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  organization: text("organization").notNull().default(""),
  position: text("position").notNull().default(""),
  /** Shown publicly on published events. */
  bio: text("bio").notNull().default(""),
  /** Private — never exposed outside the board area. */
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  linkedin: text("linkedin").notNull().default(""),
  contactStatus: contactStatusEnum("contact_status").notNull().default("prospect"),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  notes: text("notes").notNull().default(""),
  lastContactedAt: date("last_contacted_at"),
  archived: boolean("archived").notNull().default(false),
  ...timestamps,
});

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    /** Public description (shown once the event is published). */
    description: text("description").notNull().default(""),
    /** Private planning notes — board only. */
    internalNotes: text("internal_notes").notNull().default(""),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    speakerId: uuid("speaker_id").references(() => speakers.id, { onDelete: "set null" }),
    status: eventStatusEnum("status").notNull().default("idea"),
    /** Publication is a separate, explicit decision — never implied by status. */
    isPublic: boolean("is_public").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    scheduledPublishAt: timestamp("scheduled_publish_at", { withTimezone: true }),
    /** Null while the date is still being negotiated (see event_proposals). */
    startAt: timestamp("start_at", { withTimezone: true }),
    endAt: timestamp("end_at", { withTimezone: true }),
    allDay: boolean("all_day").notNull().default(false),
    location: text("location").notNull().default(""),
    onlineUrl: text("online_url").notNull().default(""),
    registrationUrl: text("registration_url").notNull().default(""),
    /** Validated embed URL of an external registration widget (Luma). Never raw HTML. */
    embedUrl: text("embed_url").notNull().default(""),
    /** Shown at the top of the members site while it is public and upcoming. */
    featured: boolean("featured").notNull().default(false),
    color: text("color"),
    /** Academic programs this event targets (layer program keys); empty = everyone. */
    audience: jsonb("audience").$type<string[]>().notNull().default([]),
    /** iCalendar SEQUENCE: bumped on every change that subscribers must notice. */
    sequence: integer("sequence").notNull().default(0),
    /** Optimistic-concurrency counter: bumped on every write. */
    version: integer("version").notNull().default(1),
    overrideReason: text("override_reason"),
    overrideBy: uuid("override_by").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("events_start_idx").on(t.startAt),
    index("events_public_idx").on(t.isPublic, t.startAt),
    index("events_status_idx").on(t.status),
  ],
);

export const eventProposals = pgTable(
  "event_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    state: proposalStateEnum("state").notNull().default("active"),
    /** What the speaker told us. `unknown` means nobody asked yet — not "free". */
    availability: availabilityEnum("availability").notNull().default("unknown"),
    note: text("note").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("proposals_event_idx").on(t.eventId), index("proposals_start_idx").on(t.startAt)],
);

export const eventOrganizers = pgTable(
  "event_organizers",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.userId] })],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    notes: text("notes").notNull().default(""),
    dueDate: date("due_date"),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    doneBy: uuid("done_by").references(() => users.id, { onDelete: "set null" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("tasks_event_idx").on(t.eventId), index("tasks_due_idx").on(t.dueDate)],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("comments_event_idx").on(t.eventId)],
);

/** Attachments are links (Drive, Notion, …): no file storage service is required. */
export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TemplateData = {
  categoryId?: string;
  durationMinutes: number;
  startTime: string; // "18:30"
  location: string;
  description: string;
  tasks: { title: string; offsetDays: number }[]; // offset relative to the event day (negative = before)
};

export const templates = pgTable("templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  data: jsonb("data").$type<TemplateData>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* -------------------------------------------------------------- academic */

export const academicLayers = pgTable("academic_layers", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Stable key, e.g. "boe-y1", "aidams-y1", "sport". */
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  program: text("program").notNull().default(""),
  yearGroup: text("year_group").notNull().default(""),
  color: text("color").notNull().default("#2563eb"),
  visibleByDefault: boolean("visible_by_default").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export type SourceRef = {
  importId?: string;
  filename?: string;
  page?: number;
  /** PDF user-space rectangle of the source cell: [x0, y0, x1, y1]. */
  bbox?: [number, number, number, number];
  text?: string;
};

export const academicImports = pgTable("academic_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  filename: text("filename").notNull(),
  sha256: text("sha256").notNull(),
  title: text("title").notNull().default(""),
  versionLabel: text("version_label").notNull().default(""),
  format: text("format").notNull().default("pdf"),
  warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
  uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const importCandidates = pgTable(
  "import_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importId: uuid("import_id")
      .notNull()
      .references(() => academicImports.id, { onDelete: "cascade" }),
    layerKey: text("layer_key").notNull(),
    layerName: text("layer_name").notNull(),
    label: text("label").notNull(),
    kind: academicKindEnum("kind").notNull().default("other"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    /** 0–1: how sure the extractor is about the date span. */
    confidence: integer("confidence_pct").notNull().default(50),
    issues: jsonb("issues").$type<string[]>().notNull().default([]),
    source: jsonb("source").$type<SourceRef>().notNull().default({}),
    status: candidateStatusEnum("status").notNull().default("pending"),
    edited: boolean("edited").notNull().default(false),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [index("candidates_import_idx").on(t.importId)],
);

export const academicEntries = pgTable(
  "academic_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    layerId: uuid("layer_id")
      .notNull()
      .references(() => academicLayers.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    kind: academicKindEnum("kind").notNull().default("other"),
    startDate: date("start_date").notNull(),
    /** Inclusive. */
    endDate: date("end_date").notNull(),
    /** Only entries a human approved are verified. */
    verified: boolean("verified").notNull().default(false),
    verifiedBy: uuid("verified_by").references(() => users.id, { onDelete: "set null" }),
    source: jsonb("source").$type<SourceRef>().notNull().default({}),
    candidateId: uuid("candidate_id"),
    ...timestamps,
  },
  (t) => [index("entries_layer_idx").on(t.layerId), index("entries_dates_idx").on(t.startDate, t.endDate)],
);

/* ---------------------------------------------- restrictions & settings */

export type RuleParams = {
  /** date_range */
  startDate?: string;
  endDate?: string;
  /** academic_kind */
  kinds?: string[];
  layerKeys?: string[];
  /** victoriales: number of days before the event that are blocked (default 21). */
  daysBefore?: number;
};

export const restrictionRules = pgTable("restriction_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: ruleTypeEnum("type").notNull(),
  severity: severityEnum("severity").notNull().default("soft"),
  /** Category kinds the rule applies to. */
  appliesTo: jsonb("applies_to").$type<string[]>().notNull().default(["conference"]),
  params: jsonb("params").$type<RuleParams>().notNull().default({}),
  message: text("message").notNull().default(""),
  active: boolean("active").notNull().default(true),
  /** Built-in rules (the exam rule) cannot be deleted. */
  builtin: boolean("builtin").notNull().default(false),
  ...timestamps,
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull().default(""),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    summary: text("summary").notNull().default(""),
    /** { field: [before, after] } */
    changes: jsonb("changes").$type<Record<string, [unknown, unknown]>>(),
    reason: text("reason"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_entity_idx").on(t.entityType, t.entityId), index("audit_at_idx").on(t.at)],
);

/* -------------------------------------------------------------- relations */

export const eventsRelations = relations(events, ({ one, many }) => ({
  category: one(categories, { fields: [events.categoryId], references: [categories.id] }),
  speaker: one(speakers, { fields: [events.speakerId], references: [speakers.id] }),
  proposals: many(eventProposals),
  organizers: many(eventOrganizers),
  tasks: many(tasks),
  comments: many(comments),
  attachments: many(attachments),
}));
export const proposalsRelations = relations(eventProposals, ({ one }) => ({
  event: one(events, { fields: [eventProposals.eventId], references: [events.id] }),
}));
export const organizersRelations = relations(eventOrganizers, ({ one }) => ({
  event: one(events, { fields: [eventOrganizers.eventId], references: [events.id] }),
  user: one(users, { fields: [eventOrganizers.userId], references: [users.id] }),
}));
export const tasksRelations = relations(tasks, ({ one }) => ({
  event: one(events, { fields: [tasks.eventId], references: [events.id] }),
  assignee: one(users, { fields: [tasks.assigneeId], references: [users.id] }),
}));
export const commentsRelations = relations(comments, ({ one }) => ({
  event: one(events, { fields: [comments.eventId], references: [events.id] }),
  user: one(users, { fields: [comments.userId], references: [users.id] }),
}));
export const attachmentsRelations = relations(attachments, ({ one }) => ({
  event: one(events, { fields: [attachments.eventId], references: [events.id] }),
}));
export const speakersRelations = relations(speakers, ({ one, many }) => ({
  owner: one(users, { fields: [speakers.ownerId], references: [users.id] }),
  events: many(events),
}));
export const entriesRelations = relations(academicEntries, ({ one }) => ({
  layer: one(academicLayers, { fields: [academicEntries.layerId], references: [academicLayers.id] }),
}));
export const candidatesRelations = relations(importCandidates, ({ one }) => ({
  import: one(academicImports, { fields: [importCandidates.importId], references: [academicImports.id] }),
}));

export type User = typeof users.$inferSelect;
export type Role = User["role"];
export type SignupLink = typeof signupLinks.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type EventStatus = (typeof EVENT_STATUSES)[number];
export type CategoryKind = (typeof CATEGORY_KINDS)[number];
export type AcademicKind = (typeof ACADEMIC_KINDS)[number];
export type Category = typeof categories.$inferSelect;
export type Speaker = typeof speakers.$inferSelect;
export type Proposal = typeof eventProposals.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type AcademicLayer = typeof academicLayers.$inferSelect;
export type AcademicEntry = typeof academicEntries.$inferSelect;
export type ImportCandidate = typeof importCandidates.$inferSelect;
export type RestrictionRule = typeof restrictionRules.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;

/** Statuses in which a public event may be shown to members. */
export const PUBLIC_STATUSES: EventStatus[] = ["published", "postponed", "cancelled", "completed"];
export const publicStatusSql = sql.raw(PUBLIC_STATUSES.map((s) => `'${s}'`).join(", "));
