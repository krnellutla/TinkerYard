// What the model reads off the bill. Every number here is *read*, never computed.
export type LineKind =
  | "item"
  | "fee"
  | "late_fee"
  | "subscription"
  | "service_charge"
  | "discount"
  | "tax"
  | "rounding"
  | "previous_balance"
  | "payment"
  | "subtotal"
  | "total"
  | "other";

export interface ExtractedLine {
  description: string;
  plain_words: string; // model's plain-English explanation of the line
  qty: number | null;
  unit_price: number | null;
  amount: number;
  kind: LineKind;
  tax_rate_pct: number | null;
  box_2d: [number, number, number, number] | null; // [ymin, xmin, ymax, xmax], 0–1000
}

export interface Extraction {
  is_bill: boolean;
  merchant_name: string | null;
  merchant_country: string | null; // ISO-3166 alpha-2
  merchant_whatsapp: string | null; // business contact printed on the bill, if any
  bill_type: string | null;
  bill_number: string | null;
  bill_date: string | null; // YYYY-MM-DD
  due_date: string | null;
  period_start: string | null;
  period_end: string | null;
  currency: string | null; // ISO-4217
  tax_mode: "added" | "included" | "none" | "unknown";
  printed_subtotal: number | null;
  printed_tax_total: number | null;
  printed_tax_rate_pct: number | null;
  printed_total: number | null;
  lines: ExtractedLine[];
}

// What the user tells us they were promised.
export interface Promise {
  expectedTotal: number | null;
  pricesIncludeTax: boolean | null; // e.g. shelf / menu price was tax-inclusive
  paidOn: string | null; // YYYY-MM-DD
  lineExpected: Record<number, number>; // line index -> expected amount
  unrecognised: number[]; // line indexes the user doesn't recognise
}

export type Verdict = "wrong" | "unexplained" | "info";

export interface Finding {
  id: string;
  verdict: Verdict;
  lineIndex: number | null;
  title: string;
  maths: string; // human-readable working, built by code
  charged: number | null;
  expected: number | null;
  diff: number; // amount in the customer's favour if corrected (>= 0)
  ask: "refund" | "explain" | "none";
}

export interface Check {
  name: string;
  ok: boolean | null; // null = not applicable / couldn't check
  maths: string;
}

export interface CheckResult {
  checks: Check[];
  findings: Finding[];
  primary: Finding | null;
  outcome: "dispute" | "query" | "all_ok";
  currency: string;
}
