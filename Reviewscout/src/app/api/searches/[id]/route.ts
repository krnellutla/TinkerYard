import { NextResponse } from "next/server";
import { jsonRoute } from "@/lib/route";
import { getSearch } from "@/lib/store";

export const runtime = "nodejs";

// Reopen a past search: the videos and the chat, not the transcripts.
export const GET = jsonRoute(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const deviceId = new URL(req.url).searchParams.get("deviceId") ?? "";
  const s = await getSearch(id, deviceId);
  if (!s) return NextResponse.json({ error: "Search not found on this device" }, { status: 404 });
  return NextResponse.json({ id: s.id, topic: s.topic, found: s.found, messages: s.messages });
});
