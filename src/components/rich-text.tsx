import { ArrowDown, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, type LucideIcon } from "lucide-react";

/**
 * Arrow characters render as colourful emoji on some systems (notably Windows).
 * Text written by the board is shown with a drawn icon in their place, so it
 * looks the same everywhere.
 */
const ARROWS: Record<string, LucideIcon> = {
  "↗": ArrowUpRight,
  "➡": ArrowRight,
  "→": ArrowRight,
  "⬅": ArrowLeft,
  "←": ArrowLeft,
  "⬆": ArrowUp,
  "↑": ArrowUp,
  "⬇": ArrowDown,
  "↓": ArrowDown,
  "↘": ArrowDownRight,
};
const PATTERN = /([↗➡→⬅←⬆↑⬇↓↘])️?/g;

export function RichText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(PATTERN)) {
    const Icon = ARROWS[m[1]];
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<Icon key={m.index} aria-hidden className="inline-block h-[1em] w-[1em] align-[-0.125em]" />);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
