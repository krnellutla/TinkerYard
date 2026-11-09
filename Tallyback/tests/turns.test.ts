import { test } from "node:test";
import assert from "node:assert/strict";
import { comingUp, lastPaidDates, nextRound, payOrder } from "../src/split/lib/turns";
import { isDrink } from "../src/split/lib/drinks";
import { describeChanges } from "../src/split/lib/changes";
import { tripPhase, tripSummary } from "../src/split/lib/trip";

test("turns: whoever owes the most pays next; ties go to who paid longest ago", () => {
  assert.deepEqual(payOrder(["a", "b", "c"], { a: 500, b: -900, c: 400 }), ["b", "c", "a"]);
  assert.deepEqual(payOrder(["a", "b"], { a: 0, b: 0 }, { a: "2026-11-08", b: "2026-11-01" }), ["b", "a"]);
  assert.deepEqual(lastPaidDates([{ kind: "expense", deleted: false, date: "2026-11-02", paid: { a: 1 } }, { kind: "payment", deleted: false, date: "2026-11-09", paid: { a: 1 } }]), { a: "2026-11-02" });
});

test("rounds: go round the table, and someone buying out of turn doesn't lose anyone's place", () => {
  const p = ["a", "b", "c"];
  assert.equal(nextRound(p, []), "a");
  assert.equal(nextRound(p, [{ memberId: "a" }]), "b");
  assert.equal(nextRound(p, [{ memberId: "a" }, { memberId: "b" }, { memberId: "c" }]), "a");
  assert.equal(nextRound(p, [{ memberId: "c" }]), "a"); // c jumped in; a is still up
  assert.deepEqual(comingUp(p, [{ memberId: "a" }], 3), ["b", "c", "a"]);
});

test("drinks: regional names count, soft drinks and cooking don't", () => {
  for (const d of ["Tiger Pint", "San Miguel", "2x Soju", "House Red Wine", "Rosé glass", "Gin & Tonic"]) assert.ok(isDrink(d), d);
  for (const d of ["Ginger Beer", "Ginger chicken", "Beer battered fish", "Beef in red wine", "Iced Lemon Tea", "Virgin Mojito", "Teh Tarik"]) assert.ok(!isDrink(d), d);
});

test("changes: an edit says exactly what moved", () => {
  const before = { description: "Dinner", amount: 4000, category: "food", date: "2026-11-08", notes: "", paid: { s: 4000 }, owed: { s: 2000, k: 2000 } };
  const after = { ...before, amount: 6000, paid: { k: 6000 }, owed: { s: 3000, k: 3000 } };
  const name = (id: string) => (id === "s" ? "Sam" : "Kim");
  assert.deepEqual(describeChanges(before, after, name, "SGD"), ["S$40.00 → S$60.00", "paid by Sam → Kim", "Sam's share S$20.00 → S$30.00", "Kim's share S$20.00 → S$30.00"]);
  assert.deepEqual(describeChanges(before, before, name, "SGD"), []);
  assert.deepEqual(describeChanges(before, { ...before, owed: { s: 4000 } }, name, "SGD"), ["took off Kim", "Sam's share S$20.00 → S$40.00"]);
});

test("trip: phases and the wrap-up count only that trip's real expenses", () => {
  const t = { destination: "Manila", start: "2026-11-05", end: "2026-11-08", currency: "PHP" };
  assert.deepEqual(tripPhase(t, "2026-11-06"), { phase: "during", day: 2, of: 4 });
  assert.deepEqual(tripPhase(t, "2026-11-03"), { phase: "before", inDays: 2 });
  assert.deepEqual(tripPhase(t, "2026-11-09"), { phase: "over" });
  const e = (date: string, amount: number, extra = {}) => ({ kind: "expense", deleted: false, date, amount, category: "food", paid: { a: amount }, owed: { a: amount / 2, b: amount / 2 }, ...extra });
  const s = tripSummary(t, [e("2026-11-06", 4000), e("2026-11-01", 9999), e("2026-11-07", 1000, { deleted: true }), e("2026-11-07", 500, { kind: "payment" })]);
  assert.equal(s.total, 4000);
  assert.equal(s.count, 1);
  assert.equal(s.perDay, 1000);
  assert.deepEqual(s.coveredMost, { id: "a", amount: 4000 });
  assert.equal(s.share.b, 2000);
});
