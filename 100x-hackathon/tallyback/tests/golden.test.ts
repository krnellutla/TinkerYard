// Golden pairs from the by-hand sessions. If the checker changes behaviour, these fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runChecks } from "../src/lib/checks";
import { buildFacts, fill, verify, templateMessage, wordsChanged } from "../src/lib/message";
import sample from "../src/lib/sample.json";
import type { Extraction, ExtractedLine, Promise } from "../src/lib/types";

const P: Promise = { expectedTotal: null, pricesIncludeTax: null, paidOn: null, lineExpected: {}, unrecognised: [] };
const item = (description: string, amount: number, qty: number | null = null, unit_price: number | null = null, kind: ExtractedLine["kind"] = "item", tax_rate_pct: number | null = null): ExtractedLine =>
  ({ description, plain_words: "", qty, unit_price, amount, kind, tax_rate_pct, box_2d: null });

const base: Omit<Extraction, "lines"> = {
  is_bill: true, merchant_name: "M", merchant_country: null, merchant_whatsapp: null, bill_type: null, bill_number: null,
  bill_date: null, due_date: null, period_start: null, period_end: null, currency: "SGD", tax_mode: "unknown",
  printed_subtotal: null, printed_tax_total: null, printed_tax_rate_pct: null, printed_total: null,
};

// GP01 – Santhosh, Velan 12/10: GST included 9%, 1¢ subtotal rounding. Every line checks out.
const velan: Extraction = {
  ...base, merchant_country: "SG", bill_date: "2026-10-12", tax_mode: "included",
  printed_subtotal: 56.94, printed_tax_total: 4.70, printed_tax_rate_pct: 9, printed_total: 56.95,
  lines: [4.66, 1.85, 3.80, 3.72, 4.70, 5.53, 2.98, 4.09, 2.32, 2.50, 2.50, 5.20, 3.84, 1.50, 1.82, 2.11, 2.33, 1.50]
    .map((a, i) => item(`l${i}`, a)).concat([item("Rounding", 0.01, null, null, "rounding")]),
};
test("GP01 Velan: all ok despite 1¢ rounding", () => {
  const r = runChecks(velan, P);
  assert.equal(r.outcome, "all_ok");
  assert.equal(r.findings.filter((f) => f.verdict !== "info").length, 0);
});

// GP02 – Manish, FairPrice: 8% GST added on top.
const fp = sample as unknown as Extraction;
test("GP02 FairPrice: arithmetic fine, old rate flagged as info, asks about inclusive prices", () => {
  const r = runChecks(fp, P);
  assert.equal(r.outcome, "all_ok");
  assert.ok(r.findings.some((f) => f.id === "tax-rate" && f.verdict === "info"));
  assert.ok(r.findings.some((f) => f.id === "ask-inclusive"));
});
test("GP02 FairPrice: shelf prices inclusive → dispute S$2.73 on the GST line", () => {
  const r = runChecks(fp, { ...P, pricesIncludeTax: true });
  assert.equal(r.outcome, "dispute");
  assert.equal(r.primary?.id, "tax-on-top");
  assert.equal(r.primary?.diff, 2.73);
  assert.equal(fp.lines[r.primary!.lineIndex!].kind, "tax");
});

// Brief example – Indian mobile bill: unasked ₹199 pack, late fee on a bill paid on time, 18% GST added.
const mobile: Extraction = {
  ...base, currency: "INR", merchant_country: "IN", bill_date: "2026-09-30", due_date: "2026-09-20", tax_mode: "added",
  printed_subtotal: 848, printed_tax_total: 152.64, printed_tax_rate_pct: 18, printed_total: 1000.64,
  lines: [item("Plan 549", 549, null, null, "subscription"), item("Hello tunes pack", 199, null, null, "subscription"),
    item("Late payment fee", 100, null, null, "late_fee"), item("CGST 9%", 76.32, null, null, "tax", 9), item("SGST 9%", 76.32, null, null, "tax", 9)],
};
test("Mobile: late fee wrong when paid before due date", () => {
  const r = runChecks(mobile, { ...P, paidOn: "2026-09-18" });
  assert.equal(r.primary?.id, "late-2");
  assert.equal(r.primary?.diff, 100);
});
test("Mobile: unrecognised pack is 'unexplained', not 'wrong'", () => {
  const r = runChecks(mobile, { ...P, unrecognised: [1] });
  assert.equal(r.outcome, "query");
  assert.equal(r.primary?.lineIndex, 1);
  assert.equal(r.primary?.ask, "explain");
});
test("Mobile: plan above promise", () => {
  const r = runChecks(mobile, { ...P, lineExpected: { 0: 499 } });
  assert.equal(r.primary?.diff, 50);
});
test("Overcharged total is caught", () => {
  const r = runChecks({ ...mobile, printed_total: 1040.64 }, P);
  assert.equal(r.primary?.id, "total");
  assert.equal(r.primary?.diff, 40);
});

test("Verifier rejects a number the model made up", () => {
  const r = runChecks(fp, { ...P, pricesIncludeTax: true });
  const facts = buildFacts(fp, r.primary!);
  assert.ok(verify(fill("Please refund {{diff}} for bill {{bill_ref}}.", facts), facts).ok);
  assert.deepEqual(verify("Please refund S$3.07 now.", facts).stray, ["3.07"]);
  assert.ok(verify(templateMessage(facts, "polite"), facts).ok);
});

test("Words changed", () => {
  assert.equal(wordsChanged("please refund S$2.73 now", "please refund S$2.73 today thanks"), 2);
});

import { normalize } from "../src/lib/normalize";
test("Normalize: loose model JSON becomes clean numbers; WhatsApp gets country code", () => {
  const ex = normalize({ merchant_country: "sg", merchant_whatsapp: "98444327/97803238", printed_total: "56.95",
    lines: [{ description: "Carrot", amount: "1.82", qty: "0.65", kind: "veg" }, { description: "junk", amount: "n/a" }] });
  assert.equal(ex.merchant_whatsapp, "6598444327");
  assert.equal(ex.printed_total, 56.95);
  assert.equal(ex.lines.length, 1);
  assert.equal(ex.lines[0].kind, "other");
  assert.equal(normalize({ merchant_country: "SG", merchant_whatsapp: "+6598444327", lines: [] }).merchant_whatsapp, "6598444327");
});

test("Normalize: tax mode decided by the numbers, not the model's guess", () => {
  const added = normalize({ tax_mode: "included", printed_subtotal: 34.07, printed_tax_total: 2.73, printed_total: 36.8, lines: [] });
  assert.equal(added.tax_mode, "added");
  const incl = normalize({ tax_mode: "added", printed_subtotal: 56.94, printed_tax_total: 4.7, printed_total: 56.95, lines: [] });
  assert.equal(incl.tax_mode, "included");
});
