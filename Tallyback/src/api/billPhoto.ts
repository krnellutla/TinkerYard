import { NextResponse } from "next/server";
import { jsonRoute } from "@tallyback/lib/route";
import { readImage } from "@tallyback/lib/store";
import { ownerOf, signedInUser } from "@signin/session";


// Private photos: only the bill's owner gets the bytes.
export const GET = jsonRoute(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const owner = ownerOf(await signedInUser(req), new URL(req.url).searchParams.get("deviceId"));
  const img = owner ? await readImage(id, owner) : null;
  if (!img) return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  return new Response(img.stream, { headers: { "content-type": img.type, "cache-control": "private, max-age=3600" } });
});
