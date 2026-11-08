"use client";

import { Loading } from "@ui/ProgressRing";
import { useCallback, useEffect, useMemo, useState } from "react";
import { myShare } from "../lib/balances";
import { CURRENCIES, formatMoney } from "../lib/money";
import { GROUP_KINDS, categoryOf, kindOf, type Expense, type GroupDetail, type GroupKind } from "../lib/types";
import { ActivityList } from "./Dashboard";
import { ExpenseForm, PaymentForm } from "./EntryForms";
import { SettleUp } from "./SettleUp";
import { REPEATS } from "../lib/repeat";
import type { BillDraft } from "../lib/fromBill";
import { Avatar, ErrorNote, Sheet, Standing, Tabs, api, errorText, field, fieldBase, iconButton, primary, secondary, when } from "./kit";
import { ReceiptViewer, receiptUrl, useReceiptPickers } from "./receipt";

// One group: its expenses, who owes whom, spending totals and what happened, plus its settings.
type Tab = "expenses" | "balances" | "totals" | "activity";
type Open =
  | { kind: "add"; file?: File }
  | { kind: "edit"; expense: Expense }
  | { kind: "pay"; preset?: { from: string; to: string; amount: number } }
  | { kind: "settle"; preset?: { from: string; to: string; amount: number } }
  | { kind: "detail"; id: string }
  | { kind: "settings" }
  | null;

