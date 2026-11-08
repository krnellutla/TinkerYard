"use client";

import { useEffect } from "react";
import { askToSignIn } from "@signin/ui/prompt";
import { formatMoney } from "../lib/money";

// Small shared pieces for the Split tab's screens: API calls, the bottom sheet, avatars and amounts.

// Read any reply safely: a timeout or platform error page isn't JSON.
export async function api<T = { ok: true }>(path: string, method = "GET", body?: unknown): Promise<T> {
  const r = await fetch(`/api/tallyback${path}`, {
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

// A panel that slides up from the bottom on phones and sits centred on wider screens. `footer` stays
// pinned at the bottom (above the home indicator) while the body scrolls, so Save is always in reach.
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
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
        className="flex max-h-[92dvh] w-full max-w-xl flex-col overscroll-contain rounded-t-[28px] bg-paper shadow-xl sm:rounded-3xl"
      >
        <span aria-hidden="true" className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-line sm:hidden" />
        <div className="flex items-center justify-between gap-2 border-b border-line py-1 pl-5 pr-2">
          <h2 className="min-w-0 truncate text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className={`${iconButton} text-2xl text-muted hover:text-ink`}>
            ×
          </button>
        </div>
        <div className={`${footer ? "pb-4" : "pb-safe"} min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-4`}>{children}</div>
        {footer && <div className="pb-safe border-t border-line bg-paper/95 px-5 pt-3 backdrop-blur">{footer}</div>}
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

// A segmented control: the active segment is a light chip, so the dark balance card stays the one dark block.
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 rounded-full bg-line/60 p-1 text-sm">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`h-10 min-w-0 flex-1 truncate rounded-full px-2 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ink ${value === t.id ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"}`}
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
const focus = "outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper";
export const primary = `flex h-12 w-full items-center justify-center rounded-2xl bg-ink font-medium text-white active:scale-[.99] disabled:opacity-40 ${focus}`;
export const secondary = `inline-flex min-h-11 items-center justify-center rounded-full border border-line bg-card px-4 text-sm font-medium active:scale-[.99] disabled:opacity-40 ${focus}`;
// A 44 × 44 tap target around a small glyph (close, back, settings).
export const iconButton = `inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full leading-none active:bg-line/60 ${focus}`;

export function ErrorNote({ text }: { text: string | null }) {
  return text ? <p className="rounded-xl bg-bad-soft p-3 text-sm text-bad">{text}</p> : null;
}
