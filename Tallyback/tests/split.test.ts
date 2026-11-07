import { test } from "node:test";
import assert from "node:assert/strict";
import { allocate, checkPaid, splitAmount } from "../src/split/lib/split";
import { netBalances, pairwiseDebts, simplifiedDebts, type Entry, type Transfer } from "../src/split/lib/balances";
import { formatMoney, toCents } from "../src/split/lib/money";

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

test("money: typed amounts become whole cents; nonsense is refused", () => {
  assert.equal(toCents("12.5"), 1250);
  assert.equal(toCents("1,234.56"), 123456);
  assert.equal(toCents(".5"), 50);
  for (const bad of ["", "0", "-3", "1.234", "abc", "1e3"]) assert.equal(toCents(bad), null, bad);
  assert.equal(formatMoney(123456, "SGD"), "S$1,234.56");
  assert.equal(formatMoney(-500, "INR"), "−₹5.00");
});

test("allocate: parts always add up, leftover cents go to the largest remainders", () => {
  assert.deepEqual(allocate(1000, [1, 1, 1]), [334, 333, 333]);
  assert.deepEqual(allocate(100, [1, 2]), [33, 67]);
  for (let total = 1; total < 200; total += 7) assert.equal(allocate(total, [3, 1, 4, 1, 5]).reduce((a, b) => a + b, 0), total);
});

test("split equally: S$100 three ways is 33.34 + 33.33 + 33.33", () => {
  const r = splitAmount(10000, { method: "equal", members: ["a", "b", "c"] });
  assert.ok(r.ok);
  assert.deepEqual(r.owed, { a: 3334, b: 3333, c: 3333 });
});

test("split by exact amounts must add up to the total", () => {
  assert.deepEqual(splitAmount(5000, { method: "exact", members: ["a", "b"], values: { a: 2000, b: 3000 } }), { ok: true, owed: { a: 2000, b: 3000 } });
  const short = splitAmount(5000, { method: "exact", members: ["a", "b"], values: { a: 2000, b: 2000 } });
  assert.ok(!short.ok && /10\.00 still to assign/.test(short.error));
});

test("split by percent must reach 100; split by shares is proportional", () => {
  const p = splitAmount(9000, { method: "percent", members: ["a", "b"], values: { a: 50, b: 40 } });
  assert.ok(!p.ok && /90%/.test(p.error));
  const ok = splitAmount(9999, { method: "percent", members: ["a", "b", "c"], values: { a: 50, b: 25, c: 25 } });
  assert.ok(ok.ok && sum(ok.owed) === 9999);
  const s = splitAmount(5000, { method: "shares", members: ["a", "b"], values: { a: 2, b: 3 } });
  assert.deepEqual(s, { ok: true, owed: { a: 2000, b: 3000 } });
  // A zero share leaves that person out entirely.
  const z = splitAmount(5000, { method: "shares", members: ["a", "b"], values: { a: 0, b: 1 } });
  assert.deepEqual(z, { ok: true, owed: { b: 5000 } });
});

test("payers must cover exactly the total", () => {
  assert.equal(checkPaid(5000, { a: 5000 }), null);
  assert.equal(checkPaid(5000, { a: 3000, b: 2000 }), null);
  assert.match(checkPaid(5000, { a: 3000 })!, /less/);
  assert.match(checkPaid(5000, {})!, /who paid/);
});

// Alice pays 90 dinner for three; Bob pays 30 taxi for Bob and Cara; Cara pays Alice back 20.
const trip: Entry[] = [
  { paid: { alice: 9000 }, owed: { alice: 3000, bob: 3000, cara: 3000 } },
  { paid: { bob: 3000 }, owed: { bob: 1500, cara: 1500 } },
  { paid: { cara: 2000 }, owed: { alice: 2000 } },
];

const settles = (net: Record<string, number>, ts: Transfer[]) => {
  const after = { ...net };
  for (const t of ts) {
    after[t.from] += t.amount;
    after[t.to] -= t.amount;
  }
  return Object.values(after).every((c) => c === 0);
};

test("balances: a payment moves both people, and the group always sums to zero", () => {
  const net = netBalances(trip);
  assert.deepEqual(net, { alice: 4000, bob: -1500, cara: -2500 });
  assert.equal(sum(net), 0);
});

test("simplified debts settle the group in at most n−1 payments", () => {
  const ts = simplifiedDebts(trip);
  assert.ok(settles(netBalances(trip), ts));
  assert.ok(ts.length <= 2);
  assert.deepEqual(ts, [
    { from: "cara", to: "alice", amount: 2500 },
    { from: "bob", to: "alice", amount: 1500 },
  ]);
});

test("pairwise debts keep who-owes-whom from shared expenses, netting opposite debts", () => {
  const ts = pairwiseDebts(trip);
  assert.ok(settles(netBalances(trip), ts));
  // Cara owed Alice 30 for dinner and paid back 20; she owes Bob 15 for the taxi.
  assert.deepEqual(ts, [
    { from: "bob", to: "alice", amount: 3000 },
    { from: "cara", to: "bob", amount: 1500 },
    { from: "cara", to: "alice", amount: 1000 },
  ]);
});

test("simplify beats pairwise on a debt chain: A→B→C becomes A→C", () => {
  const chain: Entry[] = [
    { paid: { b: 1000 }, owed: { a: 1000 } },
    { paid: { c: 1000 }, owed: { b: 1000 } },
  ];
  assert.equal(pairwiseDebts(chain).length, 2);
  assert.deepEqual(simplifiedDebts(chain), [{ from: "a", to: "c", amount: 1000 }]);
});

test("split this bill: a checked bill becomes a pre-filled expense", async () => {
  const { billToDraft } = await import("../src/split/lib/fromBill");
  const bill = {
    is_bill: true, merchant_name: "FairPrice Finest", merchant_country: "SG", merchant_whatsapp: null,
    bill_type: "supermarket receipt", bill_number: "FP2026", bill_date: "2026-10-12", due_date: null,
    period_start: null, period_end: null, currency: "SGD", tax_mode: "included" as const,
    printed_subtotal: null, printed_tax_total: null, printed_tax_rate_pct: null, printed_total: 56.95, lines: [],
  };
  assert.deepEqual(billToDraft(bill), { description: "FairPrice Finest", amount: 5695, date: "2026-10-12", category: "groceries", currency: "SGD", notes: "Bill FP2026" });
  // No total, no name, odd date: the form opens with what we know and asks for the rest.
  const sparse = billToDraft({ ...bill, merchant_name: null, bill_type: null, printed_total: null, bill_date: "12/10/2026", bill_number: null });
  assert.deepEqual(sparse, { description: "Bill", amount: null, date: null, category: "general", currency: "SGD", notes: "" });
  // 0.1 + 0.2 style floats still land on whole cents
  assert.equal(billToDraft({ ...bill, printed_total: 0.1 + 0.2 }).amount, 30);
});
