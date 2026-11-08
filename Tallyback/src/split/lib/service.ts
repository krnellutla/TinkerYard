import "server-only";
import { z } from "zod";
import { insert, select, update, type Row } from "./db";
import { debts, myShare, netBalances, type Entry } from "./balances";
import { CURRENCIES, formatMoney, isSpendCurrency, matchesConversion } from "./money";
import { ratesFor } from "./fx";
import { checkPaid, splitAmount, type Amounts, type Split } from "./split";
import { findBill, streamBillPhoto } from "@tallyback/lib/store";
import { receiptActivity, receiptDecision } from "./receipt";
import { dueRepeats, nextRepeat, REPEATS, type Repeat } from "./repeat";
import { CATEGORIES, GROUP_KINDS, type Activity, type Comment, type Dashboard, type Expense, type Friend, type GroupDetail, type GroupKind, type Member } from "./types";

// Everything the Split tab does, with the rules in one place. Identity always comes from the session (Me),
// never from the request body. You can see a group when you're one of its members: added by your
// account, or invited by your email address (the invite becomes yours the first time you open it).

export interface Me {
  id: string;
  email: string;
}

// A refusal the person should see (bad input, not allowed, not found), as opposed to a crash.
export class Problem extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const lower = (e: string) => e.trim().toLowerCase();
const nameFromEmail = (email: string) => {
  const local = email.split("@")[0].replace(/[._-]+/g, " ").trim();
  return local ? local[0].toUpperCase() + local.slice(1) : email;
};

// ---- input shapes ----
const enumOf = <T extends string>(ids: readonly T[]) => z.enum(ids as unknown as [T, ...T[]]);
const memberIn = z.object({
  name: z.string().trim().min(1, "Every member needs a name.").max(60),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email("That email doesn't look right.").max(200)]).optional(),
});
const groupIn = z.object({
  name: z.string().trim().min(1, "Give the group a name.").max(80),
  kind: enumOf(GROUP_KINDS.map((k) => k.id)),
  currency: enumOf(CURRENCIES),
  myName: z.string().trim().max(60).optional(),
  members: z.array(memberIn).max(50).default([]),
});
const groupPatch = groupIn.omit({ members: true, myName: true }).partial().extend({ simplify: z.boolean().optional() });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const cents = z.number().int().positive("Enter an amount above zero.").max(1e12);
const expenseIn = z.object({
  kind: z.literal("expense"),
  description: z.string().trim().min(1, "Describe the expense.").max(120),
  amount: cents,
  category: enumOf(CATEGORIES.map((c) => c.id)),
  date: day,
  paid: z.record(z.string(), z.number().int()),
  split: z.object({
    method: z.enum(["equal", "exact", "percent", "shares"]),
    members: z.array(z.string()).min(1).max(100),
    values: z.record(z.string(), z.number()).optional(),
  }),
  notes: z.string().max(1000).default(""),
  // The receipt's bill id, from your own scan; null removes it, absent leaves it as it is.
  receiptBillId: z.string().regex(ID, "That receipt isn't valid.").nullable().optional(),
  repeat: enumOf(REPEATS.map((r) => r.id)).default("never"),
  // Spent in another currency: `amount` is already converted; this is what was paid, and at what rate.
  original: z
    .object({
      currency: z.string().refine(isSpendCurrency, "That currency isn't supported."),
      amount: cents,
      rate: z.number().positive().max(1e6),
    })
    .nullable()
    .optional(),
});
const paymentIn = z.object({ kind: z.literal("payment"), from: z.string(), to: z.string(), amount: cents, date: day, notes: z.string().max(1000).default("") });
const entryIn = z.discriminatedUnion("kind", [expenseIn, paymentIn]);

function parse<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const r = schema.safeParse(body);
  if (!r.success) throw new Problem(400, r.error.issues[0]?.message ?? "Something in the form isn't right.");
  return r.data;
}

