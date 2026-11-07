"use client";

import { useMemo, useState } from "react";
import { centsToInput, formatMoney, toCents } from "../lib/money";
import { SPLIT_METHODS, checkPaid, splitAmount, type SplitMethod } from "../lib/split";
import { CATEGORIES, type Category, type Expense, type GroupDetail } from "../lib/types";
import { ErrorNote, Sheet, api, errorText, field, fieldBase, primary, today } from "./kit";

// Adding or editing an expense, and recording a payment. The page runs the same split maths as the
// server (lib/split.ts), so it can show each person's share as you type; the server checks again.

const blankIsZero = (t: string) => (t.trim() === "" ? 0 : (toCents(t) ?? (Number(t) === 0 ? 0 : NaN)));

export function ExpenseForm({ group, expense, onClose, onSaved }: { group: GroupDetail; expense?: Expense; onClose: () => void; onSaved: () => void }) {
  const people = group.members.filter((m) => !m.removed || (expense && (expense.paid[m.id] || expense.owed[m.id])));
  const nameOf = (id: string) => (id === group.meId ? "You" : (people.find((m) => m.id === id)?.name ?? "?"));
  const s = expense?.split;
  const paidIds = expense ? Object.keys(expense.paid) : [group.meId];

  const [description, setDescription] = useState(expense?.description ?? "");
  const [amountText, setAmountText] = useState(expense ? centsToInput(expense.amount) : "");
  const [date, setDate] = useState(expense?.date ?? today());
  const [category, setCategory] = useState<Category>(expense?.category ?? "general");
  const [payer, setPayer] = useState<string>(paidIds.length > 1 ? "multiple" : paidIds[0]);
  const [multiPaid, setMultiPaid] = useState<Record<string, string>>(
    Object.fromEntries(people.map((m) => [m.id, expense?.paid[m.id] && paidIds.length > 1 ? centsToInput(expense.paid[m.id]) : ""])),
  );
  const [method, setMethod] = useState<SplitMethod>(s?.method ?? "equal");
  const [included, setIncluded] = useState<Set<string>>(new Set(s?.members ?? people.filter((m) => !m.removed).map((m) => m.id)));
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      people.map((m) => {
        const v = s?.values?.[m.id];
        return [m.id, v === undefined ? "" : s?.method === "exact" ? centsToInput(v) : String(v)];
      }),
    ),
  );
  const [notes, setNotes] = useState(expense?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = toCents(amountText) ?? 0;
  const paid = useMemo(
    () => (payer === "multiple" ? Object.fromEntries(people.map((m) => [m.id, blankIsZero(multiPaid[m.id] ?? "")])) : { [payer]: amount }),
    [payer, multiPaid, amount, people],
  );
  const split = useMemo(() => {
    const members = method === "equal" ? [...included] : people.map((m) => m.id);
    const nums = Object.fromEntries(members.map((id) => [id, method === "exact" ? blankIsZero(values[id] ?? "") : Number(values[id] || 0)]));
    return { method, members, values: method === "equal" ? undefined : nums };
  }, [method, included, values, people]);
  const result = amount ? splitAmount(amount, split) : null;
  const paidError = amount ? checkPaid(amount, paid) : null;
  const problem = !description.trim() ? "Describe the expense." : !amount ? "Enter the amount." : paidError ?? (result && !result.ok ? result.error : null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const body = { kind: "expense", description, amount, category, date, paid, split, notes };
      if (expense) await api(`/groups/${group.id}/expenses/${expense.id}`, "PATCH", body);
      else await api(`/groups/${group.id}/expenses`, "POST", body);
      onSaved();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  const unit = { exact: group.currency, percent: "%", shares: "shares", equal: "" }[method];
  return (
    <Sheet title={expense ? "Edit expense" : "Add an expense"} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div className="flex gap-2">
          <select value={category} onChange={(e) => setCategory(e.target.value as Category)} aria-label="Category" className={`${fieldBase} w-auto text-xl`}>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id} title={c.label}>
                {c.icon} {c.label}
              </option>
            ))}
          </select>
          <input autoFocus={!expense} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" className={`${fieldBase} min-w-0 flex-1`} />
        </div>
        <div className="flex gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-card px-3 focus-within:border-ink">
            <span className="text-sm text-muted">{group.currency}</span>
            <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="0.00" aria-label="Amount" className="h-12 min-w-0 flex-1 bg-transparent text-2xl font-semibold outline-none" />
          </label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" className={`${fieldBase} w-auto`} />
        </div>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">Paid by</span>
          <select value={payer} onChange={(e) => setPayer(e.target.value)} className={field}>
            {people.map((m) => (
              <option key={m.id} value={m.id}>
                {nameOf(m.id)}
              </option>
            ))}
            <option value="multiple">More than one person</option>
          </select>
        </label>
        {payer === "multiple" && (
          <div className="space-y-2 rounded-2xl border border-line bg-card p-3">
            {people.map((m) => (
              <AmountRow key={m.id} label={nameOf(m.id)} unit={group.currency} value={multiPaid[m.id] ?? ""} onChange={(v) => setMultiPaid((p) => ({ ...p, [m.id]: v }))} />
            ))}
            {paidError && <p className="text-xs text-bad">{paidError}</p>}
          </div>
        )}

        <div className="text-sm">
          <span className="mb-1 block font-medium">Split</span>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {SPLIT_METHODS.map((m) => (
              <button
                type="button"
                key={m.id}
                onClick={() => setMethod(m.id)}
                aria-pressed={method === m.id}
                className={`rounded-full border px-3 py-1 ${method === m.id ? "border-ink bg-ink text-white" : "border-line bg-card"}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="space-y-2 rounded-2xl border border-line bg-card p-3">
            {people.map((m) => {
              const share = result?.ok ? (result.owed[m.id] ?? 0) : null;
              return method === "equal" ? (
                <label key={m.id} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={included.has(m.id)}
                      onChange={(e) =>
                        setIncluded((set) => {
                          const next = new Set(set);
                          if (e.target.checked) next.add(m.id);
                          else next.delete(m.id);
                          return next;
                        })
                      }
                      className="h-4 w-4 accent-ink"
                    />
                    {nameOf(m.id)}
                  </span>
                  <span className="font-mono text-muted">{share != null && included.has(m.id) ? formatMoney(share, group.currency) : "—"}</span>
                </label>
              ) : (
                <AmountRow
                  key={m.id}
                  label={nameOf(m.id)}
                  unit={unit}
                  value={values[m.id] ?? ""}
                  onChange={(v) => setValues((p) => ({ ...p, [m.id]: v }))}
                  hint={method !== "exact" && share != null ? formatMoney(share, group.currency) : undefined}
                />
              );
            })}
            {result && !result.ok && <p className="text-xs text-bad">{result.error}</p>}
          </div>
        </div>

        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes (optional)" className={`${field} resize-none`} />
        <ErrorNote text={error} />
        <button type="submit" disabled={busy || !!problem} className={primary}>
          {busy ? "Saving…" : problem && amount && description.trim() ? problem : "Save"}
        </button>
      </form>
    </Sheet>
  );
}

function AmountRow({ label, unit, value, onChange, hint }: { label: string; unit: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="font-mono text-xs text-muted">{hint}</span>}
      <span className="flex w-36 items-center gap-1.5 rounded-lg border border-line px-2 focus-within:border-ink">
        <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0" className="h-9 min-w-0 flex-1 bg-transparent text-right outline-none" />
        <span className="text-xs text-muted">{unit}</span>
      </span>
    </label>
  );
}

// Settle up: record that one person paid another. Suggestions come from the group's debts, yours first.
export function PaymentForm({
  group,
  payment,
  preset,
  onClose,
  onSaved,
}: {
  group: GroupDetail;
  payment?: Expense;
  preset?: { from: string; to: string; amount: number };
  onClose: () => void;
  onSaved: () => void;
}) {
  const people = group.members.filter((m) => !m.removed);
  const nameOf = (id: string) => (id === group.meId ? "You" : (group.members.find((m) => m.id === id)?.name ?? "?"));
  const suggestions = [...group.debts].sort((a, b) => Number(b.from === group.meId || b.to === group.meId) - Number(a.from === group.meId || a.to === group.meId));
  const first = preset ?? (payment ? { from: Object.keys(payment.paid)[0], to: Object.keys(payment.owed)[0], amount: payment.amount } : suggestions[0]);

  const [from, setFrom] = useState(first?.from ?? group.meId);
  const [to, setTo] = useState(first?.to ?? people.find((m) => m.id !== group.meId)?.id ?? "");
  const [amountText, setAmountText] = useState(first ? centsToInput(first.amount) : "");
  const [date, setDate] = useState(payment?.date ?? today());
  const [notes, setNotes] = useState(payment?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = toCents(amountText);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { kind: "payment", from, to, amount, date, notes };
      if (payment) await api(`/groups/${group.id}/expenses/${payment.id}`, "PATCH", body);
      else await api(`/groups/${group.id}/expenses`, "POST", body);
      onSaved();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  const pick = (id: string, set: (v: string) => void, label: string) => (
    <label className="block min-w-0 flex-1 text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <select value={id} onChange={(e) => set(e.target.value)} className={field}>
        {people.map((m) => (
          <option key={m.id} value={m.id}>
            {nameOf(m.id)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Sheet title={payment ? "Edit payment" : "Settle up"} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        {!payment && suggestions.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Suggested</p>
            {suggestions.map((t) => (
              <button
                type="button"
                key={`${t.from}-${t.to}`}
                onClick={() => {
                  setFrom(t.from);
                  setTo(t.to);
                  setAmountText(centsToInput(t.amount));
                }}
                className={`flex w-full justify-between rounded-xl border px-3 py-2 text-left text-sm ${from === t.from && to === t.to ? "border-ink bg-card" : "border-line bg-card"}`}
              >
                <span>
                  {nameOf(t.from)} → {nameOf(t.to)}
                </span>
                <b>{formatMoney(t.amount, group.currency)}</b>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          {pick(from, setFrom, "Who paid")}
          <span className="pb-3 text-muted">→</span>
          {pick(to, setTo, "Paid to")}
        </div>
        <div className="flex gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-card px-3 focus-within:border-ink">
            <span className="text-sm text-muted">{group.currency}</span>
            <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="0.00" aria-label="Amount" className="h-12 min-w-0 flex-1 bg-transparent text-2xl font-semibold outline-none" />
          </label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" className={`${fieldBase} w-auto`} />
        </div>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note, e.g. PayNow ref (optional)" className={field} />
        <p className="text-xs text-muted">This only records the payment. Send the money however you normally do.</p>
        <ErrorNote text={error} />
        <button type="submit" disabled={busy || !amount || from === to} className={primary}>
          {busy ? "Saving…" : from === to ? "Choose two different people" : "Record payment"}
        </button>
      </form>
    </Sheet>
  );
}
