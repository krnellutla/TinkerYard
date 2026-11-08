// Repeating expenses (rent, subscriptions), like Splitwise's repeat_interval. Pure, so it's easy to test.
// Every copy is counted from the first date, so a monthly expense on the 31st lands on the 31st, or the
// last day of shorter months, and never drifts to the 28th for good.

export const REPEATS = [
  { id: "never", label: "Doesn't repeat" },
  { id: "weekly", label: "Every week" },
  { id: "fortnightly", label: "Every 2 weeks" },
  { id: "monthly", label: "Every month" },
  { id: "yearly", label: "Every year" },
] as const;
export type Repeat = (typeof REPEATS)[number]["id"];
export const isRepeat = (v: unknown): v is Repeat => REPEATS.some((r) => r.id === v);

const parts = (d: string) => d.split("-").map(Number) as [number, number, number];
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// The k-th repeat after `start` (k = 1 is the first copy).
export function nthRepeat(start: string, every: Exclude<Repeat, "never">, k: number): string {
  const [y, m, d] = parts(start);
  if (every === "weekly" || every === "fortnightly") {
    const t = new Date(Date.UTC(y, m - 1, d + k * (every === "weekly" ? 7 : 14)));
    return t.toISOString().slice(0, 10);
  }
  const months = every === "monthly" ? k : 12 * k;
  const total = m - 1 + months;
  const ny = y + Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return iso(ny, nm, Math.min(d, daysIn(ny, nm)));
}

// The next repeat after `start` that's later than `after`.
export function nextRepeat(start: string, every: Repeat, after: string): string | null {
  if (every === "never") return null;
  for (let k = 1; k < 2000; k++) {
    const d = nthRepeat(start, every, k);
    if (d > after) return d;
  }
  return null;
}

// Copies that are due: every repeat from `next` up to and including `today` (at most `max`, so an
// expense left alone for years can't flood the group), and where the schedule goes on from.
export function dueRepeats(start: string, every: Repeat, next: string | null, today: string, max = 24): { dates: string[]; next: string | null } {
  if (every === "never" || !next) return { dates: [], next: null };
  const dates: string[] = [];
  let at: string | null = next;
  while (at && at <= today && dates.length < max) {
    dates.push(at);
    at = nextRepeat(start, every, at);
  }
  // Too many missed: skip ahead rather than leave the schedule in the past.
  if (at && at <= today) at = nextRepeat(start, every, today);
  return { dates, next: at };
}
