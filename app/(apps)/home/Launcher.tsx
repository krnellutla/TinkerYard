"use client";

import Link from "next/link";
import { APPS } from "@signin/policy";
import { useAccess } from "@signin/ui/access";
import { AppIcon } from "../icons";
import { useInstall } from "../install";

// /home: where the installed app opens. Your apps as big tiles, the admin dashboard for admins,
// and a way to install the yard on this phone if it isn't installed yet.
const ABOUT: Record<string, string> = {
  tallyback: "Snap a bill, find the line that doesn't add up.",
  reviewscout: "What YouTube reviewers said, with timestamps.",
  splitbill: "Split costs with friends, settle up.",
};

export default function Launcher() {
  const { access } = useAccess();
  const install = useInstall();
  if (!access) return null;
  const apps = APPS.filter((a) => access.apps.includes(a.id));
  const name = access.email.split("@")[0];

  return (
    <main className="mx-auto max-w-xl px-4 pb-10 pt-6">
      <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">Hi {name}</h1>
      <p className="mt-1 text-muted">{apps.length ? "Pick up where you left off." : "No apps yet: ask an admin to add one for you."}</p>

      <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {apps.map((a) => (
          <li key={a.id}>
            <Link href={a.href} className="flex items-center gap-4 rounded-3xl border border-line bg-card p-4 active:scale-[.98]">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-ink text-white">
                <AppIcon id={a.id} className="h-7 w-7" />
              </span>
              <span className="min-w-0">
                <span className="block text-lg font-semibold">{a.label}</span>
                <span className="block text-sm text-muted">{ABOUT[a.id]}</span>
              </span>
            </Link>
          </li>
        ))}
        {access.admin && (
          <li>
            <Link href="/admin" className="flex items-center gap-4 rounded-3xl border border-line bg-card p-4 active:scale-[.98]">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-paper">
                <AppIcon id="admin" className="h-7 w-7" />
              </span>
              <span className="min-w-0">
                <span className="block text-lg font-semibold">Admin</span>
                <span className="block text-sm text-muted">People, roles and app access.</span>
              </span>
            </Link>
          </li>
        )}
      </ul>

      {(install.canPrompt || install.iosSteps) && (
        <section className="mt-8 rounded-3xl bg-ink p-5 text-white">
          <h2 className="text-lg font-semibold">Install the app</h2>
          <p className="mt-1 text-sm text-white/75">Put Tinkeryard on your home screen: it opens full-screen like any app, straight to your apps.</p>
          {install.canPrompt ? (
            <button onClick={install.prompt} className="mt-4 h-12 w-full rounded-2xl bg-paper font-medium text-ink active:scale-[.99]">
              Install Tinkeryard
            </button>
          ) : (
            <ol className="mt-3 space-y-1.5 text-sm">
              <li>
                1. Tap <ShareIcon /> <b>Share</b> in Safari&apos;s toolbar
              </li>
              <li>
                2. Choose <b>Add to Home Screen</b>
              </li>
              <li>
                3. Tap <b>Add</b>
              </li>
            </ol>
          )}
        </section>
      )}
    </main>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" className="inline h-4 w-4 align-[-3px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Share">
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M6 11v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8" />
    </svg>
  );
}
