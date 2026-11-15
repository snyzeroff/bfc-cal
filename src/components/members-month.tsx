"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { PublicEventJson } from "@/lib/public";
import { instantToWall } from "@/lib/time";

export function MembersMonth({ events: filtered, weekStartsOn }: { events: PublicEventJson[]; weekStartsOn: 0 | 1 }) {
  const router = useRouter();
  const cal = useRef<FullCalendar>(null);
  const [title, setTitle] = useState("");
  return (
        <div>
          <div className="mb-3 flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => cal.current?.getApi().today()}>Today</Button>
            <Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => cal.current?.getApi().prev()}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" aria-label="Next month" onClick={() => cal.current?.getApi().next()}><ChevronRight className="h-4 w-4" /></Button>
            <h2 className="ml-2 font-display text-2xl" aria-live="polite">{title}</h2>
          </div>
          <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
            <FullCalendar
              ref={cal}
              plugins={[dayGridPlugin]}
              initialView="dayGridMonth"
              headerToolbar={false}
              timeZone="UTC"
              now={() => `${instantToWall(new Date())}:00Z`}
              firstDay={weekStartsOn}
              height="auto"
              dayMaxEvents={3}
              displayEventTime={false}
              datesSet={(a) => setTitle(a.view.title)}
              events={filtered.map((e) => {
                const s = instantToWall(new Date(e.start));
                const en = instantToWall(new Date(e.end));
                return { id: e.id, title: e.title, start: e.allDay ? s.slice(0, 10) : `${s}:00Z`, end: e.allDay ? en.slice(0, 10) : `${en}:00Z`, allDay: e.allDay, extendedProps: { e, time: s.slice(11) } };
              })}
              eventClick={(a) => router.push(`/events/${a.event.id}`)}
              eventContent={(a) => {
                const e = a.event.extendedProps.e as PublicEventJson;
                return (
                  <div className={cn("ev-chip", e.status === "cancelled" && "ev-cancelled")} style={{ "--c": e.category.color } as React.CSSProperties} title={e.title}>
                    {!e.allDay && <span className="ev-time">{a.event.extendedProps.time}</span>}
                    <span className="ev-title">{e.title}</span>
                  </div>
                );
              }}
            />
          </div>
        </div>
  );
}
