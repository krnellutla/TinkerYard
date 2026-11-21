// Reading amounts out of OCR text. Pure, so it runs in the browser, on a phone and in tests alike.
//
// Receipts print amounts as "1,234.50", "1.234,50", "1 234.50", "₱420.00" or "420". OCR adds noise
// (letter O for zero, stray spaces). This turns one printed token into a number, or null.

const AMOUNT_TOKEN = /-?(?:\d{1,3}(?:[ ,.]\d{3})+|\d+)(?:[.,]\d{1,2})?/g;

/** "1,234.50" → 1234.5, "1.234,50" → 1234.5, "2,880" → 2880, "12,5" → 12.5. Null when it isn't a number. */
export function parseAmount(token: string): number | null {
  let t = token.trim().replace(/[^\d.,\- ]/g, "").replace(/ (?=\d{3}\b)/g, "");
  if (!/\d/.test(t)) return null;
  const neg = t.startsWith("-");
  t = t.replace(/[- ]/g, "");
  const lastDot = t.lastIndexOf(".");
  const lastComma = t.lastIndexOf(",");
  const decimalAt = Math.max(lastDot, lastComma);
  let whole = t;
  let frac = "";
  // A separator followed by 1–2 digits at the end is the decimal point; 3 digits means thousands.
  if (decimalAt >= 0 && t.length - decimalAt - 1 <= 2) {
    whole = t.slice(0, decimalAt);
    frac = t.slice(decimalAt + 1);
  }
  whole = whole.replace(/[.,]/g, "");
  if (!whole && !frac) return null;
  const n = Number(`${whole || "0"}.${frac || "0"}`);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

/**
 * Undo common OCR slips around numbers, without changing any digit:
 *   "B5, 350.00" → "B5,350.00"  (a space after a thousands separator)
 *   "B321.35" / "$0.00" next to a word → " 321.35"  (฿ read as the letter B or as $)
 * Digits are never altered: a ฿ read as "8" stays "86,200.00", and the checks treat the
 * resulting nonsense as a probable misread (see confidence.ts), not as an overcharge.
 */
export function cleanOcr(text: string): string {
  return text.replace(/(\d)([,.]) (\d{3})(?=[.,]\d{2}\b|\b)/g, "$1$2$3").replace(/(^|[\s(])[B$](?=\d)/gm, "$1");
}

/** Every amount-looking token in a piece of text, in order. */
export function amountsIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(AMOUNT_TOKEN)) {
    const n = parseAmount(m[0]);
    if (n != null) out.push(n);
  }
  return out;
}

/** The amount printed at the end of a receipt row ("Crocodile Sisig ..... 420.00"), and the text before it. */
export function trailingAmount(row: string): { label: string; amount: number } | null {
  const m = row.match(/^(.*?)[\s:]*(?:[A-Z]{3}|[₱฿₹₫€£$]|S\$|RM|Rp)?\s*(-?(?:\d{1,3}(?:[ ,.]\d{3})+|\d+)(?:[.,]\d{1,2})?)\s*[A-Za-z]?\s*$/);
  if (!m) return null;
  const amount = parseAmount(m[2]);
  if (amount == null) return null;
  return { label: m[1].trim(), amount };
}

const cents = (n: number) => Math.round(n * 100);

/** Integer-cent set of every amount in the text, for "was this number really printed?" checks. */
export function centsIn(text: string): Set<number> {
  const set = new Set<number>();
  for (const n of amountsIn(cleanOcr(text))) set.add(Math.abs(cents(n)));
  return set;
}