// ---- rows → what the page sees ----
const toMember = (r: Row): Member => ({ id: String(r.id), name: String(r.name), email: (r.email as string) || null, joined: !!r.user_id, removed: !!r.removed_at });
const toExpense = (r: Row): Expense => ({
  id: String(r.id),
  kind: r.kind === "payment" ? "payment" : "expense",
  description: String(r.description),
  amount: Number(r.amount),
  category: (r.category as Expense["category"]) ?? "general",
  date: String(r.date).slice(0, 10),
  paid: numbers(r.paid),
  owed: numbers(r.owed),
  split: (r.split as Split) ?? null,
  notes: String(r.notes ?? ""),
  hasReceipt: !!r.receipt_bill_id,
  original: r.original_currency ? { currency: String(r.original_currency), amount: Number(r.original_amount), rate: Number(r.fx_rate) } : null,
  repeat: ((r.repeat_interval as Repeat) || "never") as Repeat,
  nextRepeat: r.next_repeat ? String(r.next_repeat).slice(0, 10) : null,
  createdBy: String(r.created_by_name),
  createdAt: String(r.created_at),
  deleted: !!r.deleted_at,
});
const numbers = (v: unknown): Amounts => Object.fromEntries(Object.entries((v as Amounts) ?? {}).map(([k, c]) => [k, Number(c)]));
const newestFirst = (a: Expense, b: Expense) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);

// ---- who you are in which group ----

// Your member rows in every group, claiming invites sent to your email on the way.
async function myMemberships(me: Me): Promise<Row[]> {
  const [mine, invited] = await Promise.all([
    select("sb_members", { user_id: me.id, removed_at: null }),
    select("sb_members", { email: lower(me.email), user_id: null, removed_at: null }),
  ]);
  const groups = new Set(mine.map((m) => String(m.group_id)));
  for (const m of invited) {
    if (groups.has(String(m.group_id))) continue;
    await update("sb_members", { id: String(m.id) }, { user_id: me.id });
    mine.push({ ...m, user_id: me.id });
    groups.add(String(m.group_id));
  }
  return mine;
}

// A group you can see, its members, and which one is you. "Not found" for anything else, so
// nobody can probe which groups exist.
async function load(groupId: string, me: Me) {
  const missing = new Problem(404, "Group not found.");
  if (!ID.test(groupId)) throw missing;
  const [g] = await select("sb_groups", { id: groupId, deleted_at: null });
  if (!g) throw missing;
  const members = await select("sb_members", { group_id: groupId }, { by: "created_at" });
  const active = members.filter((m) => !m.removed_at);
  const mine = active.find((m) => m.user_id === me.id) ?? active.find((m) => !m.user_id && m.email === lower(me.email));
  if (!mine) throw missing;
  if (!mine.user_id) {
    await update("sb_members", { id: String(mine.id) }, { user_id: me.id });
    mine.user_id = me.id;
  }
  return { g, members, mine, name: String(mine.name) };
}

async function log(groupId: string, me: Me, actor: string, text: string, expenseId: string | null = null) {
  await insert("sb_activity", { id: uuid(), group_id: groupId, user_id: me.id, actor, text, expense_id: expenseId, created_at: now() });
  await update("sb_groups", { id: groupId }, { updated_at: now() });
}

// ---- repeating expenses: copies are added when the group is next opened, so there's no scheduler ----
const todayUtc = () => new Date().toISOString().slice(0, 10);

