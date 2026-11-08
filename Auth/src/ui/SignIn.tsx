"use client";

import { useEffect, useRef, useState } from "react";
import { authClient } from "../client";
import { deviceHasPasskey, markDevicePasskey, noteSignedOut, shouldAutoPasskey, signedOutHere } from "./device";
import { sessionChanged } from "./prompt";
import { afterPendingCleared, cancelPendingPasskey } from "./webauthn";
import { clearProgress, loadProgress, PROGRESS_TTL_MS, saveProgress } from "./progress";

// Signing in, with no passwords:
//   this device has a passkey → "Sign in with a passkey" (face, fingerprint or device PIN)
//   first visit, or a new device (device B) → email → 6-digit code (or a link); a passkey for this
//   device is offered right after (PasskeyPrompt). A passkey that fails or is cancelled falls back to email.
type Step = "start" | "email" | "code" | "link-sent";

// Better Auth's error codes, in plain words.
const MESSAGES: Record<string, string> = {
  INVALID_OTP: "That code doesn't match. Check the email, or send a new code.",
  OTP_EXPIRED: "That code has expired. Send a new one.",
  TOO_MANY_ATTEMPTS: "Too many wrong tries for that code. Send a new one.",
  INVALID_TOKEN: "That sign-in link has expired or was already used. Request a new one.",
  AUTH_CANCELLED: "Passkey sign-in was cancelled. Try again, or continue with email.",
  AUTHENTICATION_FAILED: "That passkey didn't work here. Continue with email to sign in another way.",
  PASSKEY_NOT_FOUND: "This device has no passkey for Tinkeryard yet. Continue with email, then add one.",
  UNABLE_TO_CREATE_SESSION: "This account isn't on the invite list any more.",
};

export const passkeysSupported = () => typeof window !== "undefined" && "PublicKeyCredential" in window;

// The automatic passkey prompt runs once per page load, however many times the panel mounts.
let autoTried = false;

