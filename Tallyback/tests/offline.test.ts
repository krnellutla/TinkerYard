import { test } from "node:test";
import assert from "node:assert/strict";
import { amountsIn, parseAmount, trailingAmount } from "../src/lib/offline/numbers";
import { parseReceiptText } from "../src/lib/offline/heuristic";
import { assess, grounding } from "../src/lib/offline/confidence";
import { OFFLINE_SCHEMA, fromOfflineJson } from "../src/lib/offline/prompt";
import { normalize } from "../src/lib/normalize";
import { DEMO_RECEIPTS } from "../src/split/lib/demoData";
import { runChecks } from "../src/lib/checks";
import type { Promise as BillPromise } from "../src/lib/types";

const noPromise: BillPromise = { expectedTotal: null, pricesIncludeTax: null, paidOn: null, lineExpected: {}, unrecognised: [] };

// What Tesseract returns for the Palawan demo receipt (Kinabuch's), with typical OCR noise.
const KINABUCH_OCR = `KINABUCH'S GRILL & BAR
Rizal Avenue - Puerto Princesa City
DATE: 2026-11-06   BILL #KGB-10394
Crocodile Sisig 420.00
Tamilok Kinilaw 280.00
Grilled Tuna Belly 560.00
2x Chicken Inasal 460.00
6x Garlic Rice 360.00
8x Red Horse Beer (500ml) [Drink] 720.00
Fresh Calamansi Juice 85.00
Subtotal (PHP) ₱2,885.00
Service Charge (10%) ₱288.50
VAT 12% (included) ₱340.02
TOTAL PHP ₱3,173.50
1 PHP = 0.0228 SGD · Converted S$72.36
CASH ₱3,200.00
CHANGE ₱26.50`;

test("offline numbers: thousands vs decimal separators, currency symbols", () => {
  assert.equal(parseAmount("1,234.50"), 1234.5);
  assert.equal(parseAmount("1.234,50"), 1234.5);
  assert.equal(parseAmount("2,880"), 2880);
  assert.equal(parseAmount("12,5"), 12.5);
  assert.equal(parseAmount("₱3,173.50"), 3173.5);
  assert.equal(parseAmount("1 234.50"), 1234.5);
  assert.equal(parseAmount("n/a"), null);
  assert.deepEqual(amountsIn("Sisig 420.00 and ₱2,885.00"), [420, 2885]);
  assert.deepEqual(trailingAmount("TOTAL PHP ₱3,173.50"), { label: "TOTAL PHP", amount: 3173.5 });
  assert.deepEqual(trailingAmount("Service Charge (10%) ₱288.50"), { label: "Service Charge (10%)", amount: 288.5 });
});

test("offline heuristic: reads the Palawan receipt with no model, and the bill checks pass", () => {
  const ex = normalize(parseReceiptText(KINABUCH_OCR), false);
  assert.equal(ex.is_bill, true);
  assert.equal(ex.merchant_name, "KINABUCH'S GRILL & BAR");
  assert.equal(ex.bill_date, "2026-11-06");
  assert.equal(ex.currency, "PHP");
  assert.equal(ex.tax_mode, "included");
  assert.equal(ex.printed_subtotal, 2885);
  assert.equal(ex.printed_tax_total, 340.02);
  assert.equal(ex.printed_tax_rate_pct, 12);
  assert.equal(ex.printed_total, 3173.5);
  const items = ex.lines.filter((l) => l.kind === "item");
  assert.equal(items.length, 7);
  assert.deepEqual(items[3], { description: "Chicken Inasal", plain_words: "", qty: 2, unit_price: null, amount: 460, kind: "item", tax_rate_pct: null, box_2d: null });
  // Cash, change and the SGD conversion note are not lines.
  assert.ok(!ex.lines.some((l) => [3200, 26.5, 72.36].includes(l.amount)));
  const result = runChecks(ex, noPromise);
  assert.deepEqual(result.findings, [], JSON.stringify(result.findings));
  const a = assess(ex, KINABUCH_OCR, result);
  assert.equal(a.trust, "high");
  assert.equal(a.grounding.ratio, 1);
});

