import { DashboardActions } from "@/components/board/dashboard-actions";
import { Pipeline } from "@/components/board/pipeline";
import { buttonClass } from "@/components/button-class";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { loadCalendarData } from "@/lib/board-data";
import { Download } from "lucide-react";

export const metadata = { title: "Conferences" };

export default async function EventsPage() {
  const user = await requireUser();
  const data = await loadCalendarData(user, { includeArchived: true });
  return (
    <div>
      <PageHeader
        title="Conferences & events"
        description="Nothing is public until a Board Admin publishes it."
        actions={
          <>
            <a href="/board/events/export" className={buttonClass("outline")} download>
              <Download className="h-4 w-4" /> Export CSV
            </a>
            <DashboardActions categories={data.categories} speakers={data.speakers} windows={data.windows} templates={data.templates} />
          </>
        }
      />
      <Pipeline events={data.events} users={data.users} categories={data.categories} />
    </div>
  );
}
