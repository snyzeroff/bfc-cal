import { CopyField, SubscribeGuide } from "@/components/subscribe";
import { appUrl } from "@/lib/feeds";
import { getSetting } from "@/lib/settings";

export const metadata = { title: "Subscribe", description: "Add the club's events to your own calendar. Updates arrive automatically." };

export default async function SubscribePage() {
  const appearance = await getSetting("appearance");
  const url = `${appUrl()}/feeds/public.ics`;
  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-ink">Stay in sync</p>
      <h1 className="mt-3 font-display text-[44px] leading-[1.02] tracking-[-0.015em]">Subscribe to the {appearance.shortName} calendar</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-ink-2">
        Add the club’s events to the calendar you already use. Unlike a downloaded file, a subscription stays connected: new conferences appear by themselves, and changes of time, room or a cancellation are updated for you.
      </p>
      <div className="mt-8 flex flex-col gap-6 rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-7">
        <div>
          <p className="mb-2 text-xs font-medium text-ink-2">Calendar address</p>
          <CopyField value={url} label="Calendar address" />
        </div>
        <SubscribeGuide url={url} name={`${appearance.shortName} events`} />
      </div>
      <dl className="mt-10 grid gap-6 text-[13px] sm:grid-cols-2">
        <div>
          <dt className="font-medium text-ink">How fast do changes arrive?</dt>
          <dd className="mt-1 leading-relaxed text-ink-3">The calendar address always returns the latest information. Your app decides how often it checks: Apple Calendar can refresh hourly, Outlook every few hours, Google Calendar up to once a day.</dd>
        </div>
        <div>
          <dt className="font-medium text-ink">What happens when an event is cancelled?</dt>
          <dd className="mt-1 leading-relaxed text-ink-3">It is marked as cancelled in your calendar at the next refresh, then removed after a few weeks. The website always shows the current status.</dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Is it private?</dt>
          <dd className="mt-1 leading-relaxed text-ink-3">The address only contains public events and no personal data. Subscribing does not share anything about you with the club.</dd>
        </div>
        <div>
          <dt className="font-medium text-ink">How do I unsubscribe?</dt>
          <dd className="mt-1 leading-relaxed text-ink-3">Delete the subscribed calendar in your calendar app. All its events disappear with it.</dd>
        </div>
      </dl>
    </div>
  );
}
