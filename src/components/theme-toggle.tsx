"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Menu, MenuItem } from "./ui";

type Pref = "light" | "dark" | "system";

const listeners = new Set<() => void>();
const readPref = (): Pref => (document.cookie.match(/(?:^|; )bfc_theme=(light|dark|system)/)?.[1] as Pref | undefined) ?? "system";
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

function apply(pref: Pref) {
  const t = pref === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : pref;
  document.documentElement.dataset.theme = t;
}

function choose(pref: Pref) {
  document.cookie = `bfc_theme=${pref}; path=/; max-age=31536000; samesite=lax`;
  apply(pref);
  listeners.forEach((fn) => fn());
}

export function ThemeToggle({ className }: { className?: string }) {
  // The preference lives in a cookie; the server render assumes "system".
  const pref = useSyncExternalStore(subscribe, readPref, () => "system" as Pref);

  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => readPref() === "system" && apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const Icon = pref === "dark" ? Moon : pref === "light" ? Sun : Monitor;
  return (
    <Menu
      trigger={
        <button aria-label="Theme" className={className ?? "grid h-8 w-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink"}>
          <Icon className="h-4 w-4" />
        </button>
      }
    >
      <MenuItem icon={<Sun />} onSelect={() => choose("light")} checked={pref === "light"}>Light</MenuItem>
      <MenuItem icon={<Moon />} onSelect={() => choose("dark")} checked={pref === "dark"}>Dark</MenuItem>
      <MenuItem icon={<Monitor />} onSelect={() => choose("system")} checked={pref === "system"}>System</MenuItem>
    </Menu>
  );
}
