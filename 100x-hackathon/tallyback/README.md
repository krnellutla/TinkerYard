# TallyBack: developer notes

User-facing overview: [../README.md](../README.md). Handover: [../docs/HANDOVER.md](../docs/HANDOVER.md).

This app also hosts **Review Scout** at `/review-scout` (see [Review Scout](#review-scout) below). A switcher at the top links the two.

## Run
```bash
cp .env.example .env.local   # GEMINI_API_KEY required; GROQ_API_KEY, DATABASE_URL, BLOB_READ_WRITE_TOKEN optional
npm install
npm run dev                  # http://localhost:3000
npm test                     # node:test via tsx: checker, verifier, history, real scans
npm run build
```
Without any AI key, only "Try a sample receipt" works. Without `DATABASE_URL`, rows go to `.data/db.json` and photos aren't kept; with it but without Blob, photos go to the `bill_photos` table.

## Environment
| Variable | Needed | Notes |
|---|---|---|
| `GEMINI_API_KEY` | yes | Main reader and writer |
| `GEMINI_MODEL` | no | Default `gemini-3.8-flash`; falls back to `gemini-3.5-flash`, then `gemini-flash-latest` |
| `GROQ_API_KEY` | no | Backup when Gemini fails or is busy |
| `GROQ_MODEL` / `GROQ_TEXT_MODEL` | no | Defaults `qwen/qwen3.8-27b` (vision) / `openai/gpt-oss-20b` (messages) |
| `DATABASE_URL` | no | Neon Postgres connection string. Tables are created on first use. Without it, rows go to `.data/db.json` |
| `BLOB_READ_WRITE_TOKEN` | no | Vercel Blob (private) for bill photos. Without it, photos go to the `bill_photos` table |

## Where things live
| Piece | Runs on | File |
|---|---|---|
| UI: capture, highlights, promise, verdict, message, My bills | phone browser | `src/app/page.tsx` |
| API (keys stay here) | Vercel functions | `src/app/api/{scan,check,message,sent,bills}` |
| AI with fallbacks: Gemini → Groq | Google / Groq | `src/lib/llm.ts`, `gemini.ts`, `groq.ts`, `prompts.ts` |
| Clean-up of model JSON; tax mode decided from numbers | server | `src/lib/normalize.ts` |
| **Code decides**: all checks and verdicts | server + browser | `src/lib/checks.ts`, `taxRules.ts`, `money.ts` |
| Message fill, number verifier, words changed | server | `src/lib/message.ts` |
| "Seen before" price history | server | `src/lib/history.ts`, `billView.ts` |
| Storage (Neon Postgres or local JSON; private Blob photos), masking | server | `src/lib/store.ts`, `db/schema.ts`, `mask.ts` |
| Private photo stream (owner device only) | server | `src/app/api/bills/[id]/photo` |
| Every reply is JSON; saving is best-effort | server | `src/lib/route.ts` |
| Schema (idempotent, applied on first use) | Neon | `src/lib/db/schema.ts` |
| One-off copy from the old Supabase project | local | `scripts/migrate-from-supabase.ts` |

## Verdicts
- **wrong**: provable by code (line maths, totals, tax arithmetic, legal rate, above the promise, late fee paid on time) → ask for a refund.
- **unexplained**: the user doesn't recognise the line, or a fee repeats → ask them to explain and reverse.
- **info**: worth knowing, never messaged (an old rate that undercharged you, "did the shelf price include tax?").

## Adding a golden pair
Save a real extraction to `tests/fixtures/<name>.json` (copy `extraction` from an `/api/scan` response) and assert the verdict you reached by hand in `tests/real-scans.test.ts`.

## Review Scout
Type a product, get a summary of what YouTube reviewers said where every claim links to a channel and timestamp, then ask follow-ups about the same videos. Rewritten from the course's Gradio app; uses the same keys as TallyBack (Gemini first, Groq as backup) and the same anonymous device id.

| Piece | File |
|---|---|
| UI: question, videos read, cited chat, past searches | `src/app/review-scout/page.tsx`, `Markdown.tsx` |
| Step 1, find and read videos (search, captions, top comments; no API key) | `src/app/api/scout/searches/route.ts`, `src/lib/scout/youtube.ts`, `captions.ts` |
| Step 2, summary or follow-up from the saved transcripts | `src/app/api/scout/searches/[id]/ask/route.ts`, `src/lib/scout/prompts.ts`, `turns.ts` |
| Storage: one `scout_searches` row per search, transcripts included, so follow-ups never ask YouTube again | `src/lib/store.ts`, `db/schema.ts` |

Transcripts come from the caption tracks YouTube lists for its phone apps (the web client hides them). YouTube sometimes blocks these requests from cloud servers; a blocked video shows as skipped.
