-- Run once in Supabase SQL Editor (My bills: reopen with highlights and the shop's WhatsApp).
alter table line_items add column if not exists box_2d int[];
alter table bills add column if not exists merchant_contact text;  -- business number printed on the bill, not the customer's
create index if not exists bills_device_idx on bills (device_id, created_at desc);
