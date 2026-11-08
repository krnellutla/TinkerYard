import { test } from "node:test";
import assert from "node:assert/strict";
import { settleOptions } from "../src/split/lib/balances";
import { dueRepeats, nextRepeat, nthRepeat } from "../src/split/lib/repeat";

test("settle up: people you owe first, then who owes you, then the rest, biggest first", () => {
  const o = settleOptions(
    [
      { from: "me", to: "a", amount: 500 },
      { from: "b", to: "me", amount: 900 },
      { from: "me", to: "c", amount: 1200 },
      { from: "b", to: "c", amount: 100 },
    ],
    "me",
  );
  assert.deepEqual(o.iOwe.map((t) => t.to), ["c", "a"]);
  assert.deepEqual(o.owedToMe.map((t) => t.from), ["b"]);
  assert.deepEqual(o.others, [{ from: "b", to: "c", amount: 100 }]);
});

test("repeats: monthly on the 31st keeps to the month's end without drifting", () => {
  assert.equal(nthRepeat("2026-01-31", "monthly", 1), "2026-02-28");
  assert.equal(nthRepeat("2026-01-31", "monthly", 2), "2026-03-31");
  assert.equal(nthRepeat("2026-12-15", "monthly", 1), "2027-01-15");
  assert.equal(nthRepeat("2024-02-29", "yearly", 1), "2025-02-28");
  assert.equal(nthRepeat("2026-11-01", "weekly", 1), "2026-11-08");
  assert.equal(nthRepeat("2026-11-01", "fortnightly", 2), "2026-11-29");
});

test("repeats: the first copy comes after today, so old dates don't flood the group", () => {
  assert.equal(nextRepeat("2026-08-01", "monthly", "2026-11-08"), "2026-12-01");
  assert.equal(nextRepeat("2026-11-08", "never", "2026-11-08"), null);
});

test("repeats: every due copy up to today, and where the schedule goes on from", () => {
  assert.deepEqual(dueRepeats("2026-08-01", "monthly", "2026-09-01", "2026-11-08"), { dates: ["2026-09-01", "2026-10-01", "2026-11-01"], next: "2026-12-01" });
  assert.deepEqual(dueRepeats("2026-08-01", "monthly", "2026-12-01", "2026-11-08"), { dates: [], next: "2026-12-01" });
  const capped = dueRepeats("2020-01-01", "weekly", "2020-01-08", "2026-11-08", 3);
  assert.equal(capped.dates.length, 3);
  assert.ok(capped.next! > "2026-11-08"); // skips ahead instead of staying in the past
});
