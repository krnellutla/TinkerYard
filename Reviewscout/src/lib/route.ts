import { NextResponse } from "next/server";

// Every API reply is JSON, even when something unexpected throws.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function jsonRoute<A extends any[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      console.error("route failed:", e);
      return NextResponse.json({ error: "Something went wrong on our side. Please try again." }, { status: 500 });
    }
  };
}

// Saving is a bonus: a database hiccup must never cost the user their result.
export async function bestEffort<T>(what: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.error(`${what} failed (continuing without saving):`, e instanceof Error ? e.message : e);
    return fallback;
  }
}
