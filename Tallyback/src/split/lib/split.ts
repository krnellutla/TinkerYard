// How an expense is shared: who paid and who owes what, in cents. Pure, so it's easy to test.
// The four ways to split, as in any bill-splitting app:
//   equal   — the same for everyone ticked
//   exact   — type each person's amount; they must add up to the total
//   percent — type each person's percentage; they must add up to 100
//   shares  — type weights (e.g. 2 nights vs 3 nights); split in proportion

export type SplitMethod = "equal" | "exact" | "percent" | "shares";
export const SPLIT_METHODS: { id: SplitMethod; label: string }[] = [
  { id: "equal", label: "Equally" },
  { id: "exact", label: "Exact amounts" },
  { id: "percent", label: "Percentages" },
  { id: "shares", label: "Shares" },
];

export type Amounts = Record<string, number>; // member id → cents

// What the person typed, kept so the expense can be edited the same way later.
// values: exact → cents, percent → percent, shares → weight. Unused for equal.
export interface Split {
  method: SplitMethod;
  members: string[];
  values?: Record<string, number>;
}

export type Result = { ok: true; owed: Amounts } | { ok: false; error: string };

// Share `total` cents in proportion to `weights`, exactly: the leftover cents go to the largest
// remainders (earliest first on a tie), so the parts always add up to the total.
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    parts[i]++;
    left--;
  }
  return parts;
}

const sumOf = (a: Amounts) => Object.values(a).reduce((x, y) => x + y, 0);

export function splitAmount(total: number, split: Split): Result {
  const ids = [...new Set(split.members)];
  if (!Number.isSafeInteger(total) || total <= 0) return { ok: false, error: "Enter an amount above zero." };
  if (!ids.length) return { ok: false, error: "Choose at least one person to split with." };
  const v = (id: string) => Number(split.values?.[id] ?? 0);
  const zip = (parts: number[]): Amounts => Object.fromEntries(ids.map((id, i) => [id, parts[i]]).filter(([, c]) => (c as number) > 0));

  switch (split.method) {
    case "equal":
      return { ok: true, owed: zip(allocate(total, ids.map(() => 1))) };
    case "exact": {
      if (ids.some((id) => !Number.isInteger(v(id)) || v(id) < 0)) return { ok: false, error: "Check each amount: whole cents, not negative." };
      const owed = zip(ids.map(v));
      const diff = total - sumOf(owed);
      if (diff !== 0) return { ok: false, error: diff > 0 ? `${(diff / 100).toFixed(2)} still to assign.` : `${(-diff / 100).toFixed(2)} more than the total.` };
      return { ok: true, owed };
    }
    case "percent": {
      if (ids.some((id) => v(id) < 0)) return { ok: false, error: "Percentages can't be negative." };
      const pct = ids.reduce((a, id) => a + v(id), 0);
      if (Math.abs(pct - 100) > 0.001) return { ok: false, error: `Percentages add up to ${+pct.toFixed(2)}%, not 100%.` };
      return { ok: true, owed: zip(allocate(total, ids.map(v))) };
    }
    case "shares": {
      if (ids.some((id) => v(id) < 0)) return { ok: false, error: "Shares can't be negative." };
      if (ids.every((id) => v(id) === 0)) return { ok: false, error: "Give at least one person a share." };
      return { ok: true, owed: zip(allocate(total, ids.map(v))) };
    }
    default:
      return { ok: false, error: "Unknown way to split." };
  }
}

// Who paid: one person the whole amount, or several people amounts that add up to the total.
export function checkPaid(total: number, paid: Amounts): string | null {
  const entries = Object.entries(paid).filter(([, c]) => c !== 0);
  if (!entries.length) return "Choose who paid.";
  if (entries.some(([, c]) => !Number.isInteger(c) || c < 0)) return "Check each paid amount: whole cents, not negative.";
  const diff = total - sumOf(paid);
  if (diff !== 0) return diff > 0 ? `Payers cover ${(diff / 100).toFixed(2)} less than the total.` : `Payers cover ${(-diff / 100).toFixed(2)} more than the total.`;
  return null;
}
