import { CopyField, SubscribeGuide } from "@/components/subscribe";
import { appUrl } from "@/lib/feeds";
import { getSetting } from "@/lib/settings";

export const metadata = { title: "Subscribe", description: "Add the club's events to your own calendar." };

export default async function SubscribePage() {
  const appearance = await getSetting("appearance");
  const url = `${appUrl()}/feeds/public.ics`;
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-[clamp(2.2rem,5.5vw,3.25rem)] leading-[1.05] tracking-[-0.035em]">Subscribe to the {appearance.shortName} calendar</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-ink-2">
        New events and changes appear in your own calendar.
      </p>
      <div className="mt-8 flex flex-col gap-6 rounded-3xl bg-surface p-5 shadow-md ring-1 ring-line sm:p-8">
        <div>
          <p className="mb-2 text-xs font-medium text-ink-2">Calendar address</p>
          <CopyField value={url} label="Calendar address" />
        </div>
        <SubscribeGuide url={url} name={`${appearance.shortName} events`} />
      </div>
      <dl className="mt-10 grid gap-6 text-[13px] sm:grid-cols-2">
        <div>
          <dt className="font-medium text-ink">How fast do changes arrive?</dt>
          <dd className="mt-1 leading-relaxed text-ink-3">Apple Calendar can refresh hourly, Outlook every few hours, Google Calendar up to once a day.</dd>
        </div>
        <div>
          <dt className="font-medium text-ink">What happens when an event is cancelled?</dt>
          <dd className="mt-1 leading-relaxed text-ink-3">It is marked as cancelled at the next refresh, then removed after a few weeks.</dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Is it private?</dt>
          <dd className="mt-1 leading-relaxed text-ink-3">The address contains public events only. Subscribing shares nothing about you.</dd>
        </div>
        <div>
          <dt className="font-medium text-ink">How do I unsubscribe?</dt>
          <dd className="mt-1 leading-relaxed text-ink-3">Delete the subscribed calendar in your calendar app.</dd>
        </div>
      </dl>
    </div>
  );
}
