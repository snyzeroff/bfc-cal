import { sql as dsql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { SetupForm } from "./setup-form";

export const metadata = { title: "First-time setup", robots: { index: false } };

export default async function SetupPage() {
  const [{ n }] = await db.select({ n: dsql<number>`count(*)::int` }).from(users);
  // The page exists only until the first account is created.
  if (n > 0) redirect("/login");
  const appearance = await getSetting("appearance");
  return (
    <main className="grid min-h-dvh place-items-center px-6 py-10">
      <div className="w-full max-w-sm">
        <Logo shortName={appearance.shortName} size={40} />
        <h1 className="mt-5 font-display text-4xl leading-tight">First-time setup</h1>
        <p className="mt-2 text-[13px] text-ink-3">
          Create the first Super Admin account for {appearance.orgName}. This page closes for good as soon as the account exists; everyone else is then invited from Settings.
        </p>
        <SetupForm />
      </div>
    </main>
  );
}
