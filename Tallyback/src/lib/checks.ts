// The part of TallyBack that decides. Pure, deterministic: same input, same answer.
// The model never computes anything that appears in a finding or a message.
import type { Check, CheckResult, Extraction, ExtractedLine, Finding, Promise } from "./types";
import { fmt, fromCents, toCents } from "./money";
import { INCLUSIVE_DISPLAY_COUNTRIES, statutoryRate } from "./taxRules";

const CHARGE_KINDS = new Set(["item", "fee", "late_fee", "subscription", "other", "discount"]);

const signed = (l: ExtractedLine) =>
  l.kind === "discount" || l.kind === "payment" ? -Math.abs(toCents(l.amount)) : toCents(l.amount);

export function runChecks(ex: Extraction, promise: Promise): CheckResult {
  const cur = ex.currency ?? "";
  const m = (c: number) => fmt(fromCents(c), cur);
  const checks: Check[] = [];
  const findings: Finding[] = [];
  const lines = ex.lines;
  const idxOf = (kind: string) => lines.findIndex((l) => l.kind === kind);

  // 1. Each line: qty × unit price = amount
  {
    const bad: string[] = [];
    let tested = 0;
    lines.forEach((l, i) => {
      if (l.qty == null || l.unit_price == null || !CHARGE_KINDS.has(l.kind) || l.kind === "discount") return;
      tested++;
      const computed = Math.round(l.qty * l.unit_price * 100);
      // Weights are printed to 2 dp; the scale may use 3 dp. Allow that much drift.
      const weighed = !Number.isInteger(l.qty);
      const tol = 1 + (weighed ? Math.ceil(l.unit_price * 0.005 * 100) : 0);
      const charged = toCents(l.amount);
      if (charged - computed > tol) {
        bad.push(l.description);
        findings.push({
          id: `line-math-${i}`,
          verdict: "wrong",
          lineIndex: i,
          title: `"${l.description}" costs more than quantity × price`,
          maths: `${l.qty} × ${m(toCents(l.unit_price))} = ${m(computed)}, but charged ${m(charged)}`,
          charged: fromCents(charged),
          expected: fromCents(computed),
          diff: fromCents(charged - computed),
          ask: "refund",
        });
      }
    });
    checks.push({
      name: "Each line: quantity × unit price",
      ok: tested === 0 ? null : bad.length === 0,
      maths: tested === 0 ? "No quantity/unit price printed" : bad.length ? `Mismatch on: ${bad.join(", ")}` : `${tested} lines checked`,
    });
  }

  // 2. Lines add up to the subtotal
  // Only rows printed before the subtotal can be part of it (models sometimes mislabel the rows below).
  const subAt = idxOf("subtotal");
  const chargeLines = lines.filter((l, i) => CHARGE_KINDS.has(l.kind) && (subAt < 0 || i < subAt));
  const chargeSum = chargeLines.reduce((s, l) => s + signed(l), 0);
  const sub = ex.printed_subtotal != null ? toCents(ex.printed_subtotal) : null;
  if (sub != null && chargeLines.length) {
    const tol = Math.max(1, Math.ceil(chargeLines.length * 0.5));
    const d = sub - chargeSum;
    const ok = Math.abs(d) <= tol;
    checks.push({
      name: "Lines add up to the subtotal",
      ok,
      maths: `${chargeLines.length} lines = ${m(chargeSum)}; printed subtotal ${m(sub)}${d ? ` (${d > 0 ? "+" : ""}${m(d)}${ok ? ", rounding" : ""})` : ""}`,
    });
    if (!ok && d > 0) {
      findings.push({
        id: "subtotal",
        verdict: "wrong",
        lineIndex: idxOf("subtotal") >= 0 ? idxOf("subtotal") : null,
        title: "Subtotal is more than the lines add up to",
        maths: `Lines add up to ${m(chargeSum)}, subtotal printed ${m(sub)}: ${m(d)} extra`,
        charged: fromCents(sub),
        expected: fromCents(chargeSum),
        diff: fromCents(d),
        ask: "refund",
      });
    }
  } else {
    checks.push({ name: "Lines add up to the subtotal", ok: null, maths: "No subtotal printed" });
  }

  // 3. Tax arithmetic
  const taxLines = lines.filter((l) => l.kind === "tax");
  const tax =
    ex.printed_tax_total != null
      ? toCents(ex.printed_tax_total)
      : taxLines.length
        ? taxLines.reduce((s, l) => s + toCents(l.amount), 0)
        : null;
  const rule = statutoryRate(ex.merchant_country, ex.bill_date);
  const printedRate =
    ex.printed_tax_rate_pct ??
    (taxLines.length && taxLines.every((l) => l.tax_rate_pct != null)
      ? taxLines.reduce((s, l) => s + (l.tax_rate_pct ?? 0), 0)
      : null);
  // Not printed? Check the maths against the legal rate for that country and date.
  const rateAssumed = printedRate == null && rule.kind === "standard";
  const rate = printedRate ?? (rule.kind === "standard" ? rule.rate : null);
  const service = lines.filter((l) => l.kind === "service_charge").reduce((s, l) => s + toCents(l.amount), 0);
  const base = (sub ?? chargeSum) + service;
  const total = ex.printed_total != null ? toCents(ex.printed_total) : null;
  const taxIdx = idxOf("tax");

  if (tax != null && rate != null && (ex.tax_mode === "added" || ex.tax_mode === "included")) {
    const computed =
      ex.tax_mode === "added"
        ? Math.round((base * rate) / 100)
        : total != null
          ? Math.round((total * rate) / (100 + rate))
          : null;
    if (computed != null) {
      const d = tax - computed;
      const tol = 1 + Math.max(0, taxLines.length - 1);
      const ok = Math.abs(d) <= tol;
      const how =
        ex.tax_mode === "added"
          ? `${rate}% × ${m(base)} = ${m(computed)}`
          : `${m(total!)} × ${rate}/${100 + rate} = ${m(computed)} (included in price)`;
      checks.push({ name: `Tax at ${rate}%${rateAssumed ? " (legal rate; not printed)" : ""}`, ok, maths: `${how}; printed ${m(tax)}` });
      if (!ok && d > 0) {
        findings.push({
          id: "tax-math",
          verdict: "wrong",
          lineIndex: taxIdx >= 0 ? taxIdx : null,
          title: `Tax is more than ${rate}% of the bill`,
          maths: `${how}, but printed ${m(tax)}: ${m(d)} extra`,
          charged: fromCents(tax),
          expected: fromCents(computed),
          diff: fromCents(d),
          ask: "refund",
        });
      }
    }
  } else {
    checks.push({ name: "Tax arithmetic", ok: null, maths: tax == null ? "No tax shown" : "Tax rate not printed" });
  }

  // 4. Tax rate vs the law on the bill date
  if (rateAssumed) {
    checks.push({ name: "Tax rate vs the law", ok: null, maths: "Rate not printed; checked the maths at the legal rate instead" });
  } else if (rate != null && rule.kind === "standard") {
    const ok = Math.abs(rate - rule.rate) < 0.001;
    checks.push({
      name: "Tax rate vs the law",
      ok,
      maths: `${ex.merchant_country} standard rate on ${ex.bill_date}: ${rule.rate}%; bill uses ${rate}%`,
    });
    if (!ok && tax != null) {
      const atLaw =
        ex.tax_mode === "included" && total != null
          ? Math.round((total * rule.rate) / (100 + rule.rate))
          : Math.round((base * rule.rate) / 100);
      const d = tax - atLaw;
      findings.push({
        id: "tax-rate",
        verdict: rate > rule.rate ? "wrong" : "info",
        lineIndex: taxIdx >= 0 ? taxIdx : null,
        title:
          rate > rule.rate
            ? `Tax charged at ${rate}%, the legal rate is ${rule.rate}%`
            : `Bill uses an old tax rate (${rate}% instead of ${rule.rate}%). You paid less, but the invoice is wrong`,
        maths: `At ${rule.rate}%: ${m(atLaw)} tax; printed ${m(tax)} (${d > 0 ? "+" : ""}${m(d)})`,
        charged: fromCents(tax),
        expected: fromCents(atLaw),
        diff: Math.max(0, fromCents(d)),
        ask: rate > rule.rate ? "refund" : "none",
      });
    }
  } else if (rate != null && rule.kind === "slabs") {
    const ok = rule.rates.some((r) => Math.abs(r - rate) < 0.001);
    checks.push({
      name: "Tax rate vs the law",
      ok,
      maths: `${ex.merchant_country} valid rates on ${ex.bill_date}: ${rule.rates.join("%, ")}%; bill uses ${rate}%`,
    });
    if (!ok) {
      findings.push({
        id: "tax-rate",
        verdict: "unexplained",
        lineIndex: taxIdx >= 0 ? taxIdx : null,
        title: `${rate}% is not a valid tax rate in ${ex.merchant_country}`,
        maths: `Valid rates: ${rule.rates.join("%, ")}%`,
        charged: tax != null ? fromCents(tax) : null,
        expected: null,
        diff: 0,
        ask: "explain",
      });
    }
  } else {
    checks.push({ name: "Tax rate vs the law", ok: null, maths: "No rule on file for this country/date" });
  }

  // 5. Subtotal + extras = total
  if (total != null) {
    // Rows printed after the total (e.g. "VISA 56.95", "Cash", "Change") are how it was paid, not part of it.
    const totalAt = idxOf("total");
    const before = (l: ExtractedLine) => totalAt < 0 || lines.indexOf(l) < totalAt;
    const rounding = lines.filter((l) => l.kind === "rounding" && before(l)).reduce((s, l) => s + signed(l), 0);
    const prev = lines.filter((l) => l.kind === "previous_balance" && before(l)).reduce((s, l) => s + signed(l), 0);
    const paid = lines.filter((l) => l.kind === "payment" && before(l)).reduce((s, l) => s + signed(l), 0);
    const expected = base + (ex.tax_mode === "added" && tax != null ? tax : 0) + rounding + prev + paid;
    const d = total - expected;
    const tol = rounding !== 0 ? 1 : 5; // allow unprinted cash rounding to 5¢
    const ok = Math.abs(d) <= tol;
    const parts = [
      `${m(sub ?? chargeSum)} ${sub != null ? "subtotal" : "lines"}`,
      service ? `+ ${m(service)} service` : "",
      ex.tax_mode === "added" && tax != null ? `+ ${m(tax)} tax` : "",
      rounding ? `${rounding > 0 ? "+" : "−"} ${m(Math.abs(rounding))} rounding` : "",
      prev ? `+ ${m(prev)} previous` : "",
      paid ? `− ${m(Math.abs(paid))} paid` : "",
    ].filter(Boolean);
    checks.push({ name: "Everything adds up to the total", ok, maths: `${parts.join(" ")} = ${m(expected)}; printed ${m(total)}` });
    if (!ok && d > 0) {
      findings.push({
        id: "total",
        verdict: "wrong",
        lineIndex: idxOf("total") >= 0 ? idxOf("total") : null,
        title: "Total is more than the bill adds up to",
        maths: `${parts.join(" ")} = ${m(expected)}, but total printed ${m(total)}: ${m(d)} extra`,
        charged: fromCents(total),
        expected: fromCents(expected),
        diff: fromCents(d),
        ask: "refund",
      });
    }
  }

  // 6. Promise: shelf/menu price already included tax
  if (ex.tax_mode === "added" && tax != null && tax > 0 && total != null) {
    if (promise.pricesIncludeTax === true) {
      findings.push({
        id: "tax-on-top",
        verdict: "wrong",
        lineIndex: taxIdx >= 0 ? taxIdx : null,
        title: "Tax was added on top of prices that already included it",
        maths: `You were shown tax-inclusive prices, so expected ${m(total - tax)}; charged ${m(total)}: ${m(tax)} extra`,
        charged: fromCents(total),
        expected: fromCents(total - tax),
        diff: fromCents(tax),
        ask: "refund",
      });
    } else if (promise.pricesIncludeTax == null && service === 0 && INCLUSIVE_DISPLAY_COUNTRIES.has(ex.merchant_country ?? "")) {
      findings.push({
        id: "ask-inclusive",
        verdict: "info",
        lineIndex: taxIdx >= 0 ? taxIdx : null,
        title: `Tax (${m(tax)}) was added on top. Did the shelf/menu price already include tax?`,
        maths: `In ${ex.merchant_country}, shops usually must show tax-inclusive prices. If so, you'd owe ${m(total - tax)}`,
        charged: null,
        expected: null,
        diff: 0,
        ask: "none",
      });
    }
  }

  // 7. Promise: expected total
  if (promise.expectedTotal != null && total != null) {
    const exp = toCents(promise.expectedTotal);
    const d = total - exp;
    checks.push({ name: "Total vs what you expected", ok: d <= 1, maths: `Expected ${m(exp)}; charged ${m(total)}` });
    if (d > 1) {
      findings.push({
        id: "promise-total",
        verdict: "wrong",
        lineIndex: idxOf("total") >= 0 ? idxOf("total") : null,
        title: "Charged more than you were promised",
        maths: `Promised ${m(exp)}, charged ${m(total)}: ${m(d)} extra`,
        charged: fromCents(total),
        expected: fromCents(exp),
        diff: fromCents(d),
        ask: "refund",
      });
    }
  }

  // 8. Promise: expected price per line
  for (const [k, v] of Object.entries(promise.lineExpected)) {
    const i = Number(k);
    const l = lines[i];
    if (!l) continue;
    const d = toCents(l.amount) - toCents(v);
    if (d > 0) {
      findings.push({
        id: `promise-line-${i}`,
        verdict: "wrong",
        lineIndex: i,
        title: `"${l.description}" charged more than promised`,
        maths: `Promised ${m(toCents(v))}, charged ${m(toCents(l.amount))}: ${m(d)} extra`,
        charged: l.amount,
        expected: v,
        diff: fromCents(d),
        ask: "refund",
      });
    }
  }

  // 9. Late fee on a bill paid on time
  lines.forEach((l, i) => {
    if (l.kind !== "late_fee") return;
    if (promise.paidOn && ex.due_date && promise.paidOn <= ex.due_date) {
      findings.push({
        id: `late-${i}`,
        verdict: "wrong",
        lineIndex: i,
        title: "Late fee on a bill paid on time",
        maths: `Paid ${promise.paidOn}, due ${ex.due_date}; late fee ${m(toCents(l.amount))} should be ${m(0)}`,
        charged: l.amount,
        expected: 0,
        diff: l.amount,
        ask: "refund",
      });
    } else if (!promise.paidOn) {
      findings.push({
        id: `late-ask-${i}`,
        verdict: "info",
        lineIndex: i,
        title: `Late fee of ${m(toCents(l.amount))}. When did you pay the last bill?`,
        maths: ex.due_date ? `Due date on bill: ${ex.due_date}` : "No due date printed",
        charged: null,
        expected: null,
        diff: 0,
        ask: "none",
      });
    }
  });

  // 10. Lines the user doesn't recognise
  for (const i of promise.unrecognised) {
    const l = lines[i];
    if (!l) continue;
    findings.push({
      id: `unrec-${i}`,
      verdict: "unexplained",
      lineIndex: i,
      title: `You don't recognise "${l.description}"`,
      maths: `Charged ${m(toCents(l.amount))}; not requested`,
      charged: l.amount,
      expected: 0,
      diff: Math.abs(l.amount),
      ask: "explain",
    });
  }

  // 11. Same fee/subscription twice
  const seen = new Map<string, number>();
  lines.forEach((l, i) => {
    if (l.kind !== "fee" && l.kind !== "subscription") return;
    const key = `${l.description.trim().toLowerCase()}|${toCents(l.amount)}`;
    if (seen.has(key)) {
      findings.push({
        id: `dup-${i}`,
        verdict: "unexplained",
        lineIndex: i,
        title: `"${l.description}" appears twice`,
        maths: `Lines ${seen.get(key)! + 1} and ${i + 1}, each ${m(toCents(l.amount))}`,
        charged: l.amount,
        expected: 0,
        diff: l.amount,
        ask: "explain",
      });
    } else seen.set(key, i);
  });

  const pick = (v: Finding["verdict"]) =>
    findings.filter((f) => f.verdict === v).sort((a, b) => b.diff - a.diff)[0] ?? null;
  const primary = pick("wrong") ?? pick("unexplained");
  return {
    checks,
    findings,
    primary,
    outcome: primary ? (primary.verdict === "wrong" ? "dispute" : "query") : "all_ok",
    currency: cur,
  };
}
