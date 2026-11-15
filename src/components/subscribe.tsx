"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, buttonClass } from "@/components/ui";
import { cn } from "@/lib/cn";

export function CopyField({ value, label, secret }: { value: string; label: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const el = document.createElement("textarea");
      el.value = value;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      el.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className="flex items-stretch gap-2">
      <input readOnly value={value} aria-label={label} onFocus={(e) => e.target.select()} className={cn("h-10 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface-2 px-3 font-mono text-xs text-ink-2 focus:outline-none focus:ring-2 focus:ring-brand-ink/20", secret && "tracking-tight")} />
      <Button variant="outline" onClick={copy} className="h-10" aria-live="polite">
        {copied ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

const APPS = ["Apple Calendar", "Google Calendar", "Outlook", "Other"] as const;

/** One-click links and step-by-step instructions for each calendar app. */
export function SubscribeGuide({ url, name, isPrivate }: { url: string; name: string; isPrivate?: boolean }) {
  const [app, setApp] = useState<(typeof APPS)[number]>("Apple Calendar");
  const webcal = url.replace(/^https?:\/\//, "webcal://");
  const google = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
  const outlook = `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`;
  const outlook365 = `https://outlook.office.com/calendar/0/addfromweb?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`;
  return (
    <div>
      <div role="tablist" aria-label="Calendar app" className="scroll-thin flex gap-1 overflow-x-auto border-b border-line">
        {APPS.map((a) => (
          <button key={a} role="tab" aria-selected={app === a} onClick={() => setApp(a)} className={cn("-mb-px shrink-0 border-b-2 px-3 pb-2 pt-1 text-[13px] font-medium", app === a ? "border-brand-ink text-ink" : "border-transparent text-ink-3 hover:text-ink")}>
            {a}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="pt-4 text-[13px] leading-relaxed text-ink-2">
        {app === "Apple Calendar" && (
          <>
            <a href={webcal} className={buttonClass("primary")}>Subscribe in Apple Calendar</a>
            <ol className="mt-4 list-decimal space-y-1 pl-5">
              <li>Tap the button and confirm <em>Subscribe</em>.</li>
              <li>If nothing happens: Calendar → <em>File → New Calendar Subscription…</em> (Mac) or <em>Calendars → Add Calendar → Add Subscription Calendar</em> (iPhone), then paste the address.</li>
              <li>Set <em>Auto-refresh</em> to “Every hour”.</li>
            </ol>
          </>
        )}
        {app === "Google Calendar" && (
          <>
            <a href={google} target="_blank" rel="noopener noreferrer" className={buttonClass("primary")}>Add to Google Calendar</a>
            <ol className="mt-4 list-decimal space-y-1 pl-5">
              <li>Sign in and confirm <em>Add</em>.</li>
              <li>Or: Google Calendar on a computer → <em>Other calendars → + → From URL</em>, paste the address.</li>
            </ol>
            <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-xs">Google refreshes subscribed calendars on its own schedule — often every 12 to 24 hours — and offers no way to speed it up.</p>
          </>
        )}
        {app === "Outlook" && (
          <>
            <div className="flex flex-wrap gap-2">
              <a href={outlook365} target="_blank" rel="noopener noreferrer" className={buttonClass("primary")}>Outlook (school / work)</a>
              <a href={outlook} target="_blank" rel="noopener noreferrer" className={buttonClass("outline")}>Outlook.com (personal)</a>
            </div>
            <ol className="mt-4 list-decimal space-y-1 pl-5">
              <li>Confirm <em>Import</em> on the page that opens.</li>
              <li>Or: Outlook → Calendar → <em>Add calendar → Subscribe from web</em>, paste the address.</li>
            </ol>
            <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-xs">Outlook refreshes every few hours.</p>
          </>
        )}
        {app === "Other" && (
          <ol className="list-decimal space-y-1 pl-5">
            <li>Copy the address above.</li>
            <li>In your calendar app, look for <em>Subscribe</em>, <em>Add by URL</em> or <em>Add internet calendar</em> (not “Import”, which never updates).</li>
            <li>Paste the address.</li>
          </ol>
        )}
        {isPrivate && <p className="mt-4 text-xs text-ink-3">Anyone with this address can read the board calendar. Do not share it; rotate it if it leaks.</p>}
      </div>
    </div>
  );
}