// The same id for the same expense and date, so two people opening the group at once can't add a copy twice.
async function repeatId(expenseId: string, date: string) {
  const h = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${expenseId}:${date}`)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// Adds every copy that's due among these rows. True when something was added (so the caller reloads).
async function runRepeats(rows: Row[], currency: (groupId: string) => string): Promise<boolean> {
  const today = todayUtc();
  let added = false;
  for (const r of rows) {
    const every = (r.repeat_interval as Repeat) || "never";
    const next = r.next_repeat ? String(r.next_repeat).slice(0, 10) : null;
    if (r.deleted_at || r.kind !== "expense" || every === "never" || !next || next > today) continue;
    const due = dueRepeats(String(r.date).slice(0, 10), every, next, today);
    for (const date of due.dates) {
      const id = await repeatId(String(r.id), date);
      if ((await select("sb_expenses", { id })).length) continue;
      const at = now();
      try {
        await insert("sb_expenses", {
          id, group_id: r.group_id, kind: "expense", description: r.description, amount: r.amount, category: r.category, date,
          paid: r.paid, owed: r.owed, split: r.split, notes: r.notes ?? "", receipt_bill_id: null, repeat_interval: "never", next_repeat: null,
          original_currency: r.original_currency ?? null, original_amount: r.original_amount ?? null, fx_rate: r.fx_rate ?? null,
          created_by: r.created_by, created_by_name: r.created_by_name, created_at: at, updated_at: at, deleted_at: null,
        });
      } catch {
        continue; // someone else added this copy a moment ago
      }
      const label = REPEATS.find((x) => x.id === every)!.label.toLowerCase();
      await insert("sb_activity", {
        id: uuid(), group_id: r.group_id, user_id: r.created_by, actor: r.created_by_name,
        text: `added “${r.description}” (${formatMoney(Number(r.amount), currency(String(r.group_id)))}), repeating ${label}`, expense_id: id, created_at: at,
      });
      added = true;
    }
    await update("sb_expenses", { id: String(r.id) }, { next_repeat: due.next });
  }
  return added;
}

const liveEntries = (rows: Row[]): Entry[] => rows.filter((r) => !r.deleted_at).map((r) => ({ paid: numbers(r.paid), owed: numbers(r.owed) }));

// ---- dashboard: every group, every friend, overall totals ----
export async function dashboard(me: Me): Promise<Dashboard> {
  const memberships = await myMemberships(me);
  const ids = [...new Set(memberships.map((m) => String(m.group_id)))];
  const out: Dashboard = { me: { email: me.email }, groups: [], friends: [], totals: {}, deleted: [] };
  if (!ids.length) return out;
  const [all, members, firstExpenses] = await Promise.all([
    select("sb_groups", { id: ids }),
    select("sb_members", { group_id: ids }),
    select("sb_expenses", { group_id: ids, deleted_at: null }),
  ]);
  const groups = all.filter((g) => !g.deleted_at);
  const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString();
  out.deleted = all
    .filter((g) => g.deleted_at && String(g.deleted_at) > monthAgo)
    .map((g) => ({ id: String(g.id), name: String(g.name), deletedAt: String(g.deleted_at) }))
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  const currencyOf = (gid: string) => String(all.find((g) => String(g.id) === gid)?.currency ?? "");
  const live = new Set(groups.map((g) => String(g.id)));
  const expenses = (await runRepeats(firstExpenses.filter((e) => live.has(String(e.group_id))), currencyOf))
    ? await select("sb_expenses", { group_id: ids, deleted_at: null })
    : firstExpenses;

  const friends = new Map<string, Friend>();
  for (const g of groups) {
    const gid = String(g.id);
    const currency = String(g.currency);
    const myId = String(memberships.find((m) => String(m.group_id) === gid)!.id);
    const gMembers = members.filter((m) => String(m.group_id) === gid);
    const entries = liveEntries(expenses.filter((e) => String(e.group_id) === gid));
    const net = netBalances(entries);
    out.groups.push({
      id: gid,
      name: String(g.name),
      kind: g.kind as GroupKind,
      currency,
      members: gMembers.filter((m) => !m.removed_at).length,
      myBalance: net[myId] ?? 0,
      updatedAt: String(g.updated_at),
    });

    // Everyone you share the group with is a friend, even when you're even. The same person in two
    // groups is one friend when they have an email; without one, names alone can't be trusted to match.
    const friendOf = (m: Row) => {
      const key = m.email ? `e:${m.email}` : `m:${m.id}`;
      let f = friends.get(key);
      if (!f) friends.set(key, (f = { key, name: String(m.name), email: (m.email as string) || null, balances: {}, groups: [] }));
      return f;
    };
    for (const m of gMembers) if (String(m.id) !== myId && !m.removed_at && m.user_id !== me.id) friendOf(m);

    const t = (out.totals[currency] ??= { owe: 0, owed: 0 });
    for (const d of debts(entries, !!g.simplify)) {
      const other = d.from === myId ? d.to : d.to === myId ? d.from : null;
      if (!other) continue;
      const m = gMembers.find((x) => String(x.id) === other);
      if (!m) continue;
      const signed = d.to === myId ? d.amount : -d.amount; // + they owe you
      if (signed > 0) t.owed += d.amount;
      else t.owe += d.amount;
      const f = friendOf(m);
      f.balances[currency] = (f.balances[currency] ?? 0) + signed;
      f.groups.push({ groupId: gid, groupName: String(g.name), currency, amount: signed });
    }
  }
  out.groups.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const size = (f: Friend) => Object.values(f.balances).reduce((a, c) => a + Math.abs(c), 0);
  out.friends = [...friends.values()].sort((a, b) => size(b) - size(a) || a.name.localeCompare(b.name));
  return out;
}

// ---- one group ----
export async function groupDetail(groupId: string, me: Me): Promise<GroupDetail> {
  const { g, members, mine } = await load(groupId, me);
  if (await runRepeats(await select("sb_expenses", { group_id: groupId, deleted_at: null }), () => String(g.currency))) await update("sb_groups", { id: groupId }, { updated_at: now() });
  const [rows, comments, activity] = await Promise.all([
    select("sb_expenses", { group_id: groupId }),
    select("sb_comments", { group_id: groupId }, { by: "created_at" }),
    select("sb_activity", { group_id: groupId }, { by: "created_at", desc: true, limit: 100 }),
  ]);
  const entries = liveEntries(rows);
  const active = members.filter((m) => !m.removed_at).map((m) => String(m.id));
  return {
    id: groupId,
    name: String(g.name),
    kind: g.kind as GroupKind,
    currency: String(g.currency),
    simplify: !!g.simplify,
    meId: String(mine.id),
    members: members.map(toMember),
    expenses: rows.map(toExpense).sort(newestFirst),
    comments: comments
      .filter((c) => !c.deleted_at)
      .map(
        (c): Comment => ({
          id: String(c.id),
          expenseId: String(c.expense_id),
          author: String(c.author),
          body: String(c.body),
          createdAt: String(c.created_at),
          mine: c.user_id === me.id,
        }),
      ),
    activity: activity.map((a) => toActivity(a, String(g.name), me)),
    balances: netBalances(entries, active),
    debts: debts(entries, !!g.simplify),
  };
}

const toActivity = (a: Row, groupName: string, me: Me): Activity => ({
  id: String(a.id),
  groupId: String(a.group_id),
  groupName,
  actor: String(a.actor),
  text: String(a.text),
  expenseId: (a.expense_id as string) ?? null,
  createdAt: String(a.created_at),
  mine: a.user_id === me.id,
});

export async function createGroup(me: Me, body: unknown): Promise<string> {
  const input = parse(groupIn, body);
  const myEmail = lower(me.email);
  const others = input.members.filter((m) => m.email !== myEmail);
  const emails = others.map((m) => m.email).filter(Boolean);
  if (new Set(emails).size !== emails.length) throw new Problem(400, "Two members have the same email.");
  const id = uuid();
  const myName = input.myName || nameFromEmail(me.email);
  await insert("sb_groups", { id, name: input.name, kind: input.kind, currency: input.currency, simplify: true, created_by: me.id, created_at: now(), updated_at: now(), deleted_at: null });
  await insert("sb_members", { id: uuid(), group_id: id, name: myName, email: myEmail, user_id: me.id, created_at: now(), removed_at: null });
  for (const m of others) await insert("sb_members", { id: uuid(), group_id: id, name: m.name, email: m.email || null, user_id: null, created_at: now(), removed_at: null });
  await log(id, me, myName, `created the group${others.length ? ` with ${others.map((m) => m.name).join(", ")}` : ""}`);
  return id;
}

export async function updateGroup(groupId: string, me: Me, body: unknown) {
  const { g, name } = await load(groupId, me);
  const patch = parse(groupPatch, body);
  if (patch.currency && patch.currency !== g.currency) {
    const any = await select("sb_expenses", { group_id: groupId });
    if (any.length) throw new Problem(409, "The currency can only change before the first expense.");
  }
  await update("sb_groups", { id: groupId }, { ...patch, updated_at: now() });
  const said: string[] = [];
  if (patch.name && patch.name !== g.name) said.push(`renamed the group to “${patch.name}”`);
  if (patch.simplify !== undefined && patch.simplify !== !!g.simplify) said.push(`turned simplify debts ${patch.simplify ? "on" : "off"}`);
  if (patch.currency && patch.currency !== g.currency) said.push(`changed the currency to ${patch.currency}`);
  for (const s of said) await log(groupId, me, name, s);
}

export async function deleteGroup(groupId: string, me: Me) {
  await load(groupId, me);
  await update("sb_groups", { id: groupId }, { deleted_at: now() });
}

// ---- members ----
export async function addMember(groupId: string, me: Me, body: unknown) {
  const { members, name } = await load(groupId, me);
  const m = parse(memberIn, body);
  if (m.email && members.some((x) => !x.removed_at && x.email === m.email)) throw new Problem(409, "Someone in the group already has that email.");
  await insert("sb_members", { id: uuid(), group_id: groupId, name: m.name, email: m.email || null, user_id: null, created_at: now(), removed_at: null });
  await log(groupId, me, name, `added ${m.name}`);
}

export async function updateMember(groupId: string, memberId: string, me: Me, body: unknown) {
  const { members, name } = await load(groupId, me);
  const target = members.find((m) => String(m.id) === memberId && !m.removed_at);
  if (!target) throw new Problem(404, "Member not found.");
  const m = parse(memberIn, body);
  // Once someone has signed in, their email is their identity in the group: it can't be repointed.
  if (target.user_id && (m.email ?? target.email) !== target.email) throw new Problem(409, `${target.name} has joined, so their email can't change.`);
  if (m.email && members.some((x) => x.id !== target.id && !x.removed_at && x.email === m.email)) throw new Problem(409, "Someone in the group already has that email.");
  await update("sb_members", { id: memberId }, { name: m.name, email: target.user_id ? target.email : m.email || null });
  if (m.name !== target.name) await log(groupId, me, name, `renamed ${target.name} to ${m.name}`);
}

