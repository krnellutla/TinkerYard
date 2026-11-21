"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MLCEngine } from "@mlc-ai/web-llm";
import { runChecks } from "../lib/checks";
import { normalize } from "../lib/normalize";
import { parseJsonLoose } from "../lib/models";
import type { CheckResult, Extraction, Finding, Promise as BillPromise } from "../lib/types";
import { parseReceiptText } from "../lib/offline/heuristic";
import { assess, type Assessment } from "../lib/offline/confidence";
import { OFFLINE_SCHEMA, OFFLINE_SYSTEM, fromOfflineJson, offlineUserPrompt } from "../lib/offline/prompt";
import { PALAWAN_RECEIPTS } from "../split/lib/demoPalawanData";
import { DEMO_RECEIPTS } from "../split/lib/demoData";
import { Sheet, primary, secondary } from "../split/ui/kit";
import { shrink } from "./upload";

// Offline lab: reads a receipt entirely on this device, to test the plan in docs/08-MOBILE-LAUNCH-PLAN.md.
//   1. Tesseract.js reads the text from the photo (WebAssembly, ~15 MB of files, cached).
//   2a. A model-free parser turns that text into lines (instant, no download).
//   2b. Optionally, a small AI model the user chose to download (WebLLM on WebGPU) does the same.
//   3. The same bill checks as the cloud path run on both, and code decides how far to trust each reading.
// Nothing here calls TallyBack's server. Model files come from Hugging Face, OCR files from jsDelivr.

const NO_PROMISE: BillPromise = { expectedTotal: null, pricesIncludeTax: null, paidOn: null, lineExpected: {}, unrecognised: [] };

