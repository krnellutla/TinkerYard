import { NextResponse } from "next/server";
import { jsonRoute } from "@/lib/route";
import { listSearches, saveSearch } from "@/lib/store";
import { gather, RATE_LIMITED } from "@/lib/youtube";

export const runtime = "nodejs";
export const maxDuration = 60;

// Past searches on this device, newest first.
export const GET = jsonRoute(async (req: Request) => {
  const deviceId = new URL(req.url).searchParams.get("deviceId");
  if (!deviceId || deviceId === "anon") return NextResponse.json({ searches: [] });
  const searches = (await listSearches(deviceId)).map((s) => ({ id: s.id, topic: s.topic, createdAt: s.createdAt, videos: s.found.filter((f) => !f.skipped).length }));
  return NextResponse.json({ searches });
});

// Step 1 of a new search: find the videos and read them. The summary is step 2 (…/ask),
// so the page can show what was found while the summary is written.
export const POST = jsonRoute(async (req: Request) => {
  const body = (await req.json()) as { deviceId?: string; topic?: string; nVideos?: number; withComments?: boolean };
  const topic = String(body.topic ?? "").trim().slice(0, 300);
  if (!topic) return NextResponse.json({ error: "Type a product to look up." }, { status: 400 });
  const nVideos = Math.min(8, Math.max(2, Math.round(Number(body.nVideos) || 5)));
  const withComments = !!body.withComments;

  let collected;
  try {
    collected = await gather(topic, nVideos, withComments);
  } catch (e) {
    console.error("scout gather failed", e);
    return NextResponse.json({ error: `Could not reach YouTube: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
  if (!collected.corpus) {
    const limited = collected.found.some((f) => f.skipped === RATE_LIMITED);
    return NextResponse.json(
      {
        error: limited
          ? "YouTube is limiting transcript downloads from this server right now. Try again in a few minutes."
          : "Found no videos with a usable transcript. Try a more specific product name.",
        found: collected.found,
      },
      { status: limited ? 429 : 422 },
    );
  }

  // Saved before the summary: follow-ups read the transcripts back from this row.
  const id = await saveSearch(String(body.deviceId ?? "anon"), {
    topic,
    nVideos,
    withComments,
    corpus: collected.corpus,
    found: collected.found,
    messages: [{ role: "user", content: topic }],
  });
  return NextResponse.json({ id, topic, found: collected.found, chars: collected.corpus.length });
});
