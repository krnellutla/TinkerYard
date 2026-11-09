import type { Amounts } from "./split";

// Whose turn it is. Pure, so it's easy to test.
//
// Next to pay: whoever owes the group the most, so that paying for the next thing brings balances
// back towards even and friends may never need to send money. Ties go to whoever paid longest ago.
//
// Rounds (at a bar): a fixed order for the night. The next round is on whoever has had the fewest
// turns; a pass counts as a turn, otherwise the person passing would stay "next" all night.

export interface Turn {
  memberId: string;
  passed: boolean;
  amount: number | null; // cents, when someone entered what the round cost
  expenseId: string | null;
  at: string;
}

export interface RoundsTab {
  id: string;
  place: string;
  people: string[]; // member ids, in turn order
  turns: Turn[];
  startedAt: string;
}

export function payOrder(people: string[], net: Amounts, lastPaid: Record<string, string> = {}): string[] {
  return [...people].sort((a, b) => (net[a] ?? 0) - (net[b] ?? 0) || (lastPaid[a] ?? "").localeCompare(lastPaid[b] ?? "") || a.localeCompare(b));
}

// The date each person last paid for something (payments between friends don't count).
export function lastPaidDates(expenses: { kind: string; deleted: boolean; date: string; paid: Amounts }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of expenses) {
    if (e.kind !== "expense" || e.deleted) continue;
    for (const id of Object.keys(e.paid)) if (e.date > (out[id] ?? "")) out[id] = e.date;
  }
  return out;
}

export function nextRound(people: string[], turns: Pick<Turn, "memberId">[]): string | null {
  if (!people.length) return null;
  const count = (id: string) => turns.filter((t) => t.memberId === id).length;
  return people.reduce((best, id) => (count(id) < count(best) ? id : best));
}

// The order after the next one, for "then Sam, then you".
export function comingUp(people: string[], turns: Pick<Turn, "memberId">[], n = 3): string[] {
  const sim = [...turns];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = nextRound(people, sim);
    if (!id) break;
    out.push(id);
    sim.push({ memberId: id });
  }
  return out;
}
