"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui";
import type { CalendarData } from "@/lib/board-types";
import { NewEventDialog } from "./new-event-dialog";

export function DashboardActions(props: Pick<CalendarData, "categories" | "speakers" | "windows" | "templates"> & { label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> {props.label ?? "New event"}
      </Button>
      <NewEventDialog open={open} onOpenChange={setOpen} categories={props.categories} speakers={props.speakers} windows={props.windows} templates={props.templates} />
    </>
  );
}
