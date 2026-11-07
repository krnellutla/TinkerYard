"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { APPS } from "@signin/policy";
import { useAccess } from "@signin/ui/access";
import { AppIcon } from "./icons";
import "./install"; // starts listening for the browser's install offer as early as possible

// On phones, navigation moves to the bottom, where thumbs are: Home plus the apps your role allows.
// Hidden on wider screens (the top switcher does the job there) and until you're signed in.
export function TabBar() {
  const path = usePathname();
  const { access } = useAccess();
  if (!access || access.status !== "active") return null;
  const tabs = [{ id: "home" as const, label: "Home", href: "/home" }, ...APPS.filter((a) => access.apps.includes(a.id))];

  return (
    <nav
      aria-label="Apps"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/90 backdrop-blur sm:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-xl">
        {tabs.map((t) => {
          const active = path === t.href || path.startsWith(`${t.href}/`);
          return (
            <li key={t.id} className="flex-1">
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-[60px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${active ? "text-ink" : "text-muted"}`}
              >
                <span className={`flex h-7 w-12 items-center justify-center rounded-full ${active ? "bg-ink text-white" : ""}`}>
                  <AppIcon id={t.id} className="h-5 w-5" />
                </span>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
