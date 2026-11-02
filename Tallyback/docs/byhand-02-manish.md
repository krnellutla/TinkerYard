# By-hand #2: Manish (outside cohort)

**Bills:** 2 receipts, Singapore (S$), both 12/10/2026
- R3 FairPrice Finest, Tampines, FP202610120987, 10 lines, Mastercard S$36.80
- R4 The Daily Brew Café, Rivervale, DB202610120456, 5 lines, Visa S$30.02

**Promise:** not stated yet. *Ask Manish: what price did the shelf / menu show?*

## Maths (computed in code)
| Check | FairPrice | Daily Brew | Result |
|---|---|---|---|
| qty × unit price = amount (per line) | all 10 ✅ | all 5 ✅ | ✅ |
| Line sum = subtotal | 34.07 | 27.80 | ✅ |
| 8% × subtotal = GST printed | 2.73 | 2.22 | ✅ arithmetic |
| Subtotal + GST = total | 36.80 | 30.02 | ✅ arithmetic |
| **GST rate vs law** | 8% | 8% | ⚠️ SG GST has been **9% since 1 Jan 2024**. At 9%: 37.14 / 30.30 |
| **GST added on top vs shelf/menu price** | +2.73 | +2.22 | ⚠️ depends on the promise (below) |

## The judgement call (wrong vs unexplained)
- **Supermarket (FairPrice):** SG rules require GST-registered retailers to display GST-*inclusive* prices.
  If the shelf said S$4.95 for milk, the customer should pay S$34.07, not S$36.80. **Possible overcharge: S$2.73.**
  → *Unexplained* until Manish confirms the shelf prices. Becomes *wrong* if he confirms.
- **Café:** F&B outlets may show "++" menu prices (GST/service charge added at the till). If the menu showed "++", adding GST is fine.
  → Ask Manish whether the menu said "++".
- **8% vs 9%:** the receipt applies an outdated rate. That *undercharges* the customer (by S$0.34 / S$0.28) but means the tax invoice is incorrect.
  Not worth a complaint from the customer's side. Worth a note in the app.

## ⚠️ Authenticity check: ask before counting this as a golden pair
Signs these may be generated sample receipts, not real ones:
- Tel `6788 1234`, barcode `1234567890123`
- Receipt numbers are date-patterned (`…20261012…`) on both
- Both use 8% GST, two years after the rate changed to 9%

The brief says *"A sample bill from the internet"* doesn't count. Ask Manish directly.

## Message (draft, only if Manish confirms the shelf price was inclusive)
> Hi FairPrice, receipt FP202610120987 (Tampines Central, 12 Oct 2026) adds GST of S$2.73 on top of a subtotal of S$34.07.
> Shelf prices are shown GST-inclusive, so I expected to pay S$34.07, not S$36.80.
> The receipt also applies GST at 8% instead of the current 9%.
> Please refund S$2.73 to my Mastercard and confirm. Thanks, Manish

## What this taught us
1. **Arithmetic can be perfect and the bill still wrong.** The error lives in the *rule* (rate, inclusive vs exclusive), not the sums. Code needs a rules table: country → GST rate by date, display rule by merchant type.
2. **The promise decides the verdict.** The same receipt is *fine* or *S$2.73 over* depending on what the shelf said. The app must ask for it.
3. **The rate depends on the date.** Tax rate must be looked up by bill date, not hard-coded.
4. **Authenticity check.** Test users may send sample or generated bills. A gentle "is this a real receipt you paid?" belongs in onboarding.
