import type { Amounts } from "./split";

// Trip mode: where and when, the currency you'll mostly spend in, and the wrap-up at the end. Pure.

export interface Trip {
  destination: string;
  start: string; // YYYY-MM-DD
  end: string;
  currency: string; // what new expenses default to during the trip
}

const dayNumber = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5;
export const tripLength = (t: Trip) => dayNumber(t.end) - dayNumber(t.start) + 1;

export type TripPhase = { phase: "before"; inDays: number } | { phase: "during"; day: number; of: number } | { phase: "over" };
export function tripPhase(t: Trip, today: string): TripPhase {
  if (today < t.start) return { phase: "before", inDays: dayNumber(t.start) - dayNumber(today) };
  if (today > t.end) return { phase: "over" };
  return { phase: "during", day: dayNumber(today) - dayNumber(t.start) + 1, of: tripLength(t) };
}

interface E {
  kind: string;
  deleted: boolean;
  date: string;
  amount: number;
  category: string;
  paid: Amounts;
  owed: Amounts;
}

export interface TripSummary {
  total: number;
  count: number;
  perDay: number;
  topCategory: { id: string; amount: number } | null;
  biggest: E | null;
  coveredMost: { id: string; amount: number } | null;
  paid: Amounts; // what each person put down
  share: Amounts; // what each person's part came to
}

export function tripSummary(t: Trip, expenses: E[]): TripSummary {
  const inTrip = expenses.filter((e) => e.kind === "expense" && !e.deleted && e.date >= t.start && e.date <= t.end);
  const paid: Amounts = {};
  const share: Amounts = {};
  const cats: Record<string, number> = {};
  let total = 0;
  let biggest: E | null = null;
  for (const e of inTrip) {
    total += e.amount;
    cats[e.category] = (cats[e.category] ?? 0) + e.amount;
    if (!biggest || e.amount > biggest.amount) biggest = e;
    for (const [m, c] of Object.entries(e.paid)) paid[m] = (paid[m] ?? 0) + c;
    for (const [m, c] of Object.entries(e.owed)) share[m] = (share[m] ?? 0) + c;
  }
  const top = <T extends string>(o: Record<T, number>) => (Object.entries(o) as [T, number][]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const cat = top(cats);
  const most = top(paid);
  return {
    total,
    count: inTrip.length,
    perDay: Math.round(total / Math.max(1, tripLength(t))),
    topCategory: cat ? { id: cat[0], amount: cat[1] } : null,
    biggest,
    coveredMost: most ? { id: most[0], amount: most[1] } : null,
    paid,
    share,
  };
}
