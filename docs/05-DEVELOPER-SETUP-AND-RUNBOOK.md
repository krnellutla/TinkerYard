# 05 — Developer Setup, Testing & Operations Runbook

> **Scope:** Local development workflow, Neon Postgres & zero-config local fallback setup, Resend email templates, automated unit + E2E test verification, production Vercel deployment checklist, and failure runbook.

---

## 1. Prerequisites & 5-Minute Local Setup

1. **Runtime:** Node.js **20+** and `npm`.
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Create `.env.local`:**
   ```bash
   cp .env.example .env.local
   ```
4. **Minimal local env variables:**
   ```dotenv
   # Generate a 32+ character secret, e.g. `openssl rand -base64 32`
   BETTER_AUTH_SECRET=replace-with-random-32-char-secret
   BETTER_AUTH_URL=http://localhost:3000

   # Comma-separated bootstrap admin emails (bypasses DB invite lists)
   ADMIN_EMAILS=you@example.com

   # Vision/Text OCR & Review Scout (at least one key recommended)
   GEMINI_API_KEY=...
   # Optional fallback providers:
   # GROQ_API_KEY=...
   # OPENROUTER_API_KEY=...
   ```
5. **Start the dev server:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) (root landing page) or [http://localhost:3000/tallyback](http://localhost:3000/tallyback).

---

## 2. Database & Storage Modes (Neon Postgres vs. `.data/` Fallback)

Tinkeryard operates identically in local zero-DB mode and production Neon Postgres mode:

| Environment | `DATABASE_URL` | `BLOB_READ_WRITE_TOKEN` | Persistence Behavior |
| --- | --- | --- | --- |
| **Local Zero-Config** | Unset | Unset | Auth, TallyBack Bills, TallyBack Split, and Review Scout read/write JSON/SQLite-style local state under `.data/` (and in-memory/file storage for receipt images). |
| **Neon Branch (Dev/Preview)** | `postgres://...` (Neon dev branch) | Optional | App auto-creates tables via idempotent `ensure*` helpers (`ensureSchema()`, `ensureSplitTables()`, `ensureAuthTables()`, `ensureAccessTables()`) on first request. No manual Prisma/Drizzle migration CLI is needed. |
| **Production (Vercel + Neon)** | Neon Pooled Connection URL | `vercel_blob_rw_...` | Full PostgreSQL durability + private Vercel Blob image storage (`access: "private"`, proxied via `/api/tallyback/bills/[id]/photo` and `/api/tallyback/groups/[id]/expenses/[expenseId]/receipt`). |

> **Local Sign-In Without Resend:** When `RESEND_API_KEY` is omitted locally, `Auth/src/email.ts` logs the 6-digit OTP code and magic-link URL straight to the Next.js server terminal stdout/dev log so you can sign in immediately without configuring email DNS.

---

## 3. Transactional Email Setup (Resend Templates)

Email templates live under `emails/` and are referenced by Resend template IDs/aliases in `.env`:

| Env Variable | Template File | Template Variables |
| --- | --- | --- |
| `RESEND_TEMPLATE_SIGN_IN_CODE` | `emails/sign-in-code.html` | `CODE`, `MINUTES` (`10`) |
| `RESEND_TEMPLATE_SIGN_IN_LINK` | `emails/sign-in-link.html` | `SIGN_IN_URL`, `MINUTES` (`10`) |
| `RESEND_TEMPLATE_NOTIFICATION` | `emails/notification.html` | `APP_NAME`, `HEADING`, `MESSAGE`, `BUTTON_TEXT`, `BUTTON_URL`, `PREVIEW_TEXT` |

- `EMAIL_FROM` sets the verified sender (e.g. `Tinkeryard <noreply@tinkeryard.dev>`).
- `FEEDBACK_EMAIL` receives submissions posted via `POST /api/feedback`.

---

## 4. Build, Lint & Test Verification

### Core Commands (`package.json`)

| Command | Script | What It Runs |
| --- | --- | --- |
| `npm run dev` | `next dev` | Starts Next.js development server (`localhost:3000`). |
| `npm run build` | `next build` | Compiles App Router pages, bundles CSS/JS, validates TypeScript/route exports. |
| `npm start` | `next start` | Runs the production build locally. |
| `npm run lint` | `next lint` | Runs ESLint across the repository. |
| `npm test` | `tsx --test Tallyback/tests/*.test.ts Reviewscout/tests/*.test.ts Auth/tests/*.test.ts ui/*.test.ts` | Executes the full Node `node:test` suite via `tsx`. |
| `npx tsc --noEmit` | TypeScript check | Verifies strict types across `app/`, `Tallyback/`, `Auth/`, `Reviewscout/`, `ui/`. |

### Live Auth & Passkey E2E Scripts

Two headless Playwright verification scripts test passwordless auth, passkey registration, and RBAC against a running local Next.js server (reading OTP codes from the server log file):

```bash
# Test WebAuthn passkey enrollment & passwordless sign-in (run against isolated test port)
node Auth/scripts/passkey-e2e.mjs http://localhost:3102 dev.log alice@test.local

# Test role resolution, suspension session revocation & invite quota guards
node Auth/scripts/access-e2e.mjs http://localhost:3103 dev.log
```

### Vision Model Benchmarking (`Tallyback/scripts/bench-models.ts`)

Evaluate OCR speed and JSON compliance across configured providers against test receipts (`npx tsx Tallyback/scripts/bench-models.ts`). Detailed provider chains and free-tier quotas are documented in [03 — OCR & Receipt Pipeline](./03-OCR-RECEIPT-PIPELINE.md).

---

## 5. Deployment Checklist (Vercel + Neon + Resend)

1. **Environment Variables (Production):**
   - Set `DATABASE_URL` to your **Neon Serverless Postgres** connection string.
   - Set `BLOB_READ_WRITE_TOKEN` for Vercel Blob private receipt storage.
   - Set `BETTER_AUTH_SECRET` (high-entropy 32+ chars) and `BETTER_AUTH_URL=https://tinkeryard.dev`.
   - Set `ADMIN_EMAILS` (bootstrap admins) and optionally `ALLOWED_EMAILS`.
   - Set `RESEND_API_KEY`, `EMAIL_FROM`, `FEEDBACK_EMAIL`, and the three `RESEND_TEMPLATE_*` variables.
   - Set at least `GEMINI_API_KEY` (and optional `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`, `GITHUB_MODELS_TOKEN`, `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`).
2. **Routing & Domains (`next.config.ts`):**
   - Primary origin is `https://tinkeryard.dev`.
   - Legacy hostnames `tallyback.tinkeryard.dev` and `reviewscout.tinkeryard.dev` redirect (`307`/`308` permanent) to `/tallyback` and `/reviewscout`.
   - WebAuthn RP ID derives from `BETTER_AUTH_URL` hostname (`tinkeryard.dev`)—do not mismatch hostnames during sign-in.
3. **PWA & Mobile Viewport Verification:**
   - Confirm `/manifest.webmanifest` (`app/manifest.ts`) resolves `192x192` and `512x512` maskable icons under `public/`.
   - Verify `viewport-fit=cover` (`app/layout.tsx`) and bottom safe-area padding (`env(safe-area-inset-bottom)`) on iOS Safari Standalone mode.

---

## 6. Operations Troubleshooting Runbook

| Symptom | Likely Cause | Resolution |
| --- | --- | --- |
| **OCR scan returns `429` ("busy right now")** | Primary Gemini Vision free/RPM quota exhausted and fallback chain either exhausted or lacks additional provider keys. | Add secondary provider keys (`GROQ_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`) to `.env` or customize `LLM_VISION_CHAIN` (see [03 — OCR Pipeline](./03-OCR-RECEIPT-PIPELINE.md)). |
| **OCR returns `503` ("isn't set up yet")** | No vision LLM keys configured in environment. | Set `GEMINI_API_KEY` (or any vision provider key) and restart Next.js. |
| **User receives `403` after sign-in** | User email is not in `ADMIN_EMAILS`, `ALLOWED_EMAILS`, or `ty_access` (`status: "active"`), or their access was suspended. | Have an admin add or reactivate the email in `/admin` (`POST /api/admin/people`) or add to `ALLOWED_EMAILS`. |
| **Invite button disabled for a member** | Either `INVITES_PER_PERSON` quota (default `3`) is used up, OR the member has not registered a WebAuthn passkey yet (`hasPasskey: false`). | Non-admin members must register at least one passkey in account settings before sending friend invites. |
| **Receipt photo returns `404` inside Split group** | Either the signed-in user is not an active member of the group, or the receipt's original `bills` row was deleted (`receipt_bill_id` points to a missing/orphaned bill). | Confirm group membership in `sb_members`; re-attach a live receipt via `PATCH /api/tallyback/groups/[id]/expenses/[expenseId]`. |
| **Review Scout returns `429` ("YouTube is limiting transcript downloads")** | Cloud IP rate-limiting on YouTube transcript fetch (`RATE_LIMITED`). | Wait a few minutes or lower `nVideos` (2–3 videos instead of 8). |
| **Passkey prompt fails with origin/RP mismatch** | `BETTER_AUTH_URL` does not match the hostname in the browser address bar (e.g. `localhost` vs `127.0.0.1` or preview URL vs prod domain). | Align `BETTER_AUTH_URL` with the active request origin. |
