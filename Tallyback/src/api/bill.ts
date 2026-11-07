import { NextResponse } from "next/server";
import { jsonRoute } from "@tallyback/lib/route";
import { getBill, photoUrl, toExtraction, toPromise } from "@tallyback/lib/store";
import { historyFor, summarise } from "@tallyback/lib/billView";
import { appUser, ownerOf } from "@signin/session";


export const GET = jsonRoute(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await appUser(req, "tallyback");
  if (user instanceof Response) return user;
  const { id } = await params;
  const deviceId = new URL(req.url).searchParams.get("deviceId") ?? "";
  const owner = ownerOf(user, deviceId);
  const b = owner ? await getBill(id, owner) : null;
  if (!owner || !b) return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  const extraction = toExtraction(b.bill, b.lines);
  const lineIds = [...b.lines].sort((x, y) => Number(x.position) - Number(y.position)).map((l) => l.id as string);
  return NextResponse.json({
    billId: id,
    lineIds,
    extraction,
    promise: toPromise(b.promise),
    imageUrl: photoUrl(b.bill, deviceId),
    history: await historyFor(owner, id, extraction),
    summary: summarise(b),
    lastMessage: b.messages[0] ? { text: (b.messages[0].sent_text ?? b.messages[0].drafted_text) as string, sentAt: b.messages[0].sent_at ?? null } : null,
  });
});
