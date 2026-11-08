"use client";

import { useEffect, useState } from "react";
import { authClient } from "../client";
import { deviceHasPasskey, markDevicePasskey, passkeyOffer } from "./device";
import { KeyIcon, passkeysSupported } from "./SignIn";
import { afterPendingCleared } from "./webauthn";
import { InviteFriends } from "./Invites";

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

// null: created (or this device already had one); "": cancelled; anything else: what went wrong.
async function createPasskey(): Promise<string | null> {
  try {
    const r = await afterPendingCleared(() => authClient.passkey.addPasskey({ name: deviceLabel() }));
    const err = r?.error as { code?: string; message?: string } | null | undefined;
    if (!err) {
      markDevicePasskey(true);
      return null;
    }
    if (err.code === "PREVIOUSLY_REGISTERED") {
      markDevicePasskey(true); // the browser says this device already holds one for the account
      return null;
    }
    if (err.code && CANCELLED.has(err.code)) return "";
    return (err.code && MESSAGES[err.code]) || err.message || "Couldn't create the passkey.";
  } catch {
    return "Couldn't reach the server. Please try again.";
  }
}

const DISMISSED = "ty-passkey-later";

// After signing in on a device without a passkey (a new account, or device B when the passkey is on
// device A): offer one for this device, once per browser session.
export function PasskeyPrompt() {
  const { data: keys, isPending } = authClient.useListPasskeys();
  const [deviceHas, setDeviceHas] = useState(deviceHasPasskey);
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISSED) === "1";
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  // Right after creating one: you're set, and now you can invite friends.
  if (created)
    return (
      <div className="pb-safe fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center">
        <div role="dialog" aria-modal="true" aria-labelledby="pk-done" className="w-full max-w-sm rounded-2xl bg-card p-5 text-ink shadow-xl">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-good text-white">✓</span>
          <h2 id="pk-done" className="mt-3 text-lg font-semibold">
            Passkey added
          </h2>
          <p className="mt-1 text-sm text-muted">Next time, this device signs in with your face, fingerprint or PIN.</p>
          <InviteFriends hasPasskey compact />
          <button onClick={() => setCreated(false)} className="mt-4 flex h-12 w-full items-center justify-center rounded-xl border border-line font-medium">
            Done
          </button>
        </div>
      </div>
    );

  const offer = passkeyOffer({ supported: passkeysSupported(), deviceHas, dismissed: hidden, accountPasskeys: isPending || !keys ? null : keys.length });
  if (offer === "none") return null;
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
          {offer === "first" ? "Skip the email next time" : "Add a passkey for this device"}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {offer === "first"
            ? "Create a passkey and sign in with your face, fingerprint or device PIN. It stays on your device (and syncs through your password manager), so there's nothing to remember and nothing to leak."
            : "Your passkey is on another device. Add one here too, and this device signs in with your face, fingerprint or PIN instead of an email code."}
        </p>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const e = await createPasskey();
            setBusy(false);
            if (e === null) {
              setDeviceHas(true);
              setCreated(true);
            } else if (e) setError(e);
            else setError("Cancelled. You can create one any time from the account menu.");
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
// Once this browser has a passkey, adding another is switched off and says so instead.
export function PasskeyList() {
  const { data: keys, isPending } = authClient.useListPasskeys();
  const [deviceHas, setDeviceHas] = useState(deviceHasPasskey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The account has no passkeys left, so neither does this device (e.g. removed on another device).
  useEffect(() => {
    if (keys?.length === 0) {
      markDevicePasskey(false);
      setDeviceHas(false);
    }
  }, [keys]);

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
                if (!r.error && keys.length === 1) {
                  markDevicePasskey(false); // that was the last one
                  setDeviceHas(false);
                }
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
      {passkeysSupported() &&
        (deviceHas ? (
          <p
            role="status"
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl bg-good-soft py-2 text-sm font-medium text-good"
          >
            <KeyIcon className="h-4 w-4" />
            This device has a passkey ✓
          </p>
        ) : (
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const e = await createPasskey();
              if (e === null) setDeviceHas(true);
              setError(e === null ? null : e || "Cancelled.");
              setBusy(false);
            }}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-line py-2 font-medium disabled:opacity-40"
          >
            <KeyIcon className="h-4 w-4" />
            {busy ? "Waiting for your device…" : "Add a passkey for this device"}
          </button>
        ))}
      {error && <p className="mt-2 rounded-lg bg-bad-soft p-2 text-xs text-bad">{error}</p>}
      <InviteFriends hasPasskey={(keys?.length ?? 0) > 0} />
    </div>
  );
}
