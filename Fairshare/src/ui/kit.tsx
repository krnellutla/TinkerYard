"use client";

import { useEffect } from "react";
import { askToSignIn } from "@signin/ui/prompt";
import { formatMoney } from "../lib/money";

// Small shared pieces for Fairshare's screens: API calls, the bottom sheet, avatars and amounts.

// Read any reply safely: a timeout or platform error page isn't JSON.
export async function api<T = { ok: true }>(path: string, method = "GET", body?: unknown): Promise<T> {
  const r = await fetch(`/api/fairshare${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let j: { error?: string } = {};
  try {
    j = text ? JSON.parse(text) : {};
  } catch {
    j = { error: `Something went wrong (${r.status}). Please try again.` };
  }
  if (r.status === 401) askToSignIn(j.error ?? "Sign in to split expenses.");
  if (!r.ok) throw new Error(j.error ?? "Something went wrong");
  return j as T;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const shortDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
export const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// A panel that slides up from the bottom on phones and sits centred on wider screens.
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", esc);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-xl flex-col rounded-t-3xl bg-paper shadow-xl sm:rounded-3xl"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="-mr-2 rounded-full px-3 py-1 text-xl leading-none text-muted hover:text-ink">
            ×
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

const PALETTE = ["#E0335F", "#2D6A3E", "#2563EB", "#A16207", "#7C3AED", "#0F766E", "#C2410C", "#475569"];
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.4, background: PALETTE[h % PALETTE.length] }}
    >
      {initials || "?"}
    </span>
  );
}

// "you are owed S$12.00" in green, "you owe" in orange, "settled up" in grey.
export function Standing({ cents, currency, you = true, className = "" }: { cents: number; currency: string; you?: boolean; className?: string }) {
  if (cents === 0) return <span className={`text-muted ${className}`}>settled up</span>;
  const owed = cents > 0;
  return (
    <span className={`${owed ? "text-good" : "text-bad"} ${className}`}>
      {you ? (owed ? "you are owed " : "you owe ") : owed ? "gets back " : "owes "}
      <b className="font-semibold">{formatMoney(Math.abs(cents), currency)}</b>
    </span>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 rounded-full border border-line bg-card p-1 text-sm">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`flex-1 rounded-full px-3 py-1.5 font-medium ${value === t.id ? "bg-ink text-white" : "text-muted hover:text-ink"}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// fieldBase sets no width, for inputs that share a row; field fills its line.
export const fieldBase = "rounded-xl border border-line bg-card px-3 py-2.5 outline-none focus:border-ink";
export const field = `w-full ${fieldBase}`;
export const primary = "flex h-12 w-full items-center justify-center rounded-2xl bg-ink font-medium text-white active:scale-[.99] disabled:opacity-40";
export const secondary = "rounded-full border border-line bg-card px-3 py-1.5 text-sm font-medium active:scale-[.99] disabled:opacity-40";

export function ErrorNote({ text }: { text: string | null }) {
  return text ? <p className="rounded-xl bg-bad-soft p-3 text-sm text-bad">{text}</p> : null;
}