// Like any expense-sharing app: you can only leave or remove someone once they're settled up.
export async function removeMember(groupId: string, memberId: string, me: Me) {
  const { g, members, name } = await load(groupId, me);
  const target = members.find((m) => String(m.id) === memberId && !m.removed_at);
  if (!target) throw new Problem(404, "Member not found.");
  const balance = netBalances(liveEntries(await select("sb_expenses", { group_id: groupId })))[memberId] ?? 0;
  if (balance !== 0)
    throw new Problem(409, `${target.name} isn't settled up (${formatMoney(Math.abs(balance), String(g.currency))} ${balance > 0 ? "owed to them" : "to pay"}). Settle up first.`);
  await update("sb_members", { id: memberId }, { removed_at: now() });
  await log(groupId, me, name, target.user_id === me.id ? "left the group" : `removed ${target.name}`);
}

// ---- expenses and payments ----

// Turn the form into who paid and who owes, checking every number and every person.
function toAmounts(input: z.infer<typeof entryIn>, allowed: Set<string>) {
  const check = (ids: string[]) => {
    if (ids.some((id) => !allowed.has(id))) throw new Problem(400, "Someone in this expense isn't in the group.");
  };
  if (input.kind === "payment") {
    check([input.from, input.to]);
    if (input.from === input.to) throw new Problem(400, "Choose two different people.");
    return { paid: { [input.from]: input.amount }, owed: { [input.to]: input.amount }, split: null };
  }
  const paid = Object.fromEntries(Object.entries(input.paid).filter(([, c]) => c !== 0));
  check([...Object.keys(paid), ...input.split.members]);
  const paidError = checkPaid(input.amount, paid);
  if (paidError) throw new Problem(400, paidError);
  const s = splitAmount(input.amount, input.split);
  if (!s.ok) throw new Problem(400, s.error);
  return { paid, owed: s.owed, split: input.split };
}

