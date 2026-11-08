"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { APPS } from "@signin/policy";
import { Account } from "@signin/ui/Account";
import { useAccess } from "@signin/ui/access";

// A switcher above whichever app is open, with a way back to the landing page.
// Signed in, it lists only the apps you may open; the admin dashboard is in the account menu.
export function AppNav() {
  const path = usePathname();
  const { access } = useAccess();
  const apps = access ? APPS.filter((a) => access.apps.includes(a.id)) : APPS;
  return (
    <nav className="mx-auto flex max-w-xl items-center gap-1 px-4 text-sm" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }} aria-label="Switch app">
      <a href="/" className="mr-1 inline-flex items-center gap-1.5 px-2 py-1 font-semibold text-muted hover:text-ink">
        <svg viewBox="0 0 22 26" className="h-4 w-3.5 shrink-0" aria-hidden="true">
          <path d="M3 1v25" stroke="currentColor" strokeWidth="2.6" />
          <path d="M4 2h16l-5 6 5 6H4z" fill="#E0335F" />
        </svg>
        tinkeryard
      </a>
      {/* On phones the bottom tab bar switches apps (TabBar.tsx); this row is for wider screens. */}
      {apps.map((a) => {
        const active = path.startsWith(a.href);
        return (
          <Link
            key={a.href}
            href={a.href}
            aria-current={active ? "page" : undefined}
            className={`hidden whitespace-nowrap rounded-full px-3 py-1 sm:block ${active ? "bg-ink text-white" : "text-muted hover:text-ink"}`}
          >
            {a.label}
          </Link>
        );
      })}
      <Account />
    </nav>
  );
}
