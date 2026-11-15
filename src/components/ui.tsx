"use client";

import * as React from "react";
import { Dialog as RDialog, DropdownMenu as RMenu, Popover as RPopover, Select as RSelect, Switch as RSwitch, Tabs as RTabs, Tooltip as RTooltip } from "radix-ui";
import { Check, ChevronDown, Loader2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { buttonClass, type ButtonVariant, type ButtonSize } from "./button-class";

export { buttonClass };

/* ------------------------------------------------------------------ Button */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, loading, className, children, disabled, type = "button", ...props },
  ref,
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} className={cn(buttonClass(variant, size), className)} {...props}>
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

/* ------------------------------------------------------------------ Fields */

const fieldBase =
  "w-full rounded-lg border border-line-strong bg-surface px-3 text-[13px] text-ink placeholder:text-ink-3 transition-[border-color,box-shadow] hover:border-ink-3 focus:border-brand-ink focus:outline-none focus:ring-2 focus:ring-brand-ink/15 disabled:bg-surface-2 disabled:text-ink-3";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(fieldBase, "h-9", className)} {...props} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(fieldBase, "min-h-[88px] py-2 leading-relaxed", className)} {...props} />;
  },
);

type Option = { value: string; label: string; disabled?: boolean };

/** Reads `<option>` children, so call sites look the same as with a native select. */
function readOptions(children: React.ReactNode): Option[] {
  const out: Option[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const props = child.props as { value?: string | number; children?: React.ReactNode; disabled?: boolean };
    if (child.type === "option") {
      const label = React.Children.toArray(props.children).join("");
      out.push({ value: String(props.value ?? label), label, disabled: props.disabled });
    } else if (props.children) {
      out.push(...readOptions(props.children));
    }
  });
  return out;
}

// Radix reserves the empty string for "no value"; ours is a real choice ("Unassigned", "Anyone"…).
const EMPTY = "__empty__";

type SelectProps = {
  value?: string | number;
  onChange?: (e: { target: { value: string } }) => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  /** A small visual in front of each choice, e.g. an avatar. */
  optionIcon?: (value: string) => React.ReactNode;
};

