// Tier 0 of offline reading: no AI model at all. Rows with an amount at the right edge become lines,
// and keywords decide what kind of line each one is. It's instant and needs no download, and it
// returns the same loose JSON shape the AI readers do, so normalize() and runChecks() treat all alike.
import { cleanOcr, parseAmount, trailingAmount } from "./numbers";

type Kind = "item" | "service_charge" | "discount" | "tax" | "rounding" | "subtotal" | "total";

// Order matters: "Sub Total" must match subtotal before total, "Service Tax" is a tax-like charge.
const RULES: [Kind | "skip", RegExp][] = [
  ["skip", /\b(cash|change|tender(ed)?|visa|master ?card|amex|card|nets|gcash|maya|paid|balance due|qr ?pay)\b/i],
  ["skip", /\b(approx|approximately|convert(ed)?)\b|≈|\d\s*[A-Z]{3}\s*=/i], // "1 PHP = 0.0228 SGD · Converted S$72.36"
  ["subtotal", /\bsub[\s-]?total\b/i],
  ["service_charge", /\b(service|svc|serv\.?)\b(?!\s*tax)/i],
  ["tax", /\b(vat|gst|sst|ppn|tax|cgst|sgst|igst|pb1)\b/i],
  ["discount", /\b(disc(ount)?|less|promo|voucher)\b/i],
  ["rounding", /\bround(ing)?\b/i],
  ["total", /\b(grand\s*total|total|amount\s*due|nett?\s*total|to\s*pay)\b/i],
];

const CURRENCIES: [RegExp, string][] = [
  [/₱|\bPHP\b/, "PHP"],
  [/฿|\bTHB\b|\bbaht\b/i, "THB"],
  [/S\$|\bSGD\b/, "SGD"],
  [/\bRM\b|\bMYR\b/, "MYR"],
  [/\bRp\b|\bIDR\b/, "IDR"],
  [/₫|\bVND\b/, "VND"],
  [/₹|\bINR\b|\bRs\.?\b/, "INR"],
  [/€|\bEUR\b/, "EUR"],
  [/£|\bGBP\b/, "GBP"],
  [/\bUSD\b|US\$/, "USD"],
];

function dateIn(text: string): string | null {
  const iso = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  // Day first: most receipts outside the US (this app's users are in SEA, India, UK, EU).
  const dmy = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|\d{2})\b/);
  if (dmy) {
    const y = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    const [d, mo] = [Number(dmy[1]), Number(dmy[2])];
    if (d <= 31 && mo <= 12) return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

/** OCR text → the loose extraction JSON (full field names) that normalize() accepts. */
export function parseReceiptText(text: string): Record<string, unknown> {
  const rows = cleanOcr(text)
    .split(/\r?\n/)
    .map((r) => r.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const lines: Record<string, unknown>[] = [];
  let subtotal: number | null = null;
  let total: number | null = null;
  let taxTotal = 0;
  let taxSeen = false;
  let rate: number | null = null;
  let firstAmountRow = -1;

  rows.forEach((row, i) => {
    const hit = trailingAmount(row);
    if (!hit || !hit.label || !/[A-Za-z]/.test(hit.label)) return; // dates, phone numbers, bare numbers
    if (/\b(tel|phone|tin|vat reg|gst reg|receipt|invoice|bill|table|pax|guests?|order|cashier|date|time)\b\s*(no\.?|#|:)?/i.test(hit.label) && !/total/i.test(hit.label)) return;
    const kind = RULES.find(([, re]) => re.test(hit.label))?.[0] ?? "item";
    if (kind === "skip") return;
    if (firstAmountRow < 0) firstAmountRow = i;

    let qty: number | null = null;
    let unit: number | null = null;
    let description = hit.label;
    // "2x Mango Shake", "2 x Mango Shake", "Mango Shake 2 @ 150.00"
    const lead = description.match(/^(\d{1,3})\s*[x×]\s*(.+)$/i);
    if (lead) {
      qty = Number(lead[1]);
      description = lead[2];
    }
    const at = description.match(/^(.*?)\s+(\d{1,3})\s*[@x×]\s*([\d.,]+)$/i);
    if (at) {
      description = at[1];
      qty = Number(at[2]);
      unit = parseAmount(at[3]);
    }

    const pct = description.match(/(\d{1,2}(?:\.\d{1,2})?)\s*%/);
    if (kind === "tax") {
      taxSeen = true;
      taxTotal += hit.amount;
      if (pct) rate = Number(pct[1]);
    }
    if (kind === "subtotal" && subtotal == null) subtotal = hit.amount;
    if (kind === "total") total = hit.amount; // the last "total" row is the one to pay

    lines.push({ description, qty, unit_price: unit, amount: Math.abs(hit.amount), kind, plain_words: "" });
  });

  // Merchant: the first wordy row above the first amount, skipping address-like rows.
  const header = rows.slice(0, Math.max(1, firstAmountRow));
  const merchant = header.find((r) => /[A-Za-z]{3}/.test(r) && !/\d{4,}/.test(r) && r.length <= 40) ?? null;
  const currency = CURRENCIES.find(([re]) => re.test(text))?.[1] ?? null;
  const included = /\bincl(?:usive|uded|\.|\b)/i.test(text); // "VAT inclusive", "(included)", "incl. GST"

  // Added on top or already inside the prices? Let the printed numbers decide, like normalize() does,
  // but counting service charge and discounts, which normalize's subtotal + tax = total test can't see.
  const sumOf = (k: Kind) => lines.filter((l) => l.kind === k).reduce((a, l) => a + (l.amount as number), 0);
  const itemsSum = sumOf("item");
  const base = (subtotal ?? itemsSum) + sumOf("service_charge") - sumOf("discount") + sumOf("rounding");
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.05;
  const taxMode = !taxSeen ? "none" : total != null && near(base + taxTotal, total) ? "added" : included || (total != null && near(base, total)) ? "included" : "unknown";

  return {
    is_bill: lines.length > 0 && total != null,
    merchant_name: merchant,
    bill_date: dateIn(text),
    currency,
    tax_mode: taxMode,
    printed_subtotal: subtotal,
    printed_tax_total: taxSeen ? Math.round(taxTotal * 100) / 100 : null,
    printed_tax_rate_pct: rate,
    printed_total: total,
    lines,
  };
}
