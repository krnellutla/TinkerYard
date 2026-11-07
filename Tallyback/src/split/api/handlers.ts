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

// /api/tallyback/groups/[id]/members(/[memberId])
export const addMember = route<G>(async (req, me, p) => fs.addMember(p.id, me, await body(req)));
export const patchMember = route<GM>(async (req, me, p) => fs.updateMember(p.id, p.memberId, me, await body(req)));
export const removeMember = route<GM>(async (_req, me, p) => fs.removeMember(p.id, p.memberId, me));

// /api/tallyback/groups/[id]/expenses(/[expenseId]) — expenses and payments alike
export const addExpense = route<G>(async (req, me, p) => ({ id: await fs.saveEntry(p.id, me, await body(req)) }));
export const patchExpense = route<GE>(async (req, me, p) => {
  const b = (await body(req)) as { restore?: boolean };
  if (b?.restore) return fs.setDeleted(p.id, p.expenseId, me, false);
  return { id: await fs.saveEntry(p.id, me, b, p.expenseId) };
});
export const deleteExpense = route<GE>(async (_req, me, p) => fs.setDeleted(p.id, p.expenseId, me, true));
export const addComment = route<GE>(async (req, me, p) => fs.addComment(p.id, p.expenseId, me, await body(req)));

// /api/tallyback/groups/[id]/export — a CSV download
export const exportGroup = route<G>(async (_req, me, p) => {
  const { filename, csv } = await fs.exportCsv(p.id, me);
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` } });
});

// /api/tallyback/activity — what happened lately, across every group
export const activity = route(async (_req, me) => ({ activity: await fs.recentActivity(me) }));
