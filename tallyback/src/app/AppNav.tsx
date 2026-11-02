"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// One roof, two apps: a switcher above whichever one is open.
const APPS = [
  { href: "/", label: "TallyBack" },
  { href: "/review-scout", label: "Review Scout" },
];

export function AppNav() {
  const path = usePathname();
  return (
    <nav className="mx-auto flex max-w-xl gap-1 px-4 pt-3 text-sm" aria-label="Apps">
      {APPS.map((a) => {
        const active = a.href === "/" ? path === "/" : path.startsWith(a.href);
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
