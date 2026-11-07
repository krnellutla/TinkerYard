# Tinkeryard

A yard for half-finished AI things. This repo is **one Next.js app** that serves [tinkeryard.dev](https://tinkeryard.dev): the landing page and every app on it share one deploy, one domain and one set of environment variables.

| Path | What it is | Code |
|---|---|---|
| `/` | Landing page listing the projects (plain HTML) | `public/index.html` |
| `/tallyback` | Snap any bill, find the line that doesn't add up, send one message | [`Tallyback/`](Tallyback) |
| `/reviewscout` | A cited summary of what YouTube reviewers said about a product, with follow-ups | [`Reviewscout/`](Reviewscout) |
| `/splitbill` | Split shared costs with friends: groups, four ways to split, simplify debts, settle up | [`Splitbill/`](Splitbill) |
| `/home` | Your apps as tiles: where the installed phone app opens | `app/(apps)/home/` |
| `/admin` | Admin dashboard: who can sign in, their role (Admin / Member) and which apps they can use | [`Auth/`](Auth) |
| `/api/auth/*` | Sign-in for every app (all of them need it): register by email code, then passkeys; allow-listed emails only | [`Auth/`](Auth) |

## Layout
```
app/                         Next.js routes only: thin files that point into the modules
  layout.tsx, globals.css    shared by every app
  (apps)/layout.tsx          app switcher above each app, with Sign in / account menu
  (apps)/tallyback/          /tallyback page
  (apps)/reviewscout/        /reviewscout page
  (apps)/splitbill/          /splitbill page
  api/tallyback/…            /api/tallyback/* → Tallyback/src/api
  api/reviewscout/…          /api/reviewscout/* → Reviewscout/src/api
  api/splitbill/…            /api/splitbill/* → Splitbill/src/api
  api/auth/[...all]/         /api/auth/* → Auth/src/handler
public/                      landing page and static files (public/tallyback/…)
Tallyback/                   module: src/{ui,api,lib}, tests, docs, scripts
Reviewscout/                 module: src/{ui,api,lib}, tests
Splitbill/                   module: src/{ui,api,lib}, tests
Auth/                        module: sign-in (src/, ui/, tests)
```
Each module keeps its own code and imports only from itself (`@tallyback/*`, `@reviewscout/*`, `@splitbill/*`, `@signin/*`), so either can be changed or removed without touching the other. Route files only re-export a module's handler and declare its Vercel settings (`runtime`, `maxDuration`), which Next.js needs to see in the route file itself.

## On phones: an installable app
The apps are a **Progressive Web App**: on a phone, open any app and install it (Android Chrome: **Install app**, or the button on `/home`; iPhone Safari: **Share → Add to Home Screen**, with the steps shown on `/home`). It then opens full-screen from its icon, straight to `/home`, with no browser bars.

| Piece | File |
|---|---|
| Manifest: name, colours, start page, standalone display, shortcuts | `app/manifest.ts` |
| Icons drawn in code (192, 512, maskable for Android, 180 for iPhone) | `app/icon.tsx`, `app/apple-icon.tsx`, `app/flag.tsx` |
| Bottom tab bar on phones (Home + your apps); the top switcher shows on wider screens | `app/(apps)/TabBar.tsx`, `app/(apps)/AppNav.tsx` |
| Install button / iPhone steps | `app/(apps)/install.ts`, `app/(apps)/home/Launcher.tsx` |
| Phone CSS: 16px fields (no iPhone zoom), instant taps, room for the tab bar and the home indicator (`--tabbar-h`, `.pb-safe`) | `app/globals.css` |

Anything fixed to the bottom of a page should sit at `bottom-[var(--tabbar-h)]` so the tab bar doesn't cover it. There's no offline mode yet (no service worker): the apps need a connection, like the AI behind them.

## Run
```bash
cp .env.example .env.local   # GEMINI_API_KEY; GROQ_API_KEY, DATABASE_URL, BLOB_READ_WRITE_TOKEN optional
npm install
npm run dev                  # http://localhost:3000, /tallyback, /reviewscout, /splitbill
npm test                     # every module's tests
npm run build
```
Without `DATABASE_URL`, each app keeps its data in its own local file under `.data/`. With it, each app creates its own tables in the same Neon database on first use.

## Deploy
The Vercel project `tinkeryard` builds the repo root (`vercel.json` sets the Next.js framework). It needs `GEMINI_API_KEY`, `GROQ_API_KEY`, TallyBack's Neon database (`DATABASE_URL`), and for sign-in `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ADMIN_EMAILS` (and optionally `ALLOWED_EMAILS`) and `RESEND_API_KEY` (see [`Auth/README.md`](Auth/README.md)). Every app needs sign-in, and each person sees only the apps their role allows (admins manage this at `/admin`), so until those are set the apps stay closed. Passkeys belong to the host in `BETTER_AUTH_URL`, so set it to the real domain before anyone registers one. `next.config.ts` redirects the old `tallyback.` and `reviewscout.` subdomains to their paths once those domains point at this project.
