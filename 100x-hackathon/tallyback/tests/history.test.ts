// "Has this charge shown up on my earlier bills?" against the two real Velan receipts (GP01).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { compareHistory, lineKey } from "../src/lib/history";
import { fmt } from "../src/lib/money";
import type { Extraction } from "../src/lib/types";

const load = (n: string) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8")) as Extraction;
const oct8 = load("velan-2026-10-08.json");
const oct12 = load("velan-2026-10-12.json");
const past = oct8.lines.map((l) => ({ ...l, bill_date: "2026-10-08" }));
const h = compareHistory(oct12.lines, past, (n) => fmt(n, "SGD"));
const at = (name: string) => h[oct12.lines.findIndex((l) => lineKey(l.description).startsWith(name))];

test("line numbers don't stop a match", () => {
  assert.equal(lineKey("13. Coriander leaf Ind"), lineKey("Coriander leaf Ind"));
});
test("Carrot: same S$/kg on both days despite 2-dp weights", () => {
  assert.equal(at("carrot")?.change, "same");
});
test("Coriander: cheaper on 12 Oct, as found by hand", () => {
  assert.equal(at("coriander")?.change, "down");
});
test("New items have no history; totals and tax are never compared", () => {
  assert.equal(at("coconut"), undefined);
  assert.ok(Object.keys(h).every((i) => !["total", "subtotal", "tax", "payment", "rounding"].includes(oct12.lines[+i].kind)));
});
test("qty/amount copied into the description doesn't stop a match", () => {
  assert.equal(lineKey("4. Carrot 0.88 2.46"), "carrot");
  assert.equal(lineKey("SPM Moong dal 1kg"), "spm moong dal 1kg");
});
