// How an expense is shared: who paid and who owes what, in cents. Pure, so it's easy to test.
// The four ways to split, as in any bill-splitting app:
//   equal   — the same for everyone ticked
//   exact   — type each person's amount; they must add up to the total
//   percent — type each person's percentage; they must add up to 100
//   shares  — type weights (e.g. 2 nights vs 3 nights); split in proportion

export type SplitMethod = "equal" | "exact" | "percent" | "shares" | "itemized";
export const SPLIT_METHODS: { id: Exclude<SplitMethod, "itemized">; label: string }[] = [
  { id: "equal", label: "Equally" },
  { id: "exact", label: "Exact amounts" },
  { id: "percent", label: "Percentages" },
  { id: "shares", label: "Shares" },
];

export type Amounts = Record<string, number>; // member id → cents

export interface SavedReceiptItem {
  lineIndex: number;
  description: string;
  qty?: number | null;
  printedCents: number;
  verifiedCents: number;
  flagged?: boolean;
  flagTitle?: string;
  isDrink?: boolean;
  members: string[];
}

export interface SavedItemizedSplit {
  useVerifiedTotal: boolean;
  nonDrinkers: string[];
  items: SavedReceiptItem[];
}

// What the person typed, kept so the expense can be edited the same way later.
// values: exact → cents, percent → percent, shares → weight. Unused for equal.
export interface Split {
  method: SplitMethod;
  members: string[];
  values?: Record<string, number>;
  itemized?: SavedItemizedSplit;
}

export type Result = { ok: true; owed: Amounts } | { ok: false; error: string };

/**
 * Allocates `total` integer cents proportionally across `weights` using the Largest Remainder Method
 * so the returned parts always sum to `total` with zero lost cents.
 * @param total Total integer cents to distribute.
 * @param weights Relative non-negative weights per participant.
 * @returns Integer-cent shares aligned with `weights`.
 */
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

/**
 * Splits `total` integer cents across `split.members` using the configured split method (`equal`, `exact`, `percent`, `shares`, or `itemized`).
 * @param total Total expense amount in integer cents.
 * @param split Split specification including member IDs and per-member values.
 * @returns Either `{ ok: true, owed }` summing to `total`, or `{ ok: false, error }`.
 */
export function splitAmount(total: number, split: Split): Result {
  const ids = [...new Set(split.members)];
  if (!Number.isSafeInteger(total) || total <= 0) return { ok: false, error: "Enter an amount above zero." };
  if (!ids.length) return { ok: false, error: "Choose at least one person to split with." };
  const v = (id: string) => Number(split.values?.[id] ?? 0);
  const zip = (parts: number[]): Amounts => Object.fromEntries(ids.map((id, i) => [id, parts[i]]).filter(([, c]) => (c as number) > 0));

  switch (split.method) {
    case "equal":
      return { ok: true, owed: zip(allocate(total, ids.map(() => 1))) };
    case "exact":
    case "itemized": {
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

export interface ReceiptItemAllocationInput {
  amountCents: number;
  members: string[]; // member IDs who shared this line item
}

export interface ItemizedResult {
  ok: true;
  owed: Amounts; // final total owed per member (items + proportional extras)
  itemSubtotals: Amounts; // pre-tax/service item subtotal per member
  extrasAllocated: Amounts; // proportional tax/service/discount/rounding per member
  itemsSumCents: number;
  extrasCents: number; // totalCents - itemsSumCents
}

/**
 * Distributes an itemized receipt across claimants while allocating tax, service charges,
 * discounts, and rounding (`total - sum(items)`) proportionally to each member's item subtotal.
 * @param total Receipt total in integer cents.
 * @param items Line items with cent amounts and claiming member IDs.
 * @param allMembers Candidate member IDs in the group.
 * @returns Breakdown with per-member `owed`, `itemSubtotals`, and `extrasAllocated`, or a validation error.
 */
export function allocateItemized(
  total: number,
  items: ReceiptItemAllocationInput[],
  allMembers: string[],
): ItemizedResult | { ok: false; error: string } {
  const ids = [...new Set(allMembers)];
  if (!Number.isSafeInteger(total) || total <= 0) return { ok: false, error: "Enter an amount above zero." };
  if (!ids.length) return { ok: false, error: "Choose at least one person to split with." };
  if (!items.length) return { ok: false, error: "Add at least one item to assign." };

  const itemSubtotals: Amounts = Object.fromEntries(ids.map((id) => [id, 0]));
  let itemsSumCents = 0;

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    if (!Number.isInteger(item.amountCents) || item.amountCents < 0) {
      return { ok: false, error: `Item #${idx + 1} has an invalid amount.` };
    }
    if (item.amountCents === 0) continue;
    const claimants = [...new Set(item.members)].filter((id) => ids.includes(id));
    if (!claimants.length) {
      return { ok: false, error: "Assign every item to at least one person." };
    }
    const shares = allocate(item.amountCents, claimants.map(() => 1));
    claimants.forEach((id, i) => {
      itemSubtotals[id] = (itemSubtotals[id] ?? 0) + shares[i];
    });
    itemsSumCents += item.amountCents;
  }

  if (itemsSumCents <= 0) {
    return { ok: false, error: "Assigned items must add up to more than zero." };
  }

  const extrasCents = total - itemsSumCents;
  const activeIds = ids.filter((id) => (itemSubtotals[id] ?? 0) > 0);
  const weights = activeIds.map((id) => itemSubtotals[id]);

  // Allocate positive or negative extras (e.g. GST + service charge, or bill-wide discount)
  // in exact proportion to each active member's item subtotal.
  const absExtras = Math.abs(extrasCents);
  const sign = extrasCents >= 0 ? 1 : -1;
  const rawExtras = absExtras > 0 ? allocate(absExtras, weights) : activeIds.map(() => 0);

  const extrasAllocated: Amounts = {};
  const owed: Amounts = {};
  activeIds.forEach((id, i) => {
    const ex = sign * rawExtras[i];
    extrasAllocated[id] = ex;
    const finalCents = itemSubtotals[id] + ex;
    if (finalCents > 0) owed[id] = finalCents;
  });

  if (sumOf(owed) !== total) {
    return { ok: false, error: "Discount exceeds the items total." };
  }

  return {
    ok: true,
    owed,
    itemSubtotals: Object.fromEntries(Object.entries(itemSubtotals).filter(([, c]) => c > 0)),
    extrasAllocated,
    itemsSumCents,
    extrasCents,
  };
}

/**
 * Validates that payer contributions are non-negative whole cents summing exactly to `total`.
 * @param total Expense total in integer cents.
 * @param paid Map of member ID to cents paid.
 * @returns Error message string if invalid, or `null` when valid.
 */
export function checkPaid(total: number, paid: Amounts): string | null {
  const entries = Object.entries(paid).filter(([, c]) => c !== 0);
  if (!entries.length) return "Choose who paid.";
  if (entries.some(([, c]) => !Number.isInteger(c) || c < 0)) return "Check each paid amount: whole cents, not negative.";
  const diff = total - sumOf(paid);
  if (diff !== 0) return diff > 0 ? `Payers cover ${(diff / 100).toFixed(2)} less than the total.` : `Payers cover ${(-diff / 100).toFixed(2)} more than the total.`;
  return null;
}
