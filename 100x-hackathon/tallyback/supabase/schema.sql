-- BillShield schema. Rows for facts, files for bytes. Store the least.
-- Not stored: customer name, phone, address, account/card numbers (masked to last 4 before insert).

create table bills (
  id uuid primary key,
  device_id text not null,            -- anonymous per-browser id, no login
  merchant_name text,
  merchant_country text,
  bill_type text,
  bill_ref_masked text,               -- e.g. FP••••••••0987
  bill_date date,
  due_date date,
  currency text,
  tax_mode text,
  printed_subtotal numeric,
  printed_tax_total numeric,
  printed_tax_rate_pct numeric,
  printed_total numeric,
  merchant_contact text,              -- business number printed on the bill, not the customer's
  image_path text,                    -- key in storage bucket "bills"; the row keeps the link
  model text,
  created_at timestamptz not null default now()
);
create index on bills (device_id, created_at desc);

create table line_items (
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
  box_2d int[]                        -- where the row sits on the photo, for highlights
);
create index on line_items (bill_id);

-- History is a row: each time the user states a promise we add one.
create table promises (
  id uuid primary key,
  bill_id uuid not null references bills(id) on delete cascade,
  device_id text not null,
  expected_total numeric,
  prices_include_tax boolean,
  paid_on date,
  line_expected jsonb,
  unrecognised int[],
  created_at timestamptz not null default now()
);

create table findings (
  id uuid primary key,
  bill_id uuid not null references bills(id) on delete cascade,
  line_item_id uuid references line_items(id),
  code text not null,
  verdict text not null,              -- wrong | unexplained | info
  title text not null,
  maths text not null,
  charged numeric,
  expected numeric,
  diff numeric not null,
  created_at timestamptz not null default now()
);

-- THE proof link: message -> line_item, with when it was sent and how many words changed.
create table messages (
  id uuid primary key,
  bill_id uuid not null references bills(id) on delete cascade,
  line_item_id uuid references line_items(id),
  finding_id uuid references findings(id),
  drafted_text text not null,
  drafted_by text not null,           -- model | template
  sent_text text,
  words_changed int,
  channel text,                       -- whatsapp | copied | other
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index on messages (line_item_id);

-- Lock every table. No policies on purpose: the browser never talks to Supabase.
-- Only our server does, with the secret key, which bypasses RLS.
alter table bills enable row level security;
alter table line_items enable row level security;
alter table promises enable row level security;
alter table findings enable row level security;
alter table messages enable row level security;

-- Storage: create a PRIVATE bucket named "bills" in the Supabase dashboard.

-- The questions this must answer:
-- 1. Has this charge shown up on my earlier bills?
--    select b.bill_date, li.amount from line_items li join bills b on b.id = li.bill_id
--    where b.device_id = $1 and lower(li.description) = lower($2) order by b.bill_date;
-- 2. Which messages did I send, and about which line?
--    select m.sent_at, m.words_changed, li.description, li.amount from messages m
--    join line_items li on li.id = m.line_item_id join bills b on b.id = m.bill_id
--    where b.device_id = $1 and m.sent_at is not null;
-- 3. What was I promised, and when did it change?
--    select created_at, expected_total, prices_include_tax from promises where bill_id = $1 order by created_at;
