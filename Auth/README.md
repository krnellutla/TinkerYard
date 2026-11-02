# Sign-in

Passwordless sign-in for every app on tinkeryard.dev, built on [Better Auth](https://www.better-auth.com). One sign-in covers all apps, because they share one domain.

- **Email code:** enter your email, get a 6-digit code, type it in. A code works for 10 minutes, at most 3 wrong tries.
- **Magic link:** the same, but click a link instead. It works once, for 10 minutes.
- **Invite-only:** only addresses in `ALLOWED_EMAILS` can sign in. Anyone else is told so, and **no code is created and no email is sent**. A second check refuses to create an account for any other address.
- **Sessions** last 30 days in a signed cookie. The cookie is trusted for 5 minutes at a time, so most requests don't touch the database.

Phase 1 adds sign-in itself. Nothing in TallyBack or Review Scout requires it yet: that's phase 2.

## Files
| File | What it does |
|---|---|
| `src/auth.ts` | Server config: plugins, allow-list hooks, sessions, database; creates its tables on first use |
| `src/allowlist.ts` | Parses `ALLOWED_EMAILS` and checks an address (tested in `tests/`) |
| `src/email.ts` | Sends the code and link emails through Resend; prints them to the console in development |
| `src/handler.ts` | Answers `/api/auth/*` (wired up by `app/api/auth/[...all]/route.ts`) |
| `src/client.ts` | Browser calls: send code, verify, send link, sign out, current session |
| `src/ui/SignIn.tsx` | The sign-in box: email → code, or email → link |
| `src/ui/Account.tsx` | "Sign in" or the account menu, in the app switcher |

## Storage
With `DATABASE_URL`, Better Auth keeps `user`, `session`, `account` and `verification` tables in that Postgres database, using the standard `pg` driver (Neon's pooled URL works). Codes and link tokens are stored hashed. Without a database, in development only, accounts and sessions live in memory until the server restarts. In production, sign-in refuses to start without a database, and the Sign in button stays hidden while sign-in is unavailable.

## Settings
| Variable | Needed | Notes |
|---|---|---|
| `BETTER_AUTH_SECRET` | production | Signs sessions. Generate with `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | yes | `https://tinkeryard.dev`; `http://localhost:3000` locally. Used in sign-in links |
| `ALLOWED_EMAILS` | yes | Comma-separated. Empty means nobody can sign in |
| `RESEND_API_KEY` | production | From resend.com, after verifying the sending domain |
| `EMAIL_FROM` | no | Default `Tinkeryard <login@tinkeryard.dev>` |
| `DATABASE_URL` | production | Shared with the apps |

## Testing locally
Put your email in `ALLOWED_EMAILS` in `.env.local`, run `npm run dev`, and click **Sign in** in the app switcher. Without `RESEND_API_KEY`, the code and the link appear in the terminal running the dev server.
