# Sign-in

Passwordless sign-in for every app on tinkeryard.dev, built on [Better Auth](https://www.better-auth.com). One sign-in covers all apps, because they share one domain. **Every app needs an account**: until you sign in, a sign-in wall shows instead of the app.

- **Register once:** enter your email, get a 6-digit code, type it in (or click an emailed link instead). A code works for 10 minutes, at most 3 wrong tries; a link works once, for 10 minutes.
- **Then a passkey:** right after, you're offered a passkey ("Skip the email next time"). Your device makes a key pair; the private key stays on the device behind Face ID, a fingerprint or the device PIN, and only the public key is stored here. From then on, **Sign in with a passkey** is one tap, with no email.
- **A second device (device B):** passkeys live on the device that made them (unless your password manager syncs them), so device B opens on the email code. Right after signing in, it offers **Add a passkey for this device**, even though device A already has one, and from then on device B signs in with its own passkey. If a passkey sign-in fails or is cancelled, the screen falls back to the email code. **Use a passkey instead** stays available for synced passkeys. The account menu lists every device's passkey and lets you remove old ones.
- **Invite-only:** only people on the list can sign in (see Roles and app access below). Anyone else is told so, and **no code is created and no email is sent**. A second check refuses to create an account for any other address, and a third refuses to start a session for someone who has since been removed or suspended, however they sign in (so it also shuts out their passkeys).
- **Sessions** last 30 days in a signed cookie. The cookie is trusted for 5 minutes at a time, so most requests don't touch the database.

## How passkeys work here
Passkeys are the WebAuthn standard. To register, the server sends a random challenge; the device creates a key pair for this site only and returns the public key, which goes in the `passkey` table. To sign in, the server sends a fresh challenge and the device signs it with the private key after your face, fingerprint or PIN; the server checks the signature against the stored public key. Nothing secret is kept on the server, and a passkey can't be phished: it only works on the site it was made for.

- **Site:** the passkey's "relying party" is the host in `BETTER_AUTH_URL` (`tinkeryard.dev` in production, `localhost` locally), so passkeys made locally never work in production and vice versa. If the domain ever changes, existing passkeys stop working and people re-register by email.
- **Which device has one:** the server knows the account's passkeys, not which device each lives on, so the browser keeps a small marker (`localStorage`, `src/ui/device.ts`): set when a passkey is created or used here, cleared when one fails here or the last one is removed. It only decides what to show first; the server still checks every passkey.
- **Discoverable passkeys** (`residentKey: "required"`): the device knows which account a passkey belongs to, so signing in needs no email. The email field also offers saved passkeys in its autofill.
- **Adding a passkey needs a session**, which only comes from the email code, so the invite list guards registration too.
- Plugin: `@better-auth/passkey` (official, built on SimpleWebAuthn), pinned to the same version as `better-auth`.

## Roles and app access
Role-based access control: every check in the yard asks one policy function, `can(access, action)` in `src/policy.ts`, so the rules live in one tested place.

| | Admin | Member |
|---|---|---|
| Use apps | every app | only the apps an admin grants |
| Admin dashboard (`/admin`): add people, set role and apps, suspend, remove | ✓ | ✗ |

Each person also has a **status**: active, or **suspended** (locked out at once: every app route refuses them and their sessions are deleted). Someone's access is worked out in this order:

1. **`ADMIN_EMAILS`** (server setting): Admin, every app, and it can't be changed from the dashboard, so the owner can never be locked out.
2. **The dashboard list** (`ty_access` table): whatever an admin set.
3. **`ALLOWED_EMAILS`** (the original invite list): Member with every app, until an admin edits them, which takes them over into the dashboard.

Nobody else can sign in: no code is created and no email is sent.

**Guard rails:** you can't demote, suspend or remove yourself; `ADMIN_EMAILS` people can't be edited from the dashboard; the last active admin can't be removed. Every change is written to `ty_access_log` with who made it, and shown on the dashboard.

**Where it's enforced:**
- **Sign-in** (`src/auth.ts`): the three locks above ask the policy.
- **Every app API route:** `appUser(req, "tallyback")` from `src/session.ts` answers `401` when you're not signed in and `403` (`code: "no_access"`) when the app isn't yours, or you're suspended or removed.
- **The admin API** (`/api/admin/people`): `adminUser(req)`.
- **The pages:** `src/ui/Gate.tsx` shows sign-in, "You don't have access to …", or "Your access is paused". The app switcher lists only your apps, and admins get an Admin dashboard link in the account menu. The pages only help; the server decides.

Lookups are cached for 30 seconds per server instance. A change clears the cache on the server that made it, so other instances may take up to 30 seconds to notice; suspended and removed people are signed out immediately.

Adding someone doesn't email them. Tell them to open the site and register with that address.

**Who owns what.** Bills, searches and split groups belong to accounts. Bills and searches made as a guest before sign-in was required still carry the device that made them; the first time someone opens My bills or Past searches while signed in on that device, those items move to their account (`claimDevice`). Identity always comes from the session cookie on the server, never from anything the browser sends.

If sign-in isn't working on a server (missing secret or database), the apps stay closed and the wall says so.

## Files
| File | What it does |
|---|---|
| `src/auth.ts` | Server config: plugins, allow-list hooks, sessions, database; creates its tables on first use |
| `src/policy.ts` | Roles, apps and `can()`: the one policy everything asks (pure, tested in `tests/`) |
| `src/access.ts` | Stores the dashboard list and change log (`ty_access`, `ty_access_log`); `accessFor(email)` |
| `src/admin.ts` | `/api/admin/people` (list, add/edit, remove, with guard rails) and `/api/access` (your own access) |
| `src/ui/Admin.tsx` | The admin dashboard at `/admin` |
| `src/ui/access.ts` | `useAccess()`: your role and apps, shared by the nav, the gate and the account menu |
| `src/email.ts` | Sends the code and link emails through Resend; prints them to the console in development |
| `src/handler.ts` | Answers `/api/auth/*` (wired up by `app/api/auth/[...all]/route.ts`) |
| `src/client.ts` | Browser calls: send code, verify, send link, passkeys, sign out, current session |
| `src/ui/SignIn.tsx` | Sign-in steps: passkey, or email → code / link (as a panel or a dialog) |
| `src/ui/Gate.tsx` | The wall around every app: sign in, then only the apps your role allows; the passkey offer after sign-in |
| `src/ui/Passkeys.tsx` | "Create a passkey" / "Add a passkey for this device" prompt, and the passkey list in the account menu |
| `src/ui/device.ts` | Does this device have a passkey? The marker, and when to offer one (tested in `tests/`) |
| `src/ui/Account.tsx` | "Sign in" or the account menu (passkeys, sign out), in the app switcher |
| `scripts/passkey-e2e.mjs` | End-to-end passkey test with a software authenticator (see below) |
| `scripts/access-e2e.mjs` | End-to-end test of roles and app access (see below) |
| `src/session.ts` | For API routes: `appUser(req, app)`, `adminUser(req)`, `signedInUser(req)`, `ownerOf(user, deviceId)` |
| `src/owner.ts` | The owner rule: account, or guest device (tested in `tests/`) |
| `src/ui/prompt.ts` | For pages: `isSignedIn()`, `askToSignIn(reason)`, `onSessionChanged(reload)` |

## Storage
With `DATABASE_URL`, Better Auth keeps `user`, `session`, `account`, `verification` and `passkey` tables, and the access list keeps `ty_access` and `ty_access_log`, in that Postgres database, using the standard `pg` driver (Neon's pooled URL works). Codes and link tokens are stored hashed. Without a database, in development only, accounts and sessions live in memory until the server restarts. In production, sign-in refuses to start without a database, and the Sign in button stays hidden while sign-in is unavailable.

## Settings
| Variable | Needed | Notes |
|---|---|---|
| `BETTER_AUTH_SECRET` | production | Signs sessions. Generate with `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | yes | `https://tinkeryard.dev`; `http://localhost:3000` locally. Used in sign-in links, and its host is the passkeys' site |
| `ADMIN_EMAILS` | yes | Comma-separated. Admins: every app and `/admin`; can't be locked out from the dashboard |
| `ALLOWED_EMAILS` | no | The original invite list: Members with every app until an admin edits them |
| `RESEND_API_KEY` | production | From resend.com, after verifying the sending domain |
| `EMAIL_FROM` | no | Default `Tinkeryard <login@tinkeryard.dev>` |
| `DATABASE_URL` | production | Shared with the apps |

## Testing locally
Put your email in `ADMIN_EMAILS` in `.env.local`, run `npm run dev`, and click **Sign in** in the app switcher. Without `RESEND_API_KEY`, the code and the link appear in the terminal running the dev server.

## Testing passkeys
Browsers create passkeys with the device's secure hardware, so a test needs either a real device or a stand-in. `scripts/passkey-e2e.mjs` is that stand-in: a software authenticator (a real P-256 key pair) that registers a passkey and signs in with it against a running server, the same messages a phone would send. It also checks that every app refuses strangers, that a forged signature and a replayed challenge are refused. Run it against a local server with no database and no email service, so nothing real is touched:

```bash
DATABASE_URL= RESEND_API_KEY= BETTER_AUTH_URL=http://localhost:3102 ALLOWED_EMAILS=alice@test.local npx next dev -p 3102 > dev.log 2>&1 &
node Auth/scripts/passkey-e2e.mjs http://localhost:3102 dev.log alice@test.local
```

To try it by hand, run `npm run dev` and open http://localhost:3000/tallyback in Chrome or Safari: your laptop's Touch ID / Windows Hello, or your phone via the QR code, makes a real passkey for `localhost`. Chrome DevTools → More tools → WebAuthn can also add a virtual authenticator.

## Testing roles and app access
`scripts/access-e2e.mjs` signs in as an admin, a member and a stranger against a running server and checks every rule: strangers can't get a code, members open only their apps (403 elsewhere, and on `/api/admin`), a grant works at once, nobody can make themselves admin, the guard rails hold, suspending locks out at once and blocks new sign-ins, `ALLOWED_EMAILS` people can be restricted, removal works, and everything is logged.

```bash
DATABASE_URL= RESEND_API_KEY= BETTER_AUTH_URL=http://localhost:3103 ADMIN_EMAILS=admin@test.local ALLOWED_EMAILS=old@test.local npx next dev -p 3103 > dev.log 2>&1 &
node Auth/scripts/access-e2e.mjs http://localhost:3103 dev.log
```

