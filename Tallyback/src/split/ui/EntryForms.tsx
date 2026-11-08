"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { runChecks } from "@tallyback/lib/checks";
import { billToDraft } from "../lib/fromBill";
import { CURRENCY_NAMES, SPEND_CURRENCIES, centsToInput, convert, formatMoney, formatRate, isSpendCurrency, rateBetween, toCents } from "../lib/money";
import { ProgressRing } from "@ui/ProgressRing";
import { SPLIT_METHODS, allocateItemized, checkPaid, splitAmount, type SplitMethod } from "../lib/split";
import type { BillDraft, ClaimableReceiptLine } from "../lib/fromBill";
import { REPEATS, type Repeat } from "../lib/repeat";
import { CATEGORIES, type Category, type Expense, type GroupDetail } from "../lib/types";
import { ErrorNote, Sheet, api, errorText, field, fieldBase, primary, today } from "./kit";
import { ReceiptTile, ReceiptViewer, receiptUrl, scanReceipt, useReceiptPickers, type ReceiptState } from "./receipt";

// Nothing promised: the checks then look only at the bill's own arithmetic and tax.
const NO_PROMISE = { expectedTotal: null, pricesIncludeTax: null, paidOn: null, lineExpected: {}, unrecognised: [] };

// Adding or editing an expense, and recording a payment. The page runs the same split maths as the
// server (lib/split.ts), so it can show each person's share as you type; the server checks again.

const blankIsZero = (t: string) => (t.trim() === "" ? 0 : (toCents(t) ?? (Number(t) === 0 ? 0 : NaN)));

