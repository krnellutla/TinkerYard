// Every amount is whole cents (integers), so splits always add up exactly. Pure: used by the page and the server.
//
// A group keeps its balances in one currency (CURRENCIES, all with cents). An expense can be entered
// in any SPEND_CURRENCIES and is converted into the group's currency when it's saved, at a rate the
// person can see and change; the original amount is kept alongside for display. Asia-Pacific first,
// for trips around the region (an SGD group shopping in Manila pays in pesos).

export const CURRENCIES = ["SGD", "MYR", "PHP", "THB", "HKD", "AUD", "NZD", "INR", "CNY", "TWD", "USD", "EUR", "GBP"] as const;
export type Currency = (typeof CURRENCIES)[number];

// Also spendable on a trip, but not as a group's currency: these have no cents in daily use.
const NO_CENTS = ["JPY", "KRW", "VND", "IDR"] as const;
export const SPEND_CURRENCIES = [...CURRENCIES.slice(0, 10), ...NO_CENTS, ...CURRENCIES.slice(10)] as const;
export type SpendCurrency = (typeof SPEND_CURRENCIES)[number];
export const isSpendCurrency = (c: unknown): c is SpendCurrency => typeof c === "string" && (SPEND_CURRENCIES as readonly string[]).includes(c);
const noCents = (c: string) => (NO_CENTS as readonly string[]).includes(c);

export const CURRENCY_NAMES: Record<SpendCurrency, string> = {
  SGD: "Singapore dollar",
  MYR: "Malaysian ringgit",
  PHP: "Philippine peso",
  THB: "Thai baht",
  HKD: "Hong Kong dollar",
  AUD: "Australian dollar",
  NZD: "New Zealand dollar",
  INR: "Indian rupee",
  CNY: "Chinese yuan",
  TWD: "New Taiwan dollar",
  JPY: "Japanese yen",
  KRW: "Korean won",
  VND: "Vietnamese dong",
  IDR: "Indonesian rupiah",
  USD: "US dollar",
  EUR: "Euro",
  GBP: "British pound",
};

/**
 * Parses a positive decimal amount string or number into whole integer cents.
 * @param input User-entered amount (e.g., `"12.5"`, `"1,234.56"`).
 * @returns Positive safe integer cents, or `null` for invalid, zero, or negative inputs.
 */
export function toCents(input: string | number): number | null {
  const text = typeof input === "number" ? String(input) : input.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$|^\.\d{1,2}$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  return cents > 0 && Number.isSafeInteger(cents) ? cents : null;
}

/**
 * Formats integer cents for prefilling text inputs, omitting decimals for zero-decimal currencies.
 * @param cents Amount in integer cents (stored at 100x scale even for zero-decimal currencies).
 * @param currency Optional ISO-4217 code (e.g., `"JPY"`).
 * @returns Plain numeric string without grouping or symbol.
 */
export const centsToInput = (cents: number, currency?: string) => (currency && noCents(currency) ? String(Math.round(cents / 100)) : (cents / 100).toFixed(2));

// Fixed symbols and grouping, so S$ never reads as US$ and the server and browser print the same text.
const SYMBOLS: Record<string, string> = {
  SGD: "S$",
  MYR: "RM",
  PHP: "₱",
  THB: "฿",
  HKD: "HK$",
  AUD: "A$",
  NZD: "NZ$",
  INR: "₹",
  CNY: "CN¥",
  TWD: "NT$",
  JPY: "¥",
  KRW: "₩",
  VND: "₫",
  IDR: "Rp",
  USD: "US$",
  EUR: "€",
  GBP: "£",
};
export const symbolOf = (currency: string) => SYMBOLS[currency] ?? `${currency} `;

/**
 * Formats integer cents with fixed currency symbols and consistent locale grouping.
 * @param cents Signed amount in integer cents.
 * @param currency ISO-4217 currency code.
 * @returns Formatted currency string (e.g., `"S$1,234.56"` or `"−₹5.00"`).
 */
export function formatMoney(cents: number, currency: string): string {
  const d = noCents(currency) ? 0 : 2;
  const n = (Math.abs(cents) / 100).toLocaleString("en", { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${cents < 0 ? "−" : ""}${symbolOf(currency)}${n}`;
}

// ---- converting ----
// A rate is how much of the group's currency one unit of the spent currency buys (1 PHP = 0.0203 SGD).

/**
 * Converts integer cents between currencies using `rate`, rounding to the nearest whole cent.
 * @param cents Source integer cents.
 * @param rate Exchange multiplier from source currency to target currency.
 * @returns Converted integer cents.
 */
export const convert = (cents: number, rate: number) => Math.round(cents * rate);

/**
 * Computes the cross-rate between `from` and `to` given a base-currency rate table.
 * @param table Rate table keyed by ISO-4217 code relative to `table.base`.
 * @param from Spent currency code.
 * @param to Group currency code.
 * @returns Exchange multiplier, or `null` if either currency is unavailable.
 */
export function rateBetween(table: { base: string; rates: Record<string, number> }, from: string, to: string): number | null {
  const per = (c: string) => (c === table.base ? 1 : table.rates[c]);
  const f = per(from);
  const t = per(to);
  return f && t && f > 0 && t > 0 ? t / f : null;
}

// "1 PHP = 0.0203 SGD": enough digits to be useful for both 0.0000391 (VND) and 41.2 (SGD → PHP).
export function formatRate(rate: number, from: string, to: string): string {
  const digits = rate >= 100 ? 2 : rate >= 1 ? 4 : Math.min(8, 3 - Math.floor(Math.log10(rate)));
  return `1 ${from} = ${Number(rate.toFixed(digits)).toString()} ${to}`;
}

// The saved amount must be the original times the rate (to the cent), so the page and the server agree.
export const matchesConversion = (amount: number, original: number, rate: number) => Math.abs(convert(original, rate) - amount) <= 1;
