"use client";

import { useState } from "react";
import { ExternalLink, Link2, MessageSquare, Paperclip, Send, Trash2 } from "lucide-react";
import { addAttachmentAction, addCommentAction, deleteCommentAction, removeAttachmentAction } from "@/app/actions/events";
import { Avatar, Button, EmptyState, Input, SectionTitle, Textarea } from "@/components/ui";
import type { EventDetail } from "@/lib/board-types";
import { formatDateTime } from "@/lib/time";
import { useBoard, useMutate } from "./context";

export function DiscussionPanel({ detail, readOnly }: { detail: EventDetail; readOnly: boolean }) {
  const { me } = useBoard();
  const { mutate, busy } = useMutate();
  const [body, setBody] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const id = detail.event.id;
  const send = () => body.trim() && mutate(() => addCommentAction(id, body), { onOk: () => setBody("") });

  return (
    <div className="grid gap-8 pb-10 lg:grid-cols-[1fr_280px]">
      <section>
        <SectionTitle>Internal comments</SectionTitle>
        {detail.comments.length === 0 ? (
          <EmptyState icon={<MessageSquare className="h-5 w-5" />} title="No comments yet">Keep the speaker follow-up and decisions here so the whole board has the context.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-4">
            {detail.comments.map((c) => (
              <li key={c.id} className="group flex gap-3">
                <Avatar name={c.userName} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-ink-3">
                    <span className="font-medium text-ink">{c.userName}</span> · {formatDateTime(new Date(c.createdAt))}
                    {(c.userId === me.id || me.isAdmin) && (
                      <button onClick={() => mutate(() => deleteCommentAction(c.id))} className="ml-2 text-ink-3 opacity-0 hover:text-danger focus:opacity-100 group-hover:opacity-100 max-sm:opacity-100">Delete</button>
                    )}
                  </p>
                  <p className="mt-0.5 whitespace-pre-line text-[13px] leading-relaxed text-ink-2">{c.body}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <form
          className="mt-5 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
            }}
            placeholder="Write a comment… (visible to the board only)"
            aria-label="Comment"
            className="min-h-[60px]"
            maxLength={4000}
          />
          <Button type="submit" variant="primary" size="icon" className="h-9 w-9" aria-label="Send comment" disabled={!body.trim()} loading={busy}>
            {!busy && <Send className="h-4 w-4" />}
          </Button>
        </form>
      </section>

      <section>
        <SectionTitle>Attachments</SectionTitle>
        <p className="mb-3 text-xs text-ink-3">Links to documents (Drive, Notion, slides). Board only.</p>
        {detail.attachments.length === 0 ? (
          <p className="flex items-center gap-2 rounded-lg border border-dashed border-line-strong px-3 py-4 text-xs text-ink-3"><Paperclip className="h-3.5 w-3.5" /> Nothing attached</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {detail.attachments.map((a) => (
              <li key={a.id} className="group flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-2 text-[13px]">
                <Link2 className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                <a href={a.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate hover:underline" title={a.url}>{a.name}</a>
                <ExternalLink className="h-3 w-3 shrink-0 text-ink-3" />
                {!readOnly && (
                  <button aria-label={`Remove ${a.name}`} onClick={() => mutate(() => removeAttachmentAction(a.id))} className="text-ink-3 hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!readOnly && (
          <form
            className="mt-3 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (url.trim()) mutate(() => addAttachmentAction(id, { name, url }), { onOk: () => (setName(""), setUrl("")) });
            }}
          >
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label="Link" inputMode="url" />
            <div className="flex gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" aria-label="Name" maxLength={120} />
              <Button type="submit" variant="outline" disabled={!url.trim()}>Attach</Button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

const FIELD_LABEL: Record<string, string> = {
  title: "Title",
  description: "Description",
  internalNotes: "Internal notes",
  startAt: "Start",
  endAt: "End",
  allDay: "All day",
  location: "Location",
  onlineUrl: "Online link",
  registrationUrl: "Registration link",
  status: "Status",
  speakerId: "Speaker",
  categoryId: "Category",
  isPublic: "Public",
  color: "Colour",
  audience: "Audience",
  organizers: "Organisers",
  scheduledPublishAt: "Scheduled publication",
  overrideReason: "Exception reason",
  availability: "Speaker availability",
  note: "Note",
  proposal: "Proposed date",
};

function show(key: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return formatDateTime(new Date(v));
  if (["speakerId", "categoryId"].includes(key)) return "changed";
  const s = Array.isArray(v) ? v.join(", ") || "—" : String(v);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

export function HistoryPanel({ detail }: { detail: EventDetail }) {
  const e = detail.event;
  return (
    <div className="pb-10">
      <p className="mb-4 text-xs text-ink-3">
        Created {formatDateTime(new Date(e.createdAt))}{e.createdByName ? ` by ${e.createdByName}` : ""} · last modified {formatDateTime(new Date(e.updatedAt))}{e.updatedByName ? ` by ${e.updatedByName}` : ""}
      </p>
      <ol className="relative flex flex-col gap-5 border-l border-line pl-5">
        {detail.history.map((h) => (
          <li key={h.id} className="relative">
            <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-line-strong ring-4 ring-bg" />
            <p className="text-[13px] text-ink">{h.summary}</p>
            <p className="text-xs text-ink-3">{h.actorName} · {formatDateTime(new Date(h.at))}</p>
            {h.reason && <p className="mt-1 rounded-md bg-warn-soft px-2 py-1 text-xs text-ink-2">Reason: {h.reason}</p>}
            {h.changes && (
              <ul className="mt-1.5 flex flex-col gap-0.5 text-xs text-ink-3">
                {Object.entries(h.changes).filter(([k]) => FIELD_LABEL[k]).map(([k, [a, b]]) => (
                  <li key={k}>
                    <span className="text-ink-2">{FIELD_LABEL[k]}:</span> {["description", "internalNotes"].includes(k) ? "edited" : <>{show(k, a)} → <span className="text-ink-2">{show(k, b)}</span></>}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
        {detail.history.length === 0 && <li className="text-[13px] text-ink-3">No recorded changes.</li>}
      </ol>
    </div>
  );
}
