"use client";

import { useCallback, useEffect, useState } from "react";
import type { InvitesReply } from "../invites";

// Invite friends by email: once you have a passkey, a few invites (3 unless set otherwise; admins have no limit).
// The friend gets an email with a link that fills in their address on the sign-in screen.

async function call(method: "GET" | "POST" | "DELETE", body?: object, query = ""): Promise<InvitesReply & { warning?: string }> {
  const r = await fetch(`/api/invites${query}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d as { error?: string }).error ?? "Something went wrong. Please try again.");
  return d as InvitesReply;
}

const STATUS = { pending: "Invited", joined: "Joined ✓", revoked: "Taken back" } as const;

// `hasPasskey` changes when a passkey is added or removed, so the list asks the server again.
export function InviteFriends({ hasPasskey, compact }: { hasPasskey: boolean; compact?: boolean }) {
  const [data, setData] = useState<InvitesReply | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => call("GET").then(setData, () => setData(null)), []);
  useEffect(() => {
    if (hasPasskey) load();
  }, [hasPasskey, load]);

  if (!hasPasskey || !data) return null;
  const leftText = data.left == null ? "Invite anyone" : data.left === 1 ? "1 invite left" : `${data.left} invites left`;
  const shown = data.invites.filter((i) => i.status !== "revoked");

  async function act(fn: () => Promise<InvitesReply & { warning?: string }>, ok?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const d = await fn();
      setData(d);
      setNotice(d.warning ?? ok ?? null);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={compact ? "mt-4 text-left" : "mt-3 border-t border-line pt-3"}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-medium">Invite friends</p>
        <span className="text-xs text-muted">{leftText}</span>
      </div>
      <p className="mt-0.5 text-xs text-muted">Tinkeryard is invite-only. They&apos;ll get an email with a link to join.</p>
      {data.allowed ? (
        <form
          className="mt-2 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const to = email.trim();
            if (await act(() => call("POST", { email: to }), `Invite sent to ${to}.`)) setEmail("");
          }}
        >
          <input
            type="email"
            inputMode="email"
            autoComplete="off"
            aria-label="Friend's email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="friend@example.com"
            className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-paper px-3 text-base outline-none focus:border-ink"
          />
          <button type="submit" disabled={busy || !email.includes("@")} className="h-11 shrink-0 rounded-xl bg-ink px-4 font-medium text-white disabled:opacity-40">
            {busy ? "…" : "Invite"}
          </button>
        </form>
      ) : (
        data.reason && <p className="mt-2 rounded-lg bg-paper p-2 text-xs text-muted">{data.reason}</p>
      )}
      {notice && <p className="mt-2 rounded-lg bg-good-soft p-2 text-xs text-good">{notice}</p>}
      {error && <p className="mt-2 rounded-lg bg-bad-soft p-2 text-xs text-bad">{error}</p>}
      {shown.length > 0 && (
        <ul className="mt-2 space-y-1">
          {shown.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">{i.email}</span>
              <span className="flex shrink-0 items-center gap-2 text-xs">
                <span className={i.status === "joined" ? "text-good" : "text-muted"}>{STATUS[i.status]}</span>
                {i.status === "pending" && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`Take back the invite to ${i.email}? They won't be able to sign in, and you get the invite back.`))
                        act(() => call("DELETE", undefined, `?id=${encodeURIComponent(i.id)}`), "Invite taken back.");
                    }}
                    className="text-bad underline"
                  >
                    Take back
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
