import { NextResponse } from "next/server";
import { z } from "zod";
import { bestEffort, jsonRoute } from "@tallyback/lib/route";
import { findBill, markSent } from "@tallyback/lib/store";
import { appUser, ownerOf } from "@signin/session";
import { wordsChanged } from "@tallyback/lib/message";

const sentIn = z.object({
  billId: z.string().max(64).default(""),
  deviceId: z.string().max(64).optional().default(""),
  messageId: z.string().max(64).default(""),
  drafted: z.string().max(10000).default(""),
  sentText: z.string().max(10000),
  channel: z.string().trim().min(1).max(32),
});

export const POST = jsonRoute(async (req: Request) => {
  const user = await appUser(req, "tallyback");
  if (user instanceof Response) return user;
  const parsed = sentIn.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { billId, deviceId, messageId, drafted, sentText, channel } = parsed.data;
  const owner = ownerOf(user, deviceId);
  // Logged only on a message drafted for a bill this person owns; server computes wordsChanged from the stored draft.
  const changed =
    messageId && owner && (await findBill(billId, owner))
      ? await bestEffort("mark sent", () => markSent(billId, messageId, sentText, drafted, channel), wordsChanged(drafted, sentText))
      : wordsChanged(drafted, sentText);
  return NextResponse.json({ wordsChanged: changed });
});
