import { test } from "node:test";
import assert from "node:assert/strict";
import { CURRENCIES, SPEND_CURRENCIES, centsToInput, convert, formatMoney, formatRate, isSpendCurrency, matchesConversion, rateBetween } from "../src/split/lib/money";

test("currency: Asia-Pacific first; yen, won, dong and rupiah can be spent but not hold a group", () => {
  for (const c of ["SGD", "MYR", "PHP", "THB", "HKD", "AUD", "NZD", "INR", "CNY", "TWD"]) assert.ok((CURRENCIES as readonly string[]).includes(c), c);
  for (const c of ["JPY", "KRW", "VND", "IDR"]) {
    assert.ok(isSpendCurrency(c), c);
    assert.ok(!(CURRENCIES as readonly string[]).includes(c), c);
  }
  assert.equal(new Set(SPEND_CURRENCIES).size, SPEND_CURRENCIES.length);
});

test("currency: symbols, and no cents where nobody uses them", () => {
  assert.equal(formatMoney(500000, "PHP"), "₱5,000.00");
  assert.equal(formatMoney(150000, "JPY"), "¥1,500");
  assert.equal(formatMoney(25000000, "VND"), "₫250,000");
  assert.equal(formatMoney(1050, "SGD"), "S$10.50");
  assert.equal(centsToInput(150000, "JPY"), "1500");
  assert.equal(centsToInput(1050), "10.50");
});

test("currency: pesos into Singapore dollars, from a table published per Singapore dollar", () => {
  const table = { base: "SGD", rates: { PHP: 49.175149, JPY: 123.513227 } };
  const php = rateBetween(table, "PHP", "SGD")!;
  assert.ok(Math.abs(php - 1 / 49.175149) < 1e-12);
  assert.equal(convert(500000, php), 10168); // ₱5,000 ≈ S$101.68
  assert.equal(rateBetween(table, "SGD", "SGD"), 1);
  assert.ok(Math.abs(rateBetween(table, "PHP", "JPY")! - 123.513227 / 49.175149) < 1e-12); // across, not via the group
  assert.equal(rateBetween(table, "XXX", "SGD"), null);
});

test("currency: the server only accepts an amount that is the original times the rate", () => {
  assert.ok(matchesConversion(10168, 500000, 1 / 49.175149));
  assert.ok(!matchesConversion(12000, 500000, 1 / 49.175149));
});

test("currency: rates read sensibly however small or large", () => {
  assert.equal(formatRate(1 / 49.175149, "PHP", "SGD"), "1 PHP = 0.02034 SGD");
  assert.equal(formatRate(1 / 19970.98, "VND", "SGD"), "1 VND = 0.00005007 SGD");
  assert.equal(formatRate(49.175149, "SGD", "PHP"), "1 SGD = 49.1751 PHP");
});