// `draft` pre-fills a new expense from a checked bill ("Split this bill"); `initialFile` is a receipt photo
// taken from the group's Scan button, read as soon as the form opens. A receipt added here is read the
// same way and fills in whatever the person hasn't typed themselves.
export function ExpenseForm({
  group,
  expense,
  draft: draftIn,
  initialFile,
  onClose,
  onSaved,
}: {
  group: GroupDetail;
  expense?: Expense;
  draft?: BillDraft | null;
  initialFile?: File | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<BillDraft | null | undefined>(draftIn);
  const people = group.members.filter((m) => !m.removed || (expense && (expense.paid[m.id] || expense.owed[m.id])));
  const nameOf = (id: string) => (id === group.meId ? "You" : (people.find((m) => m.id === id)?.name ?? "?"));
  const s = expense?.split;
  const paidIds = expense ? Object.keys(expense.paid) : [group.meId];

  const hasDisputedDiff =
    draft?.printedAmountCents != null &&
    draft?.verifiedAmountCents != null &&
    draft.verifiedAmountCents < draft.printedAmountCents;
  const [useVerifiedTotal, setUseVerifiedTotal] = useState(true);

  // The currency it was spent in: the group's, or another (pesos on a trip from Singapore). A scanned
  // bill's own currency is picked up by itself.
  const billCurrency = (d?: BillDraft | null) => (d?.currency && isSpendCurrency(d.currency) ? d.currency : null);
  const [spend, setSpend] = useState<string>(expense?.original?.currency ?? billCurrency(draft) ?? group.currency);
  const foreign = spend !== group.currency;
  const [rate, setRate] = useState<number | null>(expense?.original?.rate ?? null);
  const [rateInfo, setRateInfo] = useState<string | null>(expense?.original ? "the rate saved with this expense" : null);
  const [rateBusy, setRateBusy] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);
  const [editingRate, setEditingRate] = useState(false);

  const [description, setDescription] = useState(expense?.description ?? draft?.description ?? "");
  const [amountText, setAmountText] = useState(
    expense ? (expense.original ? centsToInput(expense.original.amount, expense.original.currency) : centsToInput(expense.amount)) : draft?.amount ? centsToInput(draft.amount) : "",
  );
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
  const [repeat, setRepeat] = useState<Repeat>(expense?.repeat ?? "never");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- the receipt ----
  // The receipt to save: a bill id from your own scan, null to remove it, undefined to leave it as it is
  // (the server never tells the page which photo an expense has, only that it has one).
  const [receiptBillId, setReceiptBillId] = useState<string | null | undefined>(draftIn?.billId ?? undefined);
  const [receipt, setReceipt] = useState<ReceiptState>(() =>
    expense?.hasReceipt
      ? { kind: "attached", preview: receiptUrl(group.id, expense.id) }
      : draftIn?.billId
        ? { kind: "attached", preview: `/api/tallyback/bills/${draftIn.billId}/photo` }
        : { kind: "none" },
  );
  const [viewing, setViewing] = useState(false);
  // Fields the person typed themselves; a receipt read afterwards never overwrites them.
  const typed = useRef<Set<string>>(new Set(expense ? ["description", "amount", "date", "category", "notes"] : []));
  const touch = (k: string) => typed.current.add(k);

  function applyDraft(d: BillDraft) {
    setDraft(d);
    const free = (k: string) => !typed.current.has(k);
    if (free("description") && d.description) setDescription(d.description);
    const cur = billCurrency(d);
    if (free("currency") && cur && cur !== spend) chooseCurrency(cur);
    if (free("amount") && d.amount) setAmountText(centsToInput(d.amount));
    if (free("date") && d.date) setDate(d.date);
    if (free("category")) setCategory(d.category);
    if (free("notes") && d.notes) setNotes(d.notes);
    setUseVerifiedTotal(true);
    const lines = d.claimableLines ?? [];
    const activeIds = people.filter((m) => !m.removed).map((m) => m.id);
    setItemLines(lines);
    setItemClaims(Object.fromEntries(lines.map((line) => [line.lineIndex, line.flagged && line.verifiedCents === 0 ? [] : activeIds])));
    if (lines.length > 1) setItemMode(true);
  }

  async function readReceipt(file: File) {
    const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    setReceipt({ kind: "scanning", preview });
    const out = await scanReceipt(file);
    if (out.kind === "read") {
      const checked = runChecks(out.extraction, NO_PROMISE);
      applyDraft(billToDraft(out.extraction, checked, out.billId));
      setReceiptBillId(out.billId);
      setReceipt({ kind: "read", preview, items: out.extraction.lines.filter((l) => l.kind === "item").length || out.extraction.lines.length });
    } else if (out.kind === "kept") {
      setReceiptBillId(out.billId);
      setReceipt({ kind: "kept", preview, note: out.error });
    } else {
      setReceipt({ kind: "failed", preview, note: out.error });
    }
  }
  const pickers = useReceiptPickers(readReceipt);
  // A photo taken from the group's Scan button: read it straight away (once).
  const started = useRef(false);
  useEffect(() => {
    if (initialFile && !started.current) {
      started.current = true;
      readReceipt(initialFile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);
  function removeReceipt() {
    setReceiptBillId(null);
    setReceipt({ kind: "none" });
  }
  const viewSrc = receipt.kind === "none" || receipt.kind === "scanning" || receipt.kind === "failed" ? null : receipt.preview || (expense?.hasReceipt && receiptBillId === undefined ? receiptUrl(group.id, expense.id) : null);

  // Today's rate for the chosen currency, into the group's (fetched once per group currency per form).
  const tables = useRef<Record<string, { base: string; date: string; source: string; rates: Record<string, number> }>>({});
  async function chooseCurrency(c: string) {
    touch("currency");
    setSpend(c);
    setRateError(null);
    setEditingRate(false);
    if (c === group.currency) return setRate(null);
    setRate(null);
    setRateBusy(true);
    try {
      const t = (tables.current[group.currency] ??= await api(`/rates?base=${group.currency}`));
      const r = rateBetween(t, c, group.currency);
      if (!r) throw new Error(`There's no rate for ${c} today. Type the rate yourself.`);
      setRate(r);
      setRateInfo(`${t.source}, ${t.date}`);
    } catch (e) {
      setRateError(errorText(e));
      setEditingRate(true);
    } finally {
      setRateBusy(false);
    }
  }
  // A bill scanned abroad arrives in its own currency: look its rate up straight away.
  useEffect(() => {
    if (foreign && rate == null && !rateBusy) chooseCurrency(spend);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // What was typed, in the currency it was spent in; and the amount in the group's currency, which
  // everything else (who paid, the split) works in.
  const entered = toCents(amountText) ?? 0;
  const amount = foreign ? (rate ? convert(entered, rate) : 0) : entered;
  const inGroup = (c: number) => (foreign && rate ? convert(c, rate) : c);

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
        amountCents: inGroup(useVerifiedTotal ? line.verifiedCents : line.printedCents), // the bill's lines are in the currency it was spent in
        members: itemClaims[line.lineIndex] ?? [],
      }))
      .filter((l) => l.amountCents > 0);
    return allocateItemized(
      amount,
      activeLines,
      people.map((m) => m.id),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemMode, amount, itemLines, itemClaims, useVerifiedTotal, people, rate, foreign]);

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
  const problem = !description.trim()
    ? "Describe the expense."
    : foreign && !rate
      ? rateBusy
        ? "Getting today's rate…"
        : "Enter the exchange rate."
      : !amount
        ? "Enter the amount."
        : paidError ?? (result && !result.ok ? result.error : null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const original = foreign && rate ? { currency: spend, amount: entered, rate } : null;
      const body = { kind: "expense", description, amount, category, date, paid, split, notes, receiptBillId, repeat, original };
      if (receipt.kind === "scanning" && !confirm("The receipt is still being read. Save without it?")) {
        setBusy(false);
        return;
      }
      if (expense) await api(`/groups/${group.id}/expenses/${expense.id}`, "PATCH", body);
      else await api(`/groups/${group.id}/expenses`, "POST", body);
      onSaved();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  const unit = { exact: group.currency, percent: "%", shares: "shares", equal: "" }[method];
  const scanning = receipt.kind === "scanning";
  const saveLabel = busy ? "Saving…" : problem && amount && description.trim() ? problem : amount ? `Save · ${formatMoney(amount, group.currency)}` : "Save";
  return (
    <Sheet
      title={expense ? "Edit expense" : draftIn ? "Split this bill" : "Add an expense"}
      onClose={onClose}
      footer={
        <>
          <ErrorNote text={error} />
          <button type="submit" form="expense-form" disabled={busy || !!problem} className={`${primary} ${error ? "mt-2" : ""}`}>
            {saveLabel}
          </button>
        </>
      }
    >
      {pickers.inputs}
      <form id="expense-form" onSubmit={save} className="space-y-4">
        <ReceiptTile state={receipt} onTakePhoto={pickers.takePhoto} onChooseFile={pickers.chooseFile} onView={viewSrc ? () => setViewing(true) : undefined} onRemove={removeReceipt} />

        <label className={`flex items-baseline justify-center gap-2 rounded-2xl border border-line bg-card px-4 py-3 focus-within:border-ink ${scanning && !typed.current.has("amount") ? "animate-pulse" : ""}`}>
          {/* Shows just the code; the list underneath names each currency. */}
          <span className={`relative shrink-0 text-lg ${foreign ? "font-medium text-ink" : "text-muted"}`}>
            {spend} <span aria-hidden="true" className="text-xs">▾</span>
            <select
              value={spend}
              onChange={(e) => chooseCurrency(e.target.value)}
              aria-label={`Currency it was spent in: ${spend}`}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            >
              {SPEND_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                  {c === group.currency ? " (group)" : ` · ${CURRENCY_NAMES[c]}`}
                </option>
              ))}
            </select>
          </span>
          <input
            inputMode="decimal"
            enterKeyHint="done"
            value={amountText}
            onChange={(e) => {
              touch("amount");
              setAmountText(e.target.value);
            }}
            placeholder="0.00"
            aria-label="Amount"
            className="text-hero min-w-0 max-w-[12ch] flex-1 bg-transparent text-center font-semibold outline-none"
          />
        </label>

        {foreign && (
          <div className="-mt-2 rounded-2xl bg-card px-4 py-2.5 text-sm" aria-live="polite">
            {rateBusy ? (
              <span className="flex items-center gap-2 text-muted">
                <ProgressRing size={18} expectedMs={1000} label="Getting today's rate" className="text-ink" /> Getting today&apos;s rate…
              </span>
            ) : (
              <>
                {rate && (
                  <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span>
                      = <b className="tabular-nums">{formatMoney(amount, group.currency)}</b> for the group
                    </span>
                    <button type="button" onClick={() => setEditingRate((v) => !v)} className="text-xs text-muted underline underline-offset-4">
                      {formatRate(rate, spend, group.currency)}
                    </button>
                  </p>
                )}
                {rate && rateInfo && !editingRate && <p className="text-xs text-muted">Rate from {rateInfo}. Tap it to use your card&apos;s rate instead.</p>}
                {rateError && <p className="text-xs text-warn">{rateError}</p>}
                {editingRate && (
                  <label className="mt-2 flex items-center gap-2 text-xs">
                    <span className="shrink-0">1 {spend} =</span>
                    <input
                      inputMode="decimal"
                      defaultValue={rate ? String(Number(rate.toPrecision(6))) : ""}
                      onChange={(e) => {
                        const r = Number(e.target.value);
                        setRate(r > 0 && Number.isFinite(r) ? r : null);
                        setRateInfo("the rate you entered");
                      }}
                      aria-label={`Exchange rate, ${group.currency} per ${spend}`}
                      className={`${fieldBase} h-10 min-w-0 flex-1 text-base`}
                    />
                    <span className="shrink-0">{group.currency}</span>
                  </label>
                )}
              </>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <select
            value={category}
            onChange={(e) => {
              touch("category");
              setCategory(e.target.value as Category);
            }}
            aria-label="Category"
            className={`${fieldBase} h-12 w-14 shrink-0 px-2 text-center text-xl`}
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id} title={c.label}>
                {c.icon} {c.label}
              </option>
            ))}
          </select>
          <input
            value={description}
            onChange={(e) => {
              touch("description");
              setDescription(e.target.value);
            }}
            placeholder={scanning ? "Reading the receipt…" : "What was it for?"}
            enterKeyHint="next"
            className={`${fieldBase} h-12 min-w-0 flex-1`}
          />
        </div>
        <div className="flex gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => {
            touch("date");
            setDate(e.target.value);
          }}
          aria-label="Date"
          className={`${fieldBase} h-12 min-w-0 flex-1`}
        />
        <select value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)} aria-label="Repeats" className={`${fieldBase} h-12 w-auto shrink-0`}>
          {REPEATS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id === "never" ? "No repeat" : `🔁 ${r.label}`}
            </option>
          ))}
        </select>
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

        {draft?.currency && draft.currency !== group.currency && !isSpendCurrency(draft.currency) && (
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
          <div className="-mx-5 mb-2 flex snap-x gap-1.5 overflow-x-auto px-5 pb-1">
            <button
              type="button"
              onClick={() => setItemMode(true)}
              aria-pressed={itemMode}
              className={`min-h-11 shrink-0 snap-start whitespace-nowrap rounded-full border px-4 font-medium ${itemMode ? "border-ink bg-ink text-white" : "border-line bg-card"}`}
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
                className={`min-h-11 shrink-0 snap-start whitespace-nowrap rounded-full border px-4 ${!itemMode && method === m.id ? "border-ink bg-ink text-white" : "border-line bg-card"}`}
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
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {people.map((m) => {
                            const active = claimants.includes(m.id);
                            return (
                              <button
                                type="button"
                                key={m.id}
                                onClick={() => toggleClaim(line.lineIndex, m.id)}
                                aria-pressed={active}
                                className={`min-h-10 rounded-full border px-3.5 text-sm font-medium ${active ? "border-ink bg-ink text-white" : "border-line bg-paper text-muted"}`}
                              >
                                {nameOf(m.id)}
                              </button>
                            );
                          })}
                          <button
                            type="button"
                            onClick={() => claimAllForLine(line.lineIndex)}
                            className={`min-h-10 rounded-full border px-3 text-sm ${allSelected ? "border-ink/40 bg-paper text-ink" : "border-dashed border-line text-muted"}`}
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
                  <label key={m.id} className="flex min-h-11 items-center justify-between gap-3">
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
                        className="h-6 w-6 accent-ink"
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

        <textarea
          value={notes}
          onChange={(e) => {
            touch("notes");
            setNotes(e.target.value);
          }}
          rows={2}
          placeholder="Notes (optional)"
          className={`${field} resize-none`}
        />
      </form>
      {viewing && viewSrc && <ReceiptViewer src={viewSrc} title={description || "Receipt"} onClose={() => setViewing(false)} />}
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
