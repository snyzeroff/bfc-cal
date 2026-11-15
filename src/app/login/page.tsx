import { sql as dsql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getUser } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";
import { LoginForm } from "./login-form";

export const metadata = { title: "Board sign-in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const [user, appearance, sp] = await Promise.all([getUser(), getSetting("appearance"), searchParams]);
  const next = sp.next && sp.next.startsWith("/board") ? sp.next : "/board";
  if (user) redirect(next);
  // Brand-new installation: nobody can sign in yet, so start with the setup page.
  const [{ n }] = await db.select({ n: dsql<number>`count(*)::int` }).from(users);
  if (n === 0) redirect("/setup");
  return (
    <AuthShell title="Sign in" subtitle={`${appearance.orgName} board`} back={{ href: "/", label: "Members calendar" }} footer="Forgot your password? Ask a Super Admin.">
      <LoginForm next={next} />
    </AuthShell>
  );
}
