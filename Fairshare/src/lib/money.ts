// Every amount is whole cents (integers), so splits always add up exactly. Pure: used by the page and the server.

// Two-decimal currencies only: amounts are kept in cents.
export const CURRENCIES = ["SGD", "INR", "USD", "EUR", "GBP", "AUD", "MYR"] as const;
export type Currency = (typeof CURRENCIES)[number];

// "12.5", "1,234.56", 12.5 → cents; anything else → null. Negative and zero amounts are refused.
export function toCents(input: string | number): number | null {
  const text = typeof input === "number" ? String(input) : input.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$|^\.\d{1,2}$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  return cents > 0 && Number.isSafeInteger(cents) ? cents : null;
}

// Cents → "12.50", for prefilling inputs.
export const centsToInput = (cents: number) => (cents / 100).toFixed(2);

// Fixed symbols and grouping, so S$ never reads as US$ and the server and browser print the same text.
const SYMBOLS: Record<string, string> = { SGD: "S$", INR: "₹", USD: "US$", EUR: "€", GBP: "£", AUD: "A$", MYR: "RM" };
export function formatMoney(cents: number, currency: string): string {
  const n = (Math.abs(cents) / 100).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${cents < 0 ? "−" : ""}${SYMBOLS[currency] ?? `${currency} `}${n}`;
}
