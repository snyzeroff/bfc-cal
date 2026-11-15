import { BoardCalendar } from "@/components/board/calendar";
import { requireUser } from "@/lib/auth/session";
import { loadCalendarData } from "@/lib/board-data";

export const metadata = { title: "Board calendar" };

export default async function CalendarPage() {
  const user = await requireUser();
  const data = await loadCalendarData(user);
  return <BoardCalendar data={data} />;
}
