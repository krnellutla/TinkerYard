import { body, route } from "@tallyback/split/lib/route";
import * as fs from "@tallyback/split/lib/service";

// Every splitting endpoint (TallyBack's Split tab). The files under app/api/tallyback/{groups,activity} re-export these.
type G = { id: string };
type GM = { id: string; memberId: string };
type GE = { id: string; expenseId: string };

// /api/tallyback/groups — your groups, friends and totals; create a group
export const listGroups = route(async (_req, me) => fs.dashboard(me));
export const createGroup = route(async (req, me) => ({ id: await fs.createGroup(me, await body(req)) }));

// /api/tallyback/groups/[id] — everything in one group; change its settings; delete it
export const getGroup = route<G>(async (_req, me, p) => fs.groupDetail(p.id, me));
export const patchGroup = route<G>(async (req, me, p) => fs.updateGroup(p.id, me, await body(req)));
export const deleteGroup = route<G>(async (_req, me, p) => fs.deleteGroup(p.id, me));
// /api/tallyback/groups/[id]/restore — bring back a deleted group
export const restoreGroup = route<G>(async (_req, me, p) => fs.restoreGroup(p.id, me));
// /api/tallyback/friends/settle — settle up with one friend across every group
export const settleFriend = route(async (req, me) => fs.settleFriend(me, await body(req)));

// /api/tallyback/groups/[id]/members(/[memberId])
export const addMember = route<G>(async (req, me, p) => fs.addMember(p.id, me, await body(req)));
export const patchMember = route<GM>(async (req, me, p) => fs.updateMember(p.id, p.memberId, me, await body(req)));
export const removeMember = route<GM>(async (_req, me, p) => fs.removeMember(p.id, p.memberId, me));

// /api/tallyback/groups/[id]/expenses(/[expenseId]) — expenses and payments alike
export const addExpense = route<G>(async (req, me, p) => fs.saveEntry(p.id, me, await body(req)));
export const patchExpense = route<GE>(async (req, me, p) => {
  const b = (await body(req)) as { restore?: boolean };
  if (b?.restore) return fs.setDeleted(p.id, p.expenseId, me, false);
  return fs.saveEntry(p.id, me, b, p.expenseId);
});
export const deleteExpense = route<GE>(async (_req, me, p) => fs.setDeleted(p.id, p.expenseId, me, true));
// /api/tallyback/groups/[id]/expenses/[expenseId]/receipt — the receipt photo, only for the group's current members.
// Served so it can only ever display (no type sniffing, sandboxed), and never stored: someone who leaves
// or is removed from the group loses it at once, with no copy left in a cache.
export const receipt = route<GE>(async (_req, me, p) => {
  const photo = await fs.receiptFor(p.id, p.expenseId, me);
  return new Response(photo.stream, {
    headers: {
      "Content-Type": photo.type,
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
});
export const addComment = route<GE>(async (req, me, p) => fs.addComment(p.id, p.expenseId, me, await body(req)));
export const deleteComment = route<GE>(async (req, me, p) => fs.deleteComment(p.id, p.expenseId, new URL(req.url).searchParams.get("commentId") ?? "", me));

// /api/tallyback/groups/[id]/export — a CSV download
export const exportGroup = route<G>(async (_req, me, p) => {
  const { filename, csv } = await fs.exportCsv(p.id, me);
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` } });
});

// /api/tallyback/rates?base=SGD — today's exchange rates (1 SGD = x of each)
export const rates = route(async (req) => fs.rates(new URL(req.url).searchParams.get("base") ?? ""));

// /api/tallyback/activity — what happened lately, across every group
export const activity = route(async (_req, me) => ({ activity: await fs.recentActivity(me) }));
