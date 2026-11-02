import "server-only";
import { neon } from "@neondatabase/serverless";
import { get as blobGet, put as blobPut } from "@vercel/blob";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { CheckResult, Extraction, ExtractedLine, Promise as BillPromise } from "./types";
import { maskDigits } from "./mask";
import { SCHEMA, TABLES, type Table } from "./db/schema";

// Postgres (Neon) when DATABASE_URL is set; otherwise a local JSON file so the app runs with zero setup.
// Photos go to private Vercel Blob when BLOB_READ_WRITE_TOKEN is set.
type Row = Record<string, unknown>;
type Sql = ReturnType<typeof neon>;

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

const assertTable = (t: string): Table => {
  if (!(TABLES as readonly string[]).includes(t)) throw new Error(`unknown table ${t}`);
  return t as Table;
};

// Read rows back as JSON so dates are "YYYY-MM-DD", timestamps ISO strings and arrays arrays.
async function selectJson(sql: Sql, query: string, params: unknown[]): Promise<Row[]> {
  const rows = (await sql.query(`select coalesce(json_agg(t), '[]'::json) as rows from (${query}) t`, params)) as { rows: Row[] }[];
  return rows[0]?.rows ?? [];
}

const DB_FILE = path.join(process.env.VERCEL ? os.tmpdir() : process.cwd(), ".data", "db.json");

async function localAll(): Promise<Record<string, Row[]>> {
  try {
    return JSON.parse(await fs.readFile(DB_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function localWrite(data: Record<string, Row[]>) {
  await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
  await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2));
}

async function insert(table: string, rows: Row[]) {
  const t = assertTable(table);
  const sql = await db();
  if (!sql) {
    const data = await localAll();
    data[t] = [...(data[t] ?? []), ...rows];
    return localWrite(data);
  }
  // One statement for any number of rows; column types come from the table itself.
  await sql.query(`insert into ${t} select * from json_populate_recordset(null::${t}, $1::json)`, [JSON.stringify(rows)]);
}

async function update(table: string, id: string, patch: Row) {
  const t = assertTable(table);
  const sql = await db();
  if (!sql) {
    const data = await localAll();
    data[t] = (data[t] ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r));
    return localWrite(data);
  }
  await sql.query(
    `update ${t} u set ${Object.keys(patch)
      .map((k) => `${k.replace(/[^a-z_]/g, "")} = p.${k.replace(/[^a-z_]/g, "")}`)
      .join(", ")} from json_populate_record(null::${t}, $2::json) p where u.id = $1`,
    [id, JSON.stringify(patch)],
  );
}

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

const DB_PHOTO = "db:"; // image_path prefix for photos kept in the bill_photos table

// Private Blob when configured, else the bill_photos table, else (local dev) not kept.
export async function uploadImage(billId: string, bytes: Buffer, mime: string): Promise<string | null> {
  let link: string;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const ext = mime.includes("pdf") ? "pdf" : "jpg";
    link = (await blobPut(`bills/${billId}.${ext}`, bytes, { access: "private", contentType: mime, allowOverwrite: true })).pathname;
  } else {
    const sql = await db();
    if (!sql) return null;
    await sql.query(
      `insert into bill_photos (bill_id, content_type, bytes) values ($1, $2, decode($3, 'base64'))
       on conflict (bill_id) do update set content_type = excluded.content_type, bytes = excluded.bytes`,
      [billId, mime, bytes.toString("base64")],
    );
    link = DB_PHOTO + billId;
  }
  await update("bills", billId, { image_path: link }); // the row keeps the link to the file
  return link;
}

