import "server-only";
import { neon } from "@neondatabase/serverless";
import { get as blobGet, put as blobPut } from "@vercel/blob";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { CheckResult, Extraction, ExtractedLine, Promise as BillPromise } from "./types";
import { maskDigits } from "./mask";
import { wordsChanged } from "./message";
import { SCHEMA, TABLES, type Table } from "./db/schema";
import type { Owner } from "@signin/owner";
import { ATTACHMENT_MODEL } from "./upload";

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

/**
 * Uploads receipt bytes to private Vercel Blob (if `BLOB_READ_WRITE_TOKEN` is set) or the `bill_photos` table,
 * updating `bills.image_path` with the storage reference.
 * @param billId Target bill UUID.
 * @param bytes Raw image or PDF buffer.
 * @param mime MIME type of the uploaded file.
 * @returns Storage path (`bills/<id>.<ext>` or `db:<id>`), or `null` in local JSON dev mode.
 */
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

/**
 * Streams a private receipt image back only if the caller (`owner`) owns the bill.
 * @param billId Target bill UUID.
 * @param owner Verified session/device owner descriptor.
 * @returns Readable stream and content type, or `null` if not found or unauthorized.
 */
export async function readImage(billId: string, owner: Owner): Promise<{ stream: ReadableStream; type: string } | null> {
  const b = await findBill(billId, owner);
  return b ? streamPhoto(b) : null;
}

/**
 * Streams a receipt photo without a bill-owner check for shared Split expenses;
 * callers must verify group membership before invoking this function.
 * @param billId Bill UUID attached to the group expense.
 * @returns Readable stream and content type, or `null` if missing.
 */
export async function streamBillPhoto(billId: string): Promise<{ stream: ReadableStream; type: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(billId)) return null;
  const sql = await db();
  const b = sql
    ? ((await selectJson(sql, `select * from bills where id = $1`, [billId]))[0] ?? null)
    : (((await localAll()).bills ?? []).find((r) => r.id === billId) ?? null);
  return b ? streamPhoto(b) : null;
}

const DATA_SVG_B64 = "data:image/svg+xml;base64,";
const DATA_SVG_UTF8 = "data:image/svg+xml;utf8,";

