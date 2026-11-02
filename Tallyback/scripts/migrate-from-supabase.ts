// One-off: copy TallyBack's data from Supabase to Neon Postgres + private Vercel Blob.
// Safe to re-run: existing rows are skipped, photos are overwritten in place.
// Usage: npx tsx scripts/migrate-from-supabase.ts   (reads .env.local)
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { neon } from "@neondatabase/serverless";
import { put } from "@vercel/blob";
import { SCHEMA, TABLES } from "../src/lib/db/schema";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const need = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL"]; // BLOB_READ_WRITE_TOKEN optional
const missing = need.filter((k) => !process.env[k]);
if (missing.length) throw new Error(`Missing in .env.local: ${missing.join(", ")}`);

const sbUrl = process.env.SUPABASE_URL!.replace(/\/(rest|storage)\/v1\/?.*$/, "").replace(/\/+$/, "");
const sb = createClient(sbUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  for (const stmt of SCHEMA) await sql.query(stmt);

  // Parents before children so foreign keys hold.
  for (const t of TABLES) {
    const { data, error } = await sb.from(t).select("*");
    if (error) throw new Error(`${t}: ${error.message}`);
    const rows = data ?? [];
    if (rows.length)
      await sql.query(`insert into ${t} select * from json_populate_recordset(null::${t}, $1::json) on conflict (id) do nothing`, [JSON.stringify(rows)]);
    const [{ n }] = (await sql.query(`select count(*)::int as n from ${t}`)) as { n: number }[];
    console.log(`${t.padEnd(11)} supabase ${String(rows.length).padStart(4)}  →  neon ${n}`);
  }

  const { data: bills } = await sb.from("bills").select("id, image_path").not("image_path", "is", null);
  let copied = 0;
  for (const b of bills ?? []) {
    const { data: file, error } = await sb.storage.from("bills").download(b.image_path);
    if (error || !file) {
      console.warn(`photo for ${b.id}: ${error?.message ?? "missing"}`);
      continue;
    }
    const ext = String(b.image_path).endsWith(".pdf") ? "pdf" : "jpg";
    const type = file.type || (ext === "pdf" ? "application/pdf" : "image/jpeg");
    const bytes = Buffer.from(await file.arrayBuffer());
    let link: string;
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      link = (await put(`bills/${b.id}.${ext}`, bytes, { access: "private", contentType: type, allowOverwrite: true })).pathname;
    } else {
      await sql.query(
        `insert into bill_photos (bill_id, content_type, bytes) values ($1, $2, decode($3, 'base64'))
         on conflict (bill_id) do update set content_type = excluded.content_type, bytes = excluded.bytes`,
        [b.id, type, bytes.toString("base64")],
      );
      link = `db:${b.id}`;
    }
    await sql.query(`update bills set image_path = $1 where id = $2`, [link, b.id]);
    copied++;
  }
  console.log(`photos      supabase ${String(bills?.length ?? 0).padStart(4)}  →  ${process.env.BLOB_READ_WRITE_TOKEN ? "blob" : "neon"} ${copied}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
