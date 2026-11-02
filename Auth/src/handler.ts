import "server-only";
import { toNextJsHandler } from "better-auth/next-js";
import { auth, ensureAuthTables } from "./auth";

// Every /api/auth/* request: make sure the tables exist, then let Better Auth answer.
const handlers = toNextJsHandler(auth);

export async function GET(req: Request) {
  await ensureAuthTables();
  return handlers.GET(req);
}

export async function POST(req: Request) {
  await ensureAuthTables();
  return handlers.POST(req);
}