async function streamPhoto(b: Row): Promise<{ stream: ReadableStream; type: string } | null> {
  const p = b.image_path;
  if (typeof p !== "string") return null;
  if (p.startsWith(DATA_SVG_B64)) {
    const bytes = Buffer.from(p.slice(DATA_SVG_B64.length), "base64");
    return { stream: new Blob([bytes]).stream(), type: "image/svg+xml" };
  }
  if (p.startsWith(DATA_SVG_UTF8)) {
    const bytes = Buffer.from(decodeURIComponent(p.slice(DATA_SVG_UTF8.length)), "utf8");
    return { stream: new Blob([bytes]).stream(), type: "image/svg+xml" };
  }
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

/**
 * Persists a normalized bill extraction and its ordered `line_items` (masking digit sequences on sensitive refs).
 * @param owner Authenticated user / device owner.
 * @param ex Normalized OCR extraction.
 * @param imagePath Optional storage reference from `uploadImage()`.
 * @param model Winning `"provider/model"` string (or `ATTACHMENT_MODEL` for Split-only photos).
 * @returns Created `billId` and parallel array of generated `lineIds`.
 */
export async function saveBill(owner: Owner, ex: Extraction, imagePath: string | null, model: string) {
  const billId = uuid();
  await insert("bills", [
    {
      id: billId,
      device_id: owner.deviceId,
      user_id: owner.userId,
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

/**
 * Appends a user promise snapshot and atomically replaces current `findings` rows for `billId`.
 * @param billId Target bill UUID.
 * @param owner Owner descriptor recording `device_id`.
 * @param lineIds Ordered line item UUIDs matching `ex.lines` indexes.
 * @param promise User expectations (`expectedTotal`, `pricesIncludeTax`, `paidOn`, disputes).
 * @param result Deterministic check result from `runChecks()`.
 * @returns Map of finding code (`f.id`) to inserted finding UUID.
 */
export async function saveCheck(billId: string, owner: Owner, lineIds: string[], promise: BillPromise, result: CheckResult) {
  const ids: Record<string, string> = {};
  const promiseRow = {
    id: uuid(),
    bill_id: billId,
    device_id: owner.deviceId,
    expected_total: promise.expectedTotal,
    prices_include_tax: promise.pricesIncludeTax,
    paid_on: promise.paidOn,
    line_expected: promise.lineExpected,
    unrecognised: promise.unrecognised,
    created_at: now(),
  };
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
  const sql = await db();
  if (!sql) {
    const data = await localAll();
    data.promises = [...(data.promises ?? []), promiseRow];
    data.findings = [...(data.findings ?? []).filter((f) => f.bill_id !== billId), ...rows];
    await localWrite(data);
    return ids;
  }
  const stmts = [
    sql.query(`insert into promises select * from json_populate_recordset(null::promises, $1::json)`, [JSON.stringify([promiseRow])]),
    sql.query(`delete from findings where bill_id = $1`, [billId]),
  ];
  if (rows.length) {
    stmts.push(sql.query(`insert into findings select * from json_populate_recordset(null::findings, $1::json)`, [JSON.stringify(rows)]));
  }
  await sql.transaction(stmts);
  return ids;
}

/**
 * Records a drafted dispute message linked to its bill, finding, and specific `line_item_id`.
 * @param m Draft metadata including generated text and `"model"` or `"template"` provenance.
 * @returns Generated message UUID.
 */
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

/**
 * Marks a drafted dispute message as sent and computes word edit distance server-side against `drafted_text`.
 * @param billId Parent bill UUID.
 * @param messageId Message UUID.
 * @param sentText Final text sent by the user.
 * @param fallbackDrafted Client draft fallback used only if no persisted draft row exists.
 * @param channel Delivery channel (`"whatsapp"`, `"copied"`, `"other"`).
 * @returns Number of words changed between the persisted draft and `sentText`.
 */
export async function markSent(
  billId: string,
  messageId: string,
  sentText: string,
  fallbackDrafted: string,
  channel: string,
): Promise<number> {
  const sql = await db();
  if (!sql) {
    const data = await localAll();
    const row = (data.messages ?? []).find((m) => m.id === messageId && m.bill_id === billId);
    const changed = wordsChanged(typeof row?.drafted_text === "string" ? row.drafted_text : fallbackDrafted, sentText);
    if (!row) return changed;
    await update("messages", messageId, { sent_text: sentText, words_changed: changed, channel, sent_at: now() });
    return changed;
  }
  if (!/^[0-9a-f-]{36}$/i.test(messageId)) return wordsChanged(fallbackDrafted, sentText);
  const existing = await selectJson(sql, `select drafted_text from messages where id = $1 and bill_id = $2`, [messageId, billId]);
  const draftedText = typeof existing[0]?.drafted_text === "string" ? existing[0].drafted_text : fallbackDrafted;
  const changed = wordsChanged(draftedText, sentText);
  if (existing[0]) {
    await sql.query(
      `update messages set sent_text = $3, words_changed = $4, channel = $5, sent_at = now() where id = $1 and bill_id = $2`,
      [messageId, billId, sentText, changed, channel],
    );
  }
  return changed;
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

// Who can see a bill: the account that owns it, or the device that made it if no account has claimed it.
const ownerSql = (owner: Owner, n: number) =>
  owner.userId ? { where: `user_id = $${n}`, param: owner.userId } : { where: `device_id = $${n} and user_id is null`, param: owner.deviceId };
const ownsRow = (b: Row, owner: Owner) => (owner.userId ? b.user_id === owner.userId : b.device_id === owner.deviceId && !b.user_id);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Attaches unclaimed guest bills created on a valid UUID `deviceId` to the signed-in user's account.
 * @param owner Owner containing authenticated `userId` and UUID `deviceId`.
 */
export async function claimDevice(owner: Owner) {
  if (!owner.userId || !UUID_RE.test(owner.deviceId)) return;
  const sql = await db();
  if (!sql) {
    const data = await localAll();
    if (!(data.bills ?? []).some((b) => b.device_id === owner.deviceId && !b.user_id)) return;
    data.bills = (data.bills ?? []).map((b) => (b.device_id === owner.deviceId && !b.user_id ? { ...b, user_id: owner.userId } : b));
    return localWrite(data);
  }
  await sql.query(`update bills set user_id = $1 where device_id = $2 and user_id is null`, [owner.userId, owner.deviceId]);
}

export async function listBills(owner: Owner, limit = 50): Promise<StoredBill[]> {
  const sql = await db();
  if (!sql) {
    const data = await localAll();
    return newest((data.bills ?? []).filter((b) => ownsRow(b, owner) && b.model !== ATTACHMENT_MODEL))
      .slice(0, limit)
      .map((b) => ({
        bill: b,
        lines: (data.line_items ?? []).filter((l) => l.bill_id === b.id),
        promise: newest((data.promises ?? []).filter((p) => p.bill_id === b.id))[0] ?? null,
        messages: newest((data.messages ?? []).filter((m) => m.bill_id === b.id)),
      }));
  }
  const o = ownerSql(owner, 1);
  const bills = await selectJson(sql, `select * from bills where ${o.where} and model is distinct from '${ATTACHMENT_MODEL}' order by created_at desc limit $2`, [o.param, limit]);
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

// The bill row, only if this owner may see it.
export async function findBill(id: string, owner: Owner): Promise<Row | null> {
  const sql = await db();
  if (!sql) return ((await localAll()).bills ?? []).find((b) => b.id === id && ownsRow(b, owner)) ?? null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const o = ownerSql(owner, 2);
  return (await selectJson(sql, `select * from bills where id = $1 and ${o.where}`, [id, o.param]))[0] ?? null;
}

/**
 * Fetches one stored bill with its ordered line items, latest promise, and message history if owned by `owner`.
 * @param id Bill UUID.
 * @param owner Verified session/device owner.
 * @returns Full `StoredBill`, or `null` if not found or unauthorized.
 */
export async function getBill(id: string, owner: Owner): Promise<StoredBill | null> {
  const bill = await findBill(id, owner);
  if (!bill) return null;
  const sql = await db();
  if (!sql) {
    const data = await localAll();
    return {
      bill,
      lines: (data.line_items ?? []).filter((l) => l.bill_id === id),
      promise: newest((data.promises ?? []).filter((p) => p.bill_id === id))[0] ?? null,
      messages: newest((data.messages ?? []).filter((m) => m.bill_id === id)),
    };
  }
  const [lines, promises, messages] = await Promise.all([
    selectJson(sql, `select * from line_items where bill_id = $1 order by position asc`, [id]),
    selectJson(sql, `select * from promises where bill_id = $1 order by created_at desc limit 1`, [id]),
    selectJson(sql, `select * from messages where bill_id = $1 order by created_at desc`, [id]),
  ]);
  return { bill, lines, promise: promises[0] ?? null, messages };
}

// Photos are private: the page asks our server, which checks the owner before streaming it.
export function photoUrl(bill: Row, deviceId: string): string | null {
  const p = bill.image_path;
  if (typeof p !== "string" || p.endsWith(".pdf")) return null;
  return `/api/tallyback/bills/${bill.id}/photo?deviceId=${encodeURIComponent(deviceId)}`;
}

// Earlier lines from the same shop, for this owner, for "has this shown up before?"
export async function pastLines(owner: Owner, merchant: string | null, excludeBillId: string) {
  if (!merchant) return [];
  const key = merchant.trim().toLowerCase();
  const sql = await db();
  if (!sql) {
    const all = await listBills(owner, 200);
    return all
      .filter((b) => b.bill.id !== excludeBillId && String(b.bill.merchant_name ?? "").trim().toLowerCase() === key)
      .flatMap((b) => toExtraction(b.bill, b.lines).lines.map((l) => ({ ...l, bill_date: (b.bill.bill_date as string) ?? String(b.bill.created_at).slice(0, 10) })));
  }
  if (!UUID_RE.test(excludeBillId)) return [];
  const o = ownerSql(owner, 1);
  const rows = await selectJson(
    sql,
    `select l.*, b.bill_date, b.created_at as bill_created_at
     from line_items l
     join bills b on b.id = l.bill_id
     where ${o.where}
       and b.id <> $2::uuid
       and lower(trim(coalesce(b.merchant_name, ''))) = $3
       and b.model is distinct from '${ATTACHMENT_MODEL}'
     order by b.created_at desc, l.position asc
     limit 500`,
    [o.param, excludeBillId, key],
  );
  return rows.map((r) => ({
    ...toExtraction({} as Row, [r]).lines[0],
    bill_date: (r.bill_date as string) ?? String(r.bill_created_at).slice(0, 10),
  }));
}
