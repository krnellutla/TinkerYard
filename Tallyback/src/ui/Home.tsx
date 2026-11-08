"use client";

import { ProgressRing } from "@ui/ProgressRing";
import { Loading } from "@ui/ProgressRing";
import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_UPLOAD } from "@tallyback/lib/upload";
import { shrink } from "./upload";
import { runChecks } from "@tallyback/lib/checks";
import { allClearSummary } from "@tallyback/lib/message";
import { fmt } from "@tallyback/lib/money";
import type { LineHistory } from "@tallyback/lib/history";
import type { Extraction, Finding, Promise as BillPromise } from "@tallyback/lib/types";
import { askToSignIn, isSignedIn, onSessionChanged } from "@signin/ui/prompt";
import { billToDraft, type BillDraft } from "@tallyback/split/lib/fromBill";
import { SplitPanel } from "@tallyback/split/ui/SplitPanel";

type Stage = "start" | "scanning" | "review" | "bills";
// Two halves of one app: check a bill, or split costs with friends (Tallyback/src/split).
type Tab = "bills" | "split";

interface BillSummary {
  id: string;
  merchant: string | null;
  billType: string | null;
  billDate: string | null;
  createdAt: string;
  currency: string;
  total: number | null;
  status: "sent" | "drafted" | "dispute" | "query" | "all_ok";
  atStake: number;
  issue: string | null;
  sentAt: string | null;
  wordsChanged: number | null;
}

interface LastMessage {
  text: string;
  sentAt: string | null;
}

const EMPTY_PROMISE: BillPromise = { expectedTotal: null, pricesIncludeTax: null, paidOn: null, lineExpected: {}, unrecognised: [] };

