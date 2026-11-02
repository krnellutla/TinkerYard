import { authClient } from "../client";

// How the apps talk to the account menu without depending on it: browser events.
const ASK = "tinkeryard:ask-sign-in";
const CHANGED = "tinkeryard:session-changed";

// Open the sign-in box with a reason, e.g. "Sign in to check a real bill."
export function askToSignIn(reason: string) {
  window.dispatchEvent(new CustomEvent(ASK, { detail: reason }));
}

export function onAskToSignIn(cb: (reason: string) => void) {
  const h = (e: Event) => cb(String((e as CustomEvent).detail ?? ""));
  window.addEventListener(ASK, h);
  return () => window.removeEventListener(ASK, h);
}

// Someone signed in or out: lists that depend on who you are should reload.
export function sessionChanged() {
  window.dispatchEvent(new Event(CHANGED));
}

export function onSessionChanged(cb: () => void) {
  window.addEventListener(CHANGED, cb);
  return () => window.removeEventListener(CHANGED, cb);
}

// Checked before a costly action, so the page can ask for sign-in before uploading anything.
// The server checks again: this is only for a smoother experience.
export async function isSignedIn(): Promise<boolean> {
  try {
    const { data } = await authClient.getSession();
    return !!data;
  } catch {
    return false;
  }
}