test("offline confidence: an amount the model made up drops trust, so issues show as possible misreads", () => {
  const ex = normalize(parseReceiptText(KINABUCH_OCR), false);
  // A small model "fixes" the total and invents a line: neither number is in the scanned text.
  const tampered = { ...ex, printed_total: 3273.5, lines: [...ex.lines, { ...ex.lines[0], description: "Lechon", amount: 999 }] };
  const g = grounding(tampered, KINABUCH_OCR);
  assert.deepEqual(g.missing, ["Lechon 999.00", "Total 3273.50"]);
  const a = assess(tampered, KINABUCH_OCR, runChecks(tampered, noPromise));
  assert.equal(a.trust, "low");
  assert.match(a.reasons.join(" "), /2 of \d+ amounts aren't in the scanned text/);
});

test("offline heuristic: a real overcharge is still caught, with high trust", () => {
  // Items add to 2,885.00 but the receipt's subtotal says 2,985.00: ₱100 extra, and every number was printed.
  const ocr = KINABUCH_OCR.replace("Subtotal (PHP) ₱2,885.00", "Subtotal (PHP) ₱2,985.00").replace("TOTAL PHP ₱3,173.50", "TOTAL PHP ₱3,283.50").replace("₱288.50", "₱298.50");
  const ex = normalize(parseReceiptText(ocr), false);
  const result = runChecks(ex, noPromise);
  assert.ok(result.findings.length > 0, "the subtotal mismatch is flagged");
  assert.equal(assess(ex, ocr, result).trust, "high");
});

test("offline model output: short-key JSON maps onto the same extraction, and the schema requires every key", () => {
  const modelJson = {
    bill: true,
    m: "Kinabuch's",
    d: "2026-11-06",
    cur: "PHP",
    tm: "included",
    sub: 2885,
    tax: 340.02,
    rate: 12,
    tot: 3173.5,
    l: [
      { d: "Crocodile Sisig", q: null, p: null, a: 420, k: "item" },
      { d: "Chicken Inasal", q: 2, p: null, a: "460.00", k: "item" },
      { d: "Service Charge", q: null, p: null, a: 288.5, k: "service_charge" },
    ],
  };
  const ex = normalize(fromOfflineJson(modelJson), false);
  assert.equal(ex.lines.length, 3);
  assert.equal(ex.lines[1].amount, 460);
  assert.equal(ex.lines[2].kind, "service_charge");
  assert.deepEqual([...OFFLINE_SCHEMA.required].sort(), Object.keys(modelJson).sort());
});

test("offline heuristic: VAT added on top (Bangkok receipt, OCR reads ฿ as B) is worked out from the numbers", () => {
  const ocr = `SOMBOON SEAFOOD
Bantadthong Road : Bangkok
DATE: 2026-11-12 BILL #BKK-4820
Signature Curry Crab (L) 1,400.00
Tom Yum Goong Hotpot 650.00
Stir-Fried Garlic Prawns 850.00
Morning Glory Sambal 320.00
2x Mango Sticky Rice 480.00
Chang Draft Beer Tower [Drink] 390.00
Subtotal (THB) B4,090.00
Service Charge (10%) B409.00
VAT (7%) B321.35
TOTAL THB B4,820.35
1 THB = 0.0385 SGD - Converted S$185.58`;
  const ex = normalize(parseReceiptText(ocr), false);
  assert.equal(ex.currency, "THB");
  assert.equal(ex.tax_mode, "added");
  assert.equal(ex.printed_tax_total, 321.35);
  assert.equal(ex.printed_tax_rate_pct, 7);
  // The demo receipt's own VAT is off (7% of 4,499.00 is 314.93, it prints 321.35): the offline reading
  // must reach exactly the verdict the known-correct extraction does, no more and no less.
  const truth = DEMO_RECEIPTS.find((r) => r.key === "somboon")!.extraction;
  const mine = runChecks(ex, noPromise).findings.map((f) => [f.id, f.diff]);
  assert.deepEqual(mine, runChecks(truth, noPromise).findings.map((f) => [f.id, f.diff]));
  assert.deepEqual(mine, [["tax-math", 6.42]]);
});

test("offline OCR slips: ฿ misread as 8, B or $ and split numbers become 'possible misread', never an accusation", () => {
  // Tesseract on the Bangkok spa receipt: ฿6,200.00 came out as 86,200.00.
  const spa = `LET'S RELAX SPA
DATE: 2026-11-13 BILL #LRS-6200
2x Thai Massage + Herbal (90m) 2,600.00
2x Aromatherapy 0il (66m) 2,400.00
Foot Reflexology (66m) 600.00
5x Therapist Gratuity Pool 600.00
Subtotal (THB) 86,200.00
Service Charge (10%) $0.00
VAT (7%) $0.00
TOTAL THB B6,200.00`;
  const a = parseReceiptText(spa);
  assert.equal(a.printed_total, 6200);
  const exA = normalize(a, false);
  const resA = runChecks(exA, noPromise);
  assert.ok(resA.findings.length > 0);
  const trustA = assess(exA, spa, resA);
  assert.equal(trustA.trust, "low");
  assert.match(trustA.reasons.join(" "), /probably misread/);

  // And on the rooftop bar: "B5, 350.00" is read as 5,350.00; a garbled line still can't pass as an overcharge.
  const bar = `OCTAVE ROOFTOP BAR
4x Bangkok Sunset Cocktails [Drink 1,920.00
Lychee Rose Zero-Proof Mocktail 320.00
Wagyu Sliders & Truffle Fries 2530 555!
Subtotal (THB) B4,545.55
Service Charge (10%) B454.56
VAT (7%) B349.89
TOTAL THB B5, 350.00`;
  const exB = normalize(parseReceiptText(bar), false);
  assert.equal(exB.printed_total, 5350);
  assert.equal(exB.tax_mode, "added");
  assert.equal(assess(exB, bar, runChecks(exB, noPromise)).trust, "low");
});
