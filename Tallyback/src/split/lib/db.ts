import "server-only";
import { neon } from "@neondatabase/serverless";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

// Postgres (Neon) when DATABASE_URL is set; otherwise a local JSON file so the app runs with zero setup.
// The rest of the Split tab only uses the four calls below (insert, update, select, and the table names),
// so the same code runs against either.
export type Row = Record<string, unknown>;
type Sql = ReturnType<typeof neon>;

export type Table = "sb_groups" | "sb_members" | "sb_expenses" | "sb_comments" | "sb_activity" | "sb_tabs";
const TABLES: Table[] = ["sb_groups", "sb_members", "sb_expenses", "sb_comments", "sb_activity", "sb_tabs"];

// Idempotent: created on first use, so there's no SQL to run by hand.
// Amounts are cents. paid/owed are {member id: cents}; split is what was typed, for editing.
// Deleting sets deleted_at, so an expense can be restored like in any expense-sharing app.
const SCHEMA = [
  `create table if not exists sb_groups (
    id uuid primary key,
    name text not null,
    kind text not null default 'other',
    currency text not null,
    simplify boolean not null default true,
    created_by text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz
  )`,
  `create table if not exists sb_members (
    id uuid primary key,
    group_id uuid not null references sb_groups(id),
    name text not null,
    email text,
    user_id text,
    created_at timestamptz not null default now(),
    removed_at timestamptz
  )`,
  `create index if not exists sb_members_group_idx on sb_members (group_id)`,
  `create index if not exists sb_members_user_idx on sb_members (user_id)`,
  `create index if not exists sb_members_email_idx on sb_members (email)`,
  `create table if not exists sb_expenses (
    id uuid primary key,
    group_id uuid not null references sb_groups(id),
    kind text not null default 'expense',
    description text not null,
    amount bigint not null,
    category text not null default 'general',
    date date not null,
    paid jsonb not null,
    owed jsonb not null,
    split jsonb,
    notes text not null default '',
    created_by text not null,
    created_by_name text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz
  )`,
  `create index if not exists sb_expenses_group_idx on sb_expenses (group_id, date desc)`,
  // The receipt photo: a TallyBack bill (scanned, or kept as a plain photo). Added after launch, so it's
  // an "add column if not exists"; rows in the local JSON file simply don't have it (read as null).
  `alter table sb_expenses add column if not exists receipt_bill_id uuid`,
  // Repeating expenses: how often, and the date the next copy is due (null: doesn't repeat).
  `alter table sb_expenses add column if not exists repeat_interval text not null default 'never'`,
  `alter table sb_expenses add column if not exists next_repeat date`,
  // Spent in another currency: what was paid there, and the rate used to convert it into the group's.
  `alter table sb_expenses add column if not exists original_currency text`,
  `alter table sb_expenses add column if not exists original_amount bigint`,
  `alter table sb_expenses add column if not exists fx_rate double precision`,
  `create table if not exists sb_comments (
    id uuid primary key,
    group_id uuid not null references sb_groups(id),
    expense_id uuid not null references sb_expenses(id),
    user_id text not null,
    author text not null,
    body text not null,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists sb_comments_group_idx on sb_comments (group_id)`,
  `create index if not exists sb_comments_expense_idx on sb_comments (expense_id)`,
  `alter table sb_comments add column if not exists deleted_at timestamptz`,
  `create table if not exists sb_activity (
    id uuid primary key,
    group_id uuid not null references sb_groups(id),
    user_id text not null,
    actor text not null,
    text text not null,
    expense_id uuid,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists sb_activity_group_idx on sb_activity (group_id, created_at desc)`,
  // Trip mode: { destination, start, end, currency }, or null.
  `alter table sb_groups add column if not exists trip jsonb`,
  // A night of rounds at a bar: who's at the table, in turn order, and each round so far.
  `create table if not exists sb_tabs (
    id uuid primary key,
    group_id uuid not null references sb_groups(id),
    place text not null default '',
    people jsonb not null,
    turns jsonb not null default '[]',
    created_by text not null,
    created_at timestamptz not null default now(),
    ended_at timestamptz
  )`,
  `create index if not exists sb_tabs_group_idx on sb_tabs (group_id)`,
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

// ---- local file ----
const DB_FILE = path.join(process.env.VERCEL ? os.tmpdir() : process.cwd(), ".data", "splitbill.json");
type Local = Record<Table, Row[]>;

async function localAll(): Promise<Local> {
  let data: Partial<Local> = {};
  try {
    data = JSON.parse(await fs.readFile(DB_FILE, "utf8"));
  } catch {}
  return Object.fromEntries(TABLES.map((t) => [t, data[t] ?? []])) as Local;
}

async function localWrite(data: Local) {
  await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
  await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2));
}

