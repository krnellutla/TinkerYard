// Idempotent schema: created on first use, so there's no SQL to run by hand.
// Rows for facts, files for bytes: the photo lives in Blob, the bill row keeps its pathname.
export const SCHEMA = [
  `create table if not exists bills (
    id uuid primary key,
    device_id text not null,
    merchant_name text,
    merchant_country text,
    merchant_contact text,
    bill_type text,
    bill_ref_masked text,
    bill_date date,
    due_date date,
    currency text,
    tax_mode text,
    printed_subtotal numeric,
    printed_tax_total numeric,
    printed_tax_rate_pct numeric,
    printed_total numeric,
    image_path text,
    model text,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists bills_device_idx on bills (device_id, created_at desc)`,
  `create table if not exists line_items (
    id uuid primary key,
    bill_id uuid not null references bills(id) on delete cascade,
    position int not null,
    description text not null,
    plain_words text,
    qty numeric,
    unit_price numeric,
    amount numeric not null,
    kind text not null,
    tax_rate_pct numeric,
    box_2d int[]
  )`,
  `create index if not exists line_items_bill_idx on line_items (bill_id)`,
  `create table if not exists promises (
    id uuid primary key,
    bill_id uuid not null references bills(id) on delete cascade,
    device_id text not null,
    expected_total numeric,
    prices_include_tax boolean,
    paid_on date,
    line_expected jsonb,
    unrecognised int[],
    created_at timestamptz not null default now()
  )`,
  `create index if not exists promises_bill_idx on promises (bill_id)`,
  `create table if not exists findings (
    id uuid primary key,
    bill_id uuid not null references bills(id) on delete cascade,
    line_item_id uuid references line_items(id),
    code text not null,
    verdict text not null,
    title text not null,
    maths text not null,
    charged numeric,
    expected numeric,
    diff numeric not null,
    created_at timestamptz not null default now()
  )`,
  // THE proof link: message -> line_item, with when it was sent and how many words changed.
  `create table if not exists messages (
    id uuid primary key,
    bill_id uuid not null references bills(id) on delete cascade,
    line_item_id uuid references line_items(id),
    finding_id uuid references findings(id),
    drafted_text text not null,
    drafted_by text not null,
    sent_text text,
    words_changed int,
    channel text,
    sent_at timestamptz,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists messages_bill_idx on messages (bill_id)`,
  // Photo bytes when Vercel Blob isn't configured. Kept out of "bills" so bill rows stay small;
  // bills.image_path holds the link ("db:<bill id>").
  `create table if not exists bill_photos (
    bill_id uuid primary key references bills(id) on delete cascade,
    content_type text not null,
    bytes bytea not null,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists messages_line_idx on messages (line_item_id)`,
];

export const TABLES = ["bills", "line_items", "promises", "findings", "messages"] as const;
export type Table = (typeof TABLES)[number];
