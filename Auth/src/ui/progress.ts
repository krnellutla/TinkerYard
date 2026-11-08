// Where you are in signing in, kept on this device for as long as the email code works (10 minutes).
// Phones often reload a tab while you're in the mail app fetching the code; without this, you'd come
// back to an empty email field instead of "Enter the code we sent to …".

export type SavedStep = "code" | "link-sent";
export interface Progress {
  step: SavedStep;
  email: string;
  at: number; // when the code or link was sent (ms)
}

const KEY = "ty-signin-progress";
export const PROGRESS_TTL_MS = 10 * 60 * 1000;

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

export function loadProgress(): Progress | null {
  try {
    return restoreProgress(localStorage.getItem(KEY), Date.now());
  } catch {
    return null;
  }
}

export function saveProgress(step: SavedStep, email: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ step, email, at: Date.now() }));
  } catch {}
}

export function clearProgress() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
