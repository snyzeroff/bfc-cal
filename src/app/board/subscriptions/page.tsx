import { and, desc, eq, isNull } from "drizzle-orm";
import { Subscriptions } from "@/components/board/subscriptions";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import { feedTokens } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { appUrl } from "@/lib/feeds";
import { getSetting } from "@/lib/settings";

export const metadata = { title: "Subscriptions" };

export default async function SubscriptionsPage() {
  const user = await requireUser();
  const [tokens, feed, appearance] = await Promise.all([
    db.select().from(feedTokens).where(and(eq(feedTokens.userId, user.id), isNull(feedTokens.revokedAt))).orderBy(desc(feedTokens.createdAt)),
    getSetting("feed"),
    getSetting("appearance"),
  ]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Calendar subscriptions" description="See BFC events in your own calendar app. Subscriptions update by themselves — there is nothing to re-import when an event changes." />
      <Subscriptions
        publicUrl={`${appUrl()}/feeds/public.ics`}
        shortName={appearance.shortName}
        retentionDays={feed.cancelledRetentionDays}
        tokens={tokens.map((t) => ({ id: t.id, label: t.label, includeTentative: t.includeTentative, includeDeadlines: t.includeDeadlines, createdAt: t.createdAt.toISOString(), lastUsedAt: t.lastUsedAt?.toISOString() ?? null }))}
      />
    </div>
  );
}