export function Select({ value, onChange, children, className, disabled, optionIcon, ...aria }: SelectProps) {
  const options = readOptions(children);
  const current = String(value ?? "");
  const selected = options.find((o) => o.value === current);
  return (
    <RSelect.Root value={current || EMPTY} onValueChange={(v) => onChange?.({ target: { value: v === EMPTY ? "" : v } })} disabled={disabled}>
      <RSelect.Trigger
        {...aria}
        className={cn(
          fieldBase,
          "group flex h-9 items-center justify-between gap-2 text-left data-[state=open]:border-brand-ink data-[state=open]:ring-2 data-[state=open]:ring-brand-ink/15 disabled:cursor-not-allowed",
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {optionIcon?.(current)}
          <span className="truncate">
            <RSelect.Value>{selected?.label ?? ""}</RSelect.Value>
          </span>
        </span>
        <RSelect.Icon>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-3 transition-transform duration-200 group-data-[state=open]:rotate-180" aria-hidden />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          sideOffset={6}
          collisionPadding={8}
          className="select-pop z-[70] max-h-[min(320px,var(--radix-select-content-available-height))] min-w-[max(var(--radix-select-trigger-width),150px)] overflow-hidden rounded-xl border border-line bg-surface shadow-lg"
        >
          <RSelect.Viewport className="scroll-thin p-1">
            {options.map((o) => (
              <RSelect.Item
                key={o.value}
                value={o.value || EMPTY}
                disabled={o.disabled}
                className="relative flex cursor-pointer select-none items-center gap-2 rounded-lg py-1.5 pl-2.5 pr-8 text-[13px] text-ink !outline-none transition-colors duration-100 data-[disabled]:cursor-not-allowed data-[highlighted]:bg-surface-2 data-[state=checked]:font-medium data-[disabled]:opacity-45"
              >
                {optionIcon?.(o.value)}
                <RSelect.ItemText>{o.label}</RSelect.ItemText>
                <RSelect.ItemIndicator className="absolute right-2.5 top-1/2 -translate-y-1/2">
                  <Check className="h-3.5 w-3.5 text-brand-ink" aria-hidden />
                </RSelect.ItemIndicator>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
  optional,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
  className?: string;
  optional?: boolean;
}) {
  const id = React.useId();
  const child = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<{ id?: string; "aria-describedby"?: string }>, {
        id: (children.props as { id?: string }).id ?? id,
        "aria-describedby": hint || error ? `${id}-hint` : undefined,
      })
    : children;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="flex items-baseline gap-1.5 text-xs font-medium text-ink-2">
        {label}
        {optional && <span className="font-normal text-ink-3">optional</span>}
      </label>
      {child}
      {(error || hint) && (
        <p id={`${id}-hint`} className={cn("text-xs", error ? "text-danger" : "text-ink-3")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  hideLabel,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  /** Keep the label for assistive technology only (e.g. a switch at the end of a table row). */
  hideLabel?: boolean;
}) {
  const id = React.useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className={hideLabel ? "sr-only" : "min-w-0"}>
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        {description && <span className="block text-xs text-ink-3">{description}</span>}
      </label>
      <RSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-line-strong transition-colors data-[state=checked]:bg-brand disabled:opacity-50"
      >
        <RSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
      </RSwitch.Root>
    </div>
  );
}

/* ------------------------------------------------------------------ Badges */

export function Badge({
  children,
  tone = "neutral",
  className,
  color,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "brand" | "ok" | "warn" | "danger" | "info";
  className?: string;
  /** Arbitrary colour (status / category colours from settings). */
  color?: string;
}) {
  return (
    <span
      style={color ? ({ "--c": color } as React.CSSProperties) : undefined}
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[11px] font-medium",
        color && "tint tint-bg",
        !color && tone === "neutral" && "bg-surface-2 text-ink-2",
        !color && tone === "brand" && "bg-brand-soft text-brand-ink",
        !color && tone === "ok" && "bg-ok-soft text-ok",
        !color && tone === "warn" && "bg-warn-soft text-warn",
        !color && tone === "danger" && "bg-danger-soft text-danger",
        !color && tone === "info" && "bg-info-soft text-info",
        className,
      )}
    >
      {color && <span className="h-1.5 w-1.5 rounded-full bg-[var(--c)]" aria-hidden />}
      {children}
    </span>
  );
}

export function Avatar({ name, size = 24, className }: { name: string; size?: number; className?: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span
      title={name}
      aria-label={name}
      style={{ width: size, height: size, fontSize: size * 0.4, background: `oklch(0.48 0.1 ${h})` }}
      className={cn("inline-grid shrink-0 place-items-center rounded-full font-semibold text-white", className)}
    >
      {initials}
    </span>
  );
}

/* ------------------------------------------------------------------ Layout */

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-xl border border-line bg-surface shadow-sm", className)} {...props}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, action, className }: { children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3 flex items-center justify-between gap-3", className)}>
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs text-ink-3">{eyebrow}</div>}
        <h1 className="font-display text-[32px] leading-[1.1] tracking-[-0.01em] text-ink">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-[13px] text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong px-6 py-12 text-center", className)}>
      {icon && <div className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-ink-3">{icon}</div>}
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <p className="mt-1 max-w-sm text-[13px] text-ink-3">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Callout({
  tone = "info",
  title,
  children,
  icon,
  className,
  action,
}: {
  tone?: "info" | "warn" | "danger" | "ok" | "neutral";
  title?: string;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "note"}
      className={cn(
        "flex gap-3 rounded-lg border px-3.5 py-3 text-[13px]",
        tone === "info" && "border-info/20 bg-info-soft text-ink",
        tone === "warn" && "border-warn/25 bg-warn-soft text-ink",
        tone === "danger" && "border-danger/25 bg-danger-soft text-ink",
        tone === "ok" && "border-ok/20 bg-ok-soft text-ink",
        tone === "neutral" && "border-line bg-surface-2 text-ink",
        className,
      )}
    >
      {icon && (
        <span
          className={cn(
            "mt-0.5 shrink-0 [&_svg]:h-4 [&_svg]:w-4",
            tone === "info" && "text-info",
            tone === "warn" && "text-warn",
            tone === "danger" && "text-danger",
            tone === "ok" && "text-ok",
            tone === "neutral" && "text-ink-3",
          )}
        >
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn("text-ink-2", title && "mt-0.5")}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ Dialog */

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  side,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** Render as a right-hand sheet (desktop) / bottom sheet (mobile). */
  side?: "right";
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px] data-[state=closed]:animate-out data-[state=open]:animate-in" />
        <RDialog.Content
          aria-describedby={description ? undefined : undefined}
          className={cn(
            "fixed z-50 flex flex-col bg-surface shadow-lg focus:outline-none",
            side === "right"
              ? "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl data-[state=closed]:animate-down-out data-[state=open]:animate-up sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[460px] sm:rounded-none sm:border-l sm:border-line sm:data-[state=closed]:animate-sheet-out sm:data-[state=open]:animate-sheet"
              : cn(
                  "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl data-[state=closed]:animate-down-out data-[state=open]:animate-up sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[86dvh] sm:w-[calc(100vw-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:border-line sm:data-[state=closed]:animate-pop-out sm:data-[state=open]:animate-pop",
                  size === "sm" && "sm:max-w-sm",
                  size === "md" && "sm:max-w-lg",
                  size === "lg" && "sm:max-w-2xl",
                  size === "xl" && "sm:max-w-4xl",
                ),
          )}
        >
          <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-5">
            <div className="min-w-0">
              <RDialog.Title className="text-base font-semibold leading-snug text-ink">{title}</RDialog.Title>
              {description ? (
                <RDialog.Description className="mt-1 text-[13px] text-ink-3">{description}</RDialog.Description>
              ) : (
                <RDialog.Description className="sr-only">{title}</RDialog.Description>
              )}
            </div>
            <RDialog.Close asChild>
              <button aria-label="Close" className="-mr-1.5 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            </RDialog.Close>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/* -------------------------------------------------------------------- Menu */

export function Menu({
  trigger,
  children,
  align = "end",
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "end" | "center";
}) {
  return (
    <RMenu.Root>
      <RMenu.Trigger asChild>{trigger}</RMenu.Trigger>
      <RMenu.Portal>
        <RMenu.Content
          align={align}
          sideOffset={6}
          className="menu-pop z-[60] min-w-[190px] rounded-xl border border-line bg-surface p-1 shadow-lg"
        >
          {children}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  );
}

export function MenuItem({
  children,
  onSelect,
  icon,
  danger,
  disabled,
  checked,
  hint,
}: {
  children: React.ReactNode;
  onSelect?: () => void;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  hint?: string;
}) {
  return (
    <RMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] outline-none data-[disabled]:cursor-not-allowed data-[highlighted]:bg-surface-2 data-[disabled]:opacity-45",
        danger ? "text-danger" : "text-ink",
      )}
    >
      {icon && <span className="grid h-4 w-4 place-items-center text-ink-3 [&_svg]:h-4 [&_svg]:w-4">{icon}</span>}
      <span className="flex-1">{children}</span>
      {hint && <span className="text-[11px] text-ink-3">{hint}</span>}
      {checked && <Check className="h-3.5 w-3.5 text-brand-ink" />}
    </RMenu.Item>
  );
}

