# TallyBack Mobile (iOS + Android): Launch Plan

> Combined plan from three reviews: **product** (scope, pricing, metrics), **UX** (flows, trust, consent) and **senior architecture** (code reuse, AI pipeline, data, payments).
> Where the reviewers disagreed, the decision taken here is marked **Decision**.
> Scope, pricing and the AI design in this document take precedence over [07 — Mobile Design Plan](./07-MOBILE-DESIGN-PLAN.md). Doc 07 is still the reference for the screen catalogue.
> Prices, store fees, AI costs and model sizes are estimates. Re-check them before committing money.

---

## 1. Product in one line

**"Snap your bill, find out if it adds up, and split it in seconds, even offline."**

| | |
|---|---|
| **Primary user** | The group-dinner organiser and Southeast Asia traveller: at the table, one hand free, dim light, patchy roaming signal, tax and service charge stacked on the bill. |
| **Secondary users** | Friend groups of 3–8 people who want a fast fair split, and flatmates or couples keeping a running tally. |
| **Differentiator** | A deterministic overcharge check ([`checks.ts`](../Tallyback/src/lib/checks.ts)): qty × price, items vs subtotal, VAT included vs added, service charge, and total. Splitwise-style apps don't have it. |
| **Principle** | **AI reads, code decides.** A model only reads the receipt. Every number is checked by tested TypeScript before the app says anything. |

## 2. The core loop

```
Camera ─► Reading ─► Review (+ issues) ─► Saved ─► Split (optional) ─► Share
 auto-     3–8 s       1 tap Save            toast     "Split equally"     WhatsApp /
 capture   cloud,      or Fix + Save         + Undo    = 1 tap             share sheet
           20–60 s
           on-device
```
**Target:** from scan to saved in under 20 s, with no more than 3 taps after the photo.

## 3. MVP scope

| Must (v1) | Should (v1.x) | Later |
|---|---|---|
| Camera with edge detection, plus import from photos | Downloadable on-device model (§6) | Accounts and cloud sync across devices |
| Line items, tax and service charge, each editable inline | Currency per bill and a manual FX rate | Shared groups where friends have their own logins |
| Bill check with a plain verdict and the maths shown | Groups or trips with running balances and settle-up | Multi-currency trips with live FX |
| "Show to staff" full-screen view | Export one bill as an image or PDF | Passkeys, Bar Rounds, CSV, Review Scout |
| Bills stored locally with the photo, searchable | | Multi-photo receipts, duplicate detection |
| Quick split between named people: **equal by default**, itemised second | | |
| Share a summary on WhatsApp | | |
| 5 free scans, then the unlock, plus restore purchases | | |
| Clear privacy notice for cloud reading | | |

**Decision: v1 has no account.** The app works local-first and no login is needed. This avoids three web-app blockers flagged by the architect:
- sign-up is invite-only (`ALLOWED_EMAILS` / `policy.ts`);
- every API action requires an account (`appUser`);
- Apple requires in-app account deletion once accounts exist.

Accounts, sync and shared groups arrive in v1.x. The cost is that bills on a lost phone are gone, so add export and backup soon after launch.

## 4. Pricing

**Decision: free download, 5 free scans, then a US$1.99 lifetime unlock** (a one-time in-app purchase, no subscription). If the first ~300 users hit the paywall, test $0.99 / $1.49 / $1.99.

| | |
|---|---|
| Net per sale | About **$1.69** after the 15% small-business store fee. Set local price tiers deliberately for Southeast Asia. |
| Fixed costs | Apple $99 a year and Google $25 once. About 60 sales cover them. |
| Cost per cloud scan | Under $0.01 with text-only calls to a Flash-Lite-class model; images are sent only as a fallback. **Verify current pricing.** |
| The risk | A lifetime price with unlimited cloud scans has an unbounded cost. |
| Guardrails | <ul><li>Fair-use cap of about 30 cloud scans a month</li><li>On-device scanning is unlimited (cost ≈ $0)</li><li>Per-install quota enforced on the server, with a kill switch</li><li>Optional $0.99 top-up pack later</li><li>Use the paid Gemini tier: free-tier terms can allow training on your data</li></ul> |
| Free forever | Manual entry, viewing saved bills, and "Show to staff". |
| Paywall placement | Shown **after the 5th successful Review**, so users have already seen the value. Never during capture, never while offline. Copy: "Unlock unlimited scans — one payment, no subscription." |

## 5. UX rules that protect trust

**Issue language is calm, never accusing.** Use three levels, each shown with an icon and a word as well as colour:

| Level | When | Style |
|---|---|---|
| **Note** | rounding of 1–2 units | grey |
| **Worth a look** | difference under 5% | amber |
| **Likely mistake** | difference of 5% or more, or a double charge | deep orange, never red |

Each issue shows the maths and one-tap fixes:
```
Items add to  ₱2,880
Bill says     ₱3,080
Difference      +₱200  (extra)
[ Use items total ]  [ Edit a line ]  [ This is fine ]
```

