import "server-only";
import { toNextJsHandler } from "better-auth/next-js";
import { ensureAuthTables, getAuth } from "./auth";

// Every /api/auth/* request: make sure the tables exist, then let Better Auth answer.
let handlers: ReturnType<typeof toNextJsHandler> | null = null;

async function ready() {
  await ensureAuthTables();
  handlers ??= toNextJsHandler(getAuth());
  return handlers;
}

export async function GET(req: Request) {
  return (await ready()).GET(req);
}

export async function POST(req: Request) {
  return (await ready()).POST(req);
}
