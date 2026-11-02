import "server-only";
import { NextResponse } from "next/server";
import { ensureAuthTables, getAuth } from "./auth";

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