// The sign-in steps on their own, so they can sit in a page (the sign-in wall) or in a dialog.
export function SignInPanel({ onDone, reason, errorCode }: { onDone?: () => void; reason?: string; errorCode?: string }) {
  // Back from the mail app (even after the phone reloaded the tab): pick up at "Enter the code".
  // Otherwise, a device known to hold a passkey starts on the passkey, and any other on the email code.
  const [saved] = useState(loadProgress);
  const [step, setStep] = useState<Step>(() => saved?.step ?? (deviceHasPasskey() ? "start" : "email"));
  const [note, setNote] = useState<string | null>(null);
  const [email, setEmail] = useState(saved?.email ?? "");
  const [sentAt, setSentAt] = useState(saved?.at ?? 0); // when the code was sent; 0 if unknown
  const [now, setNow] = useState(() => Date.now());
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(errorCode ? (MESSAGES[errorCode] ?? "That sign-in didn't work. Please try again.") : null);
  const [canPasskey, setCanPasskey] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setCanPasskey(passkeysSupported()), []);
  useEffect(() => {
    inputRef.current?.focus();
  }, [step]);

  // Back on a device that holds a passkey: open the passkey prompt without waiting for a tap. If it's
  // cancelled, or the browser wants a tap first (Safari can), the button below is still there; unlike
  // a tap on it, a failed automatic try doesn't conclude this device has no passkey.
  useEffect(() => {
    const go = shouldAutoPasskey({
      supported: passkeysSupported(),
      deviceHas: deviceHasPasskey(),
      onStartStep: step === "start",
      signedOutHere: signedOutHere(),
      alreadyTried: autoTried,
    });
    if (!go) return;
    autoTried = true;
    setBusy(true);
    afterPendingCleared(() => authClient.signIn.passkey())
      .then((r) => {
        if (r && !r.error) {
          markDevicePasskey(true);
          done();
        }
      })
      .catch(() => {})
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The saved step is cleared only by signing in, "Start over", or the code running out, never by a
  // screen passing through another step. Coming back to the tab (or Safari restoring the page from
  // its cache) re-reads it, so the code step wins even if this screen was showing something else.
  useEffect(() => {
    const resume = () => {
      if (document.visibilityState !== "visible") return;
      const p = loadProgress();
      if (!p) return;
      setStep((s) => (s === p.step ? s : p.step));
      if (p.email) setEmail((e) => e || p.email);
      if (p.at) setSentAt((t) => t || p.at);
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", resume);
    };
  }, []);

  // A ticking clock on the code step, for "expires in 8:42".
  useEffect(() => {
    if (step !== "code" && step !== "link-sent") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [step]);
  const left = sentAt ? Math.max(0, PROGRESS_TTL_MS - (now - sentAt)) : null;
  const expired = left === 0;
  const clock = left == null ? "" : `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`;

  // The only way out of the code step besides signing in: forget it and pick an email again.
  function startOver() {
    clearProgress();
    setCode("");
    setSentAt(0);
    setError(null);
    setStep("email");
  }

  // On the email step, the browser may also offer saved passkeys in the email field's autofill.
  // If one is picked, that's a full sign-in; anything else (not supported, dismissed) is ignored.
  // Leaving the email step (or this screen) cancels that waiting request, so it can't block the
  // "Create a passkey" that comes right after signing in.
  useEffect(() => {
    if (step !== "email" || !passkeysSupported()) return;
    authClient.signIn
      .passkey({ autoFill: true })
      .then((r) => {
        if (r && !r.error) {
          markDevicePasskey(true);
          done();
        }
      })
      .catch(() => {});
    return cancelPendingPasskey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function done() {
    clearProgress();
    noteSignedOut(false);
    sessionChanged();
    onDone?.();
  }

  // Run one call; show its error message, or move on.
  async function attempt(call: () => Promise<{ error: { code?: string; message?: string } | null } | undefined>, next: () => void) {
    setBusy(true);
    setError(null);
    try {
      const r = await call();
      const err = r?.error;
      if (err) setError((err.code && MESSAGES[err.code]) || err.message || "Something went wrong. Please try again.");
      else next();
    } catch {
      setError("Couldn't reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // Signing in with a passkey. Success means this device has one; failure (none here, cancelled, not
  // recognised) moves to the email code, so device B is never stuck at an empty passkey dialog.
  async function withPasskey() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await afterPendingCleared(() => authClient.signIn.passkey());
      if (!r?.error) {
        markDevicePasskey(true);
        return done();
      }
      markDevicePasskey(false);
      setNote("No passkey for Tinkeryard on this device? Sign in with an email code, then add one for this device.");
      setStep("email");
    } catch {
      setError("Couldn't reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const sendCode = () =>
    attempt(
      () => authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: "sign-in" }),
      () => {
        setCode("");
        saveProgress("code", email.trim());
        setSentAt(Date.now());
        setNow(Date.now());
        setStep("code");
      },
    );

  const verify = () => attempt(() => authClient.signIn.emailOtp({ email: email.trim(), otp: code.trim() }), done);

  const sendLink = () =>
    attempt(
      () => authClient.signIn.magicLink({ email: email.trim(), callbackURL: window.location.pathname }),
      () => {
        saveProgress("link-sent", email.trim());
        setSentAt(Date.now());
        setNow(Date.now());
        setStep("link-sent");
      },
    );

  const link = "text-sm text-muted underline underline-offset-4 disabled:opacity-40";
  const button = "h-12 w-full rounded-xl bg-ink font-medium text-white disabled:opacity-40";

  return (
    <div>
      {step === "start" && (
        <div className="space-y-3">
          {reason && <p className="text-sm text-muted">{reason}</p>}
          {canPasskey ? (
            <button onClick={withPasskey} disabled={busy} className={`${button} flex items-center justify-center gap-2`}>
              <KeyIcon />
              {busy ? "Waiting for your passkey…" : "Sign in with a passkey"}
            </button>
          ) : (
            <p className="rounded-xl bg-warn-soft p-3 text-sm text-warn">This browser can&apos;t use passkeys. Continue with email instead.</p>
          )}
          <button onClick={() => setStep("email")} disabled={busy} className="h-12 w-full rounded-xl border border-line bg-paper font-medium disabled:opacity-40">
            Use an email code instead
          </button>
          <p className="text-center text-xs text-muted">Lost your passkey? Use an email code, then add a new one for this device.</p>
        </div>
      )}

      {step === "email" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendCode();
          }}
          className="space-y-3"
        >
          {note ? (
            <p className="rounded-xl bg-warn-soft p-3 text-sm text-warn">{note}</p>
          ) : (
            <p className="text-sm text-muted">
              First time here, or on a new device? We&apos;ll email you a 6-digit code. After that you can add a passkey, so this device skips the email next time.
            </p>
          )}
          <input
            ref={inputRef}
            type="email"
            // "webauthn" lets the browser offer saved passkeys right here, too.
            autoComplete="email webauthn"
            aria-label="Email address"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="h-12 w-full rounded-xl border border-line bg-paper px-3 outline-none focus:border-ink"
          />
          <button type="submit" disabled={busy || !email.includes("@")} className={button}>
            {busy ? "Sending…" : "Email me a code"}
          </button>
          <div className="flex justify-between">
            {canPasskey ? (
              <button type="button" onClick={withPasskey} disabled={busy} className={link}>
                Use a passkey instead
              </button>
            ) : (
              <span />
            )}
            <button type="button" onClick={sendLink} disabled={busy || !email.includes("@")} className={link}>
              Email me a link instead
            </button>
          </div>
        </form>
      )}

      {step === "code" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            verify();
          }}
          className="space-y-3"
        >
          {email.includes("@") ? (
            <p className="text-sm text-muted">
              Enter the code we sent to <span className="font-medium text-ink">{email.trim()}</span>.{" "}
              {expired ? <span className="text-bad">That code has expired: send a new one.</span> : clock ? `It expires in ${clock}.` : "It works for 10 minutes."}
            </p>
          ) : (
            // Only the page address remembered the step (e.g. storage was cleared): ask for the email again.
            <>
              <p className="text-sm text-muted">Enter the code from your email, and the address it was sent to.</p>
              <input
                type="email"
                autoComplete="email"
                aria-label="Email address"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="h-12 w-full rounded-xl border border-line bg-paper px-3 outline-none focus:border-ink"
              />
            </>
          )}
          <input
            ref={inputRef}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="123456"
            aria-label="6-digit code"
            className="h-12 w-full rounded-xl border border-line bg-paper px-3 text-center font-mono text-xl tracking-[0.4em] outline-none focus:border-ink"
          />
          <button type="submit" disabled={busy || code.length !== 6 || !email.includes("@") || expired} className={button}>
            {busy ? "Checking…" : "Continue"}
          </button>
          <div className="flex justify-between">
            <button type="button" onClick={startOver} className={link}>
              Start over
            </button>
            <button type="button" onClick={sendCode} disabled={busy || !email.includes("@")} className={link}>
              Send a new code
            </button>
          </div>
        </form>
      )}

      {step === "link-sent" && (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Open the link we sent to <span className="font-medium text-ink">{email.trim()}</span> on this device. It works once, for 10 minutes.
          </p>
          <button onClick={startOver} className={link}>
            Use a code instead
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-bad-soft p-3 text-sm text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

// The same steps in a dialog, opened from the account button or when an app asks for sign-in.
export function SignIn({ onClose, reason, errorCode }: { onClose: () => void; reason?: string; errorCode?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="pb-safe fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="signin-title"
        className="w-full max-w-sm rounded-2xl bg-card p-5 text-ink shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id="signin-title" className="text-lg font-semibold">
            Sign in
          </h2>
          <button onClick={onClose} aria-label="Close" className="-mr-1 -mt-1 rounded-full px-2 text-xl leading-none text-muted hover:text-ink">
            ×
          </button>
        </div>
        <SignInPanel onDone={onClose} reason={reason} errorCode={errorCode} />
      </div>
    </div>
  );
}

export function KeyIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="15" r="4" />
      <path d="m10.85 12.15 9.15-9.15M18 5l3 3M15 8l3 3" />
    </svg>
  );
}
