"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney, toCents } from "../lib/money";
import { comingUp, nextRound } from "../lib/turns";
import type { GroupDetail } from "../lib/types";
import { Avatar, ErrorNote, Sheet, api, errorText, field, primary, secondary, today } from "./kit";

// Rounds at a bar: whose round it is now, on everyone's phone. The card is pinned to the group and
// refreshes itself, and buzzes your phone when it becomes your round.

type NameOf = (id: string) => string;

export function roundsNudge(g: GroupDetail, nameOf: (id: string) => string) {
  const tab = g.tab!;
  const next = nextRound(tab.people, tab.turns);
  const number = tab.turns.filter((t) => !t.passed).length + 1;
  const after = comingUp(tab.people, tab.turns, 3).slice(1).map(nameOf);
  return `🍻 Round ${number}${tab.place ? ` at ${tab.place}` : ""} is on ${next ? nameOf(next) : "someone"}!${after.length ? ` Then ${after.join(", then ")}.` : ""}`;
}

export function RoundsCard({ g, nameOf, onChanged }: { g: GroupDetail; nameOf: NameOf; onChanged: () => Promise<unknown> | void }) {
  const tab = g.tab!;
  const next = nextRound(tab.people, tab.turns)!;
  const number = tab.turns.length + 1;
  const paidRound = tab.turns.filter((t) => !t.passed).length + 1;
  const mine = next === g.meId;
  const [recording, setRecording] = useState<string | null>(null); // who got this round
  const [choosing, setChoosing] = useState(false);
  const [amountText, setAmountText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `/groups/${g.id}/rounds`;

  // It just became your round: buzz (where the phone allows it).
  const wasMine = useRef(mine);
  useEffect(() => {
    if (mine && !wasMine.current) navigator.vibrate?.([200, 100, 200]);
    wasMine.current = mine;
  }, [mine]);

  async function act(body: object) {
    setBusy(true);
    setError(null);
    try {
      await api(url, "PATCH", body);
      setRecording(null);
      setChoosing(false);
      setAmountText("");
      await onChanged();
    } catch (e) {
      setError(errorText(e));
      await onChanged();
    } finally {
      setBusy(false);
    }
  }
  const turn = (memberId: string, passed = false) => act({ action: "turn", round: number, memberId, passed, amount: passed ? null : toCents(amountText), date: today() });
  const coming = comingUp(tab.people, tab.turns, 4).slice(1);
  const nudge = () => window.open(`https://wa.me/?text=${encodeURIComponent(roundsNudge(g, nameOf))}`, "_blank");

  return (
    <div className={`rounded-3xl border-2 p-4 ${mine ? "border-ink bg-warn-soft" : "border-line bg-card"}`} aria-live="polite">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-muted">
          🍻 Round {paidRound}
          {tab.place ? ` · ${tab.place}` : ""}
        </p>
        <button onClick={nudge} className="min-h-11 text-sm font-medium underline underline-offset-4">
          Remind on WhatsApp
        </button>
      </div>
      <div className="mt-1 flex items-center gap-3">
        <Avatar name={g.members.find((m) => m.id === next)?.name ?? "?"} size={48} />
        <p className="min-w-0 text-2xl font-semibold leading-tight">{mine ? "It's your round!" : `${nameOf(next)}'s round`}</p>
      </div>
      {coming.length > 0 && <p className="mt-1 text-sm text-muted">Then {coming.map(nameOf).join(", then ")}</p>}

      {recording ? (
        <div className="mt-3 space-y-2">
          <label className="flex items-center gap-2 rounded-xl border border-line bg-paper px-3 focus-within:border-ink">
            <span className="text-sm text-muted">{g.currency}</span>
            <input autoFocus inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="Cost (optional)" aria-label="What the round cost, optional" className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none" />
          </label>
          <p className="text-xs text-muted">Add the cost and it goes into the group, split across the table. Leave it blank if you&apos;re just taking turns.</p>
          <button disabled={busy || (!!amountText.trim() && !toCents(amountText))} onClick={() => turn(recording)} className={primary}>
            {busy ? "Saving…" : `${nameOf(recording)} got round ${paidRound}`}
          </button>
          <button onClick={() => setRecording(null)} className="block w-full py-2 text-sm text-muted underline underline-offset-4">
            Back
          </button>
        </div>
      ) : choosing ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {tab.people.map((id) => (
            <button key={id} onClick={() => setRecording(id)} className={secondary}>
              {nameOf(id)}
            </button>
          ))}
          <button onClick={() => setChoosing(false)} className="min-h-11 px-2 text-sm text-muted underline underline-offset-4">
            Back
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <button disabled={busy} onClick={() => setRecording(next)} className={primary}>
            {mine ? "I got this round" : `${nameOf(next)} got this round`}
          </button>
          <div className="flex gap-2">
            <button onClick={() => setChoosing(true)} className={`${secondary} flex-1`}>
              Someone else
            </button>
            <button disabled={busy} onClick={() => turn(next, true)} className={`${secondary} flex-1`}>
              {mine ? "Pass" : `${nameOf(next)} passes`}
            </button>
          </div>
        </div>
      )}
      <ErrorNote text={error} />

      {tab.turns.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-line pt-2 text-sm">
          {[...tab.turns].reverse().map((t, i) => (
            <li key={t.at} className="flex items-center justify-between gap-2">
              <span className={t.passed ? "text-muted" : ""}>
                {nameOf(t.memberId)} {t.passed ? "passed" : "bought a round"}
              </span>
              <span className="flex items-center gap-2 text-xs text-muted">
                {t.amount != null && <span className="tabular-nums">{formatMoney(t.amount, g.currency)}</span>}
                {i === 0 && (
                  <button disabled={busy} onClick={() => act({ action: "undo" })} className="min-h-9 underline underline-offset-4">
                    Undo
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <button disabled={busy} onClick={() => confirm("End the rounds for tonight?") && act({ action: "end" })} className="mt-2 min-h-11 w-full text-sm text-muted underline underline-offset-4">
        End the night
      </button>
    </div>
  );
}

export function StartRounds({ g, onClose, onStarted }: { g: GroupDetail; onClose: () => void; onStarted: () => void }) {
  const active = g.members.filter((m) => !m.removed);
  const [place, setPlace] = useState("");
  const [people, setPeople] = useState<Set<string>>(new Set(active.map((m) => m.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (id: string) =>
    setPeople((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <Sheet title="Start rounds" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api(`/groups/${g.id}/rounds`, "POST", { place, people: [...people] });
            onStarted();
          } catch (err) {
            setError(errorText(err));
            setBusy(false);
          }
        }}
      >
        <p className="text-sm text-muted">Everyone in the group sees whose round it is. Whoever owes the group the most goes first.</p>
        <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Where? (optional)" aria-label="Where" className={`${field} text-base`} />
        <div>
          <p className="mb-2 text-sm font-medium">Who&apos;s at the table?</p>
          <div className="flex flex-wrap gap-2">
            {active.map((m) => (
              <button
                type="button"
                key={m.id}
                aria-pressed={people.has(m.id)}
                onClick={() => toggle(m.id)}
                className={`min-h-11 rounded-full border px-4 text-sm font-medium ${people.has(m.id) ? "border-ink bg-ink text-white" : "border-line bg-card text-muted"}`}
              >
                {m.id === g.meId ? "You" : m.name}
              </button>
            ))}
          </div>
        </div>
        <ErrorNote text={error} />
        <button type="submit" disabled={busy || people.size < 2} className={primary}>
          {busy ? "Starting…" : people.size < 2 ? "Pick at least two people" : "Start rounds"}
        </button>
      </form>
    </Sheet>
  );
}

