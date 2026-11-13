# 06 — Tinkeryard Application User Manual

> **Who this guide is for:** End users and group organizers using **TallyBack** (Receipt Auditing + Group Expense Splitting) and **Review Scout** across iPhone/Android (PWA), iPad/tablet, and desktop browsers.

---

## 1. Getting Started & Invite-Only Sign-In

Tinkeryard is private and invite-only. You do not manage passwords—sign-in uses email codes, magic links, or Face ID / Touch ID passkeys.

1. Open [tinkeryard.dev](https://tinkeryard.dev) (or click your friend's invite link).
2. Enter your email address to receive a **6-digit sign-in code** (valid for **10 minutes**, up to 3 attempts) and a **one-tap sign-in link**.
3. **Optional — Register a Passkey (Recommended):**
   - After signing in, register Face ID, Touch ID, Windows Hello, or a hardware security key from your account bar.
   - Next time you open Tinkeryard, one tap signs you in across your browser or Home Screen PWA.
4. **Inviting Friends:**
   - Once you have a registered passkey, open **Invites** to invite up to **3 friends** by email (default quota).
   - You can revoke an invite any time before your friend signs in.

### Installing on Mobile (iPhone & Android PWA)

- **iPhone / iPad (Safari):** Tap **Share** → **Add to Home Screen**. TallyBack launches edge-to-edge without browser chrome.
- **Android (Chrome):** Tap the browser menu (**⋮**) → **Install app** / **Add to Home screen**.

---

## 2. TallyBack: Tab 1 — Bills (Receipt Audit & Dispute)

Use **Bills** whenever you check a restaurant check, bar tab, grocery receipt, or hotel folio against what you ordered or were promised.

1. **Upload or Capture Receipt Photos:**
   - Tap **Scan a bill** to take up to **3 photos** of a long or multi-page receipt (up to 8 MB each).
   - *(Optional)* Before or after scanning, fill in **What you were promised** (e.g. *"Happy hour 20% off drinks"*, *"Free dessert coupon"*, or itemized expected prices).
2. **Automatic Audit Findings:**
   - TallyBack reads every line item, subtotal, discount, tax, service fee, tip, and printed total, then runs arithmetic and promise checks:
     - **Overcharge / Math Mismatch:** Flags if line items don't add up to the subtotal, or subtotal + tax + fees − discount doesn't equal the printed total.
     - **Duplicate Charges:** Highlights repeated identical items for quick confirmation.
     - **Missed Discounts / Surcharges:** Checks promised happy-hour or coupon terms and unrequested auto-gratuities.
3. **Edit & Re-Check:**
   - Fix any misread line price or quantity inline; checks update deterministically without re-scanning.
4. **Draft & Send a Dispute Message:**
   - Pick a tone (**Friendly**, **Direct**, or **Firm**) and generate an audit message citing **only verified numbers from your bill** (guaranteed zero invented prices).
   - Copy or send straight to **WhatsApp** or **Email**.
5. **Send to Split in One Tap:**
   - Tap **Split this bill** on any saved bill to launch a pre-filled itemized split with your group (`billToDraft()`).

---

## 3. TallyBack: Tab 2 — Split (Group Expenses & Settlements)

Use **Split** for dinners, roommates, weekend trips, bar nights, and shared apartments.

### 3.1 Groups & Members
- **Create a Group:** Name your group, pick type (`Trip`, `Home`, `Couple`, or `Other`), and select the base currency (e.g. `USD`, `INR`, `EUR`, `GBP`).
- **Add People:** Add friends by name alone (great for casual trips) or attach their email so their balance syncs directly into their own Tinkeryard account when they sign in.
- **Restore & Archive:** Deleted groups or expenses can be undone cleanly without corrupting historical settlement math.

### 3.2 Adding Expenses & Splitting Methods

Tap **+ Add Expense** inside a group and pick whoever paid (supports **multiple payers** paying partial amounts):

| Split Mode | Best For | How It Works |
| --- | --- | --- |
| **Equal** | Shared rides, groceries, Utilities | Divides total evenly down to the exact cent (any spare pennies are assigned deterministically). |
| **Exact** | Someone covered one specific item | Enter exact amounts per person; must sum to the expense total. |
| **Percent (%)** | Rent split by room size | Assign percentage shares summing to `100%`. |
| **Shares** | Weighting adults vs. kids / portions | Enter ratios (e.g. `2x`, `1x`, `1x`). |
| **By Receipt Items** | Restaurant bills & group takeout | Assign each receipt line to one or more people, toggle **🍺 non-drinker exclusion**, and distribute tax, tip, and fees **proportionally** to each person's pre-tax subtotal. |

### 3.3 Travel & Special Modes
- **Multi-Currency Expenses:** Paid in `JPY` or `EUR` for a `USD` trip group? Pick the foreign currency; TallyBack fetches live rates (or lets you override the rate) and converts into the group's base currency.
- **Trip Mode (Dates & Budget):** Turn on **Trip mode** in group settings to track trip start/end dates and view spending against a target budget.
- **Bar Rounds ("Who's Next?"):**
  - Start **Rounds** with the people at the table.
  - TallyBack suggests who should buy the next round based on current group balances (`payOrder`), prevents accidental double-taps across phones, lets you **Pass** a turn or **Undo** the last round, and optionally auto-records each paid round as a group expense.
- **Audit Shield:** Attach a scanned bill (`receipt_bill_id`) directly to any group expense so group members can verify the original receipt image and line items without downloading or leaking outside the group.

### 3.4 Settling Up & Sharing
- **Simplify Debts (Default On):** Automatically collapses multi-person IOUs (e.g. A → B → C becomes a single A → C transfer) while guaranteeing identical net balances. Toggle off anytime to see direct pairwise debts.
- **Settle Across All Groups:** On the **Friends** view, tap **Settle up** for any friend to record settling payments across every shared group in that currency at once.
- **1-Tap WhatsApp Summary & CSV Export:** Share a clean plain-text tally to WhatsApp or download a formula-safe CSV ledger (`Export CSV`) for spreadsheets.

---

## 4. Review Scout (Web / Desktop)

> Available to users with the `reviewscout` app permission at `/reviewscout`.

1. Enter any product or category (e.g. *"Sony WH-1000XM5 vs Bose QC Ultra"*), choose **2–8 videos**, and optionally include top YouTube viewer comments.
2. Review Scout gathers captions/transcripts from the top reviews, displays which videos were read vs. skipped, and writes a structured **Pros / Cons / Who Should Buy / Consensus** summary.
3. Ask follow-up questions in the thread (e.g. *"What do reviewers say about mic quality in wind?"*); every answer stays grounded strictly in the collected video corpus.

---

## 5. Responsive Experience Across Devices

- **Mobile Phones (iOS / Android):** Bottom-docked navigation and sheets tailored for one-handed thumb reach, respecting notch and Home Indicator safe areas (`100dvh`), and `16px+` inputs to avoid Safari auto-zoom.
- **iPad & Desktop:** Expands automatically into side-by-side panes (bill photo beside extracted line items; group list beside active ledger & debt summary) without losing state.