// `draft`: arrived from "Split this bill", so the pre-filled expense form opens once the group loads.
export function GroupView({ id, onBack, draft, onDraftDone }: { id: string; onBack: () => void; draft?: BillDraft | null; onDraftDone?: () => void }) {
  const [g, setG] = useState<GroupDetail | null>(null);
  const [tab, setTab] = useState<Tab>("expenses");
  const [open, setOpen] = useState<Open>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => api<GroupDetail>(`/groups/${id}`).then(setG, (e) => setError(errorText(e))), [id]);
  useEffect(() => {
    reload();
  }, [reload]);
  useEffect(() => {
    if (draft && g) setOpen((o) => o ?? { kind: "add" });
  }, [draft, g]);
  const saved = () => {
    if (open?.kind === "add") onDraftDone?.();
    setOpen(null);
    reload();
  };

  // The Scan button opens the camera straight away; the photo then opens the form, already being read.
  const scan = useReceiptPickers((file) => setOpen({ kind: "add", file }));

  if (!g)
    return (
      <section className="space-y-4">
        <button onClick={onBack} className={`${iconButton} -ml-3 w-auto px-3 text-sm text-muted`}>
          ← All groups
        </button>
        {error ? (
          <ErrorNote text={error} />
        ) : (
          <Loading label="Opening the group" expectedMs={1500} className="pt-16" />
        )}
      </section>
    );

  const nameOf = (mid: string) => (mid === g.meId ? "You" : (g.members.find((m) => m.id === mid)?.name ?? "Someone"));
  const mine = g.balances[g.meId] ?? 0;
  const deleted = g.expenses.filter((e) => e.deleted).length;
  // Search, like Splitwise's expense filters: what it was for, the notes, who paid, or the amount.
  const q = query.trim().toLowerCase();
  const matches = (e: Expense) =>
    !q ||
    [e.description, e.notes, categoryOf(e.category).label, ...Object.keys(e.paid).map(nameOf), (e.amount / 100).toFixed(2)].some((t) => t.toLowerCase().includes(q));
  const shown = g.expenses.filter((e) => (showDeleted || !e.deleted) && matches(e));
  const detail = open?.kind === "detail" ? g.expenses.find((e) => e.id === open.id) : undefined;
  const active = g.members.filter((m) => !m.removed);
  // The one thing to do next: pay who you owe, nudge who owes you, or nothing at all.
  const iOwe = g.debts.filter((t) => t.from === g.meId).sort((a, b) => b.amount - a.amount)[0];
  const owesMe = g.debts.filter((t) => t.to === g.meId);
  const remind = () => window.open(`https://wa.me/?text=${encodeURIComponent(formatSettlementWhatsApp(g, nameOf))}`, "_blank");

  return (
    <section className="space-y-4 pb-24">
      <div className="-mx-1 flex items-center justify-between">
        <button onClick={onBack} aria-label="All groups" className={`${iconButton} text-xl text-muted`}>
          ←
        </button>
        <h1 className="flex min-w-0 items-center gap-2 truncate text-lg font-semibold">
          <span aria-hidden="true">{kindOf(g.kind).icon}</span>
          <span className="truncate">{g.name}</span>
        </h1>
        <button onClick={() => setOpen({ kind: "settings" })} aria-label="Group settings" className={`${iconButton} text-xl text-muted`}>
          ⋯
        </button>
      </div>

      <div className="rounded-3xl bg-ink p-5 text-white">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] text-white/70">{mine > 0 ? "You are owed" : mine < 0 ? "You owe" : "You're all square"}</p>
            <p className="mt-1 text-[40px] font-semibold leading-[44px] tracking-tight tabular-nums">{formatMoney(Math.abs(mine), g.currency)}</p>
          </div>
          <span className="flex shrink-0 -space-x-2 pt-1" aria-label={`${active.length} people`}>
            {active.slice(0, 4).map((m) => (
              <span key={m.id} className="rounded-full ring-2 ring-ink">
                <Avatar name={m.name} size={28} />
              </span>
            ))}
            {active.length > 4 && <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-[11px] ring-2 ring-ink">+{active.length - 4}</span>}
          </span>
        </div>
        <div className="mt-4 flex gap-2">
          {iOwe ? (
            <button onClick={() => setOpen({ kind: "settle", preset: iOwe })} className="min-h-11 rounded-full bg-white px-5 text-sm font-semibold text-ink active:scale-[.98]">
              Pay {nameOf(iOwe.to)} {formatMoney(iOwe.amount, g.currency)}
            </button>
          ) : owesMe.length ? (
            <button onClick={remind} className="min-h-11 rounded-full bg-white px-5 text-sm font-semibold text-ink active:scale-[.98]">
              Remind on WhatsApp
            </button>
          ) : null}
          <button onClick={() => setOpen({ kind: "settle" })} className="min-h-11 rounded-full border border-white/30 px-5 text-sm font-medium active:scale-[.98]">
            Settle up
          </button>
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "expenses", label: "Expenses" },
          { id: "balances", label: "Balances" },
          { id: "totals", label: "Totals" },
          { id: "activity", label: "Activity" },
        ]}
      />
      <ErrorNote text={error} />

      {tab === "expenses" && (
        <div className="space-y-3">
          {g.expenses.length > 5 && (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search expenses"
              aria-label="Search expenses"
              className={`${fieldBase} h-11 w-full text-base`}
            />
          )}
          {q && shown.length === 0 && <p className="py-6 text-center text-sm text-muted">Nothing matches “{query.trim()}”.</p>}
          {!q && shown.length === 0 && (
            <div className="rounded-3xl border border-dashed border-line p-6 text-center">
              <p className="font-semibold">No expenses yet</p>
              <p className="mt-1 text-sm text-muted">Snap the receipt and TallyBack fills in the amount and items, then checks the maths.</p>
              <button onClick={scan.takePhoto} className={`${primary} mt-4`}>
                Scan your first receipt
              </button>
              <button onClick={() => setOpen({ kind: "add" })} className="mt-2 min-h-11 text-sm text-muted underline underline-offset-4">
                or type it in
              </button>
            </div>
          )}
          {days(shown).map(([day, items]) => (
            <div key={day}>
              <p className="sticky top-0 z-10 -mx-4 bg-paper/95 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted backdrop-blur">{dayLabel(day)}</p>
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
                {items.map((e) => (
                  <li key={e.id}>
                    <ExpenseRow e={e} g={g} nameOf={nameOf} onClick={() => setOpen({ kind: "detail", id: e.id })} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {deleted > 0 && (
            <button onClick={() => setShowDeleted((s) => !s)} className="block w-full pt-2 text-center text-sm text-muted underline underline-offset-4">
              {showDeleted ? "Hide" : "Show"} {deleted} deleted
            </button>
          )}
        </div>
      )}

      {tab === "balances" && <Balances g={g} nameOf={nameOf} onPay={(preset) => setOpen({ kind: "settle", preset })} onChanged={reload} />}
      {tab === "totals" && <Totals g={g} />}
      {tab === "activity" && <ActivityList items={g.activity} />}

      {/* Thumb-reach actions above the tab bar: Scan opens the camera, + types one in. */}
      {scan.inputs}
      {!open && g.expenses.length > 0 && (
        <div className="fixed right-4 z-30 flex items-center gap-2" style={{ bottom: "calc(var(--tabbar-h) + 16px)" }}>
          <button onClick={() => setOpen({ kind: "add" })} aria-label="Add an expense by hand" className="flex h-14 w-14 items-center justify-center rounded-full border border-line bg-card text-2xl shadow-lg active:scale-95">
            +
          </button>
          <button onClick={scan.takePhoto} className="flex h-14 items-center gap-2 rounded-full bg-ink pl-5 pr-6 font-semibold text-white shadow-lg active:scale-95">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
            Scan receipt
          </button>
        </div>
      )}

      {open?.kind === "add" && (
        <ExpenseForm
          group={g}
          initialFile={open.file}
          draft={draft}
          onClose={() => {
            onDraftDone?.();
            setOpen(null);
          }}
          onSaved={saved}
        />
      )}
      {open?.kind === "edit" &&
        (open.expense.kind === "payment" ? (
          <PaymentForm group={g} payment={open.expense} onClose={() => setOpen(null)} onSaved={saved} />
        ) : (
          <ExpenseForm group={g} expense={open.expense} onClose={() => setOpen(null)} onSaved={saved} />
        ))}
      {open?.kind === "settle" && <SettleUp group={g} initial={open.preset} onClose={() => setOpen(null)} onSaved={saved} onOther={() => setOpen({ kind: "pay" })} />}
      {open?.kind === "pay" && <PaymentForm group={g} preset={open.preset} onClose={() => setOpen(null)} onSaved={saved} />}
      {detail && <ExpenseDetail g={g} e={detail} nameOf={nameOf} onClose={() => setOpen(null)} onEdit={() => setOpen({ kind: "edit", expense: detail })} onChanged={reload} />}
      {open?.kind === "settings" && <Settings g={g} onClose={() => setOpen(null)} onChanged={reload} onDeleted={onBack} />}
    </section>
  );
}

// Newest first, one block per day: "Today", "Yesterday", "Sat 8 Nov", and the year once it isn't this one.
function days(items: Expense[]): [string, Expense[]][] {
  const out = new Map<string, Expense[]>();
  for (const e of items) out.set(e.date, [...(out.get(e.date) ?? []), e]);
  return [...out];
}
function dayLabel(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  const t = new Date();
  const start = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const diff = Math.round((start - d.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", ...(d.getFullYear() !== t.getFullYear() ? { year: "numeric" } : {}) });
}

function ExpenseRow({ e, g, nameOf, onClick }: { e: Expense; g: GroupDetail; nameOf: (id: string) => string; onClick: () => void }) {
  const share = myShare(e, g.meId);
  const payers = Object.keys(e.paid);
  const isPayment = e.kind === "payment";
  return (
    <button onClick={onClick} className={`flex min-h-16 w-full items-center gap-3 px-3 py-2.5 text-left active:bg-paper ${e.deleted ? "opacity-50" : ""}`}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-paper text-lg" aria-hidden="true">
        {isPayment ? "💸" : categoryOf(e.category).icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`flex items-center gap-1.5 font-medium ${e.deleted ? "line-through" : ""}`}>
          <span className="truncate">{isPayment ? `${nameOf(payers[0])} paid ${nameOf(Object.keys(e.owed)[0])}` : e.description}</span>
          {e.hasReceipt && (
            <span className="shrink-0 text-xs" role="img" aria-label="Has a receipt">
              🧾
            </span>
          )}
          {e.repeat !== "never" && !e.deleted && (
            <span className="shrink-0 text-xs" role="img" aria-label="Repeats">
              🔁
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-muted">
          {isPayment ? "Payment" : `${payers.length > 1 ? `${payers.length} people` : nameOf(payers[0])} paid`} {formatMoney(e.amount, g.currency)}
        </span>
      </span>
      <span className="shrink-0 text-right text-xs">
        {share === 0 ? (
          <span className="text-muted">{e.owed[g.meId] || e.paid[g.meId] ? "settled" : "not involved"}</span>
        ) : (
          <span className={share > 0 ? "text-good" : "text-bad"}>
            {isPayment ? (share > 0 ? "you paid" : "you received") : share > 0 ? "you lent" : "you borrowed"}
            <b className="block text-sm">{formatMoney(Math.abs(share), g.currency)}</b>
          </span>
        )}
      </span>
    </button>
  );
}

function formatSettlementWhatsApp(g: GroupDetail, nameOf: (id: string) => string): string {
  const activeCount = g.expenses.filter((e) => !e.deleted && e.kind === "expense").length;
  const totalSpent = g.expenses
    .filter((e) => !e.deleted && e.kind === "expense")
    .reduce((acc, e) => acc + e.amount, 0);
  const header = `🧾 *${g.name}* — TallyBack Settlement`;
  const sub = activeCount
    ? `${activeCount} shared expense${activeCount === 1 ? "" : "s"} (${formatMoney(totalSpent, g.currency)} total)${g.simplify ? " · simplified to fewest transfers" : ""}`
    : "Group balance summary";
  if (g.debts.length === 0) {
    return `${header}\n${sub}\n\n✅ Everyone is settled up!`;
  }
  const lines = g.debts.map((t, i) => `${i + 1}. *${nameOf(t.from)}* → *${nameOf(t.to)}*: ${formatMoney(t.amount, g.currency)}`);
  return `${header}\n${sub}\n\n*Who pays whom:*\n${lines.join("\n")}\n\n— Verified & split with TallyBack`;
}

function Balances({
  g,
  nameOf,
  onPay,
  onChanged,
}: {
  g: GroupDetail;
  nameOf: (id: string) => string;
  onPay: (preset: { from: string; to: string; amount: number }) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const people = g.members.filter((m) => !m.removed).sort((a, b) => (g.balances[b.id] ?? 0) - (g.balances[a.id] ?? 0));
  const summaryText = useMemo(() => formatSettlementWhatsApp(g, nameOf), [g, nameOf]);

  async function toggle() {
    setBusy(true);
    await api(`/groups/${g.id}`, "PATCH", { simplify: !g.simplify }).catch(() => {});
    await onChanged();
    setBusy(false);
  }

  function shareWhatsApp() {
    const url = `https://wa.me/?text=${encodeURIComponent(summaryText)}`;
    window.open(url, "_blank");
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  return (
    <div className="space-y-5">
      <ul className="space-y-2">
        {people.map((m) => (
          <li key={m.id} className="flex items-center gap-3 rounded-2xl border border-line bg-card p-3">
            <Avatar name={m.name} />
            <span className="min-w-0 flex-1 truncate font-medium">{m.id === g.meId ? `${m.name} (you)` : m.name}</span>
            <Standing cents={g.balances[m.id] ?? 0} currency={g.currency} you={false} className="text-sm" />
          </li>
        ))}
      </ul>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-semibold">{g.simplify ? "Fewest payments to settle" : "Who owes whom"}</h3>
          <label className="flex items-center gap-2 text-sm text-muted">
            Simplify debts
            <input type="checkbox" checked={g.simplify} disabled={busy} onChange={toggle} className="h-4 w-4 accent-ink" />
          </label>
        </div>
        {g.debts.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">Everyone is settled up.</p>
        ) : (
          <ul className="space-y-2">
            {g.debts.map((t) => (
              <li key={`${t.from}-${t.to}`} className="flex items-center gap-3 rounded-2xl border border-line bg-card p-3 text-sm">
                <span className="min-w-0 flex-1">
                  <b className="font-medium">{nameOf(t.from)}</b> {t.from === g.meId ? "owe" : "owes"} <b className="font-medium">{nameOf(t.to)}</b>
                  <span className="block text-base font-semibold">{formatMoney(t.amount, g.currency)}</span>
                </span>
                <button onClick={() => onPay(t)} className={secondary}>
                  Record
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">
          {g.simplify
            ? "Debts are combined across the group, so nobody pays someone just to have it passed on."
            : "Each expense is settled between the people who shared it; turn on Simplify debts for fewer payments."}
        </p>
      </div>

      {g.debts.length > 0 && (
        <div className="rounded-2xl border border-line bg-card p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-semibold">Send settlement summary</h3>
            <span className="text-xs text-muted">1-tap group tally</span>
          </div>
          <pre className="mt-2.5 whitespace-pre-wrap rounded-xl border border-line bg-paper p-3 font-mono text-xs leading-relaxed text-ink">
            {summaryText}
          </pre>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={shareWhatsApp}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-wa text-sm font-medium text-white active:scale-[.99]"
            >
              Share tally on WhatsApp
            </button>
            <button type="button" onClick={copySummary} className="h-11 rounded-xl border border-line bg-paper px-4 text-sm font-medium">
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Totals({ g }: { g: GroupDetail }) {
  const stats = useMemo(() => {
    const live = g.expenses.filter((e) => !e.deleted && e.kind === "expense");
    const byCat = new Map<string, number>();
    for (const e of live) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount);
    return {
      total: live.reduce((a, e) => a + e.amount, 0),
      myShare: live.reduce((a, e) => a + (e.owed[g.meId] ?? 0), 0),
      iPaid: live.reduce((a, e) => a + (e.paid[g.meId] ?? 0), 0),
      byCat: [...byCat].sort((a, b) => b[1] - a[1]),
    };
  }, [g]);
  const max = stats.byCat[0]?.[1] ?? 1;
  const tile = (label: string, cents: number) => (
    <div className="rounded-2xl border border-line bg-card p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold">{formatMoney(cents, g.currency)}</p>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {tile("Group spending", stats.total)}
        {tile("Your share", stats.myShare)}
        {tile("You paid", stats.iPaid)}
      </div>
      {stats.byCat.length > 0 && (
        <div className="rounded-2xl border border-line bg-card p-4">
          <h3 className="mb-3 font-semibold">By category</h3>
          <ul className="space-y-2.5 text-sm">
            {stats.byCat.map(([cat, cents]) => (
              <li key={cat}>
                <div className="flex justify-between">
                  <span>
                    {categoryOf(cat).icon} {categoryOf(cat).label}
                  </span>
                  <span className="font-mono">{formatMoney(cents, g.currency)}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-paper">
                  <div className="h-full rounded-full bg-ink" style={{ width: `${(cents / max) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-muted">Payments between members aren&apos;t spending, so they&apos;re left out here.</p>
    </div>
  );
}

function ExpenseDetail({
  g,
  e,
  nameOf,
  onClose,
  onEdit,
  onChanged,
}: {
  g: GroupDetail;
  e: Expense;
  nameOf: (id: string) => string;
  onClose: () => void;
  onEdit: () => void;
  onChanged: () => Promise<unknown> | void;
}) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const comments = g.comments.filter((c) => c.expenseId === e.id);
  const isPayment = e.kind === "payment";
  const [viewing, setViewing] = useState(false);
  const receipt = e.hasReceipt ? receiptUrl(g.id, e.id) : null;

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  const url = `/groups/${g.id}/expenses/${e.id}`;

  return (
    <Sheet title={isPayment ? "Payment" : e.description} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-card text-2xl" aria-hidden="true">
            {isPayment ? "💸" : categoryOf(e.category).icon}
          </span>
          <div>
            <p className="text-3xl font-semibold">{formatMoney(e.amount, g.currency)}</p>
            <p className="text-sm text-muted">
              {new Date(`${e.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "long", year: "numeric" })}
              {!isPayment && ` · ${categoryOf(e.category).label}`}
            </p>
          </div>
        </div>
        {e.deleted && <p className="rounded-xl bg-warn-soft p-3 text-sm text-warn">This was deleted. Restore it to count it again.</p>}
        {receipt && (
          <button onClick={() => setViewing(true)} className="flex w-full items-center gap-3 rounded-2xl border border-line bg-card p-2.5 text-left active:bg-paper">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={receipt} alt="" className="h-14 w-14 shrink-0 rounded-xl border border-line bg-paper object-cover" onError={(ev) => (ev.currentTarget.style.visibility = "hidden")} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Receipt</span>
              <span className="block text-xs text-muted">Tap to see it full size</span>
            </span>
            <span className="pr-2 text-muted" aria-hidden="true">
              ›
            </span>
          </button>
        )}
        {viewing && receipt && <ReceiptViewer src={receipt} title={e.description} onClose={() => setViewing(false)} />}

        <ul className="space-y-1.5 rounded-2xl border border-line bg-card p-3 text-sm">
          {Object.entries(e.paid).map(([id, c]) => (
            <li key={`p${id}`} className="flex justify-between">
              <span>
                <b className="font-medium">{nameOf(id)}</b> paid
              </span>
              <span className="font-mono">{formatMoney(c, g.currency)}</span>
            </li>
          ))}
          {Object.entries(e.owed).map(([id, c]) => (
            <li key={`o${id}`} className="flex justify-between text-muted">
              <span>
                {nameOf(id)} {isPayment ? "received" : id === g.meId ? "owe" : "owes"}
              </span>
              <span className="font-mono">{formatMoney(c, g.currency)}</span>
            </li>
          ))}
        </ul>
        {e.split && e.split.method !== "equal" && <p className="text-xs text-muted">Split by {e.split.method === "exact" ? "exact amounts" : e.split.method === "percent" ? "percentages" : "shares"}.</p>}
        {e.repeat !== "never" && !e.deleted && (
          <p className="rounded-2xl bg-card p-3 text-sm">
            🔁 {REPEATS.find((r) => r.id === e.repeat)?.label}
            {e.nextRepeat && <span className="text-muted"> · next copy {new Date(`${e.nextRepeat}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>}
          </p>
        )}
        {e.notes && <p className="whitespace-pre-wrap rounded-2xl bg-card p-3 text-sm">{e.notes}</p>}
        <p className="text-xs text-muted">
          Added by {e.createdBy} on {when(e.createdAt)}
        </p>

        <div className="flex gap-2">
          {!e.deleted && (
            <button onClick={onEdit} className={secondary}>
              Edit
            </button>
          )}
          {e.deleted ? (
            <button disabled={busy} onClick={() => act(() => api(url, "PATCH", { restore: true }))} className={secondary}>
              Restore
            </button>
          ) : (
            <button disabled={busy} onClick={() => confirm("Delete this? You can restore it later.") && act(() => api(url, "DELETE"))} className={`${secondary} text-bad`}>
              Delete
            </button>
          )}
        </div>

        <div>
          <h3 className="mb-2 font-semibold">Comments</h3>
          {comments.length === 0 && <p className="text-sm text-muted">No comments yet.</p>}
          <ul className="space-y-2">
            {comments.map((c) => (
              <li key={c.id} className="flex gap-2 text-sm">
                <Avatar name={c.author} size={26} />
                <span className="min-w-0 rounded-2xl bg-card px-3 py-2">
                  <b className="font-medium">{c.author}</b> <span className="text-xs text-muted">{when(c.createdAt)}</span>
                  <span className="block whitespace-pre-wrap">{c.body}</span>
                  {c.mine && (
                    <button
                      disabled={busy}
                      onClick={() => confirm("Delete your comment?") && act(() => api(`${url}/comments?commentId=${c.id}`, "DELETE"))}
                      className="mt-1 text-xs text-muted underline"
                    >
                      Delete
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              const text = comment.trim();
              if (!text) return;
              act(async () => {
                await api(`${url}/comments`, "POST", { text });
                setComment("");
              });
            }}
            className="mt-3 flex gap-2"
          >
            <input value={comment} onChange={(ev) => setComment(ev.target.value)} placeholder="Add a comment" className={`${fieldBase} min-w-0 flex-1`} />
            <button type="submit" disabled={busy || !comment.trim()} className="rounded-xl bg-ink px-4 text-sm font-medium text-white disabled:opacity-40">
              Post
            </button>
          </form>
        </div>
        <ErrorNote text={error} />
      </div>
    </Sheet>
  );
}

function Settings({ g, onClose, onChanged, onDeleted }: { g: GroupDetail; onClose: () => void; onChanged: () => Promise<unknown> | void; onDeleted: () => void }) {
  const [name, setName] = useState(g.name);
  const [kind, setKind] = useState<GroupKind>(g.kind);
  const [currency, setCurrency] = useState(g.currency);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const hasExpenses = g.expenses.length > 0;

  async function act(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
      await onChanged();
      if (done) setNote(done);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Group settings" onClose={onClose}>
      <div className="space-y-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act(() => api(`/groups/${g.id}`, "PATCH", { name, kind, currency }), "Saved.");
          }}
          className="space-y-3"
        >
          <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Group name" className={field} />
          <div className="flex flex-wrap gap-2">
            {GROUP_KINDS.map((k) => (
              <button
                type="button"
                key={k.id}
                onClick={() => setKind(k.id)}
                aria-pressed={kind === k.id}
                className={`rounded-full border px-3 py-1.5 text-sm ${kind === k.id ? "border-ink bg-ink text-white" : "border-line bg-card"}`}
              >
                {k.icon} {k.label}
              </button>
            ))}
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Currency</span>
            <select value={currency} disabled={hasExpenses} onChange={(e) => setCurrency(e.target.value)} className={field}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            {hasExpenses && <span className="mt-1 block text-xs text-muted">Fixed once the group has expenses.</span>}
          </label>
          <button type="submit" disabled={busy || !name.trim()} className={primary}>
            Save changes
          </button>
        </form>

        <div>
          <h3 className="mb-2 font-semibold">Members</h3>
          <ul className="space-y-2">
            {g.members
              .filter((m) => !m.removed)
              .map((m) => (
                <li key={m.id} className="flex items-center gap-3 rounded-2xl border border-line bg-card p-3 text-sm">
                  <Avatar name={m.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {m.name}
                      {m.id === g.meId && " (you)"}
                    </span>
                    <span className="block truncate text-xs text-muted">{m.email ? `${m.email}${m.joined ? "" : " · invited"}` : "no email · tracked only"}</span>
                  </span>
                  <button
                    disabled={busy}
                    onClick={() => {
                      const n = prompt("Name", m.name);
                      if (n && n.trim() && n.trim() !== m.name) act(() => api(`/groups/${g.id}/members/${m.id}`, "PATCH", { name: n.trim(), email: m.email ?? "" }));
                    }}
                    className="px-1 py-2 text-xs text-muted underline"
                  >
                    Rename
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      confirm(m.id === g.meId ? "Leave this group?" : `Remove ${m.name}?`) &&
                      act(async () => {
                        await api(`/groups/${g.id}/members/${m.id}`, "DELETE");
                        if (m.id === g.meId) onDeleted();
                      })
                    }
                    className="px-1 py-2 text-xs text-bad underline"
                  >
                    {m.id === g.meId ? "Leave" : "Remove"}
                  </button>
                </li>
              ))}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                await api(`/groups/${g.id}/members`, "POST", { name: newName.trim() || newEmail.split("@")[0], email: newEmail.trim() });
                setNewName("");
                setNewEmail("");
              }, "Added.");
            }}
            className="mt-3 flex gap-2"
          >
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" className={`${fieldBase} w-2/5`} />
            <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} type="email" placeholder="Email (optional)" className={`${fieldBase} min-w-0 flex-1`} />
            <button type="submit" disabled={busy || !(newName.trim() || newEmail.trim())} className="rounded-xl bg-ink px-4 text-sm font-medium text-white disabled:opacity-40">
              Add
            </button>
          </form>
          <p className="mt-2 text-xs text-muted">Sign-in on Tinkeryard is invite-only, so a new person&apos;s email must also be on the allow-list before they can open the group.</p>
        </div>

        {note && <p className="rounded-xl bg-good-soft p-3 text-sm text-good">{note}</p>}
        <ErrorNote text={error} />

        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <a href={`/api/tallyback/groups/${g.id}/export`} className={secondary}>
            Export CSV
          </a>
          <button
            disabled={busy}
            onClick={() => confirm(`Delete “${g.name}” for everyone? This can't be undone here.`) && act(async () => {
              await api(`/groups/${g.id}`, "DELETE");
              onDeleted();
            })}
            className={`${secondary} text-bad`}
          >
            Delete group
          </button>
        </div>
      </div>
    </Sheet>
  );
}
