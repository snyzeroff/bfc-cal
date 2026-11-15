import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/logo";

/** Field and button sizing shared by the sign-in, setup and invite forms: 48px targets, 16px text (no iOS zoom). */
export const authInput = "h-12 rounded-xl px-3.5 text-base";
export const authButton = "mt-2 h-12 w-full text-[15px]";

/** One calm, centred column: logo, title, the form in a card, and at most one quiet line under it. */
export function AuthShell({
  title,
  subtitle,
  back,
  footer,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  /** A way out, shown top-left. */
  back?: { href: string; label: string };
  /** One quiet line under the card. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col px-4 pb-12 pt-4 sm:px-6 sm:pb-14 sm:pt-6">
      <div className="h-8">
        {back && (
          <Link href={back.href} className="inline-flex h-8 items-center gap-1.5 rounded-full text-[13px] text-ink-3 hover:text-ink">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {back.label}
          </Link>
        )}
      </div>
      <div className="rise m-auto w-full max-w-[380px] py-8">
        <div className="flex flex-col items-center text-center">
          <Logo size={56} />
          <h1 className="mt-6 font-display text-[2rem] leading-[1.1] tracking-[-0.028em]">{title}</h1>
          {subtitle && <p className="mt-2 max-w-full text-balance break-words text-[15px] leading-snug text-ink-3">{subtitle}</p>}
        </div>
        <div className="mt-8 rounded-3xl bg-surface p-5 shadow-md ring-1 ring-line sm:p-8">{children}</div>
        {footer && <p className="mt-6 text-center text-[13px] text-ink-3">{footer}</p>}
      </div>
    </main>
  );
}
