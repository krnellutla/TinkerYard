"use client";

import { useCallback, useEffect, useState } from "react";
import { authClient } from "@signin/client";
import { askToSignIn, onSessionChanged } from "@signin/ui/prompt";
import { Dashboard } from "./Dashboard";
import { GroupView } from "./GroupView";
import { primary } from "./kit";

// SplitBill: split shared expenses with friends, see who owes whom, settle up.
// INPUT: groups, members, expenses (four ways to split) and payments
// PROCESS: /api/splitbill/* stores them; lib/balances.ts works out balances and the fewest payments to settle
// OUTPUT: your totals, per-group and per-friend balances, activity, CSV export
// Groups are shared between people, so it needs sign-in; members are invited by email.

export default function SplitBill() {
  const { data, isPending, error, refetch } = authClient.useSession();
  const [groupId, setGroupId] = useState<string | null>(null);

  // The open group lives in the address (?g=…), so Back and reload work.
  useEffect(() => {
    const read = () => setGroupId(new URL(window.location.href).searchParams.get("g"));
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  useEffect(() => onSessionChanged(() => refetch()), [refetch]);

  const open = useCallback((id: string | null) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("g", id);
    else url.searchParams.delete("g");
    window.history.pushState(null, "", url.pathname + url.search);
    setGroupId(id);
    window.scrollTo(0, 0);
  }, []);

  return (
    <main className="mx-auto min-h-dvh max-w-xl px-4 pb-28 pt-6">
      <header className="mb-6 flex items-center gap-2.5">
        <button onClick={() => open(null)} className="flex items-center gap-2.5 text-left">
          <Logo />
          <span className="flex flex-col leading-tight">
            <span className="text-lg font-semibold tracking-tight">SplitBill</span>
            <span className="text-xs text-muted">Split costs with friends, settle up in fewer payments</span>
          </span>
        </button>
      </header>

      {isPending ? (
        <p className="text-muted">Loading…</p>
      ) : !data ? (
        <Intro unavailable={!!error} />
      ) : groupId ? (
        <GroupView key={groupId} id={groupId} onBack={() => open(null)} />
      ) : (
        <Dashboard onOpen={open} />
      )}
    </main>
  );
}

function Intro({ unavailable }: { unavailable: boolean }) {
  const points = [
    ["👥", "Groups for trips, homes and couples", "Add friends by email; they see the group when they sign in."],
    ["➗", "Split any way", "Equally, exact amounts, percentages or shares, paid by one person or several."],
    ["🔁", "Simplify debts", "The fewest payments that settle the whole group, or who owes whom expense by expense."],
    ["💸", "Settle up", "Record payments, see your balance with each friend across every group, export to CSV."],
  ];
  return (
    <section>
      <h1 className="text-[1.9rem] font-semibold leading-tight tracking-tight">Shared costs, without the awkward maths.</h1>
      <p className="mt-3 text-muted">Add expenses as they happen. SplitBill keeps a running balance for everyone, to the cent, and tells you who should pay whom.</p>
      <ul className="mt-6 space-y-3">
        {points.map(([icon, title, text]) => (
          <li key={title} className="flex gap-3 rounded-2xl border border-line bg-card p-4">
            <span className="text-xl" aria-hidden="true">
              {icon}
            </span>
            <span>
              <span className="block font-medium">{title}</span>
              <span className="text-sm text-muted">{text}</span>
            </span>
          </li>
        ))}
      </ul>
      {unavailable ? (
        <p className="mt-8 rounded-xl bg-warn-soft p-3 text-sm text-warn">Sign-in isn&apos;t set up on this server yet, so SplitBill can&apos;t open groups.</p>
      ) : (
        <button onClick={() => askToSignIn("Sign in to split expenses with your groups.")} className={`${primary} mt-8`}>
          Sign in to start splitting
        </button>
      )}
    </section>
  );
}

function Logo() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      <rect width="34" height="34" rx="10" fill="var(--color-ink)" />
      <circle cx="17" cy="17" r="8.5" fill="none" stroke="var(--color-paper)" strokeWidth="2.4" />
      <path d="M17 8.5v17" stroke="var(--color-paper)" strokeWidth="2.4" />
      <path d="M17 8.5a8.5 8.5 0 0 1 0 17z" fill="#E0335F" />
    </svg>
  );
}
