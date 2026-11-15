"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Menu, MenuItem } from "./ui";

type Pref = "light" | "dark" | "system";

function apply(pref: Pref) {
  const t = pref === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : pref;
  document.documentElement.dataset.theme = t;
  document.cookie = `bfc_theme=${pref}; path=/; max-age=31536000; samesite=lax`;
}

export function ThemeToggle({ className }: { className?: string }) {
  const [pref, setPref] = useState<Pref>("system");
  useEffect(() => {
    const m = document.cookie.match(/(?:^|; )bfc_theme=(light|dark|system)/);
    if (m) setPref(m[1] as Pref);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const cur = document.cookie.match(/(?:^|; )bfc_theme=(light|dark|system)/)?.[1] ?? "system";
      if (cur === "system") apply("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const choose = (p: Pref) => {
    setPref(p);
    apply(p);
  };
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
