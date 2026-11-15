import { requireUser } from "@/lib/auth/session";
import { countPendingCandidates, toMe } from "@/lib/board-data";
import { getSetting } from "@/lib/settings";
import { BoardProvider } from "@/components/board/context";
import { BoardShell } from "./shell";

export const metadata = { robots: { index: false, follow: false } };

export default async function BoardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [appearance, pending] = await Promise.all([getSetting("appearance"), countPendingCandidates()]);
  return (
    <BoardProvider me={toMe(user)} appearance={appearance}>
    <BoardShell me={toMe(user)} orgName={appearance.orgName} shortName={appearance.shortName} pendingReview={pending}>
      {children}
    </BoardShell>
    </BoardProvider>
  );
}
