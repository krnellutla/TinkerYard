"use client";

import { useCallback, useEffect, useState } from "react";
import { Dashboard } from "./Dashboard";
import { GroupView } from "./GroupView";

// SplitBill: split shared expenses with friends, see who owes whom, settle up.
// INPUT: groups, members, expenses (four ways to split) and payments
// PROCESS: /api/splitbill/* stores them; lib/balances.ts works out balances and the fewest payments to settle
// OUTPUT: your totals, per-group and per-friend balances, activity, CSV export
// Groups are shared between people, so members are invited by email. The sign-in wall around every
// app (Auth/src/ui/Gate.tsx) means this page only ever renders for a signed-in person.

export default function SplitBill() {
  const [groupId, setGroupId] = useState<string | null>(null);

  // The open group lives in the address (?g=…), so Back and reload work.
  useEffect(() => {
    const read = () => setGroupId(new URL(window.location.href).searchParams.get("g"));
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

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

      {groupId ? (
        <GroupView key={groupId} id={groupId} onBack={() => open(null)} />
      ) : (
        <Dashboard onOpen={open} />
      )}
    </main>
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
