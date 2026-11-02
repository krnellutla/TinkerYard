import "server-only";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { memoryAdapter } from "better-auth/adapters/memory";
import { getMigrations } from "better-auth/db/migration";
import { emailOTP } from "better-auth/plugins/email-otp";
import { magicLink } from "better-auth/plugins/magic-link";
import { Pool } from "pg";
import { isAllowed, NOT_INVITED, parseAllowList } from "./allowlist";
import { sendCode, sendLink } from "./email";

// Passwordless sign-in for every app on tinkeryard.dev: a 6-digit code or a link, sent by email,
// to allow-listed addresses only. Sessions live in Postgres (Neon) and last 30 days.
// BETTER_AUTH_SECRET and BETTER_AUTH_URL are read from the environment by Better Auth itself.

const dbUrl = (process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim().replace(/^["']|["']$/g, "");

// The endpoints that start a sign-in. Strangers are stopped here, before a code is made or an email sent.
const SIGN_IN_PATHS = new Set(["/email-otp/send-verification-otp", "/sign-in/email-otp", "/sign-in/magic-link"]);
const allowList = () => parseAllowList(process.env.ALLOWED_EMAILS);

function buildOptions() {
  return {
    // Without a database (local development), accounts and sessions live in memory until the server restarts.
    database: dbUrl ? new Pool({ connectionString: dbUrl, max: 3 }) : memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      // Trust the signed session cookie for 5 minutes, so most requests skip the database.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 10 * 60,
        allowedAttempts: 3,
        storeOTP: "hashed",
        sendVerificationOTP: ({ email, otp }) => sendCode(email, otp),
      }),
      magicLink({
        expiresIn: 10 * 60,
        storeToken: "hashed",
        sendMagicLink: ({ email, url }) => sendLink(email, url),
      }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (SIGN_IN_PATHS.has(ctx.path) && !isAllowed(ctx.body?.email, allowList())) throw new APIError("FORBIDDEN", { message: NOT_INVITED });
      }),
    },
    // Second lock: no account is ever created for an email that isn't on the list.
    databaseHooks: {
      user: {
        create: {
          before: async (user: { email: string }) => (isAllowed(user.email, allowList()) ? undefined : false),
        },
      },
    },
  } satisfies BetterAuthOptions;
}

// Built on first use, not on import: a route that only sometimes needs sign-in (the free sample
// receipt) keeps working even when sign-in isn't configured on this server.
let options: ReturnType<typeof buildOptions> | null = null;
function createAuth() {
  options = buildOptions();
  return betterAuth(options);
}
let instance: ReturnType<typeof createAuth> | null = null;

export function getAuth() {
  // In-memory sessions would vanish between serverless instances: refuse rather than half-work.
  if (!dbUrl && process.env.NODE_ENV === "production") throw new Error("Sign-in needs DATABASE_URL in production");
  instance ??= createAuth();
  return instance;
}

// Better Auth's tables (user, session, account, verification) are created on first use,
// like the apps' own tables. Runs once per server instance; adds only what's missing.
let tablesReady: Promise<void> | null = null;
export function ensureAuthTables(): Promise<void> {
  getAuth();
  if (!dbUrl || !options) return Promise.resolve();
  tablesReady ??= getMigrations(options)
    .then((m) => m.runMigrations())
    .catch((e) => {
      tablesReady = null; // retry on the next request
      throw e;
    });
  return tablesReady;
}
