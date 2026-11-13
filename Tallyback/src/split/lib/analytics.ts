import { categoryOf, type Category, type Expense, type Member } from "./types";

export interface CategorySlice {
  category: Category;
  label: string;
  icon: string;
  amount: number; // cents in group currency
  count: number;
  pct: number; // 0..100
}

export interface MemberSpendRow {
  id: string;
  name: string;
  paid: number; // cents put down out of pocket
  share: number; // fair share consumed (owed)
  net: number; // paid - share (+ owed money, - owes money)
}

export interface DaySpendPoint {
  date: string; // YYYY-MM-DD
  amount: number; // group cents on this day
  cumulative: number; // running total group cents
  count: number;
  foreignTotals: Record<string, number>; // spent currency -> original cents (only for foreign currencies)
}

export interface DailySpendSeries {
  days: DaySpendPoint[];
  total: number;
  averagePerDay: number;
  maxDayCents: number;
}

export interface CurrencySlice {
  currency: string;
  groupCents: number;
  originalCents: number;
  count: number;
  pct: number;
  avgRate: number | null; // effective weighted groupCents / originalCents when foreign
}

const liveExpenses = (expenses: Expense[]) => expenses.filter((e) => !e.deleted && e.kind === "expense");

/**
 * Aggregates live group expenses by category, sorted from largest spend to smallest.
 */
export function categoryBreakdown(expenses: Expense[]): CategorySlice[] {
  const live = liveExpenses(expenses);
  const total = live.reduce((sum, e) => sum + e.amount, 0);
  if (total <= 0) return [];

  const buckets = new Map<Category, { amount: number; count: number }>();
  for (const e of live) {
    const prev = buckets.get(e.category) ?? { amount: 0, count: 0 };
    buckets.set(e.category, { amount: prev.amount + e.amount, count: prev.count + 1 });
  }

  return [...buckets.entries()]
    .sort((a, b) => b[1].amount - a[1].amount || a[0].localeCompare(b[0]))
    .map(([category, b]) => {
      const meta = categoryOf(category);
      return {
        category,
        label: meta.label,
        icon: meta.icon,
        amount: b.amount,
        count: b.count,
        pct: Math.round((b.amount / total) * 1000) / 10,
      };
    });
}

/**
 * Computes how much each group member paid out of pocket vs. their actual consumed share across live expenses.
 */
export function memberComparison(expenses: Expense[], members: Member[]): MemberSpendRow[] {
  const live = liveExpenses(expenses);
  const paidMap = new Map<string, number>();
  const shareMap = new Map<string, number>();

  for (const e of live) {
    for (const [id, c] of Object.entries(e.paid)) paidMap.set(id, (paidMap.get(id) ?? 0) + c);
    for (const [id, c] of Object.entries(e.owed)) shareMap.set(id, (shareMap.get(id) ?? 0) + c);
  }

  return members
    .filter((m) => !m.removed || paidMap.has(m.id) || shareMap.has(m.id))
    .map((m) => {
      const paid = paidMap.get(m.id) ?? 0;
      const share = shareMap.get(m.id) ?? 0;
      return { id: m.id, name: m.name, paid, share, net: paid - share };
    })
    .sort((a, b) => b.paid + b.share - (a.paid + a.share) || a.name.localeCompare(b.name));
}

/**
 * Computes a chronological daily spending series with running cumulative totals and foreign-currency subtotals.
 */
export function dailySpending(expenses: Expense[]): DailySpendSeries {
  const live = liveExpenses(expenses);
  if (!live.length) return { days: [], total: 0, averagePerDay: 0, maxDayCents: 0 };

  const byDay = new Map<string, { amount: number; count: number; foreignTotals: Record<string, number> }>();
  for (const e of live) {
    const bucket = byDay.get(e.date) ?? { amount: 0, count: 0, foreignTotals: {} };
    bucket.amount += e.amount;
    bucket.count += 1;
    if (e.original) {
      bucket.foreignTotals[e.original.currency] = (bucket.foreignTotals[e.original.currency] ?? 0) + e.original.amount;
    }
    byDay.set(e.date, bucket);
  }

  let cumulative = 0;
  let maxDayCents = 0;
  const days: DaySpendPoint[] = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, b]) => {
      cumulative += b.amount;
      if (b.amount > maxDayCents) maxDayCents = b.amount;
      return { date, amount: b.amount, cumulative, count: b.count, foreignTotals: b.foreignTotals };
    });

  return {
    days,
    total: cumulative,
    averagePerDay: Math.round(cumulative / days.length),
    maxDayCents,
  };
}

/**
 * Breaks down spending by currency actually paid (`groupCurrency` vs foreign currencies converted on entry).
 */
export function currencyBreakdown(expenses: Expense[], groupCurrency: string): CurrencySlice[] {
  const live = liveExpenses(expenses);
  const total = live.reduce((sum, e) => sum + e.amount, 0);
  if (total <= 0) return [];

  const buckets = new Map<string, { groupCents: number; originalCents: number; count: number }>();
  for (const e of live) {
    const cur = e.original?.currency ?? groupCurrency;
    const orig = e.original ? e.original.amount : e.amount;
    const prev = buckets.get(cur) ?? { groupCents: 0, originalCents: 0, count: 0 };
    buckets.set(cur, {
      groupCents: prev.groupCents + e.amount,
      originalCents: prev.originalCents + orig,
      count: prev.count + 1,
    });
  }

  return [...buckets.entries()]
    .sort((a, b) => b[1].groupCents - a[1].groupCents || a[0].localeCompare(b[0]))
    .map(([currency, b]) => ({
      currency,
      groupCents: b.groupCents,
      originalCents: b.originalCents,
      count: b.count,
      pct: Math.round((b.groupCents / total) * 1000) / 10,
      avgRate: currency !== groupCurrency && b.originalCents > 0 ? Number((b.groupCents / b.originalCents).toFixed(5)) : null,
    }));
}

