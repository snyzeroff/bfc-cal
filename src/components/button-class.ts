import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

/** Shared by <Button> and by links styled as buttons (usable from server components). */
export const buttonClass = (variant: ButtonVariant = "secondary", size: ButtonSize = "md") =>
  cn(
    "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-[background,box-shadow,color,transform] duration-150 select-none active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100",
    size === "sm" && "h-7 px-2.5 text-xs",
    size === "md" && "h-9 px-3.5 text-[13px]",
    size === "lg" && "h-11 px-5 text-sm",
    size === "icon" && "h-8 w-8",
    variant === "primary" && "bg-brand text-on-brand shadow-sm hover:bg-brand-deep",
    variant === "secondary" && "bg-surface-2 text-ink hover:bg-surface-3",
    variant === "outline" && "border border-line-strong bg-surface text-ink hover:bg-surface-2",
    variant === "ghost" && "text-ink-2 hover:bg-surface-2 hover:text-ink",
    variant === "danger" && "bg-danger-soft text-danger hover:bg-danger hover:text-white",
  );
