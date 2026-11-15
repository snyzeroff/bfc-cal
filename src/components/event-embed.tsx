import { isAllowedEmbed } from "@/lib/embed";
import { cn } from "@/lib/cn";

/** Sandboxed registration widget. Renders nothing unless the address passes the allow-list. */
export function EventEmbed({ url, title, className }: { url: string; title: string; className?: string }) {
  if (!isAllowedEmbed(url)) return null;
  return (
    <iframe
      src={url}
      title={`Registration — ${title}`}
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
      allow="fullscreen; payment"
      className={cn("block h-[450px] w-full rounded-xl border border-line bg-surface", className)}
    />
  );
}
