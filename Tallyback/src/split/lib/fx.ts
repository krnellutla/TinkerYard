import "server-only";
import { isSpendCurrency, SPEND_CURRENCIES } from "./money";

// Today's exchange rates, free and without a key: ExchangeRate-API's open endpoint (covers every
// Asia-Pacific currency, VND and TWD included), with Frankfurter (European Central Bank rates) as the
// backup. Both update once a day, so a copy is kept for 6 hours per server instance.

export interface RateTable {
  base: string;
  date: string; // when the source last updated
  source: string;
  rates: Record<string, number>; // 1 base = x of each
}

const TTL = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; table: RateTable }>();

const keep = (rates: Record<string, number>) => Object.fromEntries(Object.entries(rates).filter(([c, r]) => isSpendCurrency(c) && r > 0));

async function fromOpenEr(base: string): Promise<RateTable> {
  const r = await fetch(`https://open.er-api.com/v6/latest/${base}`, { signal: AbortSignal.timeout(5000) });
  const d = (await r.json()) as { result?: string; time_last_update_utc?: string; rates?: Record<string, number> };
  if (!r.ok || d.result !== "success" || !d.rates) throw new Error(`open.er-api ${r.status}`);
  return { base, date: new Date(d.time_last_update_utc ?? Date.now()).toISOString().slice(0, 10), source: "ExchangeRate-API", rates: keep(d.rates) };
}

async function fromFrankfurter(base: string): Promise<RateTable> {
  const r = await fetch(`https://api.frankfurter.dev/v1/latest?base=${base}`, { signal: AbortSignal.timeout(5000) });
  const d = (await r.json()) as { date?: string; rates?: Record<string, number> };
  if (!r.ok || !d.rates) throw new Error(`frankfurter ${r.status}`);
  return { base, date: d.date ?? new Date().toISOString().slice(0, 10), source: "European Central Bank (Frankfurter)", rates: keep(d.rates) };
}

export async function ratesFor(base: string): Promise<RateTable | null> {
  if (!isSpendCurrency(base)) return null;
  const hit = cache.get(base);
  if (hit && Date.now() - hit.at < TTL) return hit.table;
  for (const source of [fromOpenEr, fromFrankfurter]) {
    try {
      const table = await source(base);
      cache.set(base, { at: Date.now(), table });
      return table;
    } catch (e) {
      console.error(`[fx] ${source.name} failed for ${base}:`, e instanceof Error ? e.message : e);
    }
  }
  return hit?.table ?? null; // an older copy beats none
}

export const SUPPORTED = SPEND_CURRENCIES;
