import "server-only";
import { neon } from "@neondatabase/serverless";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { APP_IDS, appsFromStored, isRole, normalEmail, parseEmails, resolveAccess, type Access, type AppId, type Role, type Settings, type Status } from "./policy";

// Who's on the list and what they may use, kept in Postgres (Neon) when DATABASE_URL is set, or a
// local JSON file otherwise. The rules themselves live in policy.ts; this file only stores and looks up.
//   ty_access      one row per person added in the admin dashboard
//   ty_access_log  every change: who did it, to whom, what changed
//   ty_invites     invites members sent their friends (rules: invites.ts)
//   ty_feedback    what people tell us from the apps (feedbackApi.ts), read in /admin

type Row = Record<string, unknown>;
type Sql = ReturnType<typeof neon>;

const SCHEMA = [
  `create table if not exists ty_access (
    email text primary key,
    role text not null default 'member',
    apps jsonb not null default '[]',
    status text not null default 'active',
    note text not null default '',
    created_by text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  `create table if not exists ty_access_log (
    id uuid primary key,
    actor text not null,
    email text not null,
    change text not null,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists ty_access_log_time_idx on ty_access_log (created_at desc)`,
  `create table if not exists ty_invites (
    id uuid primary key,
    inviter text not null,
    email text not null,
    token_hash text not null unique,
    created_at timestamptz not null default now(),
    revoked_at timestamptz
  )`,
  `create index if not exists ty_invites_inviter_idx on ty_invites (inviter)`,
  `create table if not exists ty_feedback (
    id uuid primary key,
    email text not null,
    app text not null,
    mood smallint,
    kind text not null,
    message text not null,
    page text not null default '',
    device text not null default '',
    created_at timestamptz not null default now(),
    resolved_at timestamptz
  )`,
  `create index if not exists ty_feedback_time_idx on ty_feedback (created_at desc)`,
];

const dbUrl = () => (process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim().replace(/^["']|["']$/g, "");
let sqlClient: Sql | null | undefined;
let schemaReady: Promise<void> | null = null;

async function db(): Promise<Sql | null> {
  if (sqlClient === undefined) sqlClient = dbUrl() ? neon(dbUrl()) : null;
  if (sqlClient && !schemaReady) {
    const sql = sqlClient;
    schemaReady = (async () => {
      for (const stmt of SCHEMA) await sql.query(stmt);
    })().catch((e) => {
      schemaReady = null; // retry on the next request
      throw e;
    });
  }
  if (sqlClient) await schemaReady;
  return sqlClient;
}

const DB_FILE = path.join(process.env.VERCEL ? os.tmpdir() : process.cwd(), ".data", "access.json");
type Local = { ty_access: Row[]; ty_access_log: Row[]; ty_invites: Row[]; ty_feedback: Row[] };
async function local(): Promise<Local> {
  try {
    const d = JSON.parse(await fs.readFile(DB_FILE, "utf8"));
    return { ty_access: d.ty_access ?? [], ty_access_log: d.ty_access_log ?? [], ty_invites: d.ty_invites ?? [], ty_feedback: d.ty_feedback ?? [] };
  } catch {
    return { ty_access: [], ty_access_log: [], ty_invites: [], ty_feedback: [] };
  }
}
async function localWrite(d: Local) {
  await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
  await fs.writeFile(DB_FILE, JSON.stringify(d, null, 2));
}
async function selectJson(sql: Sql, query: string, params: unknown[]): Promise<Row[]> {
  const rows = (await sql.query(`select coalesce(json_agg(t), '[]'::json) as rows from (${query}) t`, params)) as { rows: Row[] }[];
  return rows[0]?.rows ?? [];
}

export type AccessRecord = Omit<Access, "source"> & { note: string; createdBy: string; createdAt: string; updatedAt: string };

const toRecord = (r: Row): AccessRecord => ({
  email: String(r.email),
  role: isRole(r.role) ? (r.role as Role) : "member",
  apps: appsFromStored(r.apps),
  status: r.status === "suspended" ? "suspended" : "active",
  note: String(r.note ?? ""),
  createdBy: String(r.created_by),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

export const settings = (): Settings => ({ admins: parseEmails(process.env.ADMIN_EMAILS), allowed: parseEmails(process.env.ALLOWED_EMAILS) });

// ---- lookups, cached briefly: every app request asks, and access rarely changes ----
// A change made here clears this server's cache at once; other server instances catch up within 30 seconds.
const TTL = 30_000;
const cache = new Map<string, { at: number; record: AccessRecord | null }>();

async function readRecord(email: string): Promise<AccessRecord | null> {
  const hit = cache.get(email);
  if (hit && Date.now() - hit.at < TTL) return hit.record;
  const sql = await db();
  const row = sql ? (await selectJson(sql, `select * from ty_access where email = $1`, [email]))[0] : (await local()).ty_access.find((r) => r.email === email);
  const record = row ? toRecord(row) : null;
  cache.set(email, { at: Date.now(), record });
  return record;
}

// Everything the policy needs about one person. Null: not on any list.
export async function accessFor(email: unknown): Promise<Access | null> {
  const e = normalEmail(email);
  if (!e) return null;
  return resolveAccess(e, settings(), await readRecord(e));
}

export async function listRecords(): Promise<AccessRecord[]> {
  const sql = await db();
  const rows = sql ? await selectJson(sql, `select * from ty_access order by created_at`, []) : (await local()).ty_access;
  return rows.map(toRecord);
}

export interface LogEntry {
  id: string;
  actor: string;
  email: string;
  change: string;
  createdAt: string;
}

export async function recentLog(limit = 50): Promise<LogEntry[]> {
  const sql = await db();
  const rows = sql
    ? await selectJson(sql, `select * from ty_access_log order by created_at desc limit ${Math.floor(limit)}`, [])
    : (await local()).ty_access_log.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit);
  return rows.map((r) => ({ id: String(r.id), actor: String(r.actor), email: String(r.email), change: String(r.change), createdAt: String(r.created_at) }));
}

// ---- changes (the admin API checks permission before calling these) ----
export interface RecordInput {
  email: string;
  role: Role;
  apps: AppId[];
  status: Status;
  note: string;
}

export async function saveRecord(actor: string, input: RecordInput, change: string) {
  const now = new Date().toISOString();
  const apps = APP_IDS.filter((a) => input.apps.includes(a)); // known apps, in nav order
  const sql = await db();
  if (!sql) {
    const d = await local();
    const old = d.ty_access.find((r) => r.email === input.email);
    const row = { email: input.email, role: input.role, apps, status: input.status, note: input.note, created_by: old?.created_by ?? actor, created_at: old?.created_at ?? now, updated_at: now };
    d.ty_access = [...d.ty_access.filter((r) => r.email !== input.email), row];
    d.ty_access_log.push({ id: crypto.randomUUID(), actor, email: input.email, change, created_at: now });
    await localWrite(d);
  } else {
    await sql.query(
      `insert into ty_access (email, role, apps, status, note, created_by) values ($1, $2, $3::jsonb, $4, $5, $6)
       on conflict (email) do update set role = excluded.role, apps = excluded.apps, status = excluded.status, note = excluded.note, updated_at = now()`,
      [input.email, input.role, JSON.stringify(apps), input.status, input.note, actor],
    );
    await sql.query(`insert into ty_access_log (id, actor, email, change) values ($1, $2, $3, $4)`, [crypto.randomUUID(), actor, input.email, change]);
  }
  cache.delete(input.email);
}

export async function deleteRecord(actor: string, email: string) {
  const sql = await db();
  if (!sql) {
    const d = await local();
    d.ty_access = d.ty_access.filter((r) => r.email !== email);
    d.ty_access_log.push({ id: crypto.randomUUID(), actor, email, change: "removed from the list", created_at: new Date().toISOString() });
    await localWrite(d);
  } else {
    await sql.query(`delete from ty_access where email = $1`, [email]);
    await sql.query(`insert into ty_access_log (id, actor, email, change) values ($1, $2, $3, $4)`, [crypto.randomUUID(), actor, email, "removed from the list"]);
  }
  cache.delete(email);
}

// ---- invites members send (the API checks the rules in invites.ts first) ----
export interface InviteRecord {
  id: string;
  inviter: string;
  email: string;
  createdAt: string;
  revokedAt: string | null;
}
const toInvite = (r: Row): InviteRecord => ({
  id: String(r.id),
  inviter: String(r.inviter),
  email: String(r.email),
  createdAt: String(r.created_at),
  revokedAt: r.revoked_at ? String(r.revoked_at) : null,
});

export async function invitesBy(inviter: string): Promise<InviteRecord[]> {
  const sql = await db();
  const rows = sql
    ? await selectJson(sql, `select * from ty_invites where inviter = $1 order by created_at desc`, [inviter])
    : (await local()).ty_invites.filter((r) => r.inviter === inviter).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return rows.map(toInvite);
}

export async function inviteByToken(tokenHash: string): Promise<InviteRecord | null> {
  const sql = await db();
  const row = sql ? (await selectJson(sql, `select * from ty_invites where token_hash = $1`, [tokenHash]))[0] : (await local()).ty_invites.find((r) => r.token_hash === tokenHash);
  return row ? toInvite(row) : null;
}

// One step: the invite, the friend's place on the list (as a member with the inviter's apps) and the log line.
export async function createInvite(inviter: string, email: string, apps: AppId[], tokenHash: string): Promise<InviteRecord> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await saveRecord(inviter, { email, role: "member", apps, status: "active", note: `Invited by ${inviter}` }, `invited by ${inviter}`);
  const sql = await db();
  if (!sql) {
    const d = await local();
    d.ty_invites.push({ id, inviter, email, token_hash: tokenHash, created_at: now, revoked_at: null });
    await localWrite(d);
  } else {
    await sql.query(`insert into ty_invites (id, inviter, email, token_hash) values ($1, $2, $3, $4)`, [id, inviter, email, tokenHash]);
  }
  return { id, inviter, email, createdAt: now, revokedAt: null };
}

// Taking an invite back also takes the email off the list, unless an admin has changed it since.
export async function revokeInvite(inv: InviteRecord) {
  const sql = await db();
  if (!sql) {
    const d = await local();
    d.ty_invites = d.ty_invites.map((r) => (r.id === inv.id ? { ...r, revoked_at: new Date().toISOString() } : r));
    await localWrite(d);
  } else {
    await sql.query(`update ty_invites set revoked_at = now() where id = $1`, [inv.id]);
  }
  const record = await readRecord(inv.email);
  if (record && record.createdBy === inv.inviter && record.note === `Invited by ${inv.inviter}`) await deleteRecord(inv.inviter, inv.email);
}

// ---- feedback from the apps ----
export interface FeedbackRecord {
  id: string;
  email: string;
  app: string;
  mood: number | null; // 1 (unhappy) – 5 (love it)
  kind: string;
  message: string;
  page: string;
  device: string;
  createdAt: string;
  resolvedAt: string | null;
}
const toFeedback = (r: Row): FeedbackRecord => ({
  id: String(r.id),
  email: String(r.email),
  app: String(r.app),
  mood: r.mood == null ? null : Number(r.mood),
  kind: String(r.kind),
  message: String(r.message),
  page: String(r.page ?? ""),
  device: String(r.device ?? ""),
  createdAt: String(r.created_at),
  resolvedAt: r.resolved_at ? String(r.resolved_at) : null,
});

export async function addFeedback(f: Omit<FeedbackRecord, "id" | "createdAt" | "resolvedAt">): Promise<FeedbackRecord> {
  const rec: FeedbackRecord = { ...f, id: crypto.randomUUID(), createdAt: new Date().toISOString(), resolvedAt: null };
  const sql = await db();
  if (!sql) {
    const d = await local();
    d.ty_feedback.push({ id: rec.id, email: f.email, app: f.app, mood: f.mood, kind: f.kind, message: f.message, page: f.page, device: f.device, created_at: rec.createdAt, resolved_at: null });
    await localWrite(d);
  } else {
    await sql.query(`insert into ty_feedback (id, email, app, mood, kind, message, page, device) values ($1, $2, $3, $4, $5, $6, $7, $8)`, [
      rec.id, f.email, f.app, f.mood, f.kind, f.message, f.page, f.device,
    ]);
  }
  return rec;
}

export async function listFeedback(limit = 200): Promise<FeedbackRecord[]> {
  const sql = await db();
  const rows = sql
    ? await selectJson(sql, `select * from ty_feedback order by created_at desc limit ${Math.floor(limit)}`, [])
    : (await local()).ty_feedback.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit);
  return rows.map(toFeedback);
}

// How many someone sent since `since`: a daily cap keeps a stuck button (or a script) from flooding the inbox.
export async function feedbackCountSince(email: string, since: string): Promise<number> {
  const sql = await db();
  if (!sql) return (await local()).ty_feedback.filter((r) => r.email === email && String(r.created_at) > since).length;
  const rows = (await sql.query(`select count(*)::int as n from ty_feedback where email = $1 and created_at > $2`, [email, since])) as { n: number }[];
  return rows[0]?.n ?? 0;
}

export async function setFeedbackResolved(id: string, resolved: boolean) {
  const sql = await db();
  if (!sql) {
    const d = await local();
    d.ty_feedback = d.ty_feedback.map((r) => (r.id === id ? { ...r, resolved_at: resolved ? new Date().toISOString() : null } : r));
    return localWrite(d);
  }
  await sql.query(`update ty_feedback set resolved_at = ${resolved ? "now()" : "null"} where id = $1`, [id]);
}
