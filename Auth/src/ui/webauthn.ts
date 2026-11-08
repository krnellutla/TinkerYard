import { WebAuthnAbortService } from "@simplewebauthn/browser";

// A browser runs one passkey request at a time. The sign-in screen leaves one waiting in the
// background (so saved passkeys show up in the email field's autofill). Starting another before the
// browser has let go of it fails with "A request is already pending", so every passkey action
// first cancels the waiting one, gives the browser a moment, and retries once if it's still busy.

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function cancelPendingPasskey() {
  try {
    WebAuthnAbortService.cancelCeremony();
  } catch {}
}

export const isPendingError = (message?: string | null) => !!message && /already pending|pending request|request is already/i.test(message);

type Result = { error?: { code?: string; message?: string } | null } | null | undefined;

export async function afterPendingCleared<T extends Result>(run: () => Promise<T>): Promise<T> {
  cancelPendingPasskey();
  await wait(150);
  const first = await run();
  if (!isPendingError(first?.error?.message)) return first;
  cancelPendingPasskey();
  await wait(800);
  return run();
}