interface ModelOption {
  label: string;
  f16: string; // WebLLM model id when the GPU supports 16-bit floats (smaller, faster)
  f32: string;
  approx: string;
  note: string;
}
const MODELS: ModelOption[] = [
  { label: "Qwen2.5 1.5B", f16: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", f32: "Qwen2.5-1.5B-Instruct-q4f32_1-MLC", approx: "about 1 GB", note: "Most accurate of the three. Needs a recent laptop or phone." },
  { label: "Llama 3.2 1B", f16: "Llama-3.2-1B-Instruct-q4f16_1-MLC", f32: "Llama-3.2-1B-Instruct-q4f32_1-MLC", approx: "about 0.7 GB", note: "Middle ground." },
  { label: "Qwen2.5 0.5B", f16: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC", f32: "Qwen2.5-0.5B-Instruct-q4f32_1-MLC", approx: "about 0.3 GB", note: "Fastest and smallest, least accurate." },
];

const SAMPLES = [
  ...PALAWAN_RECEIPTS.map((r) => ({ key: `palawan-${r.key}`, label: `🏝️ ${r.extraction.merchant_name}`, dataUrl: r.dataUrl, truth: r.extraction })),
  ...DEMO_RECEIPTS.map((r) => ({ key: `bangkok-${r.key}`, label: `🛺 ${r.extraction.merchant_name}`, dataUrl: r.dataUrl, truth: r.extraction })),
];

interface Caps {
  webgpu: boolean;
  f16: boolean;
  freeBytes: number | null;
  cellular: boolean | null; // null: the browser doesn't say
}

interface Run {
  ex: Extraction;
  result: CheckResult;
  trust: Assessment;
  ms: number;
  tokensPerSec?: number;
  raw?: string;
}

interface Receipt {
  name: string;
  blob: Blob;
  preview: string;
  truth?: Extraction;
}

const gb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${Math.round(b / 1e6)} MB`);

async function detectCaps(): Promise<Caps> {
  const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> }; connection?: { type?: string; saveData?: boolean } };
  let webgpu = false;
  let f16 = false;
  try {
    const adapter = await nav.gpu?.requestAdapter();
    webgpu = !!adapter;
    f16 = !!adapter?.features.has("shader-f16");
  } catch {}
  let freeBytes: number | null = null;
  try {
    const est = await navigator.storage?.estimate();
    if (est?.quota != null) freeBytes = est.quota - (est.usage ?? 0);
  } catch {}
  const type = nav.connection?.type;
  return { webgpu, f16, freeBytes, cellular: type ? type === "cellular" : nav.connection?.saveData ? true : null };
}

// The exact download size: WebLLM's weight manifest lists every shard's bytes.
async function exactSize(modelId: string): Promise<number | null> {
  try {
    const { prebuiltAppConfig } = await import("@mlc-ai/web-llm");
    const rec = prebuiltAppConfig.model_list.find((m) => m.model_id === modelId);
    if (!rec) return null;
    const base = rec.model.endsWith("/") ? rec.model : `${rec.model}/`;
    const r = await fetch(`${base}resolve/main/ndarray-cache.json`);
    const j = (await r.json()) as { records: { nbytes: number }[] };
    return j.records.reduce((s, x) => s + x.nbytes, 0);
  } catch {
    return null;
  }
}

// SVG demo receipts → a 2× PNG, which OCR reads far better than a small render.
async function svgToPng(dataUrl: string): Promise<Blob> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth * 2;
  c.height = img.naturalHeight * 2;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't draw the receipt"))), "image/png"));
}

function evaluate(ex: Extraction, ocrText: string, ms: number, extra?: Partial<Run>): Run {
  const result = runChecks(ex, NO_PROMISE);
  return { ex, result, trust: assess(ex, ocrText, result), ms, ...extra };
}

// How close a reading came to the receipt's known contents (demo samples only).
function accuracy(ex: Extraction, truth: Extraction) {
  // Subtotal and total rows are compared as printed totals below, not as lines.
  const amounts = (e: Extraction) => e.lines.filter((l) => l.kind !== "subtotal" && l.kind !== "total").map((l) => Math.round(l.amount * 100));
  const want = amounts(truth);
  const got = amounts(ex);
  const pool = [...got];
  let hit = 0;
  for (const w of want) {
    const i = pool.indexOf(w);
    if (i >= 0) {
      hit++;
      pool.splice(i, 1);
    }
  }
  return { lines: `${hit}/${want.length}`, extra: pool.length, total: ex.printed_total != null && truth.printed_total != null && Math.abs(ex.printed_total - truth.printed_total) < 0.005 };
}

export default function OfflineLab() {
  const [caps, setCaps] = useState<Caps | null>(null);
  const [choice, setChoice] = useState(0);
  const [cached, setCached] = useState<Record<string, boolean>>({});
  const [consent, setConsent] = useState<{ size: number | null } | null>(null);
  const [wifiOnly, setWifiOnly] = useState(true);
  const [load, setLoad] = useState<{ pct: number; text: string } | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const engine = useRef<MLCEngine | null>(null);

  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [lang, setLang] = useState("eng");
  const [ocr, setOcr] = useState<{ text: string; ms: number } | null>(null);
  const [ocrPct, setOcrPct] = useState<number | null>(null);
  const [runs, setRuns] = useState<{ heuristic?: Run; model?: Run }>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const opt = MODELS[choice];
  const modelId = caps?.f16 ? opt.f16 : opt.f32;

  const refreshCached = useCallback(async () => {
    const { hasModelInCache } = await import("@mlc-ai/web-llm");
    const ids = MODELS.map((m) => (caps?.f16 ? m.f16 : m.f32));
    const entries = await Promise.all(ids.map(async (id) => [id, await hasModelInCache(id).catch(() => false)] as const));
    setCached(Object.fromEntries(entries));
  }, [caps?.f16]);

  useEffect(() => {
    detectCaps().then(setCaps);
  }, []);
  useEffect(() => {
    if (caps?.webgpu) refreshCached();
  }, [caps, refreshCached]);
  useEffect(() => () => void engine.current?.unload(), []);

  async function startModel() {
    setConsent(null);
    setError(null);
    try {
      await navigator.storage?.persist?.(); // ask the browser not to evict a 1 GB download
      const webllm = await import("@mlc-ai/web-llm");
      await engine.current?.unload();
      engine.current = null;
      setLoadedId(null);
      setLoad({ pct: 0, text: "Starting…" });
      engine.current = await webllm.CreateMLCEngine(modelId, { initProgressCallback: (r) => setLoad({ pct: r.progress, text: r.text }) });
      setLoadedId(modelId);
      await refreshCached();
    } catch (e) {
      setError(`Couldn't load the model: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoad(null);
    }
  }

  async function askToDownload() {
    if (cached[modelId]) return startModel(); // already on this device: nothing to download
    setConsent({ size: null });
    setConsent({ size: await exactSize(modelId) });
  }

  async function removeModel() {
    const { deleteModelAllInfoInCache } = await import("@mlc-ai/web-llm");
    if (loadedId === modelId) {
      await engine.current?.unload();
      engine.current = null;
      setLoadedId(null);
    }
    await deleteModelAllInfoInCache(modelId);
    await refreshCached();
    setCaps(await detectCaps());
  }

  async function pick(r: Receipt) {
    setReceipt(r);
    setOcr(null);
    setRuns({});
    setError(null);
  }

  async function read() {
    if (!receipt) return;
    setError(null);
    setRuns({});
    try {
      // 1. Text from the photo.
      setBusy("Reading the text on the receipt…");
      setOcrPct(0);
      const t0 = performance.now();
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker(lang, 1, { logger: (m: { status: string; progress: number }) => m.status === "recognizing text" && setOcrPct(m.progress) });
      const { data } = await worker.recognize(receipt.blob);
      await worker.terminate();
      const text = data.text;
      const o = { text, ms: performance.now() - t0 };
      setOcr(o);
      setOcrPct(null);

      // 2a. No model: instant.
      const h0 = performance.now();
      const heuristic = evaluate(normalize(parseReceiptText(text), false), text, performance.now() - h0);
      setRuns({ heuristic });

      // 2b. The downloaded model, if one is loaded.
      if (engine.current) {
        setBusy(`${opt.label} is reading the text…`);
        const m0 = performance.now();
        const res = await engine.current.chat.completions.create({
          messages: [
            { role: "system", content: OFFLINE_SYSTEM },
            { role: "user", content: offlineUserPrompt(text) },
          ],
          temperature: 0,
          max_tokens: 1500,
          response_format: { type: "json_object", schema: JSON.stringify(OFFLINE_SCHEMA) },
        });
        const raw = res.choices[0]?.message?.content ?? "";
        const ms = performance.now() - m0;
        const usage = res.usage as { completion_tokens?: number; extra?: { decode_tokens_per_s?: number } } | undefined;
        try {
          const model = evaluate(normalize(fromOfflineJson(parseJsonLoose(raw)), false), text, ms, { raw, tokensPerSec: usage?.extra?.decode_tokens_per_s });
          setRuns({ heuristic, model });
        } catch {
          setError(`${opt.label}'s answer wasn't usable JSON. The model-free reading is shown.`);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setOcrPct(null);
    }
  }

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const blob = await shrink(f);
    pick({ name: f.name, blob, preview: URL.createObjectURL(blob) });
  };

  return (
    <section className="mx-auto max-w-xl space-y-5 px-4 pb-28 pt-4">
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">TallyBack lab</p>
        <h1 className="text-2xl font-semibold">Read a bill offline</h1>
        <p className="mt-1 text-sm text-muted">Everything below runs on this device. The receipt photo never leaves it. This is a test bench for the mobile app&apos;s offline mode.</p>
      </header>

      {/* 1. The device */}
      <div className="rounded-2xl border border-line bg-card p-4 text-sm">
        <p className="font-medium">This device</p>
        {!caps ? (
          <p className="text-muted">Checking…</p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-muted">
            <li>{caps.webgpu ? "✅ WebGPU: can run an AI model" : "⚠️ No WebGPU: AI models can't run here (try Chrome or Edge on a laptop, or Chrome on Android). The model-free reader still works."}</li>
            {caps.webgpu && <li>{caps.f16 ? "✅ 16-bit GPU maths: smaller, faster model files" : "ℹ️ No 16-bit GPU maths: the larger 32-bit model files will be used"}</li>}
            {caps.freeBytes != null && <li>💾 About {gb(caps.freeBytes)} of storage available to this site</li>}
            <li>{caps.cellular === true ? "📶 You're on mobile data or data saver" : caps.cellular === false ? "📶 Not on mobile data" : "📶 Your browser doesn't say whether you're on Wi-Fi"}</li>
          </ul>
        )}
      </div>

      {/* 2. The optional model */}
      <div className="rounded-2xl border border-line bg-card p-4">
        <p className="text-sm font-medium">Optional: an AI model on this device</p>
        <p className="text-xs text-muted">Reads messy receipts better than the model-free reader. Downloaded once, only when you say so, and removable any time.</p>
        <div className="mt-3 space-y-2">
          {MODELS.map((m, i) => {
            const id = caps?.f16 ? m.f16 : m.f32;
            return (
              <label key={m.f16} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${i === choice ? "border-ink" : "border-line"}`}>
                <input type="radio" name="model" checked={i === choice} onChange={() => setChoice(i)} className="mt-1" disabled={!!load} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{m.label}</span> <span className="text-muted">· {m.approx}</span>
                  {loadedId === id ? <span className="ml-2 rounded-full bg-good-soft px-2 py-0.5 text-xs text-good">Loaded</span> : cached[id] ? <span className="ml-2 rounded-full bg-paper px-2 py-0.5 text-xs text-muted">On this device</span> : null}
                  <span className="block text-xs text-muted">{m.note}</span>
                </span>
              </label>
            );
          })}
        </div>
        {load ? (
          <div className="mt-3" role="status" aria-live="polite">
            <div className="h-2 overflow-hidden rounded-full bg-paper">
              <div className="h-full bg-ink transition-[width]" style={{ width: `${Math.round(load.pct * 100)}%` }} />
            </div>
            <p className="mt-1 text-xs text-muted">{load.text}</p>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={askToDownload} disabled={!caps?.webgpu || loadedId === modelId} className={secondary}>
              {loadedId === modelId ? "Loaded" : cached[modelId] ? `Load ${opt.label}` : `Download ${opt.label}…`}
            </button>
            {cached[modelId] && (
              <button onClick={removeModel} className={`${secondary} text-bad`}>
                Remove from this device
              </button>
            )}
          </div>
        )}
      </div>

      {/* 3. The receipt */}
      <div className="rounded-2xl border border-line bg-card p-4">
        <p className="text-sm font-medium">Receipt</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <label className={`${secondary} cursor-pointer`}>
            📷 Photo or file
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          {SAMPLES.map((s) => (
            <button
              key={s.key}
              className={secondary}
              onClick={async () => pick({ name: s.label, blob: await svgToPng(s.dataUrl), preview: s.dataUrl, truth: s.truth })}
            >
              {s.label}
            </button>
          ))}
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <span className="text-muted">Receipt language</span>
          <select value={lang} onChange={(e) => setLang(e.target.value)} className="rounded-lg border border-line bg-card px-2 py-1">
            <option value="eng">English</option>
            <option value="eng+tha">English + Thai</option>
            <option value="eng+vie">English + Vietnamese</option>
            <option value="eng+ind">English + Indonesian</option>
            <option value="eng+msa">English + Malay</option>
          </select>
        </label>
        {receipt && (
          <div className="mt-3 flex gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={receipt.preview} alt={`Receipt: ${receipt.name}`} className="h-40 w-auto rounded-lg border border-line bg-white object-contain" />
            <div className="flex flex-1 flex-col justify-end gap-2">
              <p className="text-sm">{receipt.name}</p>
              <button onClick={read} disabled={!!busy || !!load} className={primary}>
                {busy ? "Reading…" : loadedId ? `Read with ${opt.label}` : "Read (model-free)"}
              </button>
            </div>
          </div>
        )}
        {busy && (
          <p className="mt-2 text-xs text-muted" role="status" aria-live="polite">
            {busy}
            {ocrPct != null && ` ${Math.round(ocrPct * 100)}%`}
          </p>
        )}
        {error && <p className="mt-2 rounded-xl bg-bad-soft p-3 text-sm text-bad">{error}</p>}
      </div>

      {/* 4. Results */}
      {ocr && (
        <details className="rounded-2xl border border-line bg-card p-4 text-sm">
          <summary className="cursor-pointer font-medium">Scanned text · {(ocr.ms / 1000).toFixed(1)} s</summary>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-muted">{ocr.text}</pre>
        </details>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {runs.heuristic && <RunCard title="Model-free reader" run={runs.heuristic} truth={receipt?.truth} />}
        {runs.model && <RunCard title={opt.label} run={runs.model} truth={receipt?.truth} />}
      </div>

      {consent && (
        <Sheet
          title={`Download ${opt.label}?`}
          onClose={() => setConsent(null)}
          footer={
            <div className="flex gap-2">
              <button onClick={() => setConsent(null)} className={`${secondary} h-12 flex-1 rounded-2xl`}>
                Not now
              </button>
              <button
                onClick={startModel}
                disabled={(wifiOnly && caps?.cellular === true) || (consent.size != null && caps?.freeBytes != null && caps.freeBytes < consent.size * 1.2)}
                className={`${primary} flex-1`}
              >
                Download
              </button>
            </div>
          }
        >
          <div className="space-y-3 text-sm">
            <p>
              <span className="text-2xl font-semibold">{consent.size ? gb(consent.size) : opt.approx}</span>
              <span className="text-muted"> · downloaded once, then works offline</span>
            </p>
            <ul className="space-y-1.5">
              <li>🔒 Receipts are read on this device. Nothing is sent to TallyBack or an AI company.</li>
              <li>✈️ Works without internet once downloaded: on planes, abroad, with no roaming.</li>
              <li>⚖️ Honest caveat: on very messy receipts, the cloud reader is usually more accurate.</li>
              <li>💾 {caps?.freeBytes != null ? `This site can use about ${gb(caps.freeBytes)}.` : "Storage space is checked by your browser."} Remove it any time from this page.</li>
              <li>📦 Files come from Hugging Face (open model, published licence). Runs on your GPU; laptops may get warm.</li>
            </ul>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={wifiOnly} onChange={(e) => setWifiOnly(e.target.checked)} />
              Only download on Wi-Fi
            </label>
            {wifiOnly && caps?.cellular === true && <p className="rounded-xl bg-warn-soft p-3 text-warn">You seem to be on mobile data. Connect to Wi-Fi, or untick the box to download anyway.</p>}
            {wifiOnly && caps?.cellular == null && <p className="text-xs text-muted">Your browser doesn&apos;t say whether you&apos;re on Wi-Fi, so please check before downloading.</p>}
            {consent.size != null && caps?.freeBytes != null && caps.freeBytes < consent.size * 1.2 && <p className="rounded-xl bg-bad-soft p-3 text-bad">Not enough storage for this model. Try a smaller one.</p>}
          </div>
        </Sheet>
      )}
    </section>
  );
}

const LEVEL: Record<Finding["verdict"], { word: string; cls: string }> = {
  wrong: { word: "Likely mistake", cls: "bg-bad-soft text-bad" },
  unexplained: { word: "Worth a look", cls: "bg-warn-soft text-warn" },
  info: { word: "Note", cls: "bg-paper text-muted" },
};

function RunCard({ title, run, truth }: { title: string; run: Run; truth?: Extraction }) {
  const { ex, result, trust } = run;
  const acc = truth ? accuracy(ex, truth) : null;
  const items = ex.lines.filter((l) => l.kind === "item").length;
  return (
    <div className="rounded-2xl border border-line bg-card p-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{title}</p>
        <span className={`rounded-full px-2 py-0.5 text-xs ${trust.trust === "high" ? "bg-good-soft text-good" : "bg-warn-soft text-warn"}`}>{trust.trust === "high" ? "Read cleanly" : "Check the reading"}</span>
      </div>
      <p className="mt-1 text-xs text-muted">
        {run.ms < 1000 ? `${Math.round(run.ms)} ms` : `${(run.ms / 1000).toFixed(1)} s`}
        {run.tokensPerSec ? ` · ${run.tokensPerSec.toFixed(1)} tokens/s` : ""} · {items} items · total {ex.printed_total ?? "—"} {ex.currency ?? ""}
      </p>
      <p className="text-xs text-muted">
        Amounts found in the scanned text: {trust.grounding.grounded}/{trust.grounding.checked}
        {trust.grounding.missing.length > 0 && ` (not found: ${trust.grounding.missing.slice(0, 3).join(", ")})`}
      </p>
      {acc && (
        <p className="text-xs text-muted">
          Against the known receipt: {acc.lines} amounts right{acc.extra ? `, ${acc.extra} extra` : ""} · total {acc.total ? "✅" : "❌"}
        </p>
      )}
      <div className="mt-3 space-y-2">
        {result.findings.length === 0 ? (
          <p className="rounded-xl bg-good-soft p-3 text-good">✅ {result.checks.some((c) => c.ok) ? `Adds up: ${result.checks.filter((c) => c.ok).length} checks passed` : "No issues found (not enough printed totals to check the maths)"}</p>
        ) : (
          result.findings.map((f) => {
            // Low trust: never accuse the merchant; it may be our misread.
            const lvl = trust.trust === "low" ? { word: "Possible misread", cls: "bg-paper text-muted" } : LEVEL[f.verdict];
            return (
              <div key={f.id} className="rounded-xl border border-line p-3">
                <span className={`rounded-full px-2 py-0.5 text-xs ${lvl.cls}`}>{lvl.word}</span>
                <p className="mt-1 font-medium">{f.title}</p>
                <p className="font-mono text-xs text-muted">{f.maths}</p>
              </div>
            );
          })
        )}
        {trust.trust === "low" && <p className="text-xs text-muted">{trust.reasons.join(" · ")}. Compare with the photo before trusting any issue.</p>}
      </div>
      {run.raw && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted">Model output</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted">{run.raw}</pre>
        </details>
      )}
    </div>
  );
}
