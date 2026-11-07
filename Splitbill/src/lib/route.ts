import "server-only";
import { NextResponse } from "next/server";
import { signedInUser, signInRequired } from "@signin/session";
import { Problem, type Me } from "./service";

// Every SplitBill route: signed-in people only (groups are shared between real accounts, so a
// device id isn't enough), and every reply is JSON, even when something unexpected throws.
export function route<P extends Record<string, string> = Record<string, never>>(fn: (req: Request, me: Me, params: P) => Promise<Response | object | void>) {
  return async (req: Request, ctx: { params: Promise<P> }): Promise<Response> => {
    try {
      const me = await signedInUser(req);
      if (!me) return signInRequired("split expenses");
      const out = await fn(req, me, ((await ctx?.params) ?? {}) as P);
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof Problem) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error("splitbill route failed:", e);
      return NextResponse.json({ error: "Something went wrong on our side. Please try again." }, { status: 500 });
    }
  };
}

// A body that isn't JSON is a bad request, not a crash.
export async function body(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new Problem(400, "Expected a JSON body.");
  }
}
