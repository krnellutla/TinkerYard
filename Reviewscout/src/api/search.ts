import { NextResponse } from "next/server";
import { jsonRoute } from "@reviewscout/lib/route";
import { getSearch } from "@reviewscout/lib/store";
import { ownerOf, signedInUser } from "@signin/session";


// Reopen a past search: the videos and the chat, not the transcripts.
export const GET = jsonRoute(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const owner = ownerOf(await signedInUser(req), new URL(req.url).searchParams.get("deviceId"));
  const s = owner ? await getSearch(id, owner) : null;
  if (!s) return NextResponse.json({ error: "Search not found" }, { status: 404 });
  return NextResponse.json({ id: s.id, topic: s.topic, found: s.found, messages: s.messages });
});
