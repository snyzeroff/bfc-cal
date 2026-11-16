import { notFound } from "next/navigation";
import { EventEditor } from "@/components/board/event-editor";
import { requireUser } from "@/lib/auth/session";
import { loadCalendarData, loadEventDetail } from "@/lib/board-data";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const detail = await loadEventDetail(user, (await params).id);
  return { title: detail?.event.title ?? "Event" };
}

export default async function EventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  const [detail, data] = await Promise.all([loadEventDetail(user, id), loadCalendarData(user, { includeArchived: true })]);
  if (!detail) notFound();
  return <EventEditor detail={detail} categories={data.categories} speakers={data.speakers} users={data.users} layers={data.layers} windows={data.windows} initialTab={tab} />;
}
