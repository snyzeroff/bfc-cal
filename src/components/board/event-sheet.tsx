"use client";

import Link from "next/link";
import { Archive, ArrowUpRight, CalendarClock, CheckCircle2, Copy, Globe, GlobeLock, MapPin, Mic2, ShieldAlert, ShieldCheck } from "lucide-react";
import { archiveEventAction, confirmProposalAction, duplicateEventAction, publishEventAction, setStatusAction } from "@/app/actions/events";
import { Avatar, Badge, Button, Callout, Dialog, buttonClass } from "@/components/ui";
import type { EventStatus } from "@/db/schema";
import type { BoardEvent, BoardProposal, BoardUser } from "@/lib/board-types";
import { formatRange, wallToInstant } from "@/lib/time";
import { useBoard, useMutate } from "./context";
import { StatusMenu, VisibilityBadge } from "./status";

export const formatWallRange = (start: string, end: string | null, allDay = false) => formatRange(wallToInstant(start), end ? wallToInstant(end) : null, allDay);

const AVAIL: Record<BoardProposal["availability"], { label: string; tone: "ok" | "danger" | "neutral" }> = {
  available: { label: "Speaker available", tone: "ok" },
  unavailable: { label: "Speaker unavailable", tone: "danger" },
  unknown: { label: "Availability not confirmed", tone: "neutral" },
};

/** Quick look at an event from the calendar, with the most frequent actions. */
export function EventSheet({
  event,
  proposals,
  users,
  onClose,
}: {
  event: BoardEvent | null;
  proposals: BoardProposal[];
  users: BoardUser[];
  onClose: () => void;
}) {
  const { me } = useBoard();
  const { mutate, busy, dialog } = useMutate();
  if (!event) return null;
  const organizers = users.filter((u) => event.organizerIds.includes(u.id));
  const options = proposals.filter((p) => p.eventId === event.id);
  const canPublish = me.isAdmin && !!event.start && ["confirmed", "postponed", "cancelled", "completed"].includes(event.status);

  return (
    <>
      <Dialog
        open
        onOpenChange={(o) => !o && onClose()}
        side="right"
        title={event.title}
        description={event.categoryName}
        footer={
          <div className="flex w-full flex-wrap items-center gap-2">
            {me.isAdmin &&
              (event.isPublic ? (
                <Button variant="outline" loading={busy} onClick={() => mutate(() => publishEventAction(event.id, false, { expectedVersion: event.version }), { success: "Removed from the members calendar" })}>
                  <GlobeLock className="h-4 w-4" /> Unpublish
                </Button>
              ) : (
                <Button variant="outline" loading={busy} disabled={!canPublish} title={canPublish ? undefined : "Confirm the date before publishing"} onClick={() => mutate(() => publishEventAction(event.id, true, { expectedVersion: event.version }), { success: "Published on the members calendar" })}>
                  <Globe className="h-4 w-4" /> Publish
                </Button>
              ))}
            <Button variant="ghost" size="icon" aria-label="Duplicate" title="Duplicate" onClick={() => mutate(() => duplicateEventAction(event.id), { success: "Duplicated — the copy starts as an idea" })}>
              <Copy className="h-4 w-4" />
            </Button>
            {me.isAdmin && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Archive"
                title="Archive"
                onClick={() =>
                  mutate(() => archiveEventAction(event.id, true), {
                    success: "Archived",
                    onOk: onClose,
                    undo: () => mutate(() => archiveEventAction(event.id, false), { success: "Restored" }),
                  })
                }
              >
                <Archive className="h-4 w-4" />
              </Button>
            )}
            <Link href={`/board/events/${event.id}`} className={buttonClass("primary") + " ml-auto"}>
              Open <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusMenu
              status={event.status}
              isPublic={event.isPublic}
              disabled={!event.canEdit || (event.isPublic && !me.isAdmin)}
              onChange={(s: EventStatus) => {
                const prev = event.status;
                mutate((o) => setStatusAction(event.id, s, { ...o, expectedVersion: event.version }), {
                  success: "Status updated",
                  undo: () => mutate((o) => setStatusAction(event.id, prev, o), { success: "Status restored" }),
                });
              }}
            />
            <VisibilityBadge isPublic={event.isPublic} />
          </div>

          {event.violation && !event.overrideReason && (
            <Callout tone="danger" icon={<ShieldAlert />} title="Inside a restricted period">
              {event.violation}
            </Callout>
          )}
          {event.overrideReason && (
            <Callout tone="warn" icon={<ShieldCheck />} title="Scheduled by Super Admin exception">
              {event.overrideReason}
            </Callout>
          )}

          <dl className="flex flex-col gap-3 text-[13px]">
            <Row icon={<CalendarClock />}>
              {event.start ? formatWallRange(event.start, event.end, event.allDay) : <span className="text-ink-3">No date yet{options.length ? ` — ${options.length} option${options.length > 1 ? "s" : ""} on hold` : ""}</span>}
            </Row>
            {event.location && <Row icon={<MapPin />}>{event.location}</Row>}
            {event.speakerName && (
              <Row icon={<Mic2 />}>
                {event.speakerName}
                {event.speakerOrg && <span className="text-ink-3"> · {event.speakerOrg}</span>}
              </Row>
            )}
            {event.totalTasks > 0 && (
              <Row icon={<CheckCircle2 />}>
                {event.totalTasks - event.openTasks} of {event.totalTasks} tasks done
                <span className="ml-2 inline-block h-1.5 w-24 overflow-hidden rounded-full bg-surface-3 align-middle">
                  <span className="block h-full rounded-full bg-ok" style={{ width: `${((event.totalTasks - event.openTasks) / event.totalTasks) * 100}%` }} />
                </span>
              </Row>
            )}
          </dl>

          {organizers.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Organisers</p>
              <div className="flex flex-wrap gap-2">
                {organizers.map((u) => (
                  <span key={u.id} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pl-0.5 pr-2.5 text-xs">
                    <Avatar name={u.name} size={20} /> {u.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {options.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Proposed dates</p>
              <ul className="flex flex-col gap-2">
                {options.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 rounded-lg border border-dashed border-line-strong px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{formatWallRange(p.start, p.end)}</p>
                      <Badge tone={AVAIL[p.availability].tone} className="mt-1">{AVAIL[p.availability].label}</Badge>
                    </div>
                    {event.canEdit && p.availability !== "unavailable" && (
                      <Button size="sm" variant="outline" loading={busy} onClick={() => mutate((o) => confirmProposalAction(p.id, { ...o, expectedVersion: event.version }), { success: "Date confirmed — other options released" })}>
                        Confirm
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Dialog>
      {dialog}
    </>
  );
}

function Row({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="mt-0.5 text-ink-3 [&_svg]:h-4 [&_svg]:w-4">{icon}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}
