import { getUser } from "@/lib/auth/session";
import { loadCalendarData } from "@/lib/board-data";

const cell = (v: unknown) => {
  let s = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formula injection.
  s = s.replace(/\r\n?|\n/g, " ");
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
  return /[",;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET() {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const data = await loadCalendarData(user, { includeArchived: true });
  const header = ["Title", "Category", "Status", "Public", "Start (Paris)", "End (Paris)", "All day", "Location", "Speaker", "Organisation", "Organisers", "Open tasks", "Archived"];
  const rows = data.events.map((e) => [
    e.title,
    e.categoryName,
    e.status,
    e.isPublic ? "yes" : "no",
    e.start?.replace("T", " ") ?? "",
    e.end?.replace("T", " ") ?? "",
    e.allDay ? "yes" : "no",
    e.location,
    e.speakerName ?? "",
    e.speakerOrg ?? "",
    data.users.filter((u) => e.organizerIds.includes(u.id)).map((u) => u.name).join(" / "),
    e.openTasks,
    e.archived ? "yes" : "no",
  ]);
  const csv = "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bfc-events-${data.today}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
