"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// A switcher above whichever app is open, with a way back to the landing page.
const APPS = [
  { href: "/tallyback", label: "TallyBack" },
  { href: "/reviewscout", label: "Review Scout" },
];

export function AppNav() {
  const path = usePathname();
  return (
    <nav className="mx-auto flex max-w-xl items-center gap-1 px-4 pt-3 text-sm" aria-label="Apps">
      <a href="/" className="mr-1 px-2 py-1 font-medium text-muted hover:text-ink">
        Tinkeryard
      </a>
      {APPS.map((a) => {
        const active = path.startsWith(a.href);
        return (
          <Link
            key={a.href}
            href={a.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-3 py-1 ${active ? "bg-ink text-white" : "text-muted hover:text-ink"}`}
          >
            {a.label}
          </Link>
        );
      })}
    </nav>
  );
}
