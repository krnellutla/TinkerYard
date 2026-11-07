import { NextResponse } from "next/server";
import { bestEffort, jsonRoute } from "@tallyback/lib/route";
import { findBill, markSent } from "@tallyback/lib/store";
import { appUser, ownerOf } from "@signin/session";
import { wordsChanged } from "@tallyback/lib/message";


export const POST = jsonRoute(async (req: Request) => {
  const user = await appUser(req, "tallyback");
  if (user instanceof Response) return user;
  const { billId, deviceId, messageId, drafted, sentText, channel } = (await req.json()) as {
    billId: string;
    deviceId?: string;
    messageId: string;
    drafted: string;
    sentText: string;
    channel: string;
  };
  const changed = wordsChanged(drafted, sentText);
  const owner = ownerOf(user, deviceId);
  // Logged only on a message drafted for a bill this person owns.
  if (messageId && owner && (await findBill(billId, owner)))
    await bestEffort("mark sent", () => markSent(billId, messageId, sentText, changed, channel), undefined);
  return NextResponse.json({ wordsChanged: changed });
});