function deviceId(): string {
  try {
    let id = localStorage.getItem("bs-device");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("bs-device", id);
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
    if (r.status === 413) return { error: "That file is too large. Try a photo instead of a big PDF." };
    if (r.status === 504 || /timeout/i.test(text)) return { error: "Reading the bill took too long. Please try again." };
    return { error: `Something went wrong (${r.status}). Please try again.` };
  }
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("bills");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [draft, setDraft] = useState<BillDraft | null>(null); // a checked bill on its way into a group
  const [stage, setStage] = useState<Stage>("start");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isPdf, setIsPdf] = useState(false);
  const [billId, setBillId] = useState("");
  const [lineIds, setLineIds] = useState<string[]>([]);
  const [ex, setEx] = useState<Extraction | null>(null);
  const [promise, setPromise] = useState<BillPromise>(EMPTY_PROMISE);
  const [selected, setSelected] = useState<number | null>(null);
  const [history, setHistory] = useState<Record<number, LineHistory>>({});
  const [lastMessage, setLastMessage] = useState<LastMessage | null>(null);
  const [opening, setOpening] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  // A photo picked before signing in: checked as soon as sign-in succeeds, so it needn't be picked again.
  const pendingFile = useRef<File | null>(null);
  const scanRef = useRef<(file: File) => void>(() => {});

  useEffect(
    () =>
      onSessionChanged(async () => {
        const file = pendingFile.current;
        if (file && (await isSignedIn())) {
          pendingFile.current = null;
          scanRef.current(file);
        }
      }),
    [],
  );

  // Code decides, live, as the user tells us what they were promised.
  const result = useMemo(() => (ex ? runChecks(ex, promise) : null), [ex, promise]);
  const flagged = useMemo(() => {
    const m = new Map<number, Finding["verdict"]>();
    result?.findings.forEach((f) => {
      if (f.lineIndex == null) return;
      const prev = m.get(f.lineIndex);
      if (prev !== "wrong") m.set(f.lineIndex, f.verdict === "info" && prev ? prev : f.verdict);
    });
    return m;
  }, [result]);

  async function scan(file: File | null, sample = false) {
    setError(null);
    // Every TallyBack action needs an invited account (the sign-in wall normally gets there first).
    if (!sample && file && !(await isSignedIn())) {
      pendingFile.current = file;
      const why = "Sign in to check a bill.";
      setError(why);
      askToSignIn(why);
      return;
    }
    setStage("scanning");
    setPromise(EMPTY_PROMISE);
    setSelected(null);
    setHistory({});
    setLastMessage(null);
    const fd = new FormData();
    fd.append("deviceId", deviceId());
    if (sample) {
      fd.append("sample", "1");
      setPreview("/tallyback/sample-receipt.jpg");
      setIsPdf(false);
    }
    try {
      if (!sample && file) {
        const pdf = file.type === "application/pdf";
        setIsPdf(pdf);
        setPreview(pdf ? null : URL.createObjectURL(file));
        const blob = await shrink(file);
        if (blob.size > MAX_UPLOAD) throw new Error("That file is too large (over 4 MB). Try a photo of the bill instead.");
        fd.append("file", blob, pdf ? file.name : blob === file ? file.name : "bill.jpg");
      }
      const r = await fetch("/api/tallyback/scan", { method: "POST", body: fd });
      const j = await readJson(r);
      if (r.status === 401) askToSignIn(j.error);
      if (!r.ok) throw new Error(j.error ?? "Something went wrong");
      setEx(j.extraction);
      setBillId(j.billId);
      setLineIds(j.lineIds);
      setHistory(j.history ?? {});
      setStage("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("start");
    }
  }

  scanRef.current = (file: File) => scan(file);

  // The tab and the open group live in the address (?tab=split&g=…), so Back and reload work,
  // and old /splitbill links land here (next.config.ts).
  useEffect(() => {
    const read = () => {
      const q = new URL(window.location.href).searchParams;
      setTab(q.get("tab") === "split" || q.get("g") ? "split" : "bills");
      setGroupId(q.get("g"));
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  function go(next: Tab, group: string | null = null) {
    const url = new URL(window.location.href);
    url.searchParams.delete("g");
    if (next === "split") url.searchParams.set("tab", "split");
    else url.searchParams.delete("tab");
    if (group) url.searchParams.set("g", group);
    window.history.pushState(null, "", url.pathname + url.search);
    setTab(next);
    setGroupId(group);
    window.scrollTo(0, 0);
  }

  function splitThisBill() {
    if (!ex) return;
    setDraft(billToDraft(ex, result, billId || undefined));
    go("split");
  }

  function reset() {
    setStage("start");
    setEx(null);
    setPreview(null);
    setError(null);
  }

  async function openBill(id: string) {
    setOpening(true);
    setError(null);
    try {
      const r = await fetch(`/api/tallyback/bills/${id}?deviceId=${encodeURIComponent(deviceId())}`);
      const j = await readJson(r);
      if (!r.ok) throw new Error(j.error ?? "Couldn't open that bill");
      setEx(j.extraction);
      setBillId(j.billId);
      setLineIds(j.lineIds);
      setPromise(j.promise);
      setPreview(j.imageUrl);
      setIsPdf(!j.imageUrl);
      setHistory(j.history ?? {});
      setLastMessage(j.lastMessage);
      setSelected(null);
      setStage("review");
      window.scrollTo(0, 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(false);
    }
  }

  return (
    <main className="mx-auto min-h-dvh max-w-xl px-4 pb-24 pt-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <button
          onClick={() => {
            reset();
            go("bills");
          }}
          className="flex items-center gap-2.5 text-left"
        >
          <Logo />
          <span className="flex flex-col leading-tight">
            <span className="text-lg font-semibold tracking-tight">TallyBack</span>
            <span className="text-xs text-muted">Check every bill. Split it with friends.</span>
          </span>
        </button>
        {tab === "split" ? null : stage === "bills" ? (
          <button onClick={reset} className="shrink-0 rounded-full bg-ink px-3 py-1.5 text-sm font-medium text-white">
            + New bill
          </button>
        ) : (
          <button onClick={() => setStage("bills")} className="shrink-0 rounded-full border border-line bg-card px-3 py-1.5 text-sm font-medium">
            My bills
          </button>
        )}
      </header>

      <div role="tablist" aria-label="TallyBack" className="mb-6 flex gap-1 rounded-full border border-line bg-card p-1 text-sm">
        {(
          [
            ["bills", "Bills"],
            ["split", "Split with friends"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => go(id)}
            className={`h-10 flex-1 rounded-full font-medium ${tab === id ? "bg-ink text-white" : "text-muted hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "split" && (
        <SplitPanel
          groupId={groupId}
          onOpen={(id) => go("split", id)}
          draft={draft}
          onDraftDone={() => setDraft(null)}
        />
      )}

      {tab === "bills" && stage === "start" && (
        <section>
          <h1 className="text-[1.9rem] font-semibold leading-tight tracking-tight">
            A bill you don&apos;t trust, turned into one message worth sending.
          </h1>
          <p className="mt-3 text-muted">
            Snap any bill or receipt. We check every line and the maths, show you the line that doesn&apos;t add up, and write the message. Every number comes from code, not AI.
          </p>
          <div className="mt-8 grid gap-3">
            <button onClick={() => cameraRef.current?.click()} className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-ink text-base font-medium text-white active:scale-[.99]">
              <CameraIcon /> Take a photo of the bill
            </button>
            <button onClick={() => uploadRef.current?.click()} className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-line bg-card text-base font-medium active:scale-[.99]">
              <UploadIcon /> Upload photo or PDF
            </button>
            <button onClick={() => scan(null, true)} className="mt-1 text-sm text-muted underline underline-offset-4">
              No bill handy? Try a sample receipt
            </button>
          </div>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && scan(e.target.files[0])} />
          <input ref={uploadRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => e.target.files?.[0] && scan(e.target.files[0])} />
          {error && <p className="mt-6 rounded-xl bg-bad-soft p-3 text-sm text-bad">{error}</p>}
          <p className="mt-10 text-xs text-muted">We never store account numbers, phone numbers or addresses.</p>
        </section>
      )}

      {tab === "bills" && stage === "scanning" && (
        <section className="flex flex-col items-center pt-10 text-center">
          {preview && <img src={preview} alt="" className="max-h-72 rounded-xl opacity-60 shadow" />}
          {/* Paced to the usual read (4–7 s on the free models; see docs/FREE_MODELS.md). */}
          <ProgressRing expectedMs={6000} size={88} label="Reading every line" className="mt-6 text-ink" />
          <p className="mt-4 text-muted">Reading every line…</p>
        </section>
      )}

      {tab === "bills" && stage === "bills" && <BillsList onOpen={openBill} onNew={reset} opening={opening} error={error} />}

      {tab === "bills" && stage === "review" && ex && result && (
        <Review
          onSplit={splitThisBill}
          ex={ex}
          setEx={setEx}
          preview={isPdf ? null : preview}
          result={result}
          flagged={flagged}
          promise={promise}
          setPromise={setPromise}
          selected={selected}
          setSelected={setSelected}
          billId={billId}
          lineIds={lineIds}
          history={history}
          lastMessage={lastMessage}
        />
      )}
    </main>
  );
}

function Review(props: {
  onSplit: () => void;
  ex: Extraction;
  setEx: (e: Extraction) => void;
  preview: string | null;
  result: NonNullable<ReturnType<typeof runChecks>>;
  flagged: Map<number, Finding["verdict"]>;
  promise: BillPromise;
  setPromise: (p: BillPromise) => void;
  selected: number | null;
  setSelected: (i: number | null) => void;
  billId: string;
  lineIds: string[];
  history: Record<number, LineHistory>;
  lastMessage: LastMessage | null;
}) {
  const { ex, result, flagged, promise, setPromise, selected, setSelected, history, lastMessage } = props;
  const cur = ex.currency ?? "";
  const p = result.primary;
  const infos = result.findings.filter((f) => f.verdict === "info");
  const showPaidOn = ex.lines.some((l) => l.kind === "late_fee") || !!ex.due_date;
  const showInclusive = ex.tax_mode === "added" && (ex.printed_tax_total ?? 0) > 0;

  return (
    <section className="space-y-5">
      {lastMessage?.sentAt && (
        <div className="rounded-2xl bg-good-soft p-3 text-sm text-good">
          You sent a message about this bill on {new Date(lastMessage.sentAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}.
        </div>
      )}
      {/* Bill with highlighted rows */}
      <div className="rounded-2xl border border-line bg-card p-3">
        <div className="mb-3 flex items-baseline justify-between px-1">
          <div>
            <p className="font-medium">{ex.merchant_name ?? "Bill"}</p>
            <p className="text-xs text-muted">
              {[ex.bill_type, ex.bill_date, ex.bill_number].filter(Boolean).join(" · ")}
            </p>
          </div>
          {ex.printed_total != null && <p className="font-mono text-lg font-semibold">{fmt(ex.printed_total, cur)}</p>}
        </div>
        {props.preview && (
          <div className="relative overflow-hidden rounded-xl">
            <img src={props.preview} alt="Your bill" className="block w-full" />
            {ex.lines.map((l, i) => {
              const v = flagged.get(i);
              if (!l.box_2d || (!v && selected !== i)) return null;
              const [y0, x0, y1, x1] = l.box_2d;
              const cls =
                v === "wrong"
                  ? "border-bad bg-bad/15 box-bad"
                  : v === "unexplained"
                    ? "border-bad bg-bad/10"
                    : v === "info"
                      ? "border-warn bg-warn/15"
                      : "border-ink bg-ink/10";
              return (
                <button
                  key={i}
                  aria-label={l.description}
                  onClick={() => setSelected(i)}
                  className={`absolute rounded-md border-2 ${cls}`}
                  style={{ top: `${y0 / 10}%`, left: `${x0 / 10}%`, height: `${(y1 - y0) / 10}%`, width: `${(x1 - x0) / 10}%` }}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Verdict */}
      {p ? (
        <div className={`rounded-2xl p-4 ${p.verdict === "wrong" ? "bg-bad-soft" : "bg-warn-soft"}`}>
          <p className={`text-xs font-semibold uppercase tracking-wider ${p.verdict === "wrong" ? "text-bad" : "text-warn"}`}>
            {p.verdict === "wrong" ? "Doesn't add up" : "Unexplained charge"}
          </p>
          <p className="mt-1 text-xl font-semibold leading-snug">{p.title}</p>
          <p className="mt-2 font-mono text-sm">{p.maths}</p>
          {p.diff > 0 && (
            <p className="mt-3 text-sm">
              You could get back <span className="font-mono text-base font-semibold">{fmt(p.diff, cur)}</span>
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-2xl bg-good-soft p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-good">Every line checks out</p>
          <p className="mt-1 text-xl font-semibold">Nothing to dispute{infos.length ? " yet" : ""}.</p>
          <pre className="mt-3 whitespace-pre-wrap font-mono text-xs leading-relaxed">{allClearSummary(result)}</pre>
        </div>
      )}

      {infos.map((f) => (
        <div key={f.id} className="rounded-2xl border border-warn/30 bg-warn-soft/60 p-3 text-sm">
          <p className="font-medium">{f.title}</p>
          <p className="mt-1 text-muted">{f.maths}</p>
        </div>
      ))}

      {/* Promise */}
      <div className="rounded-2xl border border-line bg-card p-4">
        <p className="font-medium">What were you promised?</p>
        <p className="text-sm text-muted">Plan price, shelf price, quote, menu, or just what you expected to pay.</p>
        <label className="mt-4 block text-sm">
          Expected total ({cur || "amount"})
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            placeholder={ex.printed_total != null ? String(ex.printed_total) : "0.00"}
            value={promise.expectedTotal ?? ""}
            onChange={(e) => setPromise({ ...promise, expectedTotal: e.target.value === "" ? null : Number(e.target.value) })}
            className="mt-1 h-12 w-full rounded-xl border border-line bg-paper px-3 font-mono text-base"
          />
        </label>
        {showInclusive && (
          <div className="mt-4 text-sm">
            Did the shelf / menu prices already include tax?
            <div className="mt-2 grid grid-cols-3 gap-2">
              {([
                ["Yes", true],
                ["No", false],
                ["Not sure", null],
              ] as const).map(([label, val]) => (
                <button
                  key={label}
                  onClick={() => setPromise({ ...promise, pricesIncludeTax: val })}
                  className={`h-10 rounded-xl border ${promise.pricesIncludeTax === val ? "border-ink bg-ink text-white" : "border-line bg-paper"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        {showPaidOn && (
          <label className="mt-4 block text-sm">
            When did you pay your last bill?
            <input
              type="date"
              value={promise.paidOn ?? ""}
              onChange={(e) => setPromise({ ...promise, paidOn: e.target.value || null })}
              className="mt-1 h-12 w-full rounded-xl border border-line bg-paper px-3"
            />
          </label>
        )}
      </div>

      {/* Lines */}
      <div className="rounded-2xl border border-line bg-card">
        <p className="px-4 pt-4 font-medium">Every line</p>
        <p className="px-4 text-sm text-muted">Tap a line you don&apos;t recognise or that was meant to cost less.</p>
        <ul className="mt-2 divide-y divide-line">
          {ex.lines.map((l, i) => {
            const v = flagged.get(i);
            const open = selected === i;
            const isCharge = !["subtotal", "total", "payment", "rounding"].includes(l.kind);
            return (
              <li key={i} className={v === "wrong" || v === "unexplained" ? "bg-bad-soft" : v === "info" ? "bg-warn-soft/60" : ""}>
                <button onClick={() => setSelected(open ? null : i)} className="flex w-full items-start gap-3 px-4 py-3 text-left">
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm ${l.kind === "total" || l.kind === "subtotal" ? "font-semibold" : ""}`}>{l.description}</p>
                    <p className="truncate text-xs text-muted">
                      {l.qty != null && l.unit_price != null && l.kind === "item" ? `${l.qty} × ${fmt(l.unit_price, cur)} · ` : ""}
                      {l.plain_words}
                    </p>
                    {history[i] && (
                      <p className={`mt-0.5 text-xs ${history[i].change === "up" ? "font-medium text-warn" : "text-muted"}`}>
                        ↺ {history[i].note}
                      </p>
                    )}
                  </div>
                  <span className={`font-mono text-sm ${v === "wrong" || v === "unexplained" ? "font-semibold text-bad" : ""}`}>{fmt(l.amount, cur)}</span>
                </button>
                {open && isCharge && (
                  <div className="flex flex-wrap items-center gap-2 px-4 pb-3 text-sm">
                    <button
                      onClick={() => {
                        const has = promise.unrecognised.includes(i);
                        setPromise({ ...promise, unrecognised: has ? promise.unrecognised.filter((x) => x !== i) : [...promise.unrecognised, i] });
                      }}
                      className={`h-9 rounded-lg border px-3 ${promise.unrecognised.includes(i) ? "border-bad bg-bad text-white" : "border-line bg-card"}`}
                    >
                      I don&apos;t recognise this
                    </button>
                    <span className="text-muted">or should cost</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      placeholder="0.00"
                      value={promise.lineExpected[i] ?? ""}
                      onChange={(e) => {
                        const le = { ...promise.lineExpected };
                        if (e.target.value === "") delete le[i];
                        else le[i] = Number(e.target.value);
                        setPromise({ ...promise, lineExpected: le });
                      }}
                      className="h-9 w-24 rounded-lg border border-line bg-paper px-2 font-mono"
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <details className="rounded-2xl border border-line bg-card p-4 text-sm">
        <summary className="cursor-pointer font-medium">Show all the maths</summary>
        <ul className="mt-3 space-y-2">
          {result.checks.map((c) => (
            <li key={c.name} className="flex gap-2">
              <span className={c.ok === null ? "text-muted" : c.ok ? "text-good" : "text-bad"}>{c.ok === null ? "–" : c.ok ? "✓" : "✗"}</span>
              <span>
                <span className="font-medium">{c.name}.</span> <span className="font-mono text-xs">{c.maths}</span>
              </span>
            </li>
          ))}
        </ul>
      </details>

      {p && <MessagePanel key={p.id} {...props} finding={p} />}

      <div className="rounded-2xl border border-line bg-card p-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-medium">Shared this bill?</p>
          {p && p.diff > 0 && ex.printed_total != null && (
            <span className="rounded-full bg-bad-soft px-2.5 py-0.5 font-mono text-xs font-medium text-bad">
              Verified {fmt(Math.max(0, ex.printed_total - p.diff), cur)}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted">
          {p && p.diff > 0
            ? `Split the verified fair total (excluding ${fmt(p.diff, cur)} disputed), assign individual receipt items with proportional tax/service charge, or split equally.`
            : "Add it to a group and split by individual receipt items (with proportional tax & service charge), equally, percentages or shares."}
        </p>
        <button onClick={props.onSplit} className="mt-3 flex h-12 w-full items-center justify-center rounded-2xl bg-ink font-medium text-white active:scale-[.99]">
          {p && p.diff > 0 && ex.printed_total != null
            ? `Split verified bill (${fmt(Math.max(0, ex.printed_total - p.diff), cur)})`
            : "Split this bill"}
        </button>
      </div>
    </section>
  );
}

const STATUS: Record<BillSummary["status"], { label: string; cls: string }> = {
  sent: { label: "Message sent", cls: "bg-good-soft text-good" },
  drafted: { label: "Message drafted", cls: "bg-warn-soft text-warn" },
  dispute: { label: "Doesn't add up", cls: "bg-bad-soft text-bad" },
  query: { label: "Unexplained charge", cls: "bg-warn-soft text-warn" },
  all_ok: { label: "Checks out", cls: "bg-paper text-muted" },
};

function BillsList({ onOpen, onNew, opening, error }: { onOpen: (id: string) => void; onNew: () => void; opening: boolean; error: string | null }) {
  const [bills, setBills] = useState<BillSummary[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // Reloaded after signing in or out: an account's bills differ from a guest's.
  useEffect(() => {
    const load = () =>
      fetch(`/api/tallyback/bills?deviceId=${encodeURIComponent(deviceId())}`)
        .then(readJson)
        .then((j) => (j.error ? setLoadErr(j.error) : setBills(j.bills ?? [])))
        .catch(() => setLoadErr("Couldn't load your bills"));
    load();
    return onSessionChanged(load);
  }, []);

  const recovered = (bills ?? []).filter((b) => b.status === "sent").reduce<Record<string, number>>((acc, b) => {
    acc[b.currency] = (acc[b.currency] ?? 0) + b.atStake;
    return acc;
  }, {});

  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">My bills</h1>
      <p className="mt-1 text-sm text-muted">Every bill you&apos;ve checked on this phone, kept for next time.</p>
      {Object.entries(recovered).some(([, v]) => v > 0) && (
        <p className="mt-3 rounded-xl bg-good-soft p-3 text-sm text-good">
          Disputed so far: {Object.entries(recovered).filter(([, v]) => v > 0).map(([c, v]) => fmt(v, c)).join(" + ")}
        </p>
      )}
      {(error || loadErr) && <p className="mt-4 rounded-xl bg-bad-soft p-3 text-sm text-bad">{error ?? loadErr}</p>}
      {bills === null && !loadErr && <Loading label="Loading your bills" expectedMs={1500} />}
      {bills?.length === 0 && (
        <div className="mt-6 rounded-2xl border border-dashed border-line p-6 text-center">
          <p className="font-medium">No bills yet</p>
          <p className="mt-1 text-sm text-muted">Bills you scan show up here.</p>
          <button onClick={onNew} className="mt-4 h-11 rounded-xl bg-ink px-5 text-sm font-medium text-white">
            Check a bill
          </button>
        </div>
      )}
      <ul className={`mt-5 space-y-3 ${opening ? "pointer-events-none opacity-60" : ""}`}>
        {bills?.map((b) => {
          const st = STATUS[b.status];
          const date = b.billDate ?? b.createdAt.slice(0, 10);
          return (
            <li key={b.id}>
              <button onClick={() => onOpen(b.id)} className="w-full rounded-2xl border border-line bg-card p-4 text-left active:scale-[.99]">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate font-medium">{b.merchant ?? "Bill"}</p>
                  {b.total != null && <p className="shrink-0 font-mono">{fmt(b.total, b.currency)}</p>}
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {[new Date(date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }), b.billType].filter(Boolean).join(" · ")}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className={`rounded-full px-2.5 py-1 font-medium ${st.cls}`}>{st.label}</span>
                  {b.atStake > 0 && b.status !== "all_ok" && <span className="font-mono text-muted">{fmt(b.atStake, b.currency)} at stake</span>}
                  {b.status === "sent" && b.wordsChanged != null && <span className="text-muted">{b.wordsChanged} words changed</span>}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function MessagePanel(props: {
  ex: Extraction;
  promise: BillPromise;
  finding: Finding;
  billId: string;
  lineIds: string[];
}) {
  const { ex, promise, finding, billId, lineIds } = props;
  const [tone, setTone] = useState<"polite" | "firm">("polite");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [drafted, setDrafted] = useState("");
  const [text, setText] = useState("");
  const [messageId, setMessageId] = useState("");
  const [phone, setPhone] = useState(ex.merchant_whatsapp?.replace(/\D/g, "") ?? "");
  const [sent, setSent] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setDrafted("");
    setText("");
    setSent(null);
  }, [finding.id, finding.diff]);

  async function draft() {
    setErr(null);
    // Writing the message calls the AI: invited accounts only.
    if (!(await isSignedIn())) {
      const why = "Sign in to write the message.";
      setErr(why);
      askToSignIn(why);
      return;
    }
    setBusy(true);
    try {
      const deviceIdVal = (() => {
        try {
          return localStorage.getItem("bs-device") ?? "anon";
        } catch {
          return "anon";
        }
      })();
      const c = await fetch("/api/tallyback/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ billId, deviceId: deviceIdVal, lineIds, extraction: ex, promise }),
      }).then(readJson);
      const r = await fetch("/api/tallyback/message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ billId, deviceId: deviceIdVal, lineIds, findingDbIds: c.findingIds, extraction: ex, promise, findingId: finding.id, tone, note }),
      });
      const j = await readJson(r);
      if (r.status === 401) askToSignIn(j.error);
      if (!r.ok) throw new Error(j.error);
      setDrafted(j.text);
      setText(j.text);
      setMessageId(j.messageId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function logSent(channel: string) {
    const r = await fetch("/api/tallyback/sent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ billId, deviceId: deviceId(), messageId, drafted, sentText: text, channel }),
    }).then(readJson);
    setSent(r.wordsChanged ?? 0);
  }

  function whatsapp() {
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
    logSent("whatsapp");
    window.open(url, "_blank");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
    logSent("copied");
  }

  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <p className="font-medium">Your message</p>
      {!drafted ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            {(["polite", "firm"] as const).map((t) => (
              <button key={t} onClick={() => setTone(t)} className={`h-10 rounded-xl border capitalize ${tone === t ? "border-ink bg-ink text-white" : "border-line bg-paper"}`}>
                {t}
              </button>
            ))}
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything to add, in your words? (optional)"
            className="mt-3 h-12 w-full rounded-xl border border-line bg-paper px-3 text-sm"
          />
          <button onClick={draft} disabled={busy} className="mt-3 h-12 w-full rounded-xl bg-ink font-medium text-white disabled:opacity-60">
            {busy ? "Writing…" : "Write the message"}
          </button>
          {err && <p className="mt-2 text-sm text-bad">{err}</p>}
        </>
      ) : (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={9}
            className="mt-3 w-full rounded-xl border border-line bg-paper p-3 text-[15px] leading-relaxed"
          />
          <p className="mt-1 text-xs text-muted">Edit freely. Every amount above was computed by code.</p>
          <label className="mt-4 block text-sm">
            Send to (WhatsApp number with country code, or leave blank to pick a contact)
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="tel"
              placeholder="e.g. 6598444327"
              className="mt-1 h-12 w-full rounded-xl border border-line bg-paper px-3 font-mono"
            />
          </label>
          <button onClick={whatsapp} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-wa font-medium text-white">
            <WaIcon /> Send on WhatsApp
          </button>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <button onClick={copy} className="h-10 rounded-xl border border-line bg-paper">
              Copy text
            </button>
            <button onClick={() => logSent("other")} className="h-10 rounded-xl border border-line bg-paper">
              I sent it another way
            </button>
          </div>
          {sent !== null && (
            <p className="mt-3 rounded-xl bg-good-soft p-3 text-sm text-good">
              Logged as sent · {sent} word{sent === 1 ? "" : "s"} changed from the draft.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// A receipt with a return arrow: tally the bill, get it back.
const Logo = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M5 2.5h14v19l-2.33-1.5-2.34 1.5L12 20l-2.33 1.5L7.33 20 5 21.5v-19Z" fill="#1c1b19" />
    <path d="M14.5 9.5H10a2 2 0 0 0 0 4h4.5M12.5 7.5l2 2-2 2" stroke="#f6f4ef" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const CameraIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" strokeLinejoin="round" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);
const UploadIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M12 16V4m0 0-4 4m4-4 4 4M4 20h16" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const WaIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.7-.1 1.2Z" />
  </svg>
);
