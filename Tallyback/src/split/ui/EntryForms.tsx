"use client";

import { useMemo, useState } from "react";
import { centsToInput, formatMoney, toCents } from "../lib/money";
import { SPLIT_METHODS, allocateItemized, checkPaid, splitAmount, type SplitMethod } from "../lib/split";
import type { BillDraft, ClaimableReceiptLine } from "../lib/fromBill";
import { CATEGORIES, type Category, type Expense, type GroupDetail } from "../lib/types";
import { ErrorNote, Sheet, api, errorText, field, fieldBase, primary, today } from "./kit";

// Adding or editing an expense, and recording a payment. The page runs the same split maths as the
// server (lib/split.ts), so it can show each person's share as you type; the server checks again.

const blankIsZero = (t: string) => (t.trim() === "" ? 0 : (toCents(t) ?? (Number(t) === 0 ? 0 : NaN)));

// `draft` pre-fills a new expense from a checked bill ("Split this bill").
export function ExpenseForm({ group, expense, draft, onClose, onSaved }: { group: GroupDetail; expense?: Expense; draft?: BillDraft | null; onClose: () => void; onSaved: () => void }) {
  const people = group.members.filter((m) => !m.removed || (expense && (expense.paid[m.id] || expense.owed[m.id])));
  const nameOf = (id: string) => (id === group.meId ? "You" : (people.find((m) => m.id === id)?.name ?? "?"));
  const s = expense?.split;
  const paidIds = expense ? Object.keys(expense.paid) : [group.meId];

  const hasDisputedDiff =
    draft?.printedAmountCents != null &&
    draft?.verifiedAmountCents != null &&
    draft.verifiedAmountCents < draft.printedAmountCents;
  const [useVerifiedTotal, setUseVerifiedTotal] = useState(true);

  const [description, setDescription] = useState(expense?.description ?? draft?.description ?? "");
  const [amountText, setAmountText] = useState(expense ? centsToInput(expense.amount) : draft?.amount ? centsToInput(draft.amount) : "");
  const [date, setDate] = useState(expense?.date ?? draft?.date ?? today());
  const [category, setCategory] = useState<Category>(expense?.category ?? draft?.category ?? "general");
  const [payer, setPayer] = useState<string>(paidIds.length > 1 ? "multiple" : paidIds[0]);
  const [multiPaid, setMultiPaid] = useState<Record<string, string>>(
    Object.fromEntries(people.map((m) => [m.id, expense?.paid[m.id] && paidIds.length > 1 ? centsToInput(expense.paid[m.id]) : ""])),
  );
  const [method, setMethod] = useState<SplitMethod>(s?.method ?? "equal");
  const [itemMode, setItemMode] = useState<boolean>(!expense && (draft?.claimableLines?.length ?? 0) > 1);
  const [itemLines, setItemLines] = useState<ClaimableReceiptLine[]>(() => draft?.claimableLines ?? []);
  const [itemClaims, setItemClaims] = useState<Record<number, string[]>>(() => {
    const activeIds = people.filter((m) => !m.removed).map((m) => m.id);
    return Object.fromEntries(
      (draft?.claimableLines ?? []).map((line) => [
        line.lineIndex,
        // Flagged/unrecognized lines with 0 verified cents start unclaimed; normal items default to everyone
        line.flagged && line.verifiedCents === 0 ? [] : activeIds,
      ]),
    );
  });
  const [newItemDesc, setNewItemDesc] = useState("");
  const [newItemAmt, setNewItemAmt] = useState("");

  const [included, setIncluded] = useState<Set<string>>(new Set(s?.members ?? people.filter((m) => !m.removed).map((m) => m.id)));
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      people.map((m) => {
        const v = s?.values?.[m.id];
        return [m.id, v === undefined ? "" : s?.method === "exact" ? centsToInput(v) : String(v)];
      }),
    ),
  );
  const [notes, setNotes] = useState(expense?.notes ?? draft?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = toCents(amountText) ?? 0;

  function selectTotalMode(verified: boolean) {
    setUseVerifiedTotal(verified);
    if (!draft) return;
    const targetCents = verified ? draft.verifiedAmountCents : draft.printedAmountCents;
    if (targetCents != null) setAmountText(centsToInput(targetCents));
  }

  function toggleClaim(lineIndex: number, memberId: string) {
    setItemClaims((prev) => {
      const cur = prev[lineIndex] ?? [];
      const next = cur.includes(memberId) ? cur.filter((x) => x !== memberId) : [...cur, memberId];
      return { ...prev, [lineIndex]: next };
    });
  }

  function claimAllForLine(lineIndex: number) {
    const allIds = people.map((m) => m.id);
    setItemClaims((prev) => {
      const cur = prev[lineIndex] ?? [];
      return { ...prev, [lineIndex]: cur.length === allIds.length ? [] : allIds };
    });
  }

  function addCustomItem() {
    const cents = toCents(newItemAmt);
    if (!newItemDesc.trim() || !cents) return;
    const nextIdx = itemLines.length ? Math.max(...itemLines.map((l) => l.lineIndex)) + 1 : 0;
    const allIds = people.map((m) => m.id);
    setItemLines((prev) => [
      ...prev,
      {
        lineIndex: nextIdx,
        description: newItemDesc.trim(),
        qty: 1,
        printedCents: cents,
        verifiedCents: cents,
        flagged: false,
      },
    ]);
    setItemClaims((prev) => ({ ...prev, [nextIdx]: allIds }));
    setNewItemDesc("");
    setNewItemAmt("");
  }

  const itemizedCalc = useMemo(() => {
    if (!itemMode || !amount) return null;
    const activeLines = itemLines
      .map((line) => ({
        amountCents: useVerifiedTotal ? line.verifiedCents : line.printedCents,
        members: itemClaims[line.lineIndex] ?? [],
      }))
      .filter((l) => l.amountCents > 0);
    return allocateItemized(
      amount,
      activeLines,
      people.map((m) => m.id),
    );
  }, [itemMode, amount, itemLines, itemClaims, useVerifiedTotal, people]);

  const paid = useMemo(
    () => (payer === "multiple" ? Object.fromEntries(people.map((m) => [m.id, blankIsZero(multiPaid[m.id] ?? "")])) : { [payer]: amount }),
    [payer, multiPaid, amount, people],
  );
  const split = useMemo(() => {
    if (itemMode && itemizedCalc?.ok) {
      const members = people.map((m) => m.id);
      const nums = Object.fromEntries(members.map((id) => [id, itemizedCalc.owed[id] ?? 0]));
      return { method: "exact" as SplitMethod, members, values: nums };
    }
    const members = method === "equal" ? [...included] : people.map((m) => m.id);
    const nums = Object.fromEntries(members.map((id) => [id, method === "exact" ? blankIsZero(values[id] ?? "") : Number(values[id] || 0)]));
    return { method, members, values: method === "equal" ? undefined : nums };
  }, [itemMode, itemizedCalc, method, included, values, people]);

  const result = amount
    ? itemMode && itemizedCalc
      ? itemizedCalc.ok
        ? { ok: true as const, owed: itemizedCalc.owed }
        : itemizedCalc
      : splitAmount(amount, split)
    : null;
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
    <Sheet title={expense ? "Edit expense" : draft ? "Split this bill" : "Add an expense"} onClose={onClose}>
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

        {hasDisputedDiff && draft && (
          <div className="rounded-2xl border border-bad/30 bg-bad-soft p-3.5 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-bad">TallyBack Audit Shield</p>
                <p className="mt-0.5 font-medium text-ink">
                  {draft.issueTitle ?? "Overcharge flagged"} ({formatMoney(draft.atStakeCents ?? 0, draft.currency ?? group.currency)} disputed)
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-white/80 px-2.5 py-0.5 font-mono text-xs font-semibold text-bad">
                −{formatMoney(draft.atStakeCents ?? 0, draft.currency ?? group.currency)}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => selectTotalMode(true)}
                aria-pressed={useVerifiedTotal}
                className={`rounded-xl border px-2.5 py-2 text-left font-medium ${useVerifiedTotal ? "border-ink bg-ink text-white" : "border-line bg-card text-ink"}`}
              >
                <span className="block text-[11px] opacity-80">Split verified total</span>
                <span className="font-mono text-sm font-semibold">{formatMoney(draft.verifiedAmountCents!, draft.currency ?? group.currency)}</span>
              </button>
              <button
                type="button"
                onClick={() => selectTotalMode(false)}
                aria-pressed={!useVerifiedTotal}
                className={`rounded-xl border px-2.5 py-2 text-left font-medium ${!useVerifiedTotal ? "border-ink bg-ink text-white" : "border-line bg-card text-ink"}`}
              >
                <span className="block text-[11px] opacity-80">Split printed total</span>
                <span className="font-mono text-sm font-semibold">{formatMoney(draft.printedAmountCents!, draft.currency ?? group.currency)}</span>
              </button>
            </div>
          </div>
        )}

        {draft?.currency && draft.currency !== group.currency && (
          <p className="rounded-xl bg-warn-soft p-3 text-sm text-warn">
            The bill is in {draft.currency}, and this group uses {group.currency}. Check the amount before saving.
          </p>
        )}
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
            <button
              type="button"
              onClick={() => setItemMode(true)}
              aria-pressed={itemMode}
              className={`rounded-full border px-3 py-1 font-medium ${itemMode ? "border-ink bg-ink text-white" : "border-line bg-card"}`}
            >
              🧾 By receipt items{itemLines.length ? ` (${itemLines.length})` : ""}
            </button>
            {SPLIT_METHODS.map((m) => (
              <button
                type="button"
                key={m.id}
                onClick={() => {
                  setItemMode(false);
                  setMethod(m.id);
                }}
                aria-pressed={!itemMode && method === m.id}
                className={`rounded-full border px-3 py-1 ${!itemMode && method === m.id ? "border-ink bg-ink text-white" : "border-line bg-card"}`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {itemMode ? (
            <div className="space-y-3 rounded-2xl border border-line bg-card p-3">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>Tap who shared each item. Tax &amp; service charge split proportionally.</span>
              </div>
              {itemLines.length === 0 ? (
                <p className="py-2 text-xs text-muted">Add items below to split them with proportional tax/service charge.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {itemLines.map((line) => {
                    const lineCents = useVerifiedTotal ? line.verifiedCents : line.printedCents;
                    const claimants = itemClaims[line.lineIndex] ?? [];
                    const allSelected = claimants.length === people.length;
                    return (
                      <li key={line.lineIndex} className="py-2.5 first:pt-0 last:pb-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {line.qty && line.qty > 1 ? `${line.qty}× ` : ""}
                            {line.description}
                          </span>
                          <span className="shrink-0 font-mono text-sm font-semibold">
                            {formatMoney(lineCents, group.currency)}
                          </span>
                        </div>
                        {line.flagged && (
                          <p className="mt-0.5 text-[11px] text-bad">
                            {useVerifiedTotal && line.verifiedCents < line.printedCents
                              ? `Verified from ${formatMoney(line.printedCents, group.currency)} (${line.flagTitle ?? "disputed"})`
                              : line.flagTitle ?? "Flagged on bill"}
                          </p>
                        )}
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {people.map((m) => {
                            const active = claimants.includes(m.id);
                            return (
                              <button
                                type="button"
                                key={m.id}
                                onClick={() => toggleClaim(line.lineIndex, m.id)}
                                aria-pressed={active}
                                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${active ? "border-ink bg-ink text-white" : "border-line bg-paper text-muted"}`}
                              >
                                {nameOf(m.id)}
                              </button>
                            );
                          })}
                          <button
                            type="button"
                            onClick={() => claimAllForLine(line.lineIndex)}
                            className={`rounded-full border px-2 py-0.5 text-[11px] ${allSelected ? "border-ink/40 bg-paper text-ink" : "border-dashed border-line text-muted"}`}
                          >
                            {allSelected ? "Clear" : "All"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="flex gap-1.5 border-t border-line pt-2.5">
                <input
                  value={newItemDesc}
                  onChange={(e) => setNewItemDesc(e.target.value)}
                  placeholder="Add item (e.g. Laksa)"
                  className={`${fieldBase} h-9 min-w-0 flex-1 text-xs`}
                />
                <input
                  inputMode="decimal"
                  value={newItemAmt}
                  onChange={(e) => setNewItemAmt(e.target.value)}
                  placeholder="0.00"
                  className={`${fieldBase} h-9 w-24 text-right font-mono text-xs`}
                />
                <button
                  type="button"
                  onClick={addCustomItem}
                  disabled={!newItemDesc.trim() || !toCents(newItemAmt)}
                  className="rounded-xl border border-line bg-paper px-3 text-xs font-medium disabled:opacity-40"
                >
                  + Item
                </button>
              </div>

              {itemizedCalc && itemizedCalc.ok && (
                <div className="space-y-1.5 rounded-xl bg-paper p-2.5 text-xs">
                  <div className="flex justify-between text-muted">
                    <span>Items subtotal</span>
                    <span className="font-mono">{formatMoney(itemizedCalc.itemsSumCents, group.currency)}</span>
                  </div>
                  <div className="flex justify-between text-muted">
                    <span>
                      Proportional tax / service / extras
                      {draft?.extras && (draft.extras.serviceChargeCents > 0 || draft.extras.taxAddedCents > 0)
                        ? ` (${[
                            draft.extras.serviceChargeCents > 0 ? `svc ${formatMoney(draft.extras.serviceChargeCents, group.currency)}` : "",
                            draft.extras.taxAddedCents > 0 ? `tax ${formatMoney(draft.extras.taxAddedCents, group.currency)}` : "",
                          ]
                            .filter(Boolean)
                            .join(" + ")})`
                        : ""}
                    </span>
                    <span className="font-mono">
                      {itemizedCalc.extrasCents >= 0 ? "+" : "−"}
                      {formatMoney(Math.abs(itemizedCalc.extrasCents), group.currency)}
                    </span>
                  </div>
                  <div className="border-t border-line pt-1.5">
                    {people.map((m) => {
                      const tot = itemizedCalc.owed[m.id] ?? 0;
                      const sub = itemizedCalc.itemSubtotals[m.id] ?? 0;
                      const exShare = itemizedCalc.extrasAllocated[m.id] ?? 0;
                      return (
                        <div key={m.id} className="flex items-baseline justify-between py-0.5">
                          <span className="font-medium">{nameOf(m.id)}</span>
                          <span className="font-mono">
                            {tot > 0 ? (
                              <>
                                <span className="text-muted">
                                  {formatMoney(sub, group.currency)}
                                  {exShare !== 0 ? ` ${exShare > 0 ? "+" : "−"} ${formatMoney(Math.abs(exShare), group.currency)}` : ""} ={" "}
                                </span>
                                <b className="text-ink">{formatMoney(tot, group.currency)}</b>
                              </>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {itemizedCalc && !itemizedCalc.ok && <p className="text-xs text-bad">{itemizedCalc.error}</p>}
            </div>
          ) : (
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
          )}
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