// Stream a private photo back, only to the device that owns the bill.
export async function readImage(billId: string, deviceId: string): Promise<{ stream: ReadableStream; type: string } | null> {
  const b = await getBillRow(billId, deviceId);
  const p = b?.image_path;
  if (typeof p !== "string") return null;
  if (p.startsWith(DB_PHOTO)) {
    const sql = await db();
    if (!sql) return null;
    const rows = (await sql.query(`select content_type, encode(bytes, 'base64') as b64 from bill_photos where bill_id = $1`, [
      p.slice(DB_PHOTO.length),
    ])) as { content_type: string; b64: string }[];
    if (!rows[0]) return null;
    const bytes = Buffer.from(rows[0].b64, "base64");
    return { stream: new Blob([bytes]).stream(), type: rows[0].content_type };
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const res = await blobGet(p, { access: "private" });
  if (!res?.stream) return null;
  return { stream: res.stream, type: res.blob.contentType ?? "image/jpeg" };
}

export async function saveBill(deviceId: string, ex: Extraction, imagePath: string | null, model: string) {
  const billId = uuid();
  await insert("bills", [
    {
      id: billId,
      device_id: deviceId,
      merchant_name: ex.merchant_name,
      merchant_country: ex.merchant_country,
      merchant_contact: ex.merchant_whatsapp,
      bill_type: ex.bill_type,
      bill_ref_masked: maskDigits(ex.bill_number),
      bill_date: ex.bill_date,
      due_date: ex.due_date,
      currency: ex.currency,
      tax_mode: ex.tax_mode,
      printed_subtotal: ex.printed_subtotal,
      printed_tax_total: ex.printed_tax_total,
      printed_tax_rate_pct: ex.printed_tax_rate_pct,
      printed_total: ex.printed_total,
      image_path: imagePath,
      model,
      created_at: now(),
    },
  ]);
  const lineIds = ex.lines.map(() => uuid());
  if (ex.lines.length)
    await insert(
      "line_items",
      ex.lines.map((l, i) => ({
        id: lineIds[i],
        bill_id: billId,
        position: i,
        description: maskDigits(l.description),
        plain_words: l.plain_words,
        qty: l.qty,
        unit_price: l.unit_price,
        amount: l.amount,
        kind: l.kind,
        tax_rate_pct: l.tax_rate_pct,
        box_2d: l.box_2d,
      })),
    );
  return { billId, lineIds };
}

export async function saveCheck(billId: string, deviceId: string, lineIds: string[], promise: BillPromise, result: CheckResult) {
  // Promises are rows, so "what was I promised, and when did it change?" is a query.
  await insert("promises", [
    {
      id: uuid(),
      bill_id: billId,
      device_id: deviceId,
      expected_total: promise.expectedTotal,
      prices_include_tax: promise.pricesIncludeTax,
      paid_on: promise.paidOn,
      line_expected: promise.lineExpected,
      unrecognised: promise.unrecognised,
      created_at: now(),
    },
  ]);
  const ids: Record<string, string> = {};
  const rows = result.findings.map((f) => {
    const id = uuid();
    ids[f.id] = id;
    return {
      id,
      bill_id: billId,
      line_item_id: f.lineIndex != null ? (lineIds[f.lineIndex] ?? null) : null,
      code: f.id,
      verdict: f.verdict,
      title: f.title,
      maths: f.maths,
      charged: f.charged,
      expected: f.expected,
      diff: f.diff,
      created_at: now(),
    };
  });
  if (rows.length) await insert("findings", rows);
  return ids;
}

export async function saveDraft(m: {
  billId: string;
  lineItemId: string | null;
  findingId: string | null;
  text: string;
  source: "model" | "template";
}) {
  const id = uuid();
  await insert("messages", [
    {
      id,
      bill_id: m.billId,
      line_item_id: m.lineItemId, // the proof link: message → line_item
      finding_id: m.findingId,
      drafted_text: m.text,
      drafted_by: m.source,
      created_at: now(),
    },
  ]);
  return id;
}

export async function markSent(messageId: string, sentText: string, wordsChanged: number, channel: string) {
  await update("messages", messageId, { sent_text: sentText, words_changed: wordsChanged, channel, sent_at: now() });
}

// ---------- Reads for "My bills" ----------

export interface StoredBill {
  bill: Row;
  lines: Row[];
  promise: Row | null; // latest: history is rows, the newest one wins
  messages: Row[];
}

const num = (v: unknown) => (v == null ? null : Number(v));

export function toExtraction(bill: Row, lines: Row[]): Extraction {
  return {
    is_bill: true,
    merchant_name: (bill.merchant_name as string) ?? null,
    merchant_country: (bill.merchant_country as string) ?? null,
    merchant_whatsapp: (bill.merchant_contact as string) ?? null,
    bill_type: (bill.bill_type as string) ?? null,
    bill_number: (bill.bill_ref_masked as string) ?? null,
    bill_date: (bill.bill_date as string) ?? null,
    due_date: (bill.due_date as string) ?? null,
    period_start: null,
    period_end: null,
    currency: (bill.currency as string) ?? null,
    tax_mode: (bill.tax_mode as Extraction["tax_mode"]) ?? "unknown",
    printed_subtotal: num(bill.printed_subtotal),
    printed_tax_total: num(bill.printed_tax_total),
    printed_tax_rate_pct: num(bill.printed_tax_rate_pct),
    printed_total: num(bill.printed_total),
    lines: [...lines]
      .sort((a, b) => Number(a.position) - Number(b.position))
      .map(
        (l): ExtractedLine => ({
          description: String(l.description ?? ""),
          plain_words: String(l.plain_words ?? ""),
          qty: num(l.qty),
          unit_price: num(l.unit_price),
          amount: Number(l.amount),
          kind: l.kind as ExtractedLine["kind"],
          tax_rate_pct: num(l.tax_rate_pct),
          box_2d: Array.isArray(l.box_2d) && l.box_2d.length === 4 ? (l.box_2d as ExtractedLine["box_2d"]) : null,
        }),
      ),
  };
}

export function toPromise(p: Row | null): BillPromise {
  return {
    expectedTotal: num(p?.expected_total),
    pricesIncludeTax: (p?.prices_include_tax as boolean | null) ?? null,
    paidOn: (p?.paid_on as string) ?? null,
    lineExpected: (p?.line_expected as Record<number, number>) ?? {},
    unrecognised: (p?.unrecognised as number[]) ?? [],
  };
}

const newest = (rows: Row[]) => [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

export async function listBills(deviceId: string, limit = 50): Promise<StoredBill[]> {
  const sql = await db();
  if (!sql) {
    const data = await localAll();
    return newest((data.bills ?? []).filter((b) => b.device_id === deviceId))
      .slice(0, limit)
      .map((b) => ({
        bill: b,
        lines: (data.line_items ?? []).filter((l) => l.bill_id === b.id),
        promise: newest((data.promises ?? []).filter((p) => p.bill_id === b.id))[0] ?? null,
        messages: newest((data.messages ?? []).filter((m) => m.bill_id === b.id)),
      }));
  }
  const bills = await selectJson(sql, `select * from bills where device_id = $1 order by created_at desc limit $2`, [deviceId, limit]);
  if (!bills.length) return [];
  const ids = bills.map((b) => b.id);
  const [lines, promises, messages] = await Promise.all(
    (["line_items", "promises", "messages"] as const).map((t) => selectJson(sql, `select * from ${t} where bill_id = any($1::uuid[])`, [ids])),
  );
  const by = (rows: Row[], id: unknown) => rows.filter((r) => r.bill_id === id);
  return bills.map((bill) => ({
    bill,
    lines: by(lines, bill.id),
    promise: newest(by(promises, bill.id))[0] ?? null,
    messages: newest(by(messages, bill.id)),
  }));
}

async function getBillRow(id: string, deviceId: string): Promise<Row | null> {
  const sql = await db();
  if (!sql) return ((await localAll()).bills ?? []).find((b) => b.id === id && b.device_id === deviceId) ?? null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (await selectJson(sql, `select * from bills where id = $1 and device_id = $2`, [id, deviceId]))[0] ?? null;
}

export async function getBill(id: string, deviceId: string): Promise<StoredBill | null> {
  const all = await listBills(deviceId, 200);
  return all.find((b) => b.bill.id === id) ?? null;
}

// Photos are private: the page asks our server, which checks the device before streaming it.
export function photoUrl(bill: Row, deviceId: string): string | null {
  const p = bill.image_path;
  if (typeof p !== "string" || p.endsWith(".pdf")) return null;
  return `/api/bills/${bill.id}/photo?deviceId=${encodeURIComponent(deviceId)}`;
}

// Earlier lines from the same shop, on this device, for "has this shown up before?"
export async function pastLines(deviceId: string, merchant: string | null, excludeBillId: string) {
  if (!merchant) return [];
  const all = await listBills(deviceId, 200);
  const key = merchant.trim().toLowerCase();
  return all
    .filter((b) => b.bill.id !== excludeBillId && String(b.bill.merchant_name ?? "").trim().toLowerCase() === key)
    .flatMap((b) => toExtraction(b.bill, b.lines).lines.map((l) => ({ ...l, bill_date: (b.bill.bill_date as string) ?? String(b.bill.created_at).slice(0, 10) })));
}
