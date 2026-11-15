import { ArrowUpRight } from "lucide-react";
import { isAllowedEmbed } from "@/lib/embed";
import { cn } from "@/lib/cn";

/** Public page of the event on the platform, derived from the embed address. */
const eventPage = (url: string) => url.replace("/embed/event/", "/event/").replace(/\/simple$/, "");

/** Sandboxed registration widget. Renders nothing unless the address passes the allow-list. */
export function EventEmbed({ url, title, className }: { url: string; title: string; className?: string }) {
  if (!isAllowedEmbed(url)) return null;
  return (
    <div>
      <iframe
        src={url}
        title={`Registration — ${title}`}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        allow="fullscreen; payment"
        className={cn("block h-[450px] w-full rounded-xl border border-line bg-surface", className)}
      />
      {/* Our own link, added for every widget: same destination as the widget's footer, with a drawn arrow. */}
      <a href={eventPage(url)} target="_blank" rel="noopener noreferrer" className="mt-2.5 inline-flex items-center gap-1 text-[13px] font-medium text-brand-ink underline-offset-2 hover:underline">
        Open the full event page on Luma <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
      </a>
    </div>
  );
}
