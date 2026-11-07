import "server-only";
import { NextResponse } from "next/server";
import { accessFor } from "./access";
import { ensureAuthTables, getAuth } from "./auth";
import { appLabel, can, type AppId } from "./policy";

// What the apps' API routes use to find out who is asking.

export interface User {
  id: string;
  email: string;
}

export { ownerOf, type Owner } from "./owner";

let warned = false;

// The signed-in user, or null. If sign-in isn't working on this server, everyone counts as
// signed out: free features keep working and costly ones stay locked.
export async function signedInUser(req: Request): Promise<User | null> {
  try {
    await ensureAuthTables();
    const s = await getAuth().api.getSession({ headers: req.headers });
    return s ? { id: s.user.id, email: s.user.email } : null;
  } catch (e) {
    if (!warned) console.error("sign-in unavailable, treating requests as signed out:", e instanceof Error ? e.message : e);
    warned = true;
    return null;
  }
}

// The reply for "you need to sign in for this". The page shows the message and opens the sign-in box.
export function signInRequired(what: string) {
  return NextResponse.json({ error: `Sign in to ${what}.`, code: "sign_in" }, { status: 401 });
}

// The check every app route starts with: signed in (401 otherwise) and allowed to use this app
// (403 otherwise: not granted, suspended, or removed since signing in). Returns the user, or the reply to send.
export async function appUser(req: Request, app: AppId): Promise<User | Response> {
  const user = await signedInUser(req);
  if (!user) return signInRequired(`use ${appLabel(app)}`);
  if (!can(await accessFor(user.email), { type: "app:use", app }))
    return NextResponse.json({ error: `You don't have access to ${appLabel(app)}. Ask an admin to add it.`, code: "no_access" }, { status: 403 });
  return user;
}

// For the admin dashboard's routes: signed in and allowed to manage users.
export async function adminUser(req: Request): Promise<User | Response> {
  const user = await signedInUser(req);
  if (!user) return signInRequired("open the admin dashboard");
  if (!can(await accessFor(user.email), { type: "users:manage" })) return NextResponse.json({ error: "Only admins can do that.", code: "no_access" }, { status: 403 });
  return user;
}
