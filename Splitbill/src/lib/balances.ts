import type { Amounts } from "./split";

// Who owes whom. Pure, so it's easy to test.
// An expense or a payment is the same thing here: some people paid, some people owe.
// A payment from A to B is { paid: {A: x}, owed: {B: x} }: it moves A up and B down by x.

export interface Entry {
  paid: Amounts;
  owed: Amounts;
}

export interface Transfer {
  from: string; // owes
  to: string; // is owed
  amount: number; // cents, always > 0
}

// Each member's balance: positive = is owed money, negative = owes money. Always sums to zero.
export function netBalances(entries: Entry[], members: string[] = []): Amounts {
  const net: Amounts = Object.fromEntries(members.map((m) => [m, 0]));
  for (const e of entries) {
    for (const [m, c] of Object.entries(e.paid)) net[m] = (net[m] ?? 0) + c;
    for (const [m, c] of Object.entries(e.owed)) net[m] = (net[m] ?? 0) - c;
  }
  return net;
}

// Pay the largest debt to the largest creditor until everyone is even. Gives at most n−1 transfers
// and never asks anyone to pay someone they don't owe overall. Ties are broken by id so the
// answer doesn't change between page loads.
function settle(net: Amounts): Transfer[] {
  const pick = (sign: 1 | -1) =>
    Object.entries(net)
      .filter(([, c]) => c * sign > 0)
      .map(([id, c]) => ({ id, left: Math.abs(c) }))
      .sort((a, b) => b.left - a.left || a.id.localeCompare(b.id));
  const owed = pick(1);
  const owes = pick(-1);
  const out: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < owes.length && j < owed.length) {
    const amount = Math.min(owes[i].left, owed[j].left);
    out.push({ from: owes[i].id, to: owed[j].id, amount });
    owes[i].left -= amount;
    owed[j].left -= amount;
    if (owes[i].left === 0) i++;
    if (owed[j].left === 0) j++;
  }
  return out;
}

// "Simplify debts" on: the fewest payments that settle the whole group.
export const simplifiedDebts = (entries: Entry[]): Transfer[] => settle(netBalances(entries));

// "Simplify debts" off: who owes whom from the expenses they actually shared. Each expense is settled
// on its own, then debts between the same two people cancel out.
export function pairwiseDebts(entries: Entry[]): Transfer[] {
  const pair = new Map<string, number>(); // "a\u0000b" with a < b → what a owes b (negative: b owes a)
  for (const e of entries) {
    for (const t of settle(netBalances([e]))) {
      const [a, b, sign] = t.from < t.to ? [t.from, t.to, 1] : [t.to, t.from, -1];
      const key = `${a}\u0000${b}`;
      pair.set(key, (pair.get(key) ?? 0) + sign * t.amount);
    }
  }
  const out: Transfer[] = [];
  for (const [key, c] of pair) {
    const [a, b] = key.split("\u0000");
    if (c > 0) out.push({ from: a, to: b, amount: c });
    else if (c < 0) out.push({ from: b, to: a, amount: -c });
  }
  return out.sort((x, y) => y.amount - x.amount || x.from.localeCompare(y.from) || x.to.localeCompare(y.to));
}

export const debts = (entries: Entry[], simplify: boolean) => (simplify ? simplifiedDebts(entries) : pairwiseDebts(entries));

// One person's side of an expense: what they lent (+) or borrowed (−).
export const myShare = (e: Entry, member: string) => (e.paid[member] ?? 0) - (e.owed[member] ?? 0);
