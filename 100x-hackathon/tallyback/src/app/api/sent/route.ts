import { NextResponse } from "next/server";
import { bestEffort, jsonRoute } from "@/lib/route";
import { markSent } from "@/lib/store";
import { wordsChanged } from "@/lib/message";

export const runtime = "nodejs";

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