**Never accuse a merchant over a misread** (architect's top product risk). Today, `checks.ts` reports *wrong* or *dispute* whenever the total exceeds the computed sum. If the reading is less certain (§6 confidence), downgrade every finding to *"Possible misread — compare with the photo"* until the user confirms the numbers.

**Show to staff:** a full-screen view in large type, staying awake. It shows the 3-line calculation and "Could you please check this?", in the local language where known.

**Itemised split on a phone**
- One big **"Split equally"** button first.
- Itemised split:
  - Tap an item, then tap faces. Or pick a face first and "paint" items onto it.
  - Long-press an item to share it with everyone.
  - Tax and service are spread in proportion to items.
  - A sticky "Unassigned: 2 items" chip shows what's left.
- People are names only; no accounts needed.

**One hand:** primary actions sit in the bottom 40% of the screen, with tap targets of 48 dp or more. Text scales to 200%. Screen readers read the maths as one sentence.

## 6. AI pipeline: "a lite model the user downloads knowingly"

```
VisionKit / ML Kit document scanner ─► on-device OCR (Apple Vision / ML Kit Text v2)
   ─► mask card numbers (mask.ts) ─► Extractor router
        0. heuristic row parser (no model, instant, offline)
        1. Apple Foundation Models (iOS 26+, Apple Intelligence devices, built in, no download)
        2. Gemini Nano via ML Kit GenAI (supported Android flagships, system-managed)
        3. Downloaded open model via llama.rn (Qwen3-1.7B / Qwen2.5-1.5B Q4 GGUF, ~1.0–1.2 GB, Apache-2.0)
        4. Cloud: existing Next.js scan API, masked OCR text only (image only as a last resort)
   ─► parseJsonLoose ─► normalize ─► zod ExtractionSchema ─► confidence gate ─► runChecks ─► SQLite
```

**Confidence is computed in code, not by the model.** The reading must pass all of these:
1. the output matches the schema;
2. **every amount appears verbatim in the OCR text** (this catches made-up numbers);
3. lines, subtotal and total reconcile within the `checks.ts` tolerances;
4. the line count is plausible.

If grounding is below about 0.9, or the totals don't reconcile, the router tries the next engine. If none passes, the bill is marked "needs your review".

**Downloaded model: what the user sees and when**

| | |
|---|---|
| **When it's offered** | Never during onboarding. Offered the first time the user is offline or a scan is slow, or as a dismissible card after the 2nd–3rd scan. Always available in Settings › Offline scanning. |
| **What the sheet shows** | <ul><li>Exact size (about 1.1 GB)</li><li>Free space on the phone</li><li>Wi-Fi only (on by default)</li><li>"Receipts never leave your phone" and "Works on planes and abroad"</li><li>Honest caveat: "Cloud may read messy receipts better"</li><li>Model licence</li></ul> |
| **Consent** | One **Download** button and an equally prominent **Not now**. Nothing is pre-ticked. After "Not now", no reminder for 30 days. |
| **Download** | Resumable and continues in the background. Pauses itself when Wi-Fi drops. Progress shown with size remaining. |
| **Remove** | One tap in Settings ("frees 1.1 GB"). |
| **Device gate** | 6 GB RAM or more and 64-bit: roughly iPhone 13 Pro / 14 and later, and Android phones with Snapdragon 8-class chips. Other phones never see the offer. |
| **Speed** | About 10–20 tokens/s, so 20–60 s per receipt, shown with a progress screen. Built-in engines (1, 2) and cloud are faster. |
| **Hosting** | Cloudflare R2 (no egress fees), with Hugging Face as a mirror. A signed manifest (Ed25519 key built into the app) lists sha256, size, licence and minimum app version. The download goes to a `.part` file, is hashed as it streams, then renamed. The model file is excluded from phone backups. |
| **Store policy** | The weights are **data** read by the llama.cpp runtime bundled in the app, not executable code, so this is consistent with App Store 2.5.2 and Play's rule on downloaded code. Declare it in privacy labels and the Play data-safety form. The scan must still work without the model, so reviewers can test it. |

## 7. Architecture

```
apps/mobile (Expo dev-client + HeroUI Native)        apps/web (Next.js 15 on Vercel, unchanged UX)
  screens · SQLite (expo-sqlite + Drizzle)             scan API (+ install quota, entitlement check)
  native modules: scanner, OCR, Foundation Models,     RevenueCat webhook → entitlements table (Neon)
  ML Kit GenAI, llama.rn · model download manager      later: /api/sync push/pull, Better Auth Expo
            │ imports                                         │ imports
            ▼                                                 ▼
  packages/core (pure TS + zod; no Node or DOM APIs)
    bills/  checks normalize taxRules message history mask prompts extraction(zod)
    split/  money split balances fromBill receipt types schemas(zod)
    scan/   Extractor interface · router · confidence · heuristic parser
```

**Code-reuse facts from the architect's read of the repo**
- The bill and split maths is already pure TypeScript and can move as-is, with re-export shims at the old paths so the 106 tests and the web app keep working.
- Things to fix before moving:
  - `split/lib/service.ts` mixes zod schemas with database code. Split it into `schemas.ts` (core) and `service.ts` (server).
  - `models.ts` mixes neutral prompts and schema with server provider calls. Move the neutral parts to core and add a **zod `ExtractionSchema`**, which doesn't exist yet.
  - Two different `toCents` functions exist in `lib/money.ts` and `split/lib/money.ts`. Rename one.
  - `toLocaleString` output differs on Hermes, React Native's JavaScript engine. Pin it with tests or hand-roll the formatter.
  - The web auth client (`better-auth/react` plus browser passkeys) needs its own mobile version, but not in v1.

**No-account v1 quota:**
- Cloud scans are keyed to the RevenueCat app user ID, backed by **App Attest / Play Integrity** so the quota can't be faked.
- The server checks entitlement and quota before calling Gemini.

**Data:** SQLite is the source of truth, with UUIDv7 IDs and integer cents. Receipt photos are downscaled to about 2000 px and **stay on the phone** unless the user shares a bill or turns on backup. Later sync uses an outbox and an append-only ledger, so balances are derived and never conflict.

## 8. Success metrics (first 90 days)

| Metric | Target |
|---|---|
| Activation: first scan within 24 h | ≥ 60% of installs |
| Scan success: reconciles with ≤ 2 corrections | cloud ≥ 85%, on-device ≥ 70% |
| Bills flagged | 10–20% (below 5% means the checks are too lax; above 30% means misreads are causing false flags) |
| Flags the user confirms as real | ≥ 70% |
| Bills split | ≥ 30% of saved bills |
| Paywall → purchase | 20–30% (4–6% of all installs) |
| D30 retention | ≥ 15%; trip re-activation at D90 ≥ 25% |
| Cloud cost per paying user | < $0.30; refunds < 5% |
| Crash-free sessions / store rating | ≥ 99.5% / ≥ 4.5 |

## 9. Roadmap (solo developer working with AI, about 16 weeks)

| Phase | Weeks | Deliverable | Gate to continue |
|---|---|---|---|
| **0. Validate** | 1–2 | Collect ≥ 100 real Southeast Asia receipts. Measure cloud accuracy and the checks' false-flag rate. Run a llama.rn spike on two phones. Measure cost per scan. | Cloud success ≥ 80%, false flags < 10% |
| **1. Shared core** | 2–3 | npm workspaces, `packages/core` with shims, zod `ExtractionSchema`, `service.ts` split, `toCents` fix. **106 tests green.** | Web app unchanged in production |
| **2. Core loop** | 3–7 | Expo app with HeroUI Native: scanner, OCR, heuristic parser, cloud path, Review with issues, Show to staff, SQLite, equal and itemised split, WhatsApp share | A friend completes scan → split unaided in < 90 s |
| **3. Monetise + harden** | 8–10 | Server quota and kill switch, App Attest / Play Integrity, RevenueCat unlock and restore, privacy labels, analytics, crash reporting | Purchase works on both stores in test mode |
| **4. Beta + launch** | 11–13 | TestFlight and Play internal testing with 30–50 travellers, fix accuracy issues, store listing with screenshots showing the check and the split. Soft launch in SG, PH, TH. | Activation ≥ 50%, no store rejections |
| **5. On-device AI** | 14–16 | Apple Foundation Models and ML Kit GenAI behind the interface, then llama.rn with the consent sheet, download manager, signed manifest and device gate | On-device success ≥ 70%; consent flow approved in review |
| **6. Grow** | 17+ | Accounts (Better Auth Expo, public sign-up), sync, shared groups, trips and FX, price test; chosen from beta feedback | |

**Why on-device AI comes last:** it's the riskiest and most device-dependent part. Cloud plus the heuristic parser proves the loop and earns revenue first. The phase-0 spike still runs early, so phase 5 isn't a surprise.

## 10. Top risks

| Risk | Mitigation |
|---|---|
| Misreads on crumpled, Thai, Vietnamese or handwritten receipts produce false "overcharge" flags | Amount grounding, downgrading findings to "possible misread", low-confidence fields underlined, the 100-receipt test set as a launch gate |
| Cloud cost exceeds a one-time $1.99 | Fair-use cap, text-only calls, attested install quota, kill switch, nudging heavy users to on-device |
| Store review: AI, model download, privacy | Weights as data, explicit consent, accurate labels, the scan works without the model, reviewer notes |
| Receipt photos contain card digits and names | Photos stay on the phone, `maskDigits` before any cloud call, no server-side retention, paid API tier with no training on data |
| Solo-developer scope creep | Freeze scope at the Must list, reuse the core, ship cloud first |

## 11. Next 3 actions
1. Start collecting the receipt test set and run the cloud and false-flag baseline (phase 0).
2. Run the llama.rn spike: one Qwen ~1.5B Q4 model on one iPhone and one Android phone, using 20 receipts.
3. Create `packages/core` with shims (phase 1). This is low-risk and the web app benefits too.
