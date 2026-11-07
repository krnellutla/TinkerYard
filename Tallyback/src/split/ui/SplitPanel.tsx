"use client";

import type { BillDraft } from "../lib/fromBill";
import { Dashboard } from "./Dashboard";
import { GroupView } from "./GroupView";

// TallyBack's Split tab: split shared expenses with friends, see who owes whom, settle up.
// INPUT: groups, members, expenses (four ways to split) and payments; or a checked bill ("Split this bill")
// PROCESS: /api/tallyback/{groups,activity} stores them; lib/balances.ts works out balances and the fewest payments to settle
// OUTPUT: your totals, per-group and per-friend balances, activity, CSV export
// Groups are shared between people, so members are invited by email. The page around it
// (Tallyback/src/ui/Home.tsx) keeps the open group in the address (?tab=split&g=…).
export function SplitPanel({
  groupId,
  onOpen,
  draft,
  onDraftDone,
}: {
  groupId: string | null;
  onOpen: (id: string | null) => void;
  draft: BillDraft | null;
  onDraftDone: () => void;
}) {
  return groupId ? (
    <GroupView key={groupId} id={groupId} onBack={() => onOpen(null)} draft={draft} onDraftDone={onDraftDone} />
  ) : (
    <Dashboard onOpen={onOpen} draft={draft} onCancelDraft={onDraftDone} />
  );
}
