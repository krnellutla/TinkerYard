# Sign-in

Passwordless sign-in for every app on tinkeryard.dev, built on [Better Auth](https://www.better-auth.com). One sign-in covers all apps, because they share one domain.

- **Email code:** enter your email, get a 6-digit code, type it in. A code works for 10 minutes, at most 3 wrong tries.
- **Magic link:** the same, but click a link instead. It works once, for 10 minutes.
- **Invite-only:** only addresses in `ALLOWED_EMAILS` can sign in. Anyone else is told so, and **no code is created and no email is sent**. A second check refuses to create an account for any other address.
- **Sessions** last 30 days in a signed cookie. The cookie is trusted for 5 minutes at a time, so most requests don't touch the database.

## What needs an account
Anything that costs money needs sign-in; the rest stays open to guests.

| | Guest | Signed in |
|---|---|---|
| TallyBack sample receipt, checking a bill's maths | ✓ | ✓ |
| TallyBack: read a real bill, write the message | asks to sign in | ✓ |
| Review Scout: search, summary, follow-ups | asks to sign in | ✓ |
| My bills / Past searches | this device's guest items | your account's items, on any device |

The server enforces this on every route (`401` with `code: "sign_in"`). The pages also check first, so they can ask for sign-in before uploading anything. A photo or search started as a guest runs automatically once sign-in succeeds.

**Who owns what.** Bills and searches have a `user_id`. A signed-in person sees rows with their `user_id`. A guest sees only their device's rows that no account has claimed. The first time someone opens My bills or Past searches while signed in, that device's guest items move to their account (`claimDevice`). From then on the device alone can't read them. Messages, checks and "sent" logs are saved only against a bill the asker owns. Identity always comes from the session cookie on the server, never from anything the browser sends.

If sign-in isn't working on a server (missing secret or database), everyone counts as signed out: free features keep working and costly ones stay locked.

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
| `src/session.ts` | For API routes: `signedInUser(req)`, `ownerOf(user, deviceId)`, `signInRequired(what)` |
| `src/owner.ts` | The owner rule: account, or guest device (tested in `tests/`) |
| `src/ui/prompt.ts` | For pages: `isSignedIn()`, `askToSignIn(reason)`, `onSessionChanged(reload)` |

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
