"use client";

import { useState } from "react";
import { authClient } from "../client";
import { KeyIcon, passkeysSupported } from "./SignIn";

// Passkeys after sign-in: the offer to create one, and the list in the account menu.

// A readable label for the passkey being made here, e.g. "Mac · Safari", so the list makes sense later.
function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "This device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return browser ? `${os} · ${browser}` : os;
}

const CANCELLED = new Set(["REGISTRATION_CANCELLED", "AUTH_CANCELLED"]);
const MESSAGES: Record<string, string> = {
  PREVIOUSLY_REGISTERED: "This device already has a passkey for your account.",
  FAILED_TO_VERIFY_REGISTRATION: "The passkey couldn't be checked. Please try again.",
};

async function createPasskey(): Promise<string | null> {
  try {
    const r = await authClient.passkey.addPasskey({ name: deviceLabel() });
    const err = r?.error as { code?: string; message?: string } | null | undefined;
    if (!err) return null;
    if (err.code && CANCELLED.has(err.code)) return "";
    return (err.code && MESSAGES[err.code]) || err.message || "Couldn't create the passkey.";
  } catch {
    return "Couldn't reach the server. Please try again.";
  }
}

const DISMISSED = "ty-passkey-later";

// Right after signing in with email: if the account has no passkey yet, offer one, once per browser session.
export function PasskeyPrompt() {
  const { data: keys, isPending } = authClient.useListPasskeys();
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISSED) === "1";
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (hidden || isPending || !keys || keys.length > 0 || !passkeysSupported()) return null;
  const later = () => {
    try {
      sessionStorage.setItem(DISMISSED, "1");
    } catch {}
    setHidden(true);
  };

  return (
    <div className="pb-safe fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="pk-title" className="w-full max-w-sm rounded-2xl bg-card p-5 text-ink shadow-xl">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-ink text-white">
          <KeyIcon />
        </span>
        <h2 id="pk-title" className="mt-3 text-lg font-semibold">
          Skip the email next time
        </h2>
        <p className="mt-1 text-sm text-muted">
          Create a passkey and sign in with your face, fingerprint or device PIN. It stays on your device (and syncs through your password manager), so there&apos;s nothing to remember and nothing to leak.
        </p>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const e = await createPasskey();
            setBusy(false);
            if (e) setError(e);
            else if (e === "") setError("Cancelled. You can create one any time from the account menu.");
          }}
          className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-ink font-medium text-white disabled:opacity-40"
        >
          {busy ? "Waiting for your device…" : "Create a passkey"}
        </button>
        <button onClick={later} className="mt-2 w-full text-sm text-muted underline underline-offset-4">
          Not now
        </button>
        {error && <p className="mt-3 rounded-xl bg-bad-soft p-3 text-sm text-bad">{error}</p>}
      </div>
    </div>
  );
}

// In the account menu: your passkeys, add one for this device, remove old ones.
export function PasskeyList() {
  const { data: keys, isPending } = authClient.useListPasskeys();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="font-medium">Passkeys</p>
      {isPending && <p className="text-muted">Loading…</p>}
      {keys?.length === 0 && <p className="text-muted">None yet: you sign in by email.</p>}
      <ul className="mt-1 space-y-1">
        {keys?.map((k) => (
          <li key={k.id} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">
              {k.name || "Passkey"}
              {k.createdAt && <span className="text-muted"> · {new Date(k.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>}
            </span>
            <button
              disabled={busy}
              onClick={async () => {
                if (!confirm(`Remove “${k.name || "Passkey"}”? That device will need email to sign in again.`)) return;
                setBusy(true);
                const r = await authClient.passkey.deletePasskey({ id: k.id });
                setBusy(false);
                setError(r.error ? (r.error.message ?? "Couldn't remove it.") : null);
              }}
              className="shrink-0 text-xs text-bad underline"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {passkeysSupported() && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError((await createPasskey()) || null);
            setBusy(false);
          }}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-line py-2 font-medium disabled:opacity-40"
        >
          <KeyIcon className="h-4 w-4" />
          Add a passkey for this device
        </button>
      )}
      {error && <p className="mt-2 rounded-lg bg-bad-soft p-2 text-xs text-bad">{error}</p>}
    </div>
  );
}
