import type { AppId } from "@signin/policy";

// One simple line icon per app, for the tab bar and the home screen. They use currentColor.
const PATHS: Record<AppId | "home" | "admin", React.ReactNode> = {
  home: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </>
  ),
  tallyback: (
    <>
      <path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </>
  ),
  reviewscout: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="m10.5 9.2 4.5 2.8-4.5 2.8z" />
    </>
  ),
  admin: (
    <>
      <path d="M12 3 5 6v5c0 4.4 3 8.3 7 10 4-1.7 7-5.6 7-10V6z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
};

export function AppIcon({ id, className = "h-6 w-6" }: { id: keyof typeof PATHS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[id]}
    </svg>
  );
}