export const MenuSeparator = () => <RMenu.Separator className="my-1 h-px bg-line" />;
export const MenuLabel = ({ children }: { children: React.ReactNode }) => (
  <RMenu.Label className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">{children}</RMenu.Label>
);

/* ----------------------------------------------------------------- Popover */

export function Popover({
  trigger,
  children,
  align = "start",
  className,
  open,
  onOpenChange,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "end" | "center";
  className?: string;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  return (
    <RPopover.Root open={open} onOpenChange={onOpenChange}>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className={cn("z-[60] w-72 rounded-xl border border-line bg-surface p-3 shadow-lg focus:outline-none", "menu-pop", className)}
        >
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

/* -------------------------------------------------------------------- Tabs */

export function Tabs({
  value,
  onValueChange,
  tabs,
  children,
  className,
}: {
  value: string;
  onValueChange: (v: string) => void;
  tabs: { value: string; label: string; count?: number }[];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <RTabs.Root value={value} onValueChange={onValueChange} className={className}>
      <RTabs.List className="scroll-thin -mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-line px-1">
        {tabs.map((t) => (
          <RTabs.Trigger
            key={t.value}
            value={t.value}
            className="relative -mb-px flex shrink-0 items-center gap-1.5 border-b-2 border-transparent px-2.5 pb-2.5 pt-1 text-[13px] font-medium text-ink-3 transition-colors hover:text-ink data-[state=active]:border-brand-ink data-[state=active]:text-ink"
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="rounded-full bg-surface-2 px-1.5 text-[11px] tabular text-ink-3">{t.count}</span>
            )}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {children}
    </RTabs.Root>
  );
}
export const TabPanel = ({ value, children }: { value: string; children: React.ReactNode }) => (
  <RTabs.Content value={value} className="focus:outline-none">
    {children}
  </RTabs.Content>
);

/* ----------------------------------------------------------------- Tooltip */

export function Tip({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <RTooltip.Provider delayDuration={250}>
      <RTooltip.Root>
        <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
        <RTooltip.Portal>
          <RTooltip.Content
            sideOffset={6}
            className="z-[70] max-w-xs rounded-md bg-ink px-2 py-1 text-xs text-bg shadow-md animate-in"
          >
            {label}
          </RTooltip.Content>
        </RTooltip.Portal>
      </RTooltip.Root>
    </RTooltip.Provider>
  );
}

/* ------------------------------------------------------------ Segmented */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; title?: string }[];
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md font-medium transition-[background,color,box-shadow]",
            size === "sm" ? "h-6 px-2 text-xs" : "h-8 px-3 text-[13px]",
            value === o.value ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ ColorField */

export const SWATCHES = ["#841E21", "#CF2B36", "#B4532A", "#C98A1B", "#2F9461", "#2F7D6B", "#2F8FB5", "#3F5B8C", "#7C6BD6", "#A8549B", "#5B6470", "#1C1716"];

export function ColorField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Colour ${c}`}
          aria-pressed={value.toLowerCase() === c.toLowerCase()}
          onClick={() => onChange(c)}
          style={{ background: c }}
          className={cn(
            "h-6 w-6 rounded-full ring-offset-2 ring-offset-surface transition-shadow",
            value.toLowerCase() === c.toLowerCase() ? "ring-2 ring-ink" : "hover:ring-2 hover:ring-line-strong",
          )}
        />
      ))}
      <label className="relative ml-1 inline-flex h-6 items-center gap-1.5 rounded-full border border-line-strong pl-1 pr-2 text-[11px] text-ink-3">
        <span className="h-4 w-4 rounded-full" style={{ background: value }} />
        <span className="font-mono uppercase">{value}</span>
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#841e21"}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label={`${label} — custom colour`}
        />
      </label>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin text-ink-3", className)} aria-label="Loading" />;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-grid h-5 min-w-5 place-items-center rounded border border-line-strong bg-surface px-1 font-sans text-[10px] font-medium text-ink-3">
      {children}
    </kbd>
  );
}