const sameAmounts = (x: Amounts, y: Amounts) => {
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  return [...keys].every((k) => (x[k] ?? 0) === (y[k] ?? 0));
};

const label = (r: { kind: string; description: string }) => (r.kind === "payment" ? "a payment" : `“${r.description}”`);

export async function saveEntry(groupId: string, me: Me, body: unknown, expenseId?: string): Promise<{ id: string; receiptDropped?: boolean }> {
  const { g, members, name } = await load(groupId, me);
  const input = parse(entryIn, body);
  let existing: Row | undefined;
  if (expenseId) {
    [existing] = ID.test(expenseId) ? await select("sb_expenses", { id: expenseId, group_id: groupId }) : [];
    if (!existing) throw new Problem(404, "Expense not found.");
  }
  // New entries use current members; an edit may keep people who have since left.
  const allowed = new Set(members.filter((m) => !m.removed_at).map((m) => String(m.id)));
  if (existing) for (const id of [...Object.keys(numbers(existing.paid)), ...Object.keys(numbers(existing.owed))]) allowed.add(id);
  const amounts = toAmounts(input, allowed);
  const original = input.kind === "expense" && input.original && input.original.currency !== g.currency ? input.original : null;
  if (original && !matchesConversion(input.amount, original.amount, original.rate))
    throw new Problem(400, "The converted amount doesn't match the rate. Check the amount and try again.");
  const nameOf = (id: string) => String(members.find((m) => String(m.id) === id)?.name ?? "someone");
  const description = input.kind === "payment" ? `${nameOf(input.from)} paid ${nameOf(input.to)}` : input.description;
  const fields = {
    kind: input.kind,
    description,
    amount: input.amount,
    category: input.kind === "payment" ? "general" : input.category,
    date: input.date,
    ...amounts,
    notes: input.notes,
    // The first copy comes after today, whatever the date: a monthly rent entered for last month
    // doesn't add a pile of back-dated copies at once.
    original_currency: original?.currency ?? null,
    original_amount: original?.amount ?? null,
    fx_rate: original?.rate ?? null,
    repeat_interval: input.kind === "expense" ? input.repeat : "never",
    next_repeat: input.kind === "expense" ? nextRepeat(input.date, input.repeat, input.date > todayUtc() ? input.date : todayUtc()) : null,
    updated_at: now(),
  };
  const money = formatMoney(input.amount, String(g.currency));

  // The receipt: only your own scans can be attached (see receipt.ts).
  const had = existing ? (existing.receipt_bill_id as string) || null : null;
  const incoming = input.kind === "expense" ? input.receiptBillId : undefined;
  const owned = typeof incoming === "string" && incoming !== had ? !!(await findBill(incoming, { userId: me.id, deviceId: "" })) : false;
  const receipt = receiptDecision(had, incoming, owned);
  const receiptField = receipt.action === "set" ? { receipt_bill_id: receipt.billId } : receipt.action === "clear" ? { receipt_bill_id: null } : {};
  const receiptDropped = receipt.action === "drop" || undefined;

  if (existing) {
    const id = String(existing.id);
    const before = existing as Row;
    // Log "attached a receipt" rather than "updated" when nothing else changed.
    const onlyReceipt =
      String(before.description) === fields.description &&
      Number(before.amount) === fields.amount &&
      String(before.category) === fields.category &&
      String(before.date).slice(0, 10) === fields.date &&
      String(before.notes ?? "") === fields.notes &&
      sameAmounts(numbers(before.paid), amounts.paid) &&
      sameAmounts(numbers(before.owed), amounts.owed);
    await update("sb_expenses", { id }, { ...fields, ...receiptField });
    const receiptText = receiptActivity(receipt, label(fields));
    await log(groupId, me, name, onlyReceipt && receiptText ? receiptText : `updated ${label(fields)}`, id);
    return { id, receiptDropped };
  }
  const id = uuid();
  const withReceipt = receipt.action === "set";
  await insert("sb_expenses", { id, group_id: groupId, ...fields, receipt_bill_id: withReceipt ? receipt.billId : null, created_by: me.id, created_by_name: name, created_at: now(), deleted_at: null });
  await log(
    groupId,
    me,
    name,
    input.kind === "payment" ? `recorded a payment: ${description} ${money}` : `added “${description}” (${money})${withReceipt ? " with a receipt" : ""}`,
    id,
  );
  return { id, receiptDropped };
}

