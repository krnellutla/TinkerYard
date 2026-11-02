import { NextResponse } from "next/server";
import { bestEffort, jsonRoute } from "@reviewscout/lib/route";
import { claimDevice, listSearches, saveSearch } from "@reviewscout/lib/store";
import { ownerOf, signedInUser, signInRequired } from "@signin/session";
import { gather, RATE_LIMITED } from "@reviewscout/lib/youtube";


// Past searches, newest first: the account's, or a guest's on this device.
export const GET = jsonRoute(async (req: Request) => {
  const owner = ownerOf(await signedInUser(req), new URL(req.url).searchParams.get("deviceId"));
  if (!owner) return NextResponse.json({ searches: [] });
  await bestEffort("claim device", () => claimDevice(owner), undefined);
  const searches = (await listSearches(owner)).map((s) => ({ id: s.id, topic: s.topic, createdAt: s.createdAt, videos: s.found.filter((f) => !f.skipped).length }));
  return NextResponse.json({ searches });
});

// Step 1 of a new search: find the videos and read them. The summary is step 2 (…/ask),
// so the page can show what was found while the summary is written.
// A search reads YouTube and then calls the AI: signed-in, invited people only.
export const POST = jsonRoute(async (req: Request) => {
  const user = await signedInUser(req);
  if (!user) return signInRequired("search reviews");
  const body = (await req.json()) as { deviceId?: string; topic?: string; nVideos?: number; withComments?: boolean };
  const owner = ownerOf(user, body.deviceId)!;
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
  const id = await saveSearch(owner, {
    topic,
    nVideos,
    withComments,
    corpus: collected.corpus,
    found: collected.found,
    messages: [{ role: "user", content: topic }],
  });
  return NextResponse.json({ id, topic, found: collected.found, chars: collected.corpus.length });
});
