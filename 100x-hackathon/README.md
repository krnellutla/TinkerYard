# TallyBack

**One place to store your bills for the future.**

Snap a photo of any bill or receipt. TallyBack checks every line and the maths, highlights the charge that doesn't add up, and writes one message you can send on WhatsApp. If everything checks out, it says so and shows the working.

### ▶ Try it: **[tallyback.vercel.app](https://tallyback.vercel.app)**

Open it on your phone. No sign-up. No bill handy? Tap **"Try a sample receipt"**.

---

## Why

Most of us pay bills without reading them. Somewhere there's a charge we can't explain: a pack we never asked for, a late fee on a bill paid on time, tax added on top of a price that already included it. We notice, but we never write in, because writing that message is a chore. TallyBack does the reading, does the maths, and writes the message.

## Features

| | Feature | What it does |
|---|---|---|
| 📷 | **Snap or upload** | Take a photo with your phone camera, or upload a photo or PDF. Works with any bill: groceries, restaurants, phone, broadband, electricity, rent, subscriptions, in any currency. |
| 🔍 | **Every line, read and explained** | Each line is read off the bill and explained in plain words. |
| 🧮 | **Maths checked by code** | Quantity × price, lines vs subtotal, tax arithmetic, the legal tax rate for that country on that date, whether tax was added on top or already included, and subtotal + extras = total. |
| 🟥 | **The disputed line, highlighted** | The charge that doesn't add up is outlined on your photo of the bill, with the working underneath. |
| 🤝 | **Checked against what you were promised** | Enter the price you were promised (a plan price, shelf price, quote, or menu), say whether shelf prices included tax and when you paid, or tap a line to mark *"I don't recognise this"*. The verdict updates instantly. |
| ⚖️ | **Wrong vs unexplained** | *Wrong* means code can prove it, so the message asks for a refund. *Unexplained* means you don't recognise the charge, so the message asks them to explain it and reverse it. Small issues are shown as notes, never as accusations. |
| ✉️ | **One message, ready to send** | Polite or firm, editable. **Send on WhatsApp** opens the chat with the shop's number pre-filled when it's printed on the bill. Or copy the text. |
| ✅ | **"Every line checks out" is an answer** | If nothing is wrong, you get the maths that proves it. TallyBack never invents an error. |
| 🗂️ | **My bills** | Every bill you check is kept on your phone: reopen it later with its photo and maths, and see which ones you disputed and sent. |
| ↺ | **"Seen before" price history** | Each line is compared with your earlier bills from the same shop: *same price as 8 Oct*, or *down 7% since 8 Oct (S$13.80/kg → S$12.90/kg)*. |
| 🔒 | **Private by default** | Account, card and phone numbers are masked before anything is saved. Bill photos are kept in private storage. |

## The rule: AI reads, code decides

A language model will happily add up a bill for you, and be confidently wrong by ₹40. So in TallyBack:

- **The AI** (Gemini, with Groq as a backup) only *reads* the photo into lines, and writes the *words* of the message.
- **Code** computes *every* number: the checks, the verdict and the amounts.
- The model writes the message using placeholders like `{{diff}}`, which code fills in. A verifier then **rejects any number in the message that code didn't compute**, and falls back to a message written entirely by code.
- Even whether tax was "added" or "included" is decided by code from the printed numbers, not by the model's guess.

```
Phone (camera / upload) ──► Server (Vercel, keys live here)
                               ├─► AI: photo → lines + row positions;  message words with {{placeholders}}
                               ├─► Code: every check, every amount, the verdict, the verifier
                               └─► Neon Postgres: bills, lines, promises, findings, messages → line item; photos in private Vercel Blob
```

## Built with

Next.js 15 · TypeScript · Tailwind CSS · Google Gemini (`gemini-3.8-flash`, with fallbacks) · Groq (`qwen3.8-27b` vision, `gpt-oss-20b` text) as a backup · Neon Postgres · Vercel Blob (private) · Vercel

## Run it yourself

```bash
git clone https://github.com/krnellutla/Tallyback.git
cd Tallyback/tallyback
cp .env.example .env.local   # add a free Gemini key (aistudio.google.com/apikey); Groq, Neon and Blob are optional
npm install
npm run dev                  # http://localhost:3000
npm test                     # 21 tests, including real receipt scans
```

Without a database, data is saved to a local file. With `DATABASE_URL` (Neon Postgres), tables are created automatically on first use. Developer details are in [`tallyback/README.md`](tallyback/README.md).

## Repository

| Path | What's in it |
|---|---|
| [`tallyback/`](tallyback) | The app |
| [`tallyback/src/lib/checks.ts`](tallyback/src/lib/checks.ts) | Every check and verdict: the code that decides |
| [`tallyback/src/lib/message.ts`](tallyback/src/lib/message.ts) | Placeholder filling, the number verifier, words-changed |
| [`tallyback/tests/`](tallyback/tests) | Golden pairs from hand-checked real bills |
| [`docs/`](docs) | By-hand bill reviews, golden pairs, handover notes |

## Background

Built in 48 hours for the 100xEngineers Cohort 8 (Module 2) hackathon, problem 1: **BillShield**, *"Turn a bill you don't trust into one message worth sending."* The bar: the message gets sent, with few words changed. Every check was first done by hand on real bills from classmates and friends (see [`docs/`](docs)).

## Known limits

- Bills are tied to the phone and browser you used. There's no account yet, so clearing browser data starts a fresh list.
- Tax rules are on file for a handful of countries (Singapore, India, UK, Australia, New Zealand, UAE). Elsewhere, the tax maths is still checked but the legal rate isn't.
- On the free Groq backup, the highlight shows in the line list rather than on the photo.
