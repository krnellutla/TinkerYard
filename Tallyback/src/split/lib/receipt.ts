// What happens to an expense's receipt when it's saved. Pure, so it's easy to test.
//
//   incoming absent      keep whatever is there (an edit that didn't touch the receipt)
//   incoming null        remove it
//   same as before       keep (anyone in the group may edit an expense someone else attached a receipt to)
//   a new id you own     attach it (it came from your own scan, moments ago)
//   a new id you don't   drop it and save the expense anyway: nobody can attach someone else's bill,
//                        and a receipt that failed to save never blocks the expense

export type ReceiptAction = { action: "keep" } | { action: "set"; billId: string } | { action: "clear" } | { action: "drop" };

export function receiptDecision(existing: string | null, incoming: string | null | undefined, ownedByMe: boolean): ReceiptAction {
  if (incoming === undefined) return { action: "keep" };
  if (incoming === null) return existing ? { action: "clear" } : { action: "keep" };
  if (incoming === existing) return { action: "keep" };
  return ownedByMe ? { action: "set", billId: incoming } : { action: "drop" };
}

// The activity line for an edit, when the receipt is the only thing that changed.
export function receiptActivity(action: ReceiptAction, what: string): string | null {
  if (action.action === "set") return `attached a receipt to ${what}`;
  if (action.action === "clear") return `removed the receipt from ${what}`;
  return null;
}