// ---- the four calls ----
const COL = /^[a-z_]+$/; // column names come from code, never from a request; checked anyway
const col = (c: string) => {
  if (!COL.test(c)) throw new Error(`bad column ${c}`);
  return c;
};

// Equality filters: { group_id: "…" }, { user_id: null } (is null), { id: ["…", "…"] } (any of).
export type Where = Record<string, string | number | boolean | null | string[]>;

function matches(r: Row, where: Where) {
  return Object.entries(where).every(([k, v]) => (v === null ? r[k] == null : Array.isArray(v) ? v.includes(String(r[k])) : r[k] === v));
}

export async function insert(table: Table, row: Row) {
  const sql = await db();
  if (!sql) {
    const data = await localAll();
    data[table].push(row);
    return localWrite(data);
  }
  // Column types come from the table itself.
  await sql.query(`insert into ${table} select * from json_populate_record(null::${table}, $1::json)`, [JSON.stringify(row)]);
}

export async function update(table: Table, where: Where, patch: Row) {
  const cols = Object.keys(patch).map(col);
  if (!cols.length) return;
  const sql = await db();
  if (!sql) {
    const data = await localAll();
    data[table] = data[table].map((r) => (matches(r, where) ? { ...r, ...patch } : r));
    return localWrite(data);
  }
  const { clause, params } = whereSql(where, 2);
  await sql.query(
    `update ${table} set (${cols.join(", ")}) = (select ${cols.join(", ")} from json_populate_record(null::${table}, $1::json)) where ${clause}`,
    [JSON.stringify(patch), ...params],
  );
}

export async function select(table: Table, where: Where, order?: { by: string; desc?: boolean; limit?: number }): Promise<Row[]> {
  const sql = await db();
  if (!sql) {
    let rows = (await localAll())[table].filter((r) => matches(r, where));
    if (order) {
      const k = order.by;
      rows = rows.sort((a, b) => String(a[k]).localeCompare(String(b[k])) * (order.desc ? -1 : 1));
      if (order.limit) rows = rows.slice(0, order.limit);
    }
    return rows;
  }
  const { clause, params } = whereSql(where, 1);
  const tail = order ? ` order by ${col(order.by)} ${order.desc ? "desc" : "asc"}${order.limit ? ` limit ${Math.floor(order.limit)}` : ""}` : "";
  // Read rows back as JSON so timestamps are ISO strings, dates are YYYY-MM-DD and jsonb is plain objects.
  const out = (await sql.query(`select coalesce(json_agg(t), '[]'::json) as rows from (select * from ${table} where ${clause}${tail}) t`, params)) as {
    rows: Row[];
  }[];
  return out[0]?.rows ?? [];
}

function whereSql(where: Where, first: number) {
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(where)) {
    if (v === null) parts.push(`${col(k)} is null`);
    else if (Array.isArray(v)) {
      params.push(v);
      parts.push(`${col(k)} = any($${first + params.length - 1})`);
    } else {
      params.push(v);
      parts.push(`${col(k)} = $${first + params.length - 1}`);
    }
  }
  // Untyped parameters take the column's type, so uuid columns keep using their indexes.
  return { clause: parts.length ? parts.join(" and ") : "true", params };
}
