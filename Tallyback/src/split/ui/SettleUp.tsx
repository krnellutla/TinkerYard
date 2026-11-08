"use client";

import { useState } from "react";
import { settleOptions, type Transfer } from "../lib/balances";
import { centsToInput, formatMoney, toCents } from "../lib/money";
import type { GroupDetail } from "../lib/types";
import { Avatar, ErrorNote, Sheet, api, errorText, field, fieldBase, primary, today } from "./kit";

const TONE = { bad: "text-bad", good: "text-good", muted: "text-ink" } as const;

// Settle up in two taps, like Splitwise: pick who (the debts are already worked out), check the amount, record.
// Paying part of it is fine: change the amount. Anything unusual ("Record another payment") opens the full form.
export function SettleUp({ group, initial, onClose, onSaved, onOther }: { group: GroupDetail; initial?: Transfer; onClose: () => void; onSaved: () => void; onOther: () => void }) {
  const { iOwe, owedToMe, others } = settleOptions(group.debts, group.meId);
  const [picked, setPicked] = useState<Transfer | null>(() => {
    if (initial) return initial;
    // Only one debt in the whole group: skip straight to it.
    const all = [...iOwe, ...owedToMe, ...others];
    return all.length === 1 ? all[0] : null;
  });
  const nameOf = (id: string) => (id === group.meId ? "You" : (group.members.find((m) => m.id === id)?.name ?? "Someone"));
  const money = (c: number) => formatMoney(c, group.currency);

  if (picked) return <Confirm group={group} t={picked} nameOf={nameOf} onBack={() => setPicked(null)} onClose={onClose} onSaved={onSaved} />;

  const row = (t: Transfer, tone: "bad" | "good" | "muted") => {
    const other = t.from === group.meId ? t.to : t.to === group.meId ? t.from : null;
    const label = t.from === group.meId ? `You owe ${nameOf(t.to)}` : t.to === group.meId ? `${nameOf(t.from)} owes you` : `${nameOf(t.from)} owes ${nameOf(t.to)}`;
    return (
      <li key={`${t.from}-${t.to}`}>
        <button onClick={() => setPicked(t)} className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-line bg-card px-3 py-2 text-left active:scale-[.99]">
          <Avatar name={nameOf(other ?? t.from)} size={36} />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <b className={`tabular-nums ${TONE[tone]}`}>{money(t.amount)}</b>
          <span aria-hidden="true" className="text-muted">›</span>
        </button>
      </li>
    );
  };

  return (
    <Sheet title="Settle up" onClose={onClose}>
      <div className="space-y-5">
        {iOwe.length + owedToMe.length === 0 && (
          <div className="rounded-2xl bg-good-soft p-4 text-center text-good">
            <p className="text-2xl" aria-hidden="true">
              🎉
            </p>
            <p className="font-medium">You&apos;re settled up in {group.name}.</p>
          </div>
        )}
        {iOwe.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-muted">Who do you want to pay?</h3>
            <ul className="space-y-2">{iOwe.map((t) => row(t, "bad"))}</ul>
          </section>
        )}
        {owedToMe.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-muted">Got paid?</h3>
            <ul className="space-y-2">{owedToMe.map((t) => row(t, "good"))}</ul>
          </section>
        )}
        {others.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-muted">Between others</h3>
            <ul className="space-y-2">{others.map((t) => row(t, "muted"))}</ul>
          </section>
        )}
        <button onClick={onOther} className="block w-full text-center text-sm text-muted underline underline-offset-4">
          Record another payment
        </button>
      </div>
    </Sheet>
  );
}

function Confirm({ group, t, nameOf, onBack, onClose, onSaved }: { group: GroupDetail; t: Transfer; nameOf: (id: string) => string; onBack: () => void; onClose: () => void; onSaved: () => void }) {
  const [amountText, setAmountText] = useState(centsToInput(t.amount));
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = toCents(amountText) ?? 0;
  const partial = amount > 0 && amount < t.amount;
  const over = amount > t.amount;
  const verb = t.from === group.meId ? "You paid" : `${nameOf(t.from)} paid`;
  // Avatars use the member's own name, so yours shows your initial rather than a "Y" for "You".
  const face = (id: string) => group.members.find((m) => m.id === id)?.name ?? nameOf(id);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/groups/${group.id}/expenses`, "POST", { kind: "payment", from: t.from, to: t.to, amount, date, notes });
      onSaved();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Record a payment"
      onClose={onClose}
      footer={
        <button onClick={save} disabled={busy || !amount} className={primary}>
          {busy ? "Saving…" : `Record ${formatMoney(amount, group.currency)} payment`}
        </button>
      }
    >
      <div className="space-y-5">
        <button onClick={onBack} className="text-sm text-muted">
          ← Back
        </button>
        <div className="flex items-center justify-center gap-4">
          <span className="flex flex-col items-center gap-1 text-sm">
            <Avatar name={face(t.from)} size={56} />
            {nameOf(t.from)}
          </span>
          <span className="text-2xl text-muted" aria-hidden="true">
            →
          </span>
          <span className="flex flex-col items-center gap-1 text-sm">
            <Avatar name={face(t.to)} size={56} />
            {nameOf(t.to)}
          </span>
        </div>
        <p className="text-center text-muted">
          {verb} {t.to === group.meId ? "you" : nameOf(t.to)}
        </p>
        <label className="mx-auto flex max-w-xs items-center gap-2 border-b-2 border-ink pb-1">
          <span className="text-lg text-muted">{group.currency}</span>
          <input
            inputMode="decimal"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            aria-label="Amount"
            className="text-hero min-w-0 flex-1 bg-transparent text-center font-semibold tabular-nums outline-none"
          />
        </label>
        <p className={`text-center text-xs ${over ? "text-warn" : "text-muted"}`}>
          {over
            ? `That's more than the ${formatMoney(t.amount, group.currency)} owed; the difference will be owed back.`
            : partial
              ? `Part of it: ${formatMoney(t.amount - amount, group.currency)} will still be owed.`
              : "Settles this in full."}
        </p>
        {more ? (
          <div className="space-y-2">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" className={`${fieldBase} w-full`} />
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note, e.g. PayNow ref (optional)" className={field} />
          </div>
        ) : (
          <button onClick={() => setMore(true)} className="block w-full text-center text-sm text-muted underline underline-offset-4">
            Add a date or note
          </button>
        )}
        <p className="text-center text-xs text-muted">This only records it. Send the money however you normally do.</p>
        <ErrorNote text={error} />
      </div>
    </Sheet>
  );
}
