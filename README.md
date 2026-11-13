# Tinkeryard

> **TallyBack** (AI receipt auditing + Splitwise-grade group expense ledger) and **Review Scout** (grounded YouTube review synthesizer), built on **Next.js 15 App Router**, **Neon Serverless Postgres**, **Vercel Blob**, and **Better Auth** (Email OTP + Magic Link + WebAuthn Passkeys).

---

## Core Capabilities

- **Receipt OCR & Audit (`Bills`):** Multi-photo receipt capture (up to 3 photos, 8 MB each) processed via a multi-provider Vision LLM chain (`GEMINI_API_KEY`, Groq, OpenRouter, GitHub Models, Mistral, Cloudflare) with deterministic cent-precision arithmetic verification (`items + tax + fees − discount == total`), duplicate detection, and fact-verified dispute message drafting.
- **Itemized Group Splitting (`Split`):** Integer-cent financial ledger (`sb_groups`, `sb_members`, `sb_expenses`, `sb_tabs`) supporting Equal, Exact, Percent, Shares, and **By Receipt Items** splitting (with proportional tax/tip allocation and a non-drinker `🍺` toggle), multi-currency conversion, Trip mode, Bar Rounds (`sb_tabs`), Debt Simplification, 1-tap WhatsApp summary, and formula-safe CSV export.
- **Audit Shield:** Attach scanned bills (`receipt_bill_id`) directly to group expenses while enforcing strict group-membership IDOR checks on receipt photo streams.
- **Mobile-First PWA + Responsive Shell:** Edge-to-edge standalone iOS/Android PWA (`app/manifest.ts`, `100dvh`, `safe-area-inset-*`) scaling seamlessly into two-column iPad and desktop layouts.
- **Invite-Only Auth & Access Control:** Better Auth passwordless 6-digit email OTP, magic links, WebAuthn passkeys (`residentKey: "required"`), admin people management (`/admin`), and passkey-gated friend invites (`INVITES_PER_PERSON`).
- **Review Scout (`/reviewscout`):** Fetches and synthesizes YouTube review transcripts and viewer comments into grounded Q&A threads.

---

## 5-Minute Quickstart

1. **Prerequisites:** Node.js **20+** and `npm`.
2. **Install & configure environment:**
   ```bash
   npm install
   cp .env.example .env.local
   ```
3. **Set minimal env vars in `.env.local`:**
   ```dotenv
   BETTER_AUTH_SECRET=replace-with-32-char-random-secret
   BETTER_AUTH_URL=http://localhost:3000
   ADMIN_EMAILS=you@example.com
   GEMINI_API_KEY=your-gemini-api-key
   ```
   - *Database optional locally:* Omit `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` to run against local `.data/` storage, or point `DATABASE_URL` to a **Neon Serverless Postgres** branch (tables auto-create on first request).
   - *Email optional locally:* Omit `RESEND_API_KEY` to print 6-digit OTP codes and magic links directly to the server terminal log.
4. **Run the app & tests:**
   ```bash
   npm run dev     # http://localhost:3000 (landing) & /tallyback
   npm test        # Full unit test suite across TallyBack, Auth, ReviewScout, ui
   ```

---

## Application & Developer Bible (`/docs`)

| Guide | What It Covers |
| --- | --- |
| [**01 — Architecture & Stack**](./docs/01-ARCHITECTURE-AND-STACK.md) | System diagram, Next.js App Router + module boundaries (`Tallyback/`, `Auth/`, `Reviewscout/`, `ui/`), RSC/client split, PWA & mobile viewport patterns. |
| [**02 — Database Schema & Ledger**](./docs/02-DATABASE-SCHEMA-AND-LEDGER.md) | Neon Serverless Postgres & `.data/` dual-mode DAL, full ERD (`bills`, `sb_*`, `ty_*`, `searches`), integer-cent allocation math, proportional itemized splitting, and debt simplification. |
| [**03 — OCR & Receipt Pipeline**](./docs/03-OCR-RECEIPT-PIPELINE.md) | Vision/text fallback chains (`LLM_VISION_CHAIN`, `LLM_TEXT_CHAIN`), prompt/JSON extraction schema, deterministic arithmetic reconciliation, and provider/model swapping. |
| [**04 — API & Configuration**](./docs/04-API-AND-SERVER-ACTIONS.md) | Complete HTTP route catalog, Zod validation contracts, Better Auth / RBAC / IDOR guards, and environment variable map. |
| [**05 — Developer Setup & Runbook**](./docs/05-DEVELOPER-SETUP-AND-RUNBOOK.md) | Neon branch setup, Resend templates (`emails/`), Playwright passkey/access E2E tests, production deployment checklist, and failure troubleshooting. |
| [**06 — Application User Manual**](./docs/06-APPLICATION-USER-MANUAL.md) | End-user guide for Sign-In, Invites, PWA install, `Bills` auditing, `Split` itemized splitting, Trip mode, Bar Rounds, settlements, and Review Scout. |
| [**07 — Mobile Design Plan**](./docs/07-MOBILE-DESIGN-PLAN.md) | Complete iOS & Android native mobile product specification & 18-screen navigation blueprint for TallyBack (`Bills` + `Split`). |
