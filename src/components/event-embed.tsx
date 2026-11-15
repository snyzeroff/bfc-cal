import { ArrowUpRight } from "lucide-react";
import { isAllowedEmbed } from "@/lib/embed";
import { cn } from "@/lib/cn";

/** Public page of the event on the platform, derived from the embed address. */
const eventPage = (url: string) => url.replace("/embed/event/", "/event/").replace(/\/simple$/, "");

/**
 * Sandboxed registration widget, shown unfolded. A page cannot read the height of another
 * site's frame, so the frame is sized from its own width with heights measured on Luma's
 * widget (see `.embed` in globals.css). Scrolling stays available as a safety net.
 *
 * `column` keeps the widget in Luma's one-column layout, at the widest size that layout allows,
 * so a long title has the most room. `wide` lets it use Luma's two-column layout when there is space.
 */
export function EventEmbed({ url, title, layout = "column", className }: { url: string; title: string; layout?: "column" | "wide"; className?: string }) {
  if (!isAllowedEmbed(url)) return null;
  return (
    <div className={cn("embed", layout === "wide" && "embed-wide")}>
      <iframe
        src={url}
        title={`Registration — ${title}`}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        allow="fullscreen; payment"
        className={cn("block rounded-xl border border-line bg-surface", className)}
      />
      {/* Our own link, added for every widget: same destination as the widget's footer, with a drawn arrow. */}
      <a href={eventPage(url)} target="_blank" rel="noopener noreferrer" className="mt-2.5 inline-flex items-center gap-1 text-[13px] font-medium text-brand-ink underline-offset-2 hover:underline">
        Open the full event page on Luma <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
      </a>
    </div>
  );
}