// Settle up with a friend everywhere at once (Splitwise's "settle all balances"): a payment in each
// group of that currency where the two of you have a debt, for exactly that debt.
export async function settleFriend(me: Me, body: unknown): Promise<{ payments: number; total: number }> {
  const { key, currency } = parse(z.object({ key: z.string().min(3).max(300), currency: z.string().max(10) }), body);
  const friend = (await dashboard(me)).friends.find((f) => f.key === key);
  if (!friend) throw new Problem(404, "Friend not found.");
  const isThem = (m: Member) => !m.removed && (key.startsWith("e:") ? m.email === key.slice(2) : m.id === key.slice(2));
  let payments = 0;
  let total = 0;
  for (const groupId of new Set(friend.groups.filter((x) => x.currency === currency && x.amount).map((x) => x.groupId))) {
    const g = await groupDetail(groupId, me);
    const them = new Set(g.members.filter(isThem).map((m) => m.id));
    for (const t of g.debts) {
      const mine = (t.from === g.meId && them.has(t.to)) || (t.to === g.meId && them.has(t.from));
      if (!mine) continue;
      await saveEntry(groupId, me, { kind: "payment", from: t.from, to: t.to, amount: t.amount, date: todayUtc(), notes: "Settled up across groups" });
      payments++;
      total += t.amount;
    }
  }
  if (!payments) throw new Problem(409, "You're already settled up.");
  return { payments, total };
}

