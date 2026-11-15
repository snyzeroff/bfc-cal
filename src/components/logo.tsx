import { cn } from "@/lib/cn";

/** Monogram mark: a serif initial on the brand colour. */
export function Logo({ shortName, size = 28, className }: { shortName: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.5 }}
      className={cn("inline-grid shrink-0 place-items-center rounded-[28%] bg-brand font-display leading-none text-on-brand shadow-sm", className)}
    >
      {shortName.slice(0, 1)}
    </span>
  );
}
