"use client";

import { useEffect, useRef, useState } from "react";
import type { AppId } from "../policy";
import { askToSignIn } from "./prompt";

// A small speech-bubble button in an app's header that opens a quick feedback form: how it feels
// (five faces, optional), what kind of note it is, and a message. Admins read them in /admin.

const MOODS = [
  { v: 1, face: "😞", label: "Unhappy" },
  { v: 2, face: "🙁", label: "Not great" },
  { v: 3, face: "😐", label: "Okay" },
  { v: 4, face: "🙂", label: "Good" },
  { v: 5, face: "😍", label: "Love it" },
] as const;
const KINDS = [
  { id: "idea", label: "💡 Idea" },
  { id: "problem", label: "🐞 Problem" },
  { id: "praise", label: "👏 Praise" },
] as const;
type Kind = (typeof KINDS)[number]["id"];

const PLACEHOLDER: Record<Kind, string> = {
  idea: "What would make it better?",
  problem: "What happened, and what did you expect?",
  praise: "What do you like?",
};

export function FeedbackButton({ app, appName }: { app: AppId; appName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Send feedback about ${appName}`}
        title="Send feedback"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-card text-ink active:scale-95"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
          <path d="M8 10h8M8 13h5" />
        </svg>
      </button>
      {open && <FeedbackForm app={app} appName={appName} onClose={() => setOpen(false)} />}
    </>
  );
}

function FeedbackForm({ app, appName, onClose }: { app: AppId; appName: string; onClose: () => void }) {
  const [mood, setMood] = useState<number | null>(null);
  const [kind, setKind] = useState<Kind>("idea");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app, mood, kind, message, page: window.location.pathname }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (r.status === 401) {
        onClose();
        return askToSignIn("Sign in to send feedback.");
      }
      if (!r.ok) throw new Error(j.error ?? "Couldn't send it. Please try again.");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pb-safe fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="fb-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-[28px] bg-paper p-5 text-ink shadow-xl sm:rounded-3xl"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id="fb-title" className="text-lg font-semibold">
            {sent ? "Thank you!" : `Feedback on ${appName}`}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-11 w-11 items-center justify-center rounded-full text-xl text-muted">
            ×
          </button>
        </div>
        {sent ? (
          <div className="space-y-4 pb-2 text-center">
            <p className="text-4xl" aria-hidden="true">
              🙌
            </p>
            <p className="text-muted">We read every note. It helps decide what to build next.</p>
            <button type="button" onClick={onClose} className="h-12 w-full rounded-2xl bg-ink font-medium text-white">
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={send} className="space-y-4">
            <fieldset>
              <legend className="mb-2 text-sm text-muted">How do you feel about it? (optional)</legend>
              <div className="flex justify-between gap-1">
                {MOODS.map((m) => (
                  <button
                    key={m.v}
                    type="button"
                    aria-label={m.label}
                    aria-pressed={mood === m.v}
                    onClick={() => setMood(mood === m.v ? null : m.v)}
                    className={`flex h-12 flex-1 items-center justify-center rounded-2xl text-2xl transition ${mood === m.v ? "bg-ink/10 ring-2 ring-ink" : mood ? "opacity-40" : ""}`}
                  >
                    {m.face}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="flex gap-2" role="radiogroup" aria-label="Kind of feedback">
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  role="radio"
                  aria-checked={kind === k.id}
                  onClick={() => {
                    setKind(k.id);
                    box.current?.focus();
                  }}
                  className={`min-h-11 flex-1 whitespace-nowrap rounded-full border px-2 text-sm font-medium ${kind === k.id ? "border-ink bg-ink text-white" : "border-line bg-card"}`}
                >
                  {k.label}
                </button>
              ))}
            </div>
            <textarea
              ref={box}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={PLACEHOLDER[kind]}
              rows={4}
              maxLength={2000}
              aria-label="Your feedback"
              className="w-full resize-none rounded-2xl border border-line bg-card p-3 text-base outline-none focus:border-ink"
            />
            {error && <p className="rounded-xl bg-bad-soft p-3 text-sm text-bad">{error}</p>}
            <button type="submit" disabled={busy || !message.trim()} className="h-12 w-full rounded-2xl bg-ink font-medium text-white disabled:opacity-40">
              {busy ? "Sending…" : "Send feedback"}
            </button>
            <p className="text-center text-xs text-muted">Sent with your email and this page&apos;s address, so we can follow up.</p>
          </form>
        )}
      </div>
    </div>
  );
}
