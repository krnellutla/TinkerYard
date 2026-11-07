"use client";

import { useCallback, useEffect, useState } from "react";
import type { AppId, Role, Status } from "../policy";
import { refreshAccess } from "./access";

// /admin: who can sign in, their role, which apps they can use, and a log of every change.
// Only admins reach this page (Gate.tsx), and every call below is checked again on the server (admin.ts).

interface Person {
  email: string;
  role: Role;
  apps: AppId[];
  granted: AppId[];
  status: Status;
  source: "settings" | "dashboard";
  locked: string | null;
  note: string;
  joined: boolean;
  addedBy: string | null;
  updatedAt: string | null;
}
interface Data {
  me: string;
  people: Person[];
  log: { id: string; actor: string; email: string; change: string; createdAt: string }[];
  apps: { id: AppId; label: string }[];
  roles: { id: Role; label: string; about: string }[];
}
interface Draft {
  email: string;
  role: Role;
  apps: AppId[];
  status: Status;
  note: string;
}

async function call(method: string, url: string, body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Something went wrong (${r.status}).`);
  return j;
}

const field = "rounded-xl border border-line bg-card px-3 py-2 outline-none focus:border-ink";
const chip = "rounded-full px-2 py-0.5 text-xs font-medium";

export default function AdminDashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");

  const reload = useCallback(() => call("GET", "/api/admin/people").then(setData, (e) => setError(e.message)), []);
  useEffect(() => {
    reload();
  }, [reload]);

  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
      await reload();
      refreshAccess(); // your own nav may change too
      setNote(done);
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const save = (d: Draft, done: string) => act(() => call("POST", "/api/admin/people", d), done);

  if (!data)
    return <main className="mx-auto max-w-3xl px-4 pt-8">{error ? <p className="rounded-xl bg-bad-soft p-3 text-sm text-bad">{error}</p> : <p className="text-muted">Loading…</p>}</main>;

  const appName = (id: AppId) => data.apps.find((a) => a.id === id)?.label ?? id;
  const shown = data.people.filter((p) => !filter || p.email.includes(filter.toLowerCase()));
  const counts = {
    total: data.people.length,
    admins: data.people.filter((p) => p.role === "admin" && p.status === "active").length,
    suspended: data.people.filter((p) => p.status === "suspended").length,
    joined: data.people.filter((p) => p.joined).length,
  };

  return (
    <main className="mx-auto max-w-3xl px-4 pb-24 pt-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Admin dashboard</h1>
        <p className="mt-1 text-sm text-muted">Who can sign in, their role, and which apps they can use. Changes apply at once, and suspended or removed people are signed out everywhere.</p>
      </header>

      <section className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["People", counts.total],
          ["Active admins", counts.admins],
          ["Signed up", counts.joined],
          ["Suspended", counts.suspended],
        ].map(([label, n]) => (
          <div key={label} className="rounded-2xl border border-line bg-card p-3">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-0.5 text-xl font-semibold">{n}</p>
          </div>
        ))}
      </section>

      <section className="mt-5 grid gap-2 sm:grid-cols-2">
        {data.roles.map((r) => (
          <div key={r.id} className="rounded-2xl border border-line bg-card p-3 text-sm">
            <p className="font-medium">{r.label}</p>
            <p className="text-muted">{r.about}</p>
          </div>
        ))}
      </section>

      <AddPerson data={data} busy={busy} onSave={(d) => save(d, `Added ${d.email}. They can sign in with that email now.`)} />

      {note && <p className="mt-4 rounded-xl bg-good-soft p-3 text-sm text-good">{note}</p>}
      {error && <p className="mt-4 rounded-xl bg-bad-soft p-3 text-sm text-bad">{error}</p>}

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="font-semibold">People</h2>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find an email" aria-label="Find an email" className={`${field} w-48 text-sm`} />
        </div>
        <ul className="space-y-2">
          {shown.map((p) => (
            <li key={p.email} className="rounded-2xl border border-line bg-card p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">
                  {p.email}
                  {p.email === data.me && <span className="text-muted"> (you)</span>}
                </span>
                <span className={`${chip} ${p.role === "admin" ? "bg-ink text-white" : "bg-paper"}`}>{p.role === "admin" ? "Admin" : "Member"}</span>
                {p.status === "suspended" && <span className={`${chip} bg-bad-soft text-bad`}>Suspended</span>}
                <span className={`${chip} ${p.joined ? "bg-good-soft text-good" : "bg-warn-soft text-warn"}`}>{p.joined ? "Signed up" : "Invited"}</span>
                {p.source === "settings" && <span className={`${chip} bg-paper text-muted`}>From settings</span>}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {p.apps.length ? (
                  p.apps.map((a) => (
                    <span key={a} className={`${chip} border border-line`}>
                      {appName(a)}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-muted">No apps yet</span>
                )}
              </div>
              {p.note && <p className="mt-1 text-xs text-muted">{p.note}</p>}

              {p.locked ? (
                <p className="mt-2 text-xs text-muted">🔒 {p.locked}</p>
              ) : editing === p.email ? (
                <EditPerson
                  person={p}
                  data={data}
                  busy={busy}
                  onCancel={() => setEditing(null)}
                  onSave={(d) => save(d, `Saved ${d.email}.`)}
                />
              ) : (
                <div className="mt-1 flex flex-wrap gap-x-5 text-sm [&>button]:py-2">
                  <button onClick={() => setEditing(p.email)} className="font-medium underline underline-offset-2">
                    Edit role & apps
                  </button>
                  {p.email !== data.me && (
                    <>
                      <button
                        disabled={busy}
                        onClick={() =>
                          save(
                            { email: p.email, role: p.role, apps: p.granted, note: p.note === "From ALLOWED_EMAILS" ? "" : p.note, status: p.status === "active" ? "suspended" : "active" },
                            p.status === "active" ? `Suspended ${p.email} and signed them out.` : `Reactivated ${p.email}.`,
                          )
                        }
                        className={`underline underline-offset-2 ${p.status === "active" ? "text-warn" : "text-good"}`}
                      >
                        {p.status === "active" ? "Suspend" : "Reactivate"}
                      </button>
                      {p.source === "dashboard" && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            confirm(`Remove ${p.email}? They'll be signed out and can't sign in again unless they're added back.`) &&
                            act(() => call("DELETE", `/api/admin/people?email=${encodeURIComponent(p.email)}`), `Removed ${p.email}.`)
                          }
                          className="text-bad underline underline-offset-2"
                        >
                          Remove
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        {data.people.some((p) => p.source === "settings" && !p.locked) && (
          <p className="mt-2 text-xs text-muted">“From settings” members come from ALLOWED_EMAILS and get every app. Editing one here takes them over: from then on the dashboard decides.</p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-2 font-semibold">Change log</h2>
        {data.log.length === 0 ? (
          <p className="text-sm text-muted">No changes yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-2xl border border-line bg-card text-sm">
            {data.log.map((l) => (
              <li key={l.id} className="px-3 py-2">
                <span className="font-medium">{l.actor}</span> <span className="text-muted">→</span> <span className="font-medium">{l.email}</span>: {l.change}
                <span className="block text-xs text-muted">{new Date(l.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

// Role picker and app checkboxes, shared by "add" and "edit". Admins get every app, so their boxes are fixed.
function AccessFields({ data, draft, set }: { data: Data; draft: Draft; set: (d: Draft) => void }) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {data.roles.map((r) => (
          <label key={r.id} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 ${draft.role === r.id ? "border-ink bg-ink text-white" : "border-line bg-card"}`}>
            <input type="radio" name={`role-${draft.email}`} checked={draft.role === r.id} onChange={() => set({ ...draft, role: r.id })} className="sr-only" />
            {r.label}
          </label>
        ))}
      </div>
      <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
        <legend className="sr-only">Apps</legend>
        {data.apps.map((a) => (
          <label key={a.id} className={`flex items-center gap-1.5 ${draft.role === "admin" ? "text-muted" : ""}`}>
            <input
              type="checkbox"
              disabled={draft.role === "admin"}
              checked={draft.role === "admin" || draft.apps.includes(a.id)}
              onChange={(e) => set({ ...draft, apps: e.target.checked ? [...draft.apps, a.id] : draft.apps.filter((x) => x !== a.id) })}
              className="h-4 w-4 accent-ink"
            />
            {a.label}
          </label>
        ))}
        {draft.role === "admin" && <span className="text-xs text-muted">Admins get every app.</span>}
      </fieldset>
    </>
  );
}

function AddPerson({ data, busy, onSave }: { data: Data; busy: boolean; onSave: (d: Draft) => Promise<void> }) {
  const blank: Draft = { email: "", role: "member", apps: [], status: "active", note: "" };
  const [draft, setDraft] = useState<Draft>(blank);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        await onSave({ ...draft, email: draft.email.trim().toLowerCase() });
        setDraft(blank);
      }}
      className="mt-6 space-y-3 rounded-2xl border border-line bg-card p-4 text-sm"
    >
      <h2 className="font-semibold">Add someone</h2>
      <div className="flex flex-wrap gap-2">
        <input type="email" required value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="their@email.com" aria-label="Email" className={`${field} min-w-0 flex-1`} />
        <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="Note (optional)" aria-label="Note" className={`${field} min-w-0 flex-1`} />
      </div>
      <AccessFields data={data} draft={draft} set={setDraft} />
      <button type="submit" disabled={busy || !draft.email.includes("@")} className="h-10 rounded-xl bg-ink px-4 font-medium text-white disabled:opacity-40">
        Add to the list
      </button>
      <p className="text-xs text-muted">They aren&apos;t emailed: tell them to open tinkeryard.dev and register with this address.</p>
    </form>
  );
}

function EditPerson({ person, data, busy, onCancel, onSave }: { person: Person; data: Data; busy: boolean; onCancel: () => void; onSave: (d: Draft) => Promise<void> }) {
  const [draft, setDraft] = useState<Draft>({
    email: person.email,
    role: person.role,
    apps: person.granted,
    status: person.status,
    note: person.note === "From ALLOWED_EMAILS" ? "" : person.note,
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draft);
      }}
      className="mt-3 space-y-3 border-t border-line pt-3"
    >
      <AccessFields data={data} draft={draft} set={setDraft} />
      <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="Note (optional)" aria-label="Note" className={`${field} w-full`} />
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="h-9 rounded-xl bg-ink px-4 font-medium text-white disabled:opacity-40">
          Save
        </button>
        <button type="button" onClick={onCancel} className="h-9 rounded-xl border border-line px-4 font-medium">
          Cancel
        </button>
      </div>
    </form>
  );
}
