"use client";

import { useEffect, useRef, useState } from "react";
import { authClient } from "../client";

// Email → 6-digit code, with "email me a link instead". No passwords.
type Step = "email" | "code" | "link-sent";

// Better Auth's error codes, in plain words.
const MESSAGES: Record<string, string> = {
  INVALID_OTP: "That code doesn't match. Check the email, or send a new code.",
  OTP_EXPIRED: "That code has expired. Send a new one.",
  TOO_MANY_ATTEMPTS: "Too many wrong tries for that code. Send a new one.",
  INVALID_TOKEN: "That sign-in link has expired or was already used. Request a new one.",
};

export function SignIn({ onClose, reason, errorCode }: { onClose: () => void; reason?: string; errorCode?: string }) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(errorCode ? (MESSAGES[errorCode] ?? "That sign-in didn't work. Please try again.") : null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [step]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Run one call; show its error message, or move on.
  async function attempt(call: () => Promise<{ error: { code?: string; message?: string } | null }>, next: () => void) {
    setBusy(true);
    setError(null);
    try {
      const { error } = await call();
      if (error) setError((error.code && MESSAGES[error.code]) || error.message || "Something went wrong. Please try again.");
      else next();
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
        setStep("code");
      },
    );

  const verify = () => attempt(() => authClient.signIn.emailOtp({ email: email.trim(), otp: code.trim() }), onClose);

  const sendLink = () =>
    attempt(
      () => authClient.signIn.magicLink({ email: email.trim(), callbackURL: window.location.pathname }),
      () => setStep("link-sent"),
    );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="signin-title"
        className="w-full max-w-sm rounded-2xl bg-card p-5 text-ink shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="signin-title" className="text-lg font-semibold">
            {step === "code" ? "Check your email" : step === "link-sent" ? "Link sent" : "Sign in"}
          </h2>
          <button onClick={onClose} aria-label="Close" className="-mr-1 -mt-1 rounded-full px-2 text-xl leading-none text-muted hover:text-ink">
            ×
          </button>
        </div>

        {step === "email" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendCode();
            }}
            className="mt-3 space-y-3"
          >
            <p className="text-sm text-muted">{reason ?? "We'll email you a 6-digit code. No password needed."}</p>
            <input
              ref={inputRef}
              type="email"
              autoComplete="email"
              aria-label="Email address"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="h-12 w-full rounded-xl border border-line bg-paper px-3 outline-none focus:border-ink"
            />
            <button type="submit" disabled={busy || !email.includes("@")} className="h-12 w-full rounded-xl bg-ink font-medium text-white disabled:opacity-40">
              {busy ? "Sending…" : "Email me a code"}
            </button>
            <button type="button" onClick={sendLink} disabled={busy || !email.includes("@")} className="w-full text-sm text-muted underline underline-offset-4 disabled:opacity-40">
              Email me a sign-in link instead
            </button>
          </form>
        )}

        {step === "code" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              verify();
            }}
            className="mt-3 space-y-3"
          >
            <p className="text-sm text-muted">
              Enter the code we sent to <span className="font-medium text-ink">{email.trim()}</span>. It works for 10 minutes.
            </p>
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
            <button type="submit" disabled={busy || code.length !== 6} className="h-12 w-full rounded-xl bg-ink font-medium text-white disabled:opacity-40">
              {busy ? "Checking…" : "Sign in"}
            </button>
            <div className="flex justify-between text-sm text-muted">
              <button type="button" onClick={() => setStep("email")} className="underline underline-offset-4">
                Use another email
              </button>
              <button type="button" onClick={sendCode} disabled={busy} className="underline underline-offset-4">
                Send a new code
              </button>
            </div>
          </form>
        )}

        {step === "link-sent" && (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-muted">
              Open the link we sent to <span className="font-medium text-ink">{email.trim()}</span> on this device. It works once, for 10 minutes.
            </p>
            <button onClick={() => setStep("email")} className="text-sm text-muted underline underline-offset-4">
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
    </div>
  );
}
