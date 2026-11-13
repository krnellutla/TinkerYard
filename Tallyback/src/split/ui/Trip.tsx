"use client";

import { useState } from "react";
import { CURRENCY_NAMES, SPEND_CURRENCIES, formatMoney } from "../lib/money";
import { tripLength, tripSummary, type Trip } from "../lib/trip";
import { categoryOf, type GroupDetail } from "../lib/types";
import { categoryBreakdown, dailySpending } from "../lib/analytics";
import { CategoryDonutChart, DailySpendChart } from "./Charts";
import { ErrorNote, Sheet, api, errorText, field, fieldBase, primary, secondary, today } from "./kit";

// Trip mode: set where and when once, and new expenses default to the local currency for those dates.
// When it's over, one page says what it all came to.

export function TripForm({ g, onClose, onSaved }: { g: GroupDetail; onClose: () => void; onSaved: () => void }) {
  const t = g.trip;
  const [destination, setDestination] = useState(t?.destination ?? "");
  const [start, setStart] = useState(t?.start ?? today());
  const [end, setEnd] = useState(t?.end ?? today());
  const [currency, setCurrency] = useState(t?.currency ?? g.currency);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function patch(trip: Trip | null) {
    setBusy(true);
    setError(null);
    try {
      await api(`/groups/${g.id}`, "PATCH", { trip });
      onSaved();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }
  return (
    <Sheet title={t ? "Edit trip" : "Set up the trip"} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          patch({ destination, start, end, currency });
        }}
      >
        <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Where to? e.g. Manila" aria-label="Destination" className={`${field} text-base`} />
        <div className="flex gap-2">
          <label className="min-w-0 flex-1 text-sm">
            <span className="mb-1 block font-medium">First day</span>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={`${fieldBase} h-12 w-full`} />
          </label>
          <label className="min-w-0 flex-1 text-sm">
            <span className="mb-1 block font-medium">Last day</span>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={`${fieldBase} h-12 w-full`} />
          </label>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">You&apos;ll mostly spend in</span>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={field}>
            {SPEND_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c} · {CURRENCY_NAMES[c]}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted">During these dates, new expenses start in {currency}. Balances stay in {g.currency}.</p>
        <ErrorNote text={error} />
        <button type="submit" disabled={busy || !destination.trim()} className={primary}>
          {busy ? "Saving…" : "Save trip"}
        </button>
        {t && (
          <button type="button" disabled={busy} onClick={() => confirm("Remove the trip details? Expenses stay as they are.") && patch(null)} className="block w-full py-2 text-sm text-bad underline underline-offset-4">
            Remove trip details
          </button>
        )}
      </form>
    </Sheet>
  );
}

export function TripSummaryText(g: GroupDetail) {
  const t = g.trip!;
  const s = tripSummary(t, g.expenses);
  const money = (c: number) => formatMoney(c, g.currency);
  const lines = [`✈️ *${t.destination}* trip wrap`, `${money(s.total)} over ${tripLength(t)} day(s), ${s.count} expense(s)`, ""];
  for (const m of g.members.filter((x) => s.share[x.id] || s.paid[x.id])) lines.push(`${m.name}: spent ${money(s.share[m.id] ?? 0)}, put down ${money(s.paid[m.id] ?? 0)}`);
  lines.push("", g.debts.length ? "To settle:" : "✅ All settled!");
  for (const d of g.debts) lines.push(`${g.members.find((m) => m.id === d.from)?.name} → ${g.members.find((m) => m.id === d.to)?.name}: ${money(d.amount)}`);
  return lines.join("\n");
}

export function TripSummaryView({ g, nameOf, onClose, onEdit, onSettle }: { g: GroupDetail; nameOf: (id: string) => string; onClose: () => void; onEdit: () => void; onSettle: () => void }) {
  const t = g.trip!;
  const s = tripSummary(t, g.expenses);
  const money = (c: number) => formatMoney(c, g.currency);
  const people = g.members.filter((m) => s.share[m.id] || s.paid[m.id]);
  const tile = (label: string, value: string, sub?: string) => (
    <div className="rounded-2xl bg-card p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 truncate font-semibold">{value}</p>
      {sub && <p className="truncate text-xs text-muted">{sub}</p>}
    </div>
  );
  return (
    <Sheet title={`${t.destination} trip`} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-3xl bg-ink p-5 text-white">
          <p className="text-sm text-white/70">
            {t.start} to {t.end}
          </p>
          <p className="mt-1 text-[36px] font-semibold leading-tight tabular-nums">{money(s.total)}</p>
          <p className="text-sm text-white/70">
            {s.count} expense{s.count === 1 ? "" : "s"} · {money(s.perDay)} a day
          </p>
        </div>
        {s.count > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {s.topCategory && tile("Most spent on", `${categoryOf(s.topCategory.id).icon} ${categoryOf(s.topCategory.id).label}`, money(s.topCategory.amount))}
            {s.coveredMost && tile("Covered the most", nameOf(s.coveredMost.id), money(s.coveredMost.amount))}
            {s.biggest && tile("Biggest expense", (s.biggest as unknown as { description: string }).description, money(s.biggest.amount))}
          </div>
        )}
        {s.count > 0 && (
          <>
            <CategoryDonutChart data={categoryBreakdown(g.expenses)} total={s.total} currency={g.currency} />
            <DailySpendChart series={dailySpending(g.expenses)} currency={g.currency} />
          </>
        )}
        {people.length > 0 && (
          <ul className="divide-y divide-line rounded-2xl border border-line bg-card px-3 text-sm">
            {people.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-2.5">
                <span className="font-medium">{nameOf(m.id)}</span>
                <span className="text-right text-xs text-muted">
                  spent <b className="text-ink">{money(s.share[m.id] ?? 0)}</b> · put down {money(s.paid[m.id] ?? 0)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          {g.debts.length > 0 && (
            <button onClick={onSettle} className={`${secondary} flex-1`}>
              Settle up
            </button>
          )}
          <button onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(TripSummaryText(g))}`, "_blank")} className={`${secondary} flex-1`}>
            Share on WhatsApp
          </button>
        </div>
        <button onClick={onEdit} className="block w-full py-1 text-center text-sm text-muted underline underline-offset-4">
          Edit trip
        </button>
      </div>
    </Sheet>
  );
}
