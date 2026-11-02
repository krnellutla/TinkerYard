# By-hand #1 — Santhosh (outside cohort)

**Bills:** 2 grocery tax invoices, Velan Mini Super Mart, Singapore (S$), paid by Visa
- R1 HQ0225799, 08/10/2026, 13 lines, total S$60.60
- R2 HQ0234729, 12/10/2026, 18 lines, total S$56.95

**Promise:** none stated yet. *Ask Santhosh what he expected / what made him doubt it.*

## Maths (computed in code, not by eye)
| Check | R1 | R2 | Result |
|---|---|---|---|
| Sum of line amounts | 60.60 | 56.95 | ✅ |
| Printed subtotal | — | 56.94 | ⚠️ 1¢ below line sum (store rounds each line; subtotal uses unrounded weight × price) |
| Rounding → total | 60.60 | +0.01 → 56.95 | ✅ matches line sum; SG cash rounding to 5¢ |
| GST included = total × 9/109 | 5.00 | 4.70 | ✅ (SG GST 9%) |
| Qty total | 7.77 vs printed 7.80 | 11.79 | ✅ weights printed to 2 dp, scale uses 3 dp, 13 lines × ±0.005 kg |
| Same item, both days ($/kg range) | | | Carrot, bottlegourd, beans, drumstick, brinjal ✅ same price |
| | Coriander 13.31–14.30 | 12.54–13.26 | ⚠️ price ~5–7% lower on 12/10: price change, not a mischarge (≤1¢ effect) |
| | Yam Small 6.45–6.55 | Yam 6.24–6.35 | different SKU names, not comparable |

## Verdict
**Every line checks out.** Customer paid exactly the sum of the line items, and the GST is correct.
No message to the store is warranted. Inventing one would be the "inventing an error" trap.

## Message to Santhosh
> Hi Santhosh, went through both Velan receipts (8 Oct and 12 Oct) line by line.
> 8 Oct: 13 items add up to exactly S$60.60, GST S$5.00 is correct at 9%.
> 12 Oct: 18 items add up to S$56.95, which is what you paid; GST S$4.70 is correct.
> Prices for the same veg (carrot, beans, drumstick, brinjal, bottlegourd) match across both days.
> Nothing to dispute 👍 Was there a specific item you thought was off?

## What this taught us (product surprises)
1. **"Promise" must be broad.** BillShield takes *any* bill. The promise can be a plan price, a shelf/advertised price, a promo ("2 for $5"), a quote, a menu price, or just "what I expected to pay". When none is given, code still runs the internal checks (sum, tax, rounding, repeat-item unit price), and the app should ask "what did you expect to pay for this?" to get a promise.
2. **Tolerances are needed.** Subtotal vs line sum is off by 1¢ and printed qty is off by 0.03 by design. Code must use a tolerance (e.g. ≤ 1¢ per line, ≤ 0.005 per weighed qty) or it will flag false errors.
3. **Currency and tax regime vary.** S$ + GST 9% *inclusive* (9/109), not ₹ + 18% added on top. Tax rules must be data, not hard-coded.
4. **Unit price across bills** is a code-only check that a model would never do reliably; worth keeping for "charges that repeat across months".
