// Models return loose JSON (numbers as strings, odd kinds). Code cleans it before any check runs.
import type { Extraction, ExtractedLine, LineKind } from "./types";

const KINDS: LineKind[] = ["item", "fee", "late_fee", "subscription", "service_charge", "discount", "tax", "rounding", "previous_balance", "payment", "subtotal", "total", "other"];

const toNum = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/[^\d.-]/g, "");
  if (!/\d/.test(cleaned)) return null; // "n/a", "-", "" are not numbers
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};
const toStr = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

const DIAL: Record<string, string> = { SG: "65", IN: "91", MY: "60", GB: "44", AE: "971", AU: "61", US: "1", NZ: "64" };

// "98444327/97803238" -> "6598444327": first number only, with the country's dialling code.
function whatsapp(v: unknown, country: string | null): string | null {
  const first = toStr(v)?.split(/[\/,;]| or /)[0] ?? "";
  const plus = first.trim().startsWith("+");
  let d = first.replace(/\D/g, "");
  if (d.length < 7) return null;
  const code = country ? DIAL[country] : undefined;
  if (!plus && code && !d.startsWith(code)) d = code + d.replace(/^0+/, "");
  return d;
}

// Whether tax was added or included is arithmetic, not judgement: let the printed numbers decide.
function reconcileTaxMode(claimed: unknown, sub: number | null, tax: number | null, total: number | null): unknown {
  if (sub == null || tax == null || total == null || tax <= 0) return claimed;
  const c = (n: number) => Math.round(n * 100);
  const near = (a: number, b: number) => Math.abs(a - b) <= 5; // allow cash rounding
  if (near(c(sub) + c(tax), c(total))) return "added";
  if (near(c(sub), c(total))) return "included";
  return claimed;
}

export function normalize(raw: Record<string, unknown>, keepBoxes = true): Extraction {
  const lines = (Array.isArray(raw.lines) ? raw.lines : [])
    .map((l: Record<string, unknown>): ExtractedLine | null => {
      const amount = toNum(l.amount);
      if (amount == null) return null;
      const box = l.box_2d;
      return {
        description: toStr(l.description) ?? "",
        plain_words: toStr(l.plain_words) ?? "",
        qty: toNum(l.qty),
        unit_price: toNum(l.unit_price),
        amount,
        kind: KINDS.includes(l.kind as LineKind) ? (l.kind as LineKind) : "other",
        tax_rate_pct: toNum(l.tax_rate_pct),
        box_2d: keepBoxes && Array.isArray(box) && box.length === 4 && box.every((n) => typeof n === "number") ? (box as ExtractedLine["box_2d"]) : null,
      };
    })
    .filter((l): l is ExtractedLine => l !== null);
  const tm = reconcileTaxMode(raw.tax_mode, toNum(raw.printed_subtotal), toNum(raw.printed_tax_total), toNum(raw.printed_total));
  const country = toStr(raw.merchant_country)?.toUpperCase() ?? null;
  return {
    is_bill: raw.is_bill !== false,
    merchant_name: toStr(raw.merchant_name),
    merchant_country: country,
    merchant_whatsapp: whatsapp(raw.merchant_whatsapp, country),
    bill_type: toStr(raw.bill_type),
    bill_number: toStr(raw.bill_number),
    bill_date: toStr(raw.bill_date),
    due_date: toStr(raw.due_date),
    period_start: toStr(raw.period_start),
    period_end: toStr(raw.period_end),
    currency: toStr(raw.currency)?.toUpperCase() ?? null,
    tax_mode: tm === "added" || tm === "included" || tm === "none" ? tm : "unknown",
    printed_subtotal: toNum(raw.printed_subtotal),
    printed_tax_total: toNum(raw.printed_tax_total),
    printed_tax_rate_pct: toNum(raw.printed_tax_rate_pct),
    printed_total: toNum(raw.printed_total),
    lines,
  };
}
