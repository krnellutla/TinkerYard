# Tinkeryard

A yard for half-finished AI things. This repo is **one Next.js app** that serves [tinkeryard.dev](https://tinkeryard.dev): the landing page and every app on it share one deploy, one domain and one set of environment variables.

| Path | What it is | Code |
|---|---|---|
| `/` | Landing page listing the projects (plain HTML) | `public/index.html` |
| `/tallyback` | Snap any bill, find the line that doesn't add up, send one message | [`Tallyback/`](Tallyback) |
| `/reviewscout` | A cited summary of what YouTube reviewers said about a product, with follow-ups | [`Reviewscout/`](Reviewscout) |
| `/fairshare` | Split shared costs with friends: groups, four ways to split, simplify debts, settle up | [`Fairshare/`](Fairshare) |
| `/api/auth/*` | Passwordless sign-in for every app: email code or link, allow-listed emails only | [`Auth/`](Auth) |

## Layout
```
app/                         Next.js routes only: thin files that point into the modules
  layout.tsx, globals.css    shared by every app
  (apps)/layout.tsx          app switcher above each app, with Sign in / account menu
  (apps)/tallyback/          /tallyback page
  (apps)/reviewscout/        /reviewscout page
  (apps)/fairshare/          /fairshare page
  api/tallyback/…            /api/tallyback/* → Tallyback/src/api
  api/reviewscout/…          /api/reviewscout/* → Reviewscout/src/api
  api/fairshare/…            /api/fairshare/* → Fairshare/src/api
  api/auth/[...all]/         /api/auth/* → Auth/src/handler
public/                      landing page and static files (public/tallyback/…)
Tallyback/                   module: src/{ui,api,lib}, tests, docs, scripts
Reviewscout/                 module: src/{ui,api,lib}, tests
Fairshare/                   module: src/{ui,api,lib}, tests
Auth/                        module: sign-in (src/, ui/, tests)
```
Each module keeps its own code and imports only from itself (`@tallyback/*`, `@reviewscout/*`, `@fairshare/*`, `@signin/*`), so either can be changed or removed without touching the other. Route files only re-export a module's handler and declare its Vercel settings (`runtime`, `maxDuration`), which Next.js needs to see in the route file itself.

## Run
```bash
cp .env.example .env.local   # GEMINI_API_KEY; GROQ_API_KEY, DATABASE_URL, BLOB_READ_WRITE_TOKEN optional
npm install
npm run dev                  # http://localhost:3000, /tallyback, /reviewscout, /fairshare
npm test                     # every module's tests
npm run build
```
Without `DATABASE_URL`, each app keeps its data in its own local file under `.data/`. With it, each app creates its own tables in the same Neon database on first use.

## Deploy
The Vercel project `tinkeryard` builds the repo root (`vercel.json` sets the Next.js framework). It needs `GEMINI_API_KEY`, `GROQ_API_KEY`, TallyBack's Neon database (`DATABASE_URL`), and for sign-in `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ALLOWED_EMAILS` and `RESEND_API_KEY` (see [`Auth/README.md`](Auth/README.md)). Until those are set, sign-in stays hidden and the apps work as before. `next.config.ts` redirects the old `tallyback.` and `reviewscout.` subdomains to their paths once those domains point at this project.
