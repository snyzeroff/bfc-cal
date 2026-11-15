import type { AcademicKind, CategoryKind, EventStatus, Role } from "@/db/schema";

/** JSON-safe shapes passed from server components to the board's client UI. Times are Paris wall-clock strings. */

export type BoardUser = { id: string; name: string; email: string; role: Role; active: boolean };
export type Me = { id: string; name: string; email: string; role: Role; isAdmin: boolean; isSuperAdmin: boolean };

export type BoardCategory = { id: string; name: string; kind: CategoryKind; color: string; icon: string; archived: boolean };

export type BoardEvent = {
  id: string;
  title: string;
  status: EventStatus;
  isPublic: boolean;
  start: string | null;
  end: string | null;
  allDay: boolean;
  categoryId: string;
  categoryName: string;
  kind: CategoryKind;
  color: string;
  speakerId: string | null;
  speakerName: string | null;
  speakerOrg: string | null;
  location: string;
  audience: string[];
  organizerIds: string[];
  createdBy: string | null;
  version: number;
  canEdit: boolean;
  archived: boolean;
  overrideReason: string | null;
  /** Hard restriction this event currently violates (after a rule or Victoriales change), if any. */
  violation: string | null;
  openTasks: number;
  totalTasks: number;
  activeProposals: number;
  updatedAt: string;
  scheduledPublishAt: string | null;
};

export type BoardProposal = {
  id: string;
  eventId: string;
  eventTitle: string;
  start: string;
  end: string;
  state: "active" | "confirmed" | "released" | "declined";
  availability: "unknown" | "available" | "unavailable";
  note: string;
  color: string;
};

export type BoardTask = {
  id: string;
  title: string;
  notes: string;
  dueDate: string | null;
  eventId: string | null;
  eventTitle: string | null;
  assigneeId: string | null;
  createdBy: string | null;
  done: boolean;
  doneAt: string | null;
};

export type BoardLayer = { id: string; key: string; name: string; program: string; yearGroup: string; color: string; visibleByDefault: boolean };
export type BoardAcademic = { id: string; layerId: string; layerKey: string; label: string; kind: AcademicKind; start: string; end: string };

export type BoardWindow = {
  key: string;
  ruleId: string;
  type: "victoriales" | "date_range" | "academic_kind";
  severity: "hard" | "soft";
  appliesTo: string[];
  start: string;
  end: string;
  title: string;
  message: string;
};

export type BoardVictoriales = { id: string; label: string; date: string | null; endDate: string | null };

export type BoardSpeakerLite = { id: string; name: string; organization: string };

export type CalendarData = {
  me: Me;
  events: BoardEvent[];
  proposals: BoardProposal[];
  tasks: BoardTask[];
  layers: BoardLayer[];
  academic: BoardAcademic[];
  windows: BoardWindow[];
  victoriales: BoardVictoriales[];
  categories: BoardCategory[];
  users: BoardUser[];
  speakers: BoardSpeakerLite[];
  templates: { id: string; name: string; categoryId: string | null; startTime: string; durationMinutes: number; taskCount: number }[];
  today: string;
};

export const ACADEMIC_KIND_META: Record<AcademicKind, { label: string; color: string; group: string }> = {
  exam: { label: "Exams", color: "#c0392b", group: "exams" },
  midterm: { label: "Midterms", color: "#d35d4a", group: "exams" },
  reading: { label: "Reading days", color: "#d98a3d", group: "exams" },
  vacation: { label: "Vacation", color: "#3d8f6b", group: "breaks" },
  holiday: { label: "Public holiday", color: "#2f7d6b", group: "breaks" },
  internship: { label: "Internship", color: "#7a6fb0", group: "internship" },
  school_event: { label: "School event", color: "#3f6fb5", group: "school" },
  sport: { label: "Sport", color: "#b59a2f", group: "sport" },
  teaching: { label: "Teaching week", color: "#8a97a8", group: "teaching" },
  other: { label: "Other", color: "#7a726d", group: "school" },
};

export const KIND_GROUPS: { key: string; label: string; defaultOn: boolean }[] = [
  { key: "exams", label: "Exams, midterms & reading days", defaultOn: true },
  { key: "breaks", label: "Vacations & public holidays", defaultOn: true },
  { key: "school", label: "School events", defaultOn: true },
  { key: "internship", label: "Internship periods", defaultOn: false },
  { key: "sport", label: "Sport sessions", defaultOn: false },
  { key: "teaching", label: "Teaching weeks", defaultOn: false },
];

export type EventDetail = {
  event: BoardEvent & {
    description: string;
    internalNotes: string;
    onlineUrl: string;
    registrationUrl: string;
    embedUrl: string;
    featured: boolean;
    customColor: string | null;
    categoryColor: string;
    publishedAt: string | null;
    createdAt: string;
    createdByName: string | null;
    updatedByName: string | null;
    speakerPosition: string | null;
    speakerBio: string | null;
  };
  proposals: (BoardProposal & { resolvedAt: string | null; createdAt: string })[];
  tasks: BoardTask[];
  comments: { id: string; body: string; userId: string | null; userName: string; createdAt: string }[];
  attachments: { id: string; name: string; url: string; addedByName: string | null }[];
  history: { id: string; action: string; summary: string; actorName: string; at: string; reason: string | null; changes: Record<string, [unknown, unknown]> | null }[];
};

export type SlotAssessment = {
  day: string;
  status: "available" | "conflict" | "restricted" | "unavailable" | "unknown";
  speaker: "confirmed" | "unconfirmed" | "unavailable";
  reasons: { tone: "good" | "warn" | "bad" | "info"; text: string }[];
  score: number;
};
