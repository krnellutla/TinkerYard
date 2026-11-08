"use client";

import { ProgressRing } from "@ui/ProgressRing";
import { Loading } from "@ui/ProgressRing";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import { askToSignIn, isSignedIn, onSessionChanged } from "@signin/ui/prompt";

// Review Scout: type a product, get a cited summary of what YouTube reviewers said, then ask follow-ups.
// INPUT: the product question (+ how many videos, and whether to read comments)
// PROCESS: /api/searches finds and reads the videos; /api/searches/[id]/ask summarises or answers
// OUTPUT: the chat below, every claim linked to a channel and timestamp

type Stage = "start" | "chat" | "history";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

interface Found {
  id: string;
  title: string;
  channel: string;
  url: string;
  skipped: string | null;
}

interface PastSearch {
  id: string;
  topic: string;
  createdAt: string;
  videos: number;
}

const EXAMPLE = "Sony WH-1000XM6 - worth upgrading from the XM5?";

// Anonymous per-browser id: past searches belong to this device, with no login.
function deviceId(): string {
  try {
    let id = localStorage.getItem("rs-device");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("rs-device", id);
    }
    return id;
  } catch {
    return "anon";
  }
}

// Read any reply safely: a timeout or platform error page isn't JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readJson(r: Response): Promise<any> {
  const text = await r.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    if (r.status === 504 || /timeout/i.test(text)) return { error: "That took too long. Try fewer videos, or try again." };
    return { error: `Something went wrong (${r.status}). Please try again.` };
  }
}

