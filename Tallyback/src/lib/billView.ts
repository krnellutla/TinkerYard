import "server-only";
import { runChecks } from "./checks";
import { compareHistory, type PastLine } from "./history";
import { fmt } from "./money";
import { pastLines, toExtraction, toPromise, type StoredBill } from "./store";

export type BillStatus = "sent" | "drafted" | "dispute" | "query" | "all_ok";

// Status is recomputed by code from what's stored, never saved as a guess.
export function summarise(b: StoredBill) {
  const ex = toExtraction(b.bill, b.lines);
  const promise = toPromise(b.promise);
  const result = runChecks(ex, promise);
  const sent = b.messages.find((m) => m.sent_at);
  const drafted = b.messages[0];
  const status: BillStatus = sent ? "sent" : drafted ? "drafted" : result.outcome;
  return {
    id: b.bill.id as string,
    merchant: ex.merchant_name,
    billType: ex.bill_type,
    billDate: ex.bill_date,
    createdAt: b.bill.created_at as string,
    currency: ex.currency ?? "",
    total: ex.printed_total,
    status,
    atStake: result.primary?.diff ?? 0,
    issue: result.primary?.title ?? null,
    sentAt: (sent?.sent_at as string) ?? null,
    wordsChanged: (sent?.words_changed as number) ?? null,
    channel: (sent?.channel as string) ?? null,
  };
}

export async function historyFor(deviceId: string, billId: string, ex: ReturnType<typeof toExtraction>) {
  const past = (await pastLines(deviceId, ex.merchant_name, billId)) as PastLine[];
  return compareHistory(ex.lines, past, (n) => fmt(n, ex.currency ?? ""));
}
