import { test } from "node:test";
import assert from "node:assert/strict";
import { estimatedProgress, percent } from "./progress";

test("progress: fills fast, slows down near the usual time, and never says 100% by itself", () => {
  assert.equal(estimatedProgress(0, 5000), 0);
  const quarter = estimatedProgress(1250, 5000);
  const usual = estimatedProgress(5000, 5000);
  assert.ok(quarter > 0.35 && quarter < 0.45);
  assert.ok(usual > 0.85 && usual < 0.87);
  assert.ok(estimatedProgress(60_000, 5000) <= 0.99);
  assert.ok(estimatedProgress(6000, 5000) > usual); // always moving forward
  assert.equal(percent(0.994), 99);
  assert.equal(percent(1.2), 100);
});