// Splitwise's undelete_group: any member can bring a deleted group back.
export async function restoreGroup(groupId: string, me: Me) {
  const missing = new Problem(404, "Group not found.");
  if (!ID.test(groupId)) throw missing;
  const [g] = await select("sb_groups", { id: groupId });
  if (!g || !g.deleted_at) throw missing;
  const mine = (await select("sb_members", { group_id: groupId, user_id: me.id, removed_at: null }))[0];
  if (!mine) throw missing;
  await update("sb_groups", { id: groupId }, { deleted_at: null, updated_at: now() });
  await log(groupId, me, String(mine.name), "restored the group");
}

// Your own comments only.
export async function deleteComment(groupId: string, expenseId: string, commentId: string, me: Me) {
  await load(groupId, me);
  const [c] = ID.test(commentId) ? await select("sb_comments", { id: commentId, group_id: groupId, expense_id: expenseId }) : [];
  if (!c || c.deleted_at) throw new Problem(404, "Comment not found.");
  if (c.user_id !== me.id) throw new Problem(403, "You can only delete your own comments.");
  await update("sb_comments", { id: commentId }, { deleted_at: now() });
}

// An expense's receipt photo, for anyone in the group (deleted expenses too, so they can be restored).
export async function receiptFor(groupId: string, expenseId: string, me: Me) {
  await load(groupId, me);
  const [e] = ID.test(expenseId) ? await select("sb_expenses", { id: expenseId, group_id: groupId }) : [];
  const billId = (e?.receipt_bill_id as string) || null;
  const photo = billId ? await streamBillPhoto(billId) : null;
  if (!photo) throw new Problem(404, "No receipt for this expense.");
  return photo;
}

