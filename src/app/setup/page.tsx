import { sql as dsql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { db } from "@/db";
import { users } from "@/db/schema";
import { SetupForm } from "./setup-form";

export const metadata = { title: "First-time setup", robots: { index: false } };

export default async function SetupPage() {
  const [{ n }] = await db.select({ n: dsql<number>`count(*)::int` }).from(users);
  // The page exists only until the first account is created.
  if (n > 0) redirect("/login");
  return (
    <AuthShell title="First-time setup" subtitle="Create the first Super Admin account">
      <SetupForm needsCode={!!process.env.SETUP_TOKEN} />
    </AuthShell>
  );
}
