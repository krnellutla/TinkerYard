import "server-only";
import { Innertube, Log } from "youtubei.js";
import { parseCaptions, withMinuteMarks } from "./captions";

// Review Scout's YouTube side: search, transcripts and top comments. No API key needed.
Log.setLevel(Log.Level.NONE); // youtubei.js logs every unknown UI node; we only read a few fields

const LANGS = ["en", "en-US", "en-GB"];
export const RATE_LIMITED = "YouTube rate limit";

export interface Video {
  id: string;
  title: string;
  channel: string;
  url: string;
}

export interface Found extends Video {
  skipped: string | null; // why the video was left out, e.g. "no transcript"
}

// One YouTube session per server instance; made again on the next request if creating it failed.
let session: Promise<Innertube> | null = null;
function client(): Promise<Innertube> {
  if (!session)
    session = Innertube.create({ retrieve_player: false }).catch((e) => {
      session = null;
      throw e;
    });
  return session;
}

// Ask YouTube search for "<topic> review" and return the top n videos.
export async function searchVideos(topic: string, n: number): Promise<Video[]> {
  const res = await (await client()).search(`${topic} review`, { type: "video" });
  return res.videos
    .filter((v) => "id" in v && typeof v.id === "string" && v.id)
    .slice(0, n)
    .map((v) => {
      const id = (v as { id: string }).id;
      const x = v as { title?: { toString(): string }; author?: { name?: string } };
      return {
        id,
        title: x.title?.toString() || "Untitled",
        channel: x.author?.name || "Unknown channel",
        url: `https://www.youtube.com/watch?v=${id}`,
      };
    });
}

// The web client hides caption tracks; the phone apps still list them (as youtube-transcript-api does).
export async function fetchTranscript(videoId: string): Promise<string> {
  const yt = await client();
  let limited = false;
  for (const c of ["ANDROID", "IOS"] as const) {
    const info = await yt.getBasicInfo(videoId, { client: c }).catch(() => null);
    const tracks = info?.captions?.caption_tracks ?? [];
    const english = tracks.filter((t) => LANGS.includes(t.language_code));
    // Captions a person wrote beat YouTube's automatic ones.
    const track = english.find((t) => t.kind !== "asr") ?? english[0];
    if (!track) continue;
    const res = await fetch(track.base_url.replace(/&fmt=[^&]*/, ""));
    if (!res.ok) {
      limited ||= res.status === 429;
      continue;
    }
    const snippets = parseCaptions(await res.text());
    if (snippets.length) return withMinuteMarks(snippets);
  }
  // 429 = YouTube is limiting caption downloads from this server; it lifts after a while.
  throw new Error(limited ? RATE_LIMITED : "no English transcript");
}

// Top viewer comments: the second kind of review on YouTube. Slower, so optional.
export async function fetchComments(videoId: string, limit = 20): Promise<string[]> {
  const res = await (await client()).getComments(videoId, "TOP_COMMENTS");
  return res.contents
    .map((t) => t.comment?.content?.toString() ?? "")
    .filter(Boolean)
    .slice(0, limit);
}

// Search + collect. Returns the corpus for the LLM and what was found (including what was skipped).
export async function gather(topic: string, n: number, withComments: boolean): Promise<{ corpus: string; found: Found[] }> {
  const videos = await searchVideos(topic, n);
  // All videos at once: one slow video should not hold up the others.
  const results = await Promise.all(
    videos.map(async (v) => {
      let text: string;
      try {
        text = await fetchTranscript(v.id);
      } catch (e) {
        // no captions, region block, rate limit...
        return { found: { ...v, skipped: e instanceof Error ? e.message : "no transcript" }, block: null };
      }
      let comments = "";
      if (withComments) {
        const list = await fetchComments(v.id).catch(() => []);
        if (list.length) comments = "\nTOP COMMENTS:\n" + list.map((c) => `- ${c}`).join("\n");
      }
      const block =
        `=== VIDEO: ${v.title}\nCHANNEL: ${v.channel}\n` +
        `LINK: ${v.url}  (add &t=<seconds>s to link to a moment)\n` +
        `TRANSCRIPT:${text}${comments}`;
      return { found: { ...v, skipped: null }, block };
    }),
  );
  return {
    corpus: results.flatMap((r) => (r.block ? [r.block] : [])).join("\n\n"),
    found: results.map((r) => r.found),
  };
}
