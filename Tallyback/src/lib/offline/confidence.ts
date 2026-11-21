// How far to trust an offline reading. Decided by code, never by the model:
//   grounding  every amount the reader returned must actually appear in the OCR text
//              (a small model that "fixes" a total, or invents a line, fails this);
//   arithmetic the bill checks themselves (runChecks) report whether the printed numbers reconcile.
// When trust is low, findings are shown as "possible misread", never as "you were overcharged".
import type { CheckResult, Extraction } from "../types";
import { centsIn } from "./numbers";

export interface Grounding {
  checked: number;
  grounded: number;
  ratio: number; // 0–1; 1 when there was nothing to check
  missing: string[]; // "Total 3,080.00" — amounts not found in the text
}

export function grounding(ex: Extraction, ocrText: string): Grounding {
  const seen = centsIn(ocrText);
  const items: [string, number][] = ex.lines.map((l) => [l.description || l.kind, l.amount]);
  for (const [label, v] of [
    ["Subtotal", ex.printed_subtotal],
    ["Tax", ex.printed_tax_total],
    ["Total", ex.printed_total],
  ] as const)
    if (v != null) items.push([label, v]);
  const missing = items.filter(([, v]) => !seen.has(Math.abs(Math.round(v * 100)))).map(([label, v]) => `${label} ${v.toFixed(2)}`);
  const checked = items.length;
  return { checked, grounded: checked - missing.length, ratio: checked ? (checked - missing.length) / checked : 1, missing };
}

export type Trust = "high" | "low";

export interface Assessment {
  trust: Trust;
  grounding: Grounding;
  reasons: string[];
}

/** High trust only when it's a bill, has lines and a total, and ≥ 90% of its amounts were really printed. */
export function assess(ex: Extraction, ocrText: string, result: CheckResult): Assessment {
  const g = grounding(ex, ocrText);
  const reasons: string[] = [];
  if (!ex.is_bill) reasons.push("Doesn't look like a bill");
  if (ex.lines.length === 0) reasons.push("No lines found");
  if (ex.printed_total == null) reasons.push("No total found");
  if (g.ratio < 0.9) reasons.push(`${g.checked - g.grounded} of ${g.checked} amounts aren't in the scanned text`);
  // Real overcharges are small next to the bill: a service charge added twice, a wrong line.
  // A gap of a quarter of the bill or more, or a total far below the subtotal, is almost always
  // a misread digit (฿6,200 read as 86,200), so it must not be shown as the merchant's mistake.
  const total = ex.printed_total ?? 0;
  const biggest = Math.max(0, ...result.findings.map((f) => f.diff));
  if (total > 0 && biggest > total * 0.25) reasons.push("The gap is too big to be a real overcharge, so a number was probably misread");
  if (ex.printed_subtotal != null && total > 0 && total < ex.printed_subtotal * 0.5) reasons.push("The total is far below the subtotal, so a number was probably misread");
  const trust: Trust = reasons.length ? "low" : "high";
  if (trust === "high" && result.findings.some((f) => f.verdict === "wrong")) reasons.push("Numbers were read cleanly, so the issue is likely real");
  return { trust, grounding: g, reasons };
}
