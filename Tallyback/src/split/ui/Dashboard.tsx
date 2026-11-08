"use client";

import { Loading } from "@ui/ProgressRing";
import { useEffect, useState } from "react";
import { CURRENCIES, CURRENCY_NAMES, formatMoney } from "../lib/money";
import { GROUP_KINDS, kindOf, type Activity, type Dashboard as DashboardData, type GroupKind } from "../lib/types";
import type { BillDraft } from "../lib/fromBill";
import { Avatar, ErrorNote, Sheet, Standing, Tabs, api, errorText, field, fieldBase, primary, secondary, when } from "./kit";

// Home screen once signed in: your totals, then your groups, friends and recent activity.
type Tab = "groups" | "friends" | "activity";

export function Dashboard({ onOpen, draft, onCancelDraft }: { onOpen: (id: string) => void; draft?: BillDraft | null; onCancelDraft?: () => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [activity, setActivity] = useState<Activity[] | null>(null);
  const [tab, setTab] = useState<Tab>("groups");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [settling, setSettling] = useState<{ key: string; name: string; currency: string; amount: number; groups: number } | null>(null);
  const reload = () => api<DashboardData>("/groups").then(setData, (e) => setError(errorText(e)));
  useEffect(() => {
    reload();
  }, []);
  useEffect(() => {
    if (tab === "activity" && !activity) api<{ activity: Activity[] }>("/activity").then((j) => setActivity(j.activity), (e) => setError(errorText(e)));
  }, [tab, activity]);

  const totals = Object.entries(data?.totals ?? {}).filter(([, t]) => t.owe || t.owed);

  return (
    <section className="space-y-5">
      {draft && (
        <div className="rounded-2xl border border-ink bg-card p-4 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium">
              Split “{draft.description}”{draft.amount ? ` (${formatMoney(draft.amount, draft.currency ?? "SGD")})` : ""}
            </p>
            {draft.atStakeCents != null && draft.atStakeCents > 0 && (
              <span className="rounded-full bg-bad-soft px-2.5 py-0.5 font-mono text-xs font-medium text-bad">
                −{formatMoney(draft.atStakeCents, draft.currency ?? "SGD")} disputed excluded
              </span>
            )}
          </div>
          <p className="mt-1 text-muted">
            Pick the group to add it to, or start a new one.
            {draft.claimableLines && draft.claimableLines.length > 0
              ? ` ${draft.claimableLines.length} receipt items ready to assign with proportional tax/service charge.`
              : " The expense form opens filled in from the bill."}
          </p>
          <button onClick={onCancelDraft} className="mt-2 text-muted underline underline-offset-4">
            Cancel
          </button>
        </div>
      )}
      <div className="rounded-3xl bg-ink p-5 text-white">
        <p className="text-sm text-white/70">Overall</p>
        {!data ? (
          <p className="mt-1 text-2xl font-semibold">…</p>
        ) : totals.length === 0 ? (
          <p className="mt-1 text-2xl font-semibold">You&apos;re all settled up 🎉</p>
        ) : (
          totals.map(([cur, t]) => (
            <div key={cur} className="mt-2">
              <p className="text-2xl font-semibold">
                {t.owed - t.owe >= 0 ? "You are owed " : "You owe "}
                {formatMoney(Math.abs(t.owed - t.owe), cur)}
              </p>
              <p className="mt-1 text-sm text-white/70">
                you owe {formatMoney(t.owe, cur)} · you are owed {formatMoney(t.owed, cur)}
              </p>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "groups", label: "Groups" },
              { id: "friends", label: "Friends" },
              { id: "activity", label: "Activity" },
            ]}
          />
        </div>
        <button onClick={() => setCreating(true)} className="h-10 shrink-0 rounded-full bg-ink px-4 text-sm font-medium text-white">
          + Group
        </button>
      </div>

      <ErrorNote text={error} />

      {!data && !error && <Loading label="Loading your groups" expectedMs={1500} />}
      {tab === "groups" &&
        (data?.groups.length === 0 ? (
          <Empty text="No groups yet. Start one for a trip, your flat or anything you split." action="Start a group" onAction={() => setCreating(true)} />
        ) : (
          <ul className="space-y-2">
            {data?.groups.map((g) => (
              <li key={g.id}>
                <button onClick={() => onOpen(g.id)} className="flex w-full items-center gap-3 rounded-2xl border border-line bg-card p-3 text-left active:scale-[.99]">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-paper text-xl" aria-hidden="true">
                    {kindOf(g.kind).icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{g.name}</span>
                    <span className="text-xs text-muted">
                      {g.members} member{g.members === 1 ? "" : "s"} · {g.currency}
                    </span>
                  </span>
                  <Standing cents={g.myBalance} currency={g.currency} className="text-right text-sm" />
                </button>
              </li>
            ))}
          </ul>
        ))}

      {tab === "friends" &&
        (data?.friends.length === 0 ? (
          <Empty text="Friends show up here once you share a group with them." />
        ) : (
          <ul className="space-y-2">
            {data?.friends.map((f) => {
              const owing = Object.entries(f.balances).filter(([, c]) => c !== 0);
              return (
                <li key={f.key} className="rounded-2xl border border-line bg-card p-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={f.name} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{f.name}</span>
                      {f.email && <span className="block truncate text-xs text-muted">{f.email}</span>}
                    </span>
                    <span className="text-right text-sm">
                      {owing.length === 0 ? (
                        <span className="text-muted">settled up</span>
                      ) : (
                        owing.map(([cur, c]) => (
                          <span key={cur} className={`block ${c > 0 ? "text-good" : "text-bad"}`}>
                            {c > 0 ? "owes you " : "you owe "}
                            <b>{formatMoney(Math.abs(c), cur)}</b>
                          </span>
                        ))
                      )}
                    </span>
                  </div>
                  {owing.map(([cur, c]) => (
                    <button
                      key={cur}
                      onClick={() =>
                        setSettling({ key: f.key, name: f.name, currency: cur, amount: c, groups: new Set(f.groups.filter((x) => x.currency === cur && x.amount).map((x) => x.groupId)).size })
                      }
                      className="mt-2 min-h-11 w-full rounded-xl border border-line text-sm font-medium active:scale-[.99]"
                    >
                      Settle up{owing.length > 1 ? ` in ${cur}` : ""}
                    </button>
                  ))}
                  {f.groups.length > 0 && (
                    <ul className="mt-2 space-y-1 border-t border-line pt-2 text-xs text-muted">
                      {f.groups.map((g) => (
                        <li key={g.groupId}>
                          <button onClick={() => onOpen(g.groupId)} className="flex w-full justify-between hover:text-ink">
                            <span>{g.groupName}</span>
                            <span className={g.amount > 0 ? "text-good" : "text-bad"}>
                              {g.amount > 0 ? "owes you " : "you owe "}
                              {formatMoney(Math.abs(g.amount), g.currency)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        ))}

      {tab === "activity" && (activity?.length === 0 ? <Empty text="Nothing has happened yet." /> : <ActivityList items={activity} onOpen={onOpen} showGroup />)}

      {tab === "groups" && (data?.deleted.length ?? 0) > 0 && (
        <div className="rounded-2xl border border-dashed border-line p-3 text-sm">
          <p className="font-medium">Recently deleted</p>
          <ul className="mt-1 space-y-1">
            {data!.deleted.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-muted">{g.name}</span>
                <button
                  onClick={() => api(`/groups/${g.id}/restore`, "POST").then(reload, (e) => setError(errorText(e)))}
                  className="min-h-11 shrink-0 px-2 font-medium underline underline-offset-4"
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {creating && <NewGroup onClose={() => setCreating(false)} onCreated={onOpen} />}
      {settling && <SettleFriend s={settling} onClose={() => setSettling(null)} onDone={() => { setSettling(null); reload(); }} />}
    </section>
  );
}

export function ActivityList({ items, onOpen, showGroup }: { items: Activity[] | null; onOpen?: (groupId: string) => void; showGroup?: boolean }) {
  if (!items) return <Loading label="Loading activity" expectedMs={1200} />;
  return (
    <ul className="space-y-2">
      {items.map((a) => (
        <li key={a.id}>
          <button onClick={() => onOpen?.(a.groupId)} disabled={!onOpen} className="flex w-full gap-3 rounded-2xl border border-line bg-card p-3 text-left text-sm">
            <Avatar name={a.actor} size={30} />
            <span>
              <span className="block">
                <b className="font-medium">{a.mine ? "You" : a.actor}</b> {a.text}
                {showGroup && <span className="text-muted"> in {a.groupName}</span>}
              </span>
              <span className="text-xs text-muted">{when(a.createdAt)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Empty({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">
      <p>{text}</p>
      {action && (
        <button onClick={onAction} className={`${secondary} mt-3`}>
          {action}
        </button>
      )}
    </div>
  );
}

function NewGroup({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<GroupKind>("trip");
  const [currency, setCurrency] = useState<string>("SGD");
  const [myName, setMyName] = useState("");
  const [people, setPeople] = useState([{ name: "", email: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const members = people.filter((p) => p.name.trim() || p.email.trim()).map((p) => ({ name: p.name.trim() || p.email.split("@")[0], email: p.email.trim() }));
      const j = await api<{ id: string }>("/groups", "POST", { name, kind, currency, myName: myName.trim() || undefined, members });
      onCreated(j.id);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  const set = (i: number, k: "name" | "email", v: string) => setPeople((p) => p.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  return (
    <Sheet title="New group" onClose={onClose}>
      <form onSubmit={create} className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Group name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Bali trip, Flat 12B…" className={field} />
        </label>
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
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Currency</span>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={field}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c} · {CURRENCY_NAMES[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Your name</span>
            <input value={myName} onChange={(e) => setMyName(e.target.value)} placeholder="From your email" className={field} />
          </label>
        </div>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">Who else is in it?</legend>
          {people.map((p, i) => (
            <div key={i} className="flex gap-2">
              <input value={p.name} onChange={(e) => set(i, "name", e.target.value)} placeholder="Name" className={`${fieldBase} w-2/5`} />
              <input value={p.email} onChange={(e) => set(i, "email", e.target.value)} type="email" placeholder="Email (to share the group)" className={`${fieldBase} min-w-0 flex-1`} />
              {people.length > 1 && (
                <button type="button" onClick={() => setPeople((x) => x.filter((_, j) => j !== i))} aria-label="Remove" className="px-1 text-muted">
                  ×
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={() => setPeople((p) => [...p, { name: "", email: "" }])} className="text-sm text-muted underline underline-offset-4">
            + Add another person
          </button>
          <p className="text-xs text-muted">People with an email see this group when they sign in with that address. Leave it blank to track someone who won&apos;t sign in.</p>
        </fieldset>
        <ErrorNote text={error} />
        <button type="submit" disabled={busy || !name.trim()} className={primary}>
          {busy ? "Creating…" : "Create group"}
        </button>
      </form>
    </Sheet>
  );
}

// Settle up with one friend everywhere at once: one payment per group, each for exactly what's owed there.
function SettleFriend({
  s,
  onClose,
  onDone,
}: {
  s: { key: string; name: string; currency: string; amount: number; groups: number };
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const theyOwe = s.amount > 0;
  return (
    <Sheet title={`Settle up with ${s.name}`} onClose={onClose}>
      <div className="space-y-4 text-center">
        <div className="flex justify-center">
          <Avatar name={s.name} size={64} />
        </div>
        <p className="text-lg">{theyOwe ? `${s.name} pays you` : `You pay ${s.name}`}</p>
        <p className="text-4xl font-semibold tabular-nums">{formatMoney(Math.abs(s.amount), s.currency)}</p>
        <p className="text-sm text-muted">
          {s.groups > 1 ? `This records a payment in each of the ${s.groups} groups you share, so every one of them is settled.` : "This records the payment in the group you share."}{" "}
          Send the money however you normally do.
        </p>
        <ErrorNote text={error} />
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api("/friends/settle", "POST", { key: s.key, currency: s.currency });
              onDone();
            } catch (e) {
              setError(errorText(e));
              setBusy(false);
            }
          }}
          className={primary}
        >
          {busy ? "Recording…" : `Record ${formatMoney(Math.abs(s.amount), s.currency)} payment`}
        </button>
      </div>
    </Sheet>
  );
}