export async function setDeleted(groupId: string, expenseId: string, me: Me, deleted: boolean) {
  const { name } = await load(groupId, me);
  const [e] = ID.test(expenseId) ? await select("sb_expenses", { id: expenseId, group_id: groupId }) : [];
  if (!e) throw new Problem(404, "Expense not found.");
  await update("sb_expenses", { id: expenseId }, { deleted_at: deleted ? now() : null, updated_at: now() });
  await log(groupId, me, name, `${deleted ? "deleted" : "restored"} ${label(e as { kind: string; description: string })}`, expenseId);
}

export async function addComment(groupId: string, expenseId: string, me: Me, body: unknown) {
  const { name } = await load(groupId, me);
  const { text } = parse(z.object({ text: z.string().trim().min(1, "Write something first.").max(1000) }), body);
  const [e] = ID.test(expenseId) ? await select("sb_expenses", { id: expenseId, group_id: groupId }) : [];
  if (!e) throw new Problem(404, "Expense not found.");
  await insert("sb_comments", { id: uuid(), group_id: groupId, expense_id: expenseId, user_id: me.id, author: name, body: text, created_at: now() });
  await log(groupId, me, name, `commented on ${label(e as { kind: string; description: string })}`, expenseId);
}

// ---- activity across all your groups ----
export async function recentActivity(me: Me, limit = 100): Promise<Activity[]> {
  const ids = [...new Set((await myMemberships(me)).map((m) => String(m.group_id)))];
  if (!ids.length) return [];
  const [groups, rows] = await Promise.all([select("sb_groups", { id: ids, deleted_at: null }), select("sb_activity", { group_id: ids }, { by: "created_at", desc: true, limit })]);
  const names = new Map(groups.map((g) => [String(g.id), String(g.name)]));
  return rows.filter((a) => names.has(String(a.group_id))).map((a) => toActivity(a, names.get(String(a.group_id))!, me));
}

// ---- export: one row per expense, one column per person (+ lent, − borrowed) ----
export async function exportCsv(groupId: string, me: Me): Promise<{ filename: string; csv: string }> {
  const d = await groupDetail(groupId, me);
  const people = d.members;
  const cell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const amt = (c: number) => (c / 100).toFixed(2);
  const lines = [["Date", "Description", "Category", "Cost", "Currency", "Spent as", "Receipt", ...people.map((p) => p.name)].map(cell).join(",")];
  for (const e of [...d.expenses].reverse()) {
    if (e.deleted) continue;
    const category = e.kind === "payment" ? "Payment" : (CATEGORIES.find((c) => c.id === e.category)?.label ?? "General");
    lines.push([e.date, e.description, category, amt(e.amount), d.currency, e.original ? `${amt(e.original.amount)} ${e.original.currency} @ ${e.original.rate}` : "", e.hasReceipt ? "yes" : "", ...people.map((p) => amt(myShare(e, p.id)))].map(cell).join(","));
  }
  lines.push(["", "Total balance", "", "", d.currency, "", "", ...people.map((p) => amt(d.balances[p.id] ?? 0))].map(cell).join(","));
  const slug = d.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "group";
  return { filename: `${slug}-${new Date().toISOString().slice(0, 10)}.csv`, csv: lines.join("\n") + "\n" };
}

// ---- exchange rates, for entering an expense in another currency ----
export async function rates(base: string) {
  if (!isSpendCurrency(base)) throw new Problem(400, "That currency isn't supported.");
  const table = await ratesFor(base);
  if (!table) throw new Problem(503, "Exchange rates aren't available right now. Enter the amount in the group's currency, or type the rate yourself.");
  return table;
}
