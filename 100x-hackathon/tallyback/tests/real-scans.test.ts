// Real Gemini extractions of the by-hand golden pairs. The checker must reach the same verdict we did on paper.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { runChecks } from "../src/lib/checks";
import type { Extraction, Promise } from "../src/lib/types";

const P: Promise = { expectedTotal: null, pricesIncludeTax: null, paidOn: null, lineExpected: {}, unrecognised: [] };
const load = (n: string) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8")) as Extraction;

for (const f of ["velan-2026-10-08.json", "velan-2026-10-12.json"]) {
  test(`GP01 ${f}: every line checks out (tender row after total ignored)`, () => {
    const r = runChecks(load(f), P);
    assert.equal(r.outcome, "all_ok");
    assert.equal(r.findings.length, 0);
  });
}

test("GP02 FairPrice real scan: S$2.73 dispute once shelf prices were inclusive", () => {
  const ex = load("fairprice-2026-10-12.json");
  assert.equal(runChecks(ex, P).outcome, "all_ok");
  const r = runChecks(ex, { ...P, pricesIncludeTax: true });
  assert.equal(r.primary?.diff, 2.73);
  assert.equal(ex.lines[r.primary!.lineIndex!].kind, "tax");
});

test("GP03 Daily Brew real scan: fine if menu said ++ (tax not included)", () => {
  const r = runChecks(load("dailybrew-2026-10-12.json"), { ...P, pricesIncludeTax: false });
  assert.equal(r.outcome, "all_ok");
});

test("GP02 via Groq backup (no boxes, footer row mislabelled): same verdicts", () => {
  const ex = load("fairprice-2026-10-12.groq.json");
  assert.ok(ex.lines.every((l) => l.box_2d === null));
  assert.equal(runChecks(ex, P).outcome, "all_ok");
  assert.equal(runChecks(ex, { ...P, pricesIncludeTax: true }).primary?.diff, 2.73);
});
