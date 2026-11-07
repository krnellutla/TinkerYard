"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { myShare } from "../lib/balances";
import { CURRENCIES, formatMoney } from "../lib/money";
import { GROUP_KINDS, categoryOf, kindOf, type Expense, type GroupDetail, type GroupKind } from "../lib/types";
import { ActivityList } from "./Dashboard";
import { ExpenseForm, PaymentForm } from "./EntryForms";
import { Avatar, ErrorNote, Sheet, Standing, Tabs, api, errorText, field, fieldBase, primary, secondary, shortDate, when } from "./kit";

// One group: its expenses, who owes whom, spending totals and what happened, plus its settings.
type Tab = "expenses" | "balances" | "totals" | "activity";
type Open =
  | { kind: "add" }
  | { kind: "edit"; expense: Expense }
  | { kind: "pay"; preset?: { from: string; to: string; amount: number } }
  | { kind: "detail"; id: string }
  | { kind: "settings" }
  | null;

export function GroupView({ id, onBack }: { id: string; onBack: () => void }) {
  const [g, setG] = useState<GroupDetail | null>(null);
  const [tab, setTab] = useState<Tab>("expenses");
  const [open, setOpen] = useState<Open>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => api<GroupDetail>(`/groups/${id}`).then(setG, (e) => setError(errorText(e))), [id]);
  useEffect(() => {
    reload();
  }, [reload]);
  const saved = () => {
    setOpen(null);
    reload();
  };

  if (!g)
    return (
      <section className="space-y-4">
        <button onClick={onBack} className="text-sm text-muted">
          ← All groups
        </button>
        {error ? <ErrorNote text={error} /> : <p className="text-muted">Loading…</p>}
      </section>
    );

  const nameOf = (mid: string) => (mid === g.meId ? "You" : (g.members.find((m) => m.id === mid)?.name ?? "Someone"));
  const mine = g.balances[g.meId] ?? 0;
  const deleted = g.expenses.filter((e) => e.deleted).length;
  const shown = g.expenses.filter((e) => showDeleted || !e.deleted);
  const detail = open?.kind === "detail" ? g.expenses.find((e) => e.id === open.id) : undefined;

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-muted hover:text-ink">
          ← All groups
        </button>
        <button onClick={() => setOpen({ kind: "settings" })} className={secondary}>
          Settings
        </button>
      </div>

      <div className="flex items-center gap-3">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-line bg-card text-2xl" aria-hidden="true">
          {kindOf(g.kind).icon}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{g.name}</h1>
          <p className="text-sm">
            <Standing cents={mine} currency={g.currency} /> <span className="text-muted">· {g.members.filter((m) => !m.removed).length} people</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => setOpen({ kind: "add" })} className="h-12 rounded-2xl bg-ink font-medium text-white active:scale-[.99]">
          + Add expense
        </button>
        <button onClick={() => setOpen({ kind: "pay" })} className="h-12 rounded-2xl border border-line bg-card font-medium active:scale-[.99]">
          Settle up
        </button>
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
        <div className="space-y-2">
          {shown.length === 0 && <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">No expenses yet. Add the first one.</p>}
          {months(shown).map(([month, items]) => (
            <div key={month} className="space-y-2">
              <p className="pt-2 text-xs font-medium uppercase tracking-wide text-muted">{month}</p>
              {items.map((e) => (
                <ExpenseRow key={e.id} e={e} g={g} nameOf={nameOf} onClick={() => setOpen({ kind: "detail", id: e.id })} />
              ))}
            </div>
          ))}
          {deleted > 0 && (
            <button onClick={() => setShowDeleted((s) => !s)} className="block w-full pt-2 text-center text-sm text-muted underline underline-offset-4">
              {showDeleted ? "Hide" : "Show"} {deleted} deleted
            </button>
          )}
        </div>
      )}

      {tab === "balances" && <Balances g={g} nameOf={nameOf} onPay={(preset) => setOpen({ kind: "pay", preset })} onChanged={reload} />}
      {tab === "totals" && <Totals g={g} />}
      {tab === "activity" && <ActivityList items={g.activity} />}

      {open?.kind === "add" && <ExpenseForm group={g} onClose={() => setOpen(null)} onSaved={saved} />}
      {open?.kind === "edit" &&
        (open.expense.kind === "payment" ? (
          <PaymentForm group={g} payment={open.expense} onClose={() => setOpen(null)} onSaved={saved} />
        ) : (
          <ExpenseForm group={g} expense={open.expense} onClose={() => setOpen(null)} onSaved={saved} />
        ))}
      {open?.kind === "pay" && <PaymentForm group={g} preset={open.preset} onClose={() => setOpen(null)} onSaved={saved} />}
      {detail && <ExpenseDetail g={g} e={detail} nameOf={nameOf} onClose={() => setOpen(null)} onEdit={() => setOpen({ kind: "edit", expense: detail })} onChanged={reload} />}
      {open?.kind === "settings" && <Settings g={g} onClose={() => setOpen(null)} onChanged={reload} onDeleted={onBack} />}
    </section>
  );
}

function months(items: Expense[]): [string, Expense[]][] {
  const out = new Map<string, Expense[]>();
  for (const e of items) {
    const m = new Date(`${e.date}T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    out.set(m, [...(out.get(m) ?? []), e]);
  }
  return [...out];
}

function ExpenseRow({ e, g, nameOf, onClick }: { e: Expense; g: GroupDetail; nameOf: (id: string) => string; onClick: () => void }) {
  const share = myShare(e, g.meId);
  const payers = Object.keys(e.paid);
  const isPayment = e.kind === "payment";
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-3 rounded-2xl border border-line bg-card p-3 text-left active:scale-[.99] ${e.deleted ? "opacity-50" : ""}`}>
      <span className="w-8 shrink-0 whitespace-pre-line text-center text-xs leading-tight text-muted">{shortDate(e.date).replace(" ", "\n")}</span>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-paper text-lg" aria-hidden="true">
        {isPayment ? "💸" : categoryOf(e.category).icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate font-medium ${e.deleted ? "line-through" : ""}`}>{isPayment ? `${nameOf(payers[0])} paid ${nameOf(Object.keys(e.owed)[0])}` : e.description}</span>
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
  const people = g.members.filter((m) => !m.removed).sort((a, b) => (g.balances[b.id] ?? 0) - (g.balances[a.id] ?? 0));
  async function toggle() {
    setBusy(true);
    await api(`/groups/${g.id}`, "PATCH", { simplify: !g.simplify }).catch(() => {});
    await onChanged();
    setBusy(false);
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
                <span className="rounded-2xl bg-card px-3 py-2">
                  <b className="font-medium">{c.author}</b> <span className="text-xs text-muted">{when(c.createdAt)}</span>
                  <span className="block whitespace-pre-wrap">{c.body}</span>
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
                    className="text-xs text-muted underline"
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
                    className="text-xs text-bad underline"
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
          <a href={`/api/fairshare/groups/${g.id}/export`} className={secondary}>
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
