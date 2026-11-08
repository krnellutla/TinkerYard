// Where you are in signing in, kept until the code is entered (or its 10 minutes run out).
// Phones may reload a tab while you're in the mail app fetching the code; without this, you'd come
// back to an empty email field instead of "Enter the code we sent to …".
//
// Kept three ways, so one being cleared doesn't lose it:
//   localStorage    survives reloads and new tabs (in a private tab, until the tab closes)
//   sessionStorage  survives reloads of this tab
//   the URL's #signin-code / #signin-link marker: survives anything that keeps the address,
//                   but carries no email (personal data stays out of URLs)
// Only signing in, "Start over" or the 10 minutes running out clear it.

export type SavedStep = "code" | "link-sent";
export interface Progress {
  step: SavedStep;
  email: string; // "" when only the URL marker survived: the email field is then editable
  at: number; // when the code or link was sent (ms); 0 when unknown
}

const KEY = "ty-signin-progress";
export const PROGRESS_TTL_MS = 10 * 60 * 1000;
const HASH: Record<SavedStep, string> = { code: "#signin-code", "link-sent": "#signin-link" };

// Pure, so it's easy to test: a saved step counts only while its code or link can still work.
export function restoreProgress(raw: string | null, now: number): Progress | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<Progress>;
    if ((p.step !== "code" && p.step !== "link-sent") || typeof p.email !== "string" || !p.email.includes("@") || typeof p.at !== "number") return null;
    if (now - p.at < 0 || now - p.at > PROGRESS_TTL_MS) return null;
    return { step: p.step, email: p.email, at: p.at };
  } catch {
    return null;
  }
}

// The newest of the stored copies; failing those, just the step from the URL marker.
export function pickProgress(local: Progress | null, session: Progress | null, hash: string): Progress | null {
  const stored = [local, session].filter((p): p is Progress => !!p).sort((a, b) => b.at - a.at)[0];
  if (stored) return stored;
  const step = (Object.keys(HASH) as SavedStep[]).find((s) => HASH[s] === hash);
  return step ? { step, email: "", at: 0 } : null;
}

const read = (s: Storage) => {
  try {
    return s.getItem(KEY);
  } catch {
    return null;
  }
};

export function loadProgress(): Progress | null {
  if (typeof window === "undefined") return null;
  const now = Date.now();
  const rawLocal = read(localStorage);
  const rawSession = read(sessionStorage);
  const local = restoreProgress(rawLocal, now);
  const session = restoreProgress(rawSession, now);
  // A copy is there but has run out: the code has expired, so the URL marker mustn't revive the step.
  if ((rawLocal || rawSession) && !local && !session) {
    clearProgress();
    return null;
  }
  return pickProgress(local, session, window.location.hash);
}

// Replace only the hash, keeping the router's history state.
function setHash(hash: string) {
  try {
    const url = window.location.pathname + window.location.search + hash;
    if (window.location.hash !== hash) window.history.replaceState(window.history.state, "", url);
  } catch {}
}

export function saveProgress(step: SavedStep, email: string) {
  const value = JSON.stringify({ step, email, at: Date.now() });
  for (const s of [localStorage, sessionStorage]) {
    try {
      s.setItem(KEY, value);
    } catch {}
  }
  setHash(HASH[step]);
}

export function clearProgress() {
  for (const s of [localStorage, sessionStorage]) {
    try {
      s.removeItem(KEY);
    } catch {}
  }
  if (Object.values(HASH).includes(window.location.hash)) setHash("");
}
