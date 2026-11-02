import { NextResponse } from "next/server";
import { jsonRoute } from "@/lib/route";
import { readImage } from "@/lib/store";

export const runtime = "nodejs";

// Private photos: only the device that scanned the bill gets the bytes.
export const GET = jsonRoute(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const deviceId = new URL(req.url).searchParams.get("deviceId") ?? "";
  const img = await readImage(id, deviceId);
  if (!img) return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  return new Response(img.stream, { headers: { "content-type": img.type, "cache-control": "private, max-age=3600" } });
});
