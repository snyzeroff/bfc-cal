"use client";

import { ChevronDown, Globe, Lock } from "lucide-react";
import { EVENT_STATUSES, type EventStatus } from "@/db/schema";
import { Badge, Menu, MenuItem, MenuLabel } from "@/components/ui";
import { STATUS_META, statusColor, statusLabel } from "@/lib/appearance";
import { useBoard } from "./context";

export function StatusBadge({ status, className }: { status: EventStatus; className?: string }) {
  const { appearance } = useBoard();
  return (
    <Badge color={statusColor(appearance, status)} className={className}>
      {statusLabel(appearance, status)}
    </Badge>
  );
}

export function VisibilityBadge({ isPublic }: { isPublic: boolean }) {
  return isPublic ? (
    <Badge tone="brand"><Globe className="h-3 w-3" /> Public</Badge>
  ) : (
    <Badge><Lock className="h-3 w-3" /> Board only</Badge>
  );
}

/** Quick status change. "Published" is intentionally absent: publishing is its own action. */
export function StatusMenu({
  status,
  onChange,
  disabled,
  isPublic,
}: {
  status: EventStatus;
  onChange: (s: EventStatus) => void;
  disabled?: boolean;
  isPublic: boolean;
}) {
  const { appearance } = useBoard();
  const options = EVENT_STATUSES.filter((s) => s !== "published" || isPublic);
  return (
    <Menu
      align="start"
      trigger={
        <button
          disabled={disabled}
          aria-label={`Status: ${statusLabel(appearance, status)}. Change status`}
          className="inline-flex items-center gap-1 rounded-full pr-1.5 hover:bg-surface-2 disabled:pointer-events-none"
        >
          <StatusBadge status={status} />
          {!disabled && <ChevronDown className="h-3 w-3 text-ink-3" />}
        </button>
      }
    >
      <MenuLabel>Set status</MenuLabel>
      {options.map((s) => (
        <MenuItem
          key={s}
          onSelect={() => s !== status && onChange(s)}
          checked={s === status}
          icon={<span className="h-2 w-2 rounded-full" style={{ background: statusColor(appearance, s) }} />}
          hint={undefined}
        >
          <span title={STATUS_META[s].hint}>{statusLabel(appearance, s)}</span>
        </MenuItem>
      ))}
    </Menu>
  );
}