const post = (url: string, body: object) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export default function ReviewScout() {
  const [stage, setStage] = useState<Stage>("start");
  const [topic, setTopic] = useState("");
  const [nVideos, setNVideos] = useState(5);
  const [withComments, setWithComments] = useState(false);
  const [searchId, setSearchId] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<string | null>(null); // what we're doing right now
  const [error, setError] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState("");
  const [past, setPast] = useState<PastSearch[] | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // A search typed before signing in runs as soon as sign-in succeeds. The refs let the
  // sign-in listener (set up once) reach the latest page state.
  const pendingSearch = useRef<string | null>(null);
  const latest = useRef<{ stage: Stage; search: (q: string) => Promise<void>; openHistory: () => Promise<void> }>({
    stage,
    search: async () => {},
    openHistory: async () => {},
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, status]);

  useEffect(
    () =>
      onSessionChanged(async () => {
        const q = pendingSearch.current;
        if (q && (await isSignedIn())) {
          pendingSearch.current = null;
          latest.current.search(q);
        } else if (latest.current.stage === "history") latest.current.openHistory(); // an account's searches differ from a guest's
      }),
    [],
  );

  // Searching and asking call the AI: invited accounts only. The server checks too.
  async function needsSignIn(why: string) {
    if (await isSignedIn()) return false;
    setError(why);
    askToSignIn(why);
    return true;
  }

  async function ask(id: string, message: string | null) {
    setStatus(message ? "Checking the reviews…" : "Writing the summary…");
    try {
      const r = await post(`/api/reviewscout/searches/${id}/ask`, { deviceId: deviceId(), message });
      const j = await readJson(r);
      if (r.status === 401) askToSignIn(j.error);
      if (!r.ok) throw new Error(j.error ?? "Something went wrong");
      setTurns(j.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatus(null);
    }
  }

  async function search(question: string) {
    const q = question.trim();
    if (!q) return;
    setError(null);
    if (await needsSignIn("Sign in to search reviews.")) {
      pendingSearch.current = q;
      return;
    }
    setFound([]);
    setTurns([{ role: "user", content: q }]);
    setStage("chat");
    setStatus(`Searching YouTube for reviews of “${q}” and reading the transcripts…`);
    try {
      const r = await post("/api/reviewscout/searches", { deviceId: deviceId(), topic: q, nVideos, withComments });
      const j = await readJson(r);
      if (r.status === 401) askToSignIn(j.error);
      if (j.found) setFound(j.found);
      if (!r.ok) throw new Error(j.error ?? "Something went wrong");
      setSearchId(j.id);
      await ask(j.id, null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    }
  }

  async function sendFollowUp() {
    const m = followUp.trim();
    if (!m || status) return;
    setError(null);
    if (await needsSignIn("Sign in to ask about these reviews.")) return;
    setFollowUp("");
    setTurns((t) => [...t, { role: "user", content: m }]);
    await ask(searchId, m);
  }

  async function openHistory() {
    setStage("history");
    setPast(null);
    const r = await fetch(`/api/reviewscout/searches?deviceId=${encodeURIComponent(deviceId())}`);
    const j = await readJson(r);
    setPast(j.searches ?? []);
  }

  async function openSearch(id: string) {
    setError(null);
    const r = await fetch(`/api/reviewscout/searches/${id}?deviceId=${encodeURIComponent(deviceId())}`);
    const j = await readJson(r);
    if (!r.ok) return setError(j.error ?? "Couldn't open that search");
    setSearchId(j.id);
    setFound(j.found);
    setTurns(j.messages);
    setStage("chat");
    // A search whose summary never got written: write it now.
    if (j.messages.length === 1) await ask(j.id, null);
  }

  latest.current = { stage, search, openHistory };

  function reset() {
    setStage("start");
    setTurns([]);
    setFound([]);
    setError(null);
    setStatus(null);
  }

  const used = found.filter((f) => !f.skipped);
  const skipped = found.filter((f) => f.skipped);
  const hasSummary = turns.some((t) => t.role === "assistant");

  return (
    <main className="mx-auto min-h-dvh max-w-xl px-4 pb-32 pt-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <button onClick={reset} className="flex items-center gap-2.5 text-left">
          <Logo />
          <span className="flex flex-col leading-tight">
            <span className="text-lg font-semibold tracking-tight">Review Scout</span>
            <span className="text-xs text-muted">What YouTube reviewers said, with timestamps</span>
          </span>
        </button>
        {stage === "start" ? (
          <button onClick={openHistory} className="shrink-0 rounded-full border border-line bg-card px-3 py-1.5 text-sm font-medium">
            Past searches
          </button>
        ) : (
          <button onClick={reset} className="shrink-0 rounded-full bg-ink px-3 py-1.5 text-sm font-medium text-white">
            + New search
          </button>
        )}
      </header>

      {stage === "start" && (
        <section>
          <h1 className="text-[1.9rem] font-semibold leading-tight tracking-tight">Deciding on a product? Hear every reviewer at once.</h1>
          <p className="mt-3 text-muted">
            I find YouTube reviews, read the transcripts, and summarise them with timestamped citations. Then ask follow-ups about the same videos.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              search(topic);
            }}
            className="mt-8 space-y-4"
          >
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  search(topic);
                }
              }}
              rows={2}
              placeholder="e.g. Pixel 11 Pro camera vs iPhone 18"
              className="w-full resize-none rounded-2xl border border-line bg-card p-4 text-base outline-none focus:border-ink"
            />
            <div className="rounded-2xl border border-line bg-card p-4 text-sm">
              <label className="flex items-center justify-between gap-4">
                <span>Videos to read</span>
                <span className="flex items-center gap-3">
                  <input type="range" min={2} max={8} value={nVideos} onChange={(e) => setNVideos(Number(e.target.value))} className="w-32 accent-ink" />
                  <span className="w-4 text-right font-mono">{nVideos}</span>
                </span>
              </label>
              <label className="mt-3 flex items-center justify-between gap-4">
                <span>Also read top viewer comments (slower)</span>
                <input type="checkbox" checked={withComments} onChange={(e) => setWithComments(e.target.checked)} className="h-4 w-4 accent-ink" />
              </label>
            </div>
            <button type="submit" disabled={!topic.trim()} className="flex h-14 w-full items-center justify-center rounded-2xl bg-ink text-base font-medium text-white active:scale-[.99] disabled:opacity-40">
              Find reviews
            </button>
            <button
              type="button"
              onClick={() => {
                setTopic(EXAMPLE);
                search(EXAMPLE);
              }}
              className="block w-full text-center text-sm text-muted underline underline-offset-4"
            >
              Try an example: {EXAMPLE}
            </button>
          </form>
          {error && <p className="mt-6 rounded-xl bg-bad-soft p-3 text-sm text-bad">{error}</p>}
          <p className="mt-10 text-xs text-muted">Summaries use only what the reviewers said, never outside knowledge.</p>
        </section>
      )}

      {stage === "history" && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Past searches</h2>
          {past == null && <Loading label="Loading past searches" expectedMs={1200} />}
          {past?.length === 0 && <p className="text-muted">No searches on this device yet.</p>}
          <ul className="space-y-2">
            {past?.map((s) => (
              <li key={s.id}>
                <button onClick={() => openSearch(s.id)} className="w-full rounded-2xl border border-line bg-card p-3 text-left active:scale-[.99]">
                  <p className="font-medium">{s.topic}</p>
                  <p className="text-xs text-muted">
                    {new Date(s.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} · {s.videos} video{s.videos === 1 ? "" : "s"}
                  </p>
                </button>
              </li>
            ))}
          </ul>
          {error && <p className="mt-6 rounded-xl bg-bad-soft p-3 text-sm text-bad">{error}</p>}
        </section>
      )}

      {stage === "chat" && (
        <section className="space-y-4">
          {turns.slice(0, 1).map((t, i) => (
            <Bubble key={i} turn={t} />
          ))}

          {/* What was read sits under the question, before the summary. */}
          {found.length > 0 && (
            <details className="rounded-2xl border border-line bg-card p-3 text-sm" open={!hasSummary}>
              <summary className="cursor-pointer font-medium">
                Read {used.length} video{used.length === 1 ? "" : "s"}
                {skipped.length ? `, skipped ${skipped.length} without a transcript` : ""}
              </summary>
              <ul className="mt-2 space-y-1.5">
                {found.map((f) => (
                  <li key={f.id} className={f.skipped ? "text-muted line-through" : ""}>
                    <a href={f.url} target="_blank" rel="noopener noreferrer" className="underline decoration-line underline-offset-2">
                      {f.title}
                    </a>{" "}
                    <span className="text-muted">· {f.channel}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {turns.slice(1).map((t, i) => (
            <Bubble key={i + 1} turn={t} />
          ))}

          {status && (
            <div className="flex items-center gap-3 text-sm text-muted">
              <ProgressRing key={status} expectedMs={status.startsWith("Searching") ? 40_000 : 12_000} size={40} label={status} className="text-ink" />
              {status}
            </div>
          )}
          {error && <p className="rounded-xl bg-bad-soft p-3 text-sm text-bad">{error}</p>}
          <div ref={endRef} />

          {hasSummary && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendFollowUp();
              }}
              className="fixed inset-x-0 bottom-[var(--tabbar-h)] z-30 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur"
            >
              <div className="mx-auto flex max-w-xl gap-2">
                <input
                  value={followUp}
                  onChange={(e) => setFollowUp(e.target.value)}
                  placeholder="Ask a follow-up about these videos"
                  className="h-12 min-w-0 flex-1 rounded-full border border-line bg-card px-4 outline-none focus:border-ink"
                />
                <button type="submit" disabled={!followUp.trim() || !!status} className="h-12 shrink-0 rounded-full bg-ink px-5 font-medium text-white disabled:opacity-40">
                  Ask
                </button>
              </div>
            </form>
          )}
        </section>
      )}
    </main>
  );
}

function Bubble({ turn }: { turn: Turn }) {
  return turn.role === "user" ? (
    <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-white">{turn.content}</div>
  ) : (
    <div className="rounded-2xl border border-line bg-card p-4">
      <Markdown text={turn.content} />
    </div>
  );
}

function Logo() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      <rect width="34" height="34" rx="10" fill="var(--color-ink)" />
      <path d="M13 11.5v11l9-5.5z" fill="var(--color-paper)" />
    </svg>
  );
}
