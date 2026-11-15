import { Briefcase, CalendarDays, Coffee, Flag, Globe, GraduationCap, Handshake, LineChart, Mic, Presentation, Trophy, Users, type LucideIcon } from "lucide-react";

/** Icons an administrator can choose for a category (Settings → Categories). */
export const CATEGORY_ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  calendar: { icon: CalendarDays, label: "Calendar" },
  mic: { icon: Mic, label: "Microphone" },
  presentation: { icon: Presentation, label: "Presentation" },
  users: { icon: Users, label: "People" },
  handshake: { icon: Handshake, label: "Handshake" },
  briefcase: { icon: Briefcase, label: "Briefcase" },
  chart: { icon: LineChart, label: "Chart" },
  graduation: { icon: GraduationCap, label: "Graduation" },
  trophy: { icon: Trophy, label: "Trophy" },
  coffee: { icon: Coffee, label: "Coffee" },
  globe: { icon: Globe, label: "Globe" },
  flag: { icon: Flag, label: "Flag" },
};

export function CategoryIcon({ name, className }: { name: string; className?: string }) {
  const Icon = (CATEGORY_ICONS[name] ?? CATEGORY_ICONS.calendar).icon;
  return <Icon className={className ?? "h-3.5 w-3.5"} aria-hidden />;
}
