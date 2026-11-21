// The instructions and output shape for a small on-device model (0.5–1.5B parameters) that turns
// OCR text into the bill JSON. Small models follow short, concrete instructions best, and the JSON
// schema is enforced by the runtime's grammar (WebLLM / llama.cpp), so the answer always parses.

export const OFFLINE_SYSTEM = `You turn the text of a scanned receipt into JSON.
Rules:
- Copy every number exactly as it appears in the text. Never add, multiply or fix numbers.
- One entry in "l" per printed row that has an amount, top to bottom, including subtotal, service charge, tax and total rows.
- k (kind): item, service_charge, discount, tax, rounding, subtotal, total, other.
- Ignore payment rows (cash, card, change) and lines without an amount.
- q is the quantity if printed (e.g. "2x"), otherwise null. p is the unit price only if printed, otherwise null.
- cur is the ISO-4217 currency (PHP, THB, SGD, MYR, IDR, VND, INR...), or null if unknown.
- tm: "included" if prices include tax (e.g. "VAT inclusive"), "added" if tax is added on top, "none" if no tax, else "unknown".
- The text comes from OCR and may have typos in words; that's fine, keep the numbers as printed.`;

export const offlineUserPrompt = (ocrText: string) => `Receipt text:\n"""\n${ocrText.slice(0, 4000)}\n"""\nReturn the JSON.`;

const num = { type: ["number", "null"] };
const KINDS = ["item", "service_charge", "discount", "tax", "rounding", "subtotal", "total", "other"];

/** JSON Schema (draft-07 subset understood by WebLLM's XGrammar). Short keys keep generation fast. */
export const OFFLINE_SCHEMA = {
  type: "object",
  properties: {
    bill: { type: "boolean" },
    m: { type: ["string", "null"] },
    d: { type: ["string", "null"] },
    cur: { type: ["string", "null"] },
    tm: { type: "string", enum: ["added", "included", "none", "unknown"] },
    sub: num,
    tax: num,
    rate: num,
    tot: num,
    l: {
      type: "array",
      items: {
        type: "object",
        properties: { d: { type: "string" }, q: num, p: num, a: { type: "number" }, k: { type: "string", enum: KINDS } },
        required: ["d", "q", "p", "a", "k"],
      },
    },
  },
  required: ["bill", "m", "d", "cur", "tm", "sub", "tax", "rate", "tot", "l"],
} as const;

/** The model's short-key JSON → the loose full-name JSON that normalize() accepts. */
export function fromOfflineJson(j: Record<string, unknown>): Record<string, unknown> {
  const rows = Array.isArray(j.l) ? (j.l as Record<string, unknown>[]) : [];
  return {
    is_bill: j.bill,
    merchant_name: j.m,
    bill_date: j.d,
    currency: j.cur,
    tax_mode: j.tm,
    printed_subtotal: j.sub,
    printed_tax_total: j.tax,
    printed_tax_rate_pct: j.rate,
    printed_total: j.tot,
    lines: rows.map((r) => ({ description: r.d, qty: r.q, unit_price: r.p, amount: r.a, kind: r.k, plain_words: "" })),
  };
}
