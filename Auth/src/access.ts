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
async function local(): Promise<{ ty_access: Row[]; ty_access_log: Row[] }> {
  try {
    const d = JSON.parse(await fs.readFile(DB_FILE, "utf8"));
    return { ty_access: d.ty_access ?? [], ty_access_log: d.ty_access_log ?? [] };
  } catch {
    return { ty_access: [], ty_access_log: [] };
  }
}
async function localWrite(d: { ty_access: Row[]; ty_access_log: Row[] }) {
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
