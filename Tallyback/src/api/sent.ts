import { NextResponse } from "next/server";
import { bestEffort, jsonRoute } from "@tallyback/lib/route";
import { markSent } from "@tallyback/lib/store";
import { wordsChanged } from "@tallyback/lib/message";


export const POST = jsonRoute(async (req: Request) => {
  const { messageId, drafted, sentText, channel } = (await req.json()) as {
    messageId: string;
    drafted: string;
    sentText: string;
    channel: string;
  };
  const changed = wordsChanged(drafted, sentText);
  if (messageId) await bestEffort("mark sent", () => markSent(messageId, sentText, changed, channel), undefined);
  return NextResponse.json({ wordsChanged: changed });
});
