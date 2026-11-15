import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "sonner";
import { appUrl } from "@/lib/app-url";
import { getSetting } from "@/lib/settings";
import "./globals.css";

// Every page shows live, permission-dependent data.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const a = await getSetting("appearance");
  return {
    title: { default: `${a.shortName} Calendar`, template: `%s · ${a.shortName} Calendar` },
    description: a.tagline,
    metadataBase: new URL(appUrl()),
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8f5" },
    { media: "(prefers-color-scheme: dark)", color: "#121011" },
  ],
};

const themeScript = (fallback: string) => `(function(){try{var m=document.cookie.match(/(?:^|; )bfc_theme=(light|dark|system)/);var t=m?m[1]:${JSON.stringify(fallback)};if(t==="system")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}})()`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [appearance, jar] = await Promise.all([getSetting("appearance"), cookies()]);
  const stored = jar.get("bfc_theme")?.value;
  const pref = stored === "light" || stored === "dark" || stored === "system" ? stored : appearance.defaultTheme;
  const brand = {
    "--brand": appearance.brand.primary,
    "--brand-deep": appearance.brand.deep,
    "--brand-accent": appearance.brand.accent,
  } as React.CSSProperties;

  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
      data-theme={pref === "system" ? undefined : pref}
      data-density={appearance.density}
      data-event-style={appearance.eventStyle}
      style={brand}
      suppressHydrationWarning
    >
      <head>
        <script type={typeof window === "undefined" ? "text/javascript" : "text/plain"} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeScript(appearance.defaultTheme) }} />
      </head>
      <body className="min-h-full">
        {children}
        <Toaster position="bottom-right" toastOptions={{ classNames: { toast: "!rounded-xl !border-line !bg-surface !text-ink !shadow-lg !font-sans", description: "!text-ink-3", actionButton: "!bg-brand !text-on-brand" } }} />
      </body>
    </html>
  );
}
