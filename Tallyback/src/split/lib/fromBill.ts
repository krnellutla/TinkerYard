import type { CheckResult, Extraction } from "@tallyback/lib/types";
import type { Category } from "./types";

// "Split this bill": a checked bill becomes a pre-filled expense in a group. Pure, so it's easy to test.

export interface ClaimableReceiptLine {
  lineIndex: number;
  description: string;
  qty: number | null;
  printedCents: number;
  verifiedCents: number;
  flagged: boolean;
  flagTitle?: string;
}

export interface ReceiptExtrasBreakdown {
  serviceChargeCents: number;
  taxAddedCents: number;
  discountCents: number;
  roundingCents: number;
}

export interface BillDraft {
  description: string;
  amount: number | null; // cents; null when the bill printed no total
  date: string | null; // YYYY-MM-DD
  category: Category;
  currency: string | null; // the bill's, to warn when the group uses another
  notes: string;
  // Optional verification & itemized receipt handoff fields ("Verify First, Split Fairly")
  billId?: string;
  printedAmountCents?: number | null;
  verifiedAmountCents?: number | null;
  atStakeCents?: number;
  outcome?: CheckResult["outcome"];
  issueTitle?: string | null;
  claimableLines?: ClaimableReceiptLine[];
  extras?: ReceiptExtrasBreakdown;
}

// A best guess from what the bill says it is; the person can change it in the form.
const GUESSES: [RegExp, Category][] = [
  [/grocer|supermarket|mart|fairprice|cold storage|giant|sheng siong/i, "groceries"],
  [/restaurant|cafe|café|coffee|food|bar|bistro|hawker|kitchen|dining|pizza|burger/i, "food"],
  [/electric|water|gas|utilit|internet|broadband|mobile|telco|phone/i, "utilities"],
  [/rent|lease|landlord/i, "rent"],
  [/taxi|grab|uber|gojek|transport|fuel|petrol|parking|train|bus/i, "transport"],
  [/hotel|hostel|airbnb|flight|airline|travel/i, "travel"],
  [/cinema|movie|ticket|concert|museum|theme park/i, "fun"],
];

const CLAIMABLE_KINDS = new Set(["item", "fee", "late_fee", "subscription", "other"]);

export function billToDraft(ex: Extraction, checkResult?: CheckResult | null, billId?: string): BillDraft {
  const text = `${ex.bill_type ?? ""} ${ex.merchant_name ?? ""}`;
  const total = ex.printed_total;
  const printedCents = total != null && total > 0 ? Math.round(total * 100) : null;

  const base: BillDraft = {
    description: (ex.merchant_name ?? "").trim().slice(0, 120) || "Bill",
    amount: printedCents,
    date: ex.bill_date && /^\d{4}-\d{2}-\d{2}$/.test(ex.bill_date) ? ex.bill_date : null,
    category: GUESSES.find(([re]) => re.test(text))?.[1] ?? "general",
    currency: ex.currency,
    notes: ex.bill_number ? `Bill ${ex.bill_number}` : "",
  };

  // Preserve exact 6-key shape when called with 1 argument and no itemized lines (backward compatibility)
  if (!checkResult && !billId && ex.lines.length === 0) {
    return base;
  }

  // Build per-line finding lookup so flagged or overcharged lines know their verified cents
  const lineFindings = new Map<number, { diffCents: number; title: string }>();
  for (const f of checkResult?.findings ?? []) {
    if (f.lineIndex != null && (f.verdict === "wrong" || f.verdict === "unexplained") && f.diff > 0) {
      const diffCents = Math.round(f.diff * 100);
      const prev = lineFindings.get(f.lineIndex);
      if (!prev || diffCents > prev.diffCents) {
        lineFindings.set(f.lineIndex, { diffCents, title: f.title });
      }
    }
  }

  const totalAt = ex.lines.findIndex((l) => l.kind === "total");
  const subAt = ex.lines.findIndex((l) => l.kind === "subtotal");
  const claimableLines: ClaimableReceiptLine[] = [];

  ex.lines.forEach((l, idx) => {
    if (!CLAIMABLE_KINDS.has(l.kind)) return;
    if (subAt >= 0 && idx > subAt && l.kind === "item") return;
    if (totalAt >= 0 && idx > totalAt) return;
    const pCents = Math.round(l.amount * 100);
    if (pCents <= 0) return;
    const finding = lineFindings.get(idx);
    const vCents = finding ? Math.max(0, pCents - finding.diffCents) : pCents;
    claimableLines.push({
      lineIndex: idx,
      description: l.description,
      qty: l.qty,
      printedCents: pCents,
      verifiedCents: vCents,
      flagged: !!finding,
      ...(finding ? { flagTitle: finding.title } : {}),
    });
  });

  const serviceChargeCents = ex.lines
    .filter((l, i) => l.kind === "service_charge" && (totalAt < 0 || i < totalAt))
    .reduce((s, l) => s + Math.round(l.amount * 100), 0);
  const taxLinesCents = ex.lines
    .filter((l, i) => l.kind === "tax" && (totalAt < 0 || i < totalAt))
    .reduce((s, l) => s + Math.round(l.amount * 100), 0);
  const taxAddedCents =
    ex.tax_mode === "added"
      ? ex.printed_tax_total != null
        ? Math.round(ex.printed_tax_total * 100)
        : taxLinesCents
      : 0;
  const discountCents = ex.lines
    .filter((l, i) => l.kind === "discount" && (totalAt < 0 || i < totalAt))
    .reduce((s, l) => s + Math.abs(Math.round(l.amount * 100)), 0);
  const roundingCents = ex.lines
    .filter((l, i) => l.kind === "rounding" && (totalAt < 0 || i < totalAt))
    .reduce((s, l) => s + Math.round(l.amount * 100), 0);

  const primaryDiffCents =
    checkResult?.primary && checkResult.primary.diff > 0 ? Math.round(checkResult.primary.diff * 100) : 0;
  const verifiedCents =
    printedCents != null
      ? primaryDiffCents > 0 && primaryDiffCents < printedCents
        ? printedCents - primaryDiffCents
        : printedCents
      : null;

  const noteParts = [
    ex.bill_number ? `Bill ${ex.bill_number}` : "",
    primaryDiffCents > 0 && checkResult?.primary
      ? `TallyBack verified: excludes ${(primaryDiffCents / 100).toFixed(2)} disputed (${checkResult.primary.title})`
      : checkResult?.outcome === "all_ok"
        ? "Verified by TallyBack (all lines check out)"
        : "",
  ].filter(Boolean);

  return {
    ...base,
    // Default to the verified fair total when an overcharge was caught!
    amount: verifiedCents ?? printedCents,
    notes: noteParts.join(" · "),
    ...(billId ? { billId } : {}),
    printedAmountCents: printedCents,
    verifiedAmountCents: verifiedCents,
    atStakeCents: primaryDiffCents,
    outcome: checkResult?.outcome ?? "all_ok",
    issueTitle: checkResult?.primary?.title ?? null,
    claimableLines,
    extras: {
      serviceChargeCents,
      taxAddedCents,
      discountCents,
      roundingCents,
    },
  };
}
