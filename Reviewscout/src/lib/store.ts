import "server-only";
import { neon } from "@neondatabase/serverless";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { Found } from "./youtube";

// Postgres (Neon) when DATABASE_URL is set; otherwise a local JSON file so the app runs with zero setup.
// One row per product search. The collected transcripts (corpus) are kept so follow-up questions
// are answered from the same videos without asking YouTube again.
type Row = Record<string, unknown>;
type Sql = ReturnType<typeof neon>;

// Idempotent: created on first use, so there's no SQL to run by hand.
const SCHEMA = [
  `create table if not exists scout_searches (
    id uuid primary key,
    device_id text not null,
    topic text not null,
    n_videos int not null,
    with_comments boolean not null,
    corpus text not null,
    found jsonb not null,
    messages jsonb not null,
    model text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  `create index if not exists scout_searches_device_idx on scout_searches (device_id, created_at desc)`,
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

// Read rows back as JSON so timestamps are ISO strings and jsonb is plain objects.
async function selectJson(sql: Sql, query: string, params: unknown[]): Promise<Row[]> {
  const rows = (await sql.query(`select coalesce(json_agg(t), '[]'::json) as rows from (${query}) t`, params)) as { rows: Row[] }[];
  return rows[0]?.rows ?? [];
}

const DB_FILE = path.join(process.env.VERCEL ? os.tmpdir() : process.cwd(), ".data", "db.json");

async function localAll(): Promise<Row[]> {
  try {
    return JSON.parse(await fs.readFile(DB_FILE, "utf8")).scout_searches ?? [];
  } catch {
    return [];
  }
}

async function localWrite(rows: Row[]) {
  await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
  await fs.writeFile(DB_FILE, JSON.stringify({ scout_searches: rows }, null, 2));
}

const now = () => new Date().toISOString();
const newest = (rows: Row[]) => [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

export interface ScoutTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ScoutSearch {
  id: string;
  topic: string;
  nVideos: number;
  withComments: boolean;
  corpus: string;
  found: Found[];
  messages: ScoutTurn[]; // as shown in the chat: the product question first
  createdAt: string;
}

const toSearch = (r: Row): ScoutSearch => ({
  id: String(r.id),
  topic: String(r.topic),
  nVideos: Number(r.n_videos),
  withComments: !!r.with_comments,
  corpus: String(r.corpus ?? ""),
  found: (r.found as Found[]) ?? [],
  messages: (r.messages as ScoutTurn[]) ?? [],
  createdAt: String(r.created_at),
});

export async function saveSearch(deviceId: string, s: Omit<ScoutSearch, "id" | "createdAt">): Promise<string> {
  const row = {
    id: crypto.randomUUID(),
    device_id: deviceId,
    topic: s.topic,
    n_videos: s.nVideos,
    with_comments: s.withComments,
    corpus: s.corpus,
    found: s.found,
    messages: s.messages,
    model: null,
    created_at: now(),
    updated_at: now(),
  };
  const sql = await db();
  if (!sql) await localWrite([...(await localAll()), row]);
  // Column types come from the table itself.
  else await sql.query(`insert into scout_searches select * from json_populate_record(null::scout_searches, $1::json)`, [JSON.stringify(row)]);
  return row.id;
}

export async function saveTurns(id: string, messages: ScoutTurn[], model: string) {
  const sql = await db();
  if (!sql) return localWrite((await localAll()).map((r) => (r.id === id ? { ...r, messages, model, updated_at: now() } : r)));
  await sql.query(`update scout_searches set messages = $2::jsonb, model = $3, updated_at = now() where id = $1`, [id, JSON.stringify(messages), model]);
}

export async function getSearch(id: string, deviceId: string): Promise<ScoutSearch | null> {
  const sql = await db();
  if (!sql) {
    const row = (await localAll()).find((r) => r.id === id && r.device_id === deviceId);
    return row ? toSearch(row) : null;
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await selectJson(sql, `select * from scout_searches where id = $1 and device_id = $2`, [id, deviceId]);
  return rows[0] ? toSearch(rows[0]) : null;
}

// Newest first. The corpus is left out (empty): a list doesn't need 100 KB of transcripts per row.
export async function listSearches(deviceId: string, limit = 50): Promise<ScoutSearch[]> {
  const sql = await db();
  const rows = sql
    ? await selectJson(sql, `select id, topic, n_videos, with_comments, found, messages, created_at from scout_searches where device_id = $1 order by created_at desc limit $2`, [deviceId, limit])
    : newest((await localAll()).filter((r) => r.device_id === deviceId)).slice(0, limit);
  return rows.map((r) => ({ ...toSearch(r), corpus: "" }));
}
