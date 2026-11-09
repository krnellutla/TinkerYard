import { CATEGORIES } from "./types";
import { formatMoney } from "./money";
import type { Amounts } from "./split";

// What an edit changed, in words for the activity feed: anyone in a group can edit an expense, so
// everyone should see exactly what moved. Pure, so it's easy to test.

export interface Snapshot {
  description: string;
  amount: number;
  category: string;
  date: string;
  notes: string;
  paid: Amounts;
  owed: Amounts;
}

const same = (a: Amounts, b: Amounts) => [...new Set([...Object.keys(a), ...Object.keys(b)])].every((k) => (a[k] ?? 0) === (b[k] ?? 0));
const catLabel = (id: string) => CATEGORIES.find((c) => c.id === id)?.label ?? id;

export function describeChanges(before: Snapshot, after: Snapshot, nameOf: (id: string) => string, currency: string): string[] {
  const out: string[] = [];
  const money = (c: number) => formatMoney(c, currency);
  if (before.description !== after.description) out.push(`renamed to “${after.description}”`);
  if (before.amount !== after.amount) out.push(`${money(before.amount)} → ${money(after.amount)}`);
  if (before.date !== after.date) out.push(`date ${before.date} → ${after.date}`);
  if (before.category !== after.category) out.push(`category ${catLabel(before.category)} → ${catLabel(after.category)}`);
  if (!same(before.paid, after.paid)) {
    const b = Object.keys(before.paid);
    const a = Object.keys(after.paid);
    out.push(b.length === 1 && a.length === 1 && b[0] !== a[0] ? `paid by ${nameOf(b[0])} → ${nameOf(a[0])}` : "who paid changed");
  }
  if (!same(before.owed, after.owed)) {
    const added = Object.keys(after.owed).filter((k) => !before.owed[k]);
    const removed = Object.keys(before.owed).filter((k) => !after.owed[k]);
    const moved = Object.keys(after.owed).filter((k) => before.owed[k] && before.owed[k] !== after.owed[k]);
    if (added.length) out.push(`added ${added.map(nameOf).join(", ")}`);
    if (removed.length) out.push(`took off ${removed.map(nameOf).join(", ")}`);
    if (moved.length > 3) out.push("everyone's share changed");
    else for (const k of moved) out.push(`${nameOf(k)}'s share ${money(before.owed[k])} → ${money(after.owed[k])}`);
  }
  if (before.notes !== after.notes) out.push("edited the notes");
  return out;
}
