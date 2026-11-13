import type { Extraction } from "./types";
import { EXTRACT_PROMPT } from "./prompts";
import { normalize } from "./normalize";

// Every AI model TallyBack can use, behind one interface, so free tiers can be mixed and swapped.
//
// A "chain" is an ordered list of provider:model pairs. Each job (reading a receipt, writing a
// message) walks its chain until one answers, skipping providers with no API key. Free tiers are
// busy or capped at times, so a longer chain of free models is the way to stay free and still up.
//
// Two API styles cover the lot:
//   gemini   Google's own API: JSON schema + highlight boxes (Gemini models); Gemma reads plain JSON
//   openai   the OpenAI-style /chat/completions most providers copy: Groq, OpenRouter, GitHub Models,
//            Mistral, Cloudflare Workers AI. No highlight boxes.
//
// No "server-only" here, so the benchmark script (Tallyback/scripts/bench-models.ts) runs the same code.
// The keys only ever come from the server's environment.

export type Job = "vision" | "text";

interface Provider {
  style: "gemini" | "openai";
  keyEnv: string;
  baseUrl?: (env: Env) => string | null;
  headers?: Record<string, string>;
}

type Env = Record<string, string | undefined>;

export const PROVIDERS: Record<string, Provider> = {
  gemini: { style: "gemini", keyEnv: "GEMINI_API_KEY" },
  groq: { style: "openai", keyEnv: "GROQ_API_KEY", baseUrl: () => "https://api.groq.com/openai/v1" },
  openrouter: {
    style: "openai",
    keyEnv: "OPENROUTER_API_KEY",
    baseUrl: () => "https://openrouter.ai/api/v1",
    headers: { "HTTP-Referer": "https://www.tinkeryard.dev", "X-Title": "TallyBack" },
  },
  github: { style: "openai", keyEnv: "GITHUB_MODELS_TOKEN", baseUrl: () => "https://models.github.ai/inference" },
  mistral: { style: "openai", keyEnv: "MISTRAL_API_KEY", baseUrl: () => "https://api.mistral.ai/v1" },
  cloudflare: {
    style: "openai",
    keyEnv: "CLOUDFLARE_API_TOKEN",
    baseUrl: (env) => (env.CLOUDFLARE_ACCOUNT_ID ? `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1` : null),
  },
};

export interface Step {
  provider: string;
  model: string;
}

// Defaults, best first, all on free tiers. Picked by running Tallyback/scripts/bench-models.ts on real
// tasks (results in docs/03-OCR-RECEIPT-PIPELINE.md): the Flash-Lite models read receipts right every time
// in about 5 s, highlight boxes included, while Flash 3.8 often took 30–45 s. Each Gemini model has its
// own free quota, so several of them also mean more free reads a day. Providers without a key are skipped.
// Override with LLM_VISION_CHAIN / LLM_TEXT_CHAIN, e.g. "gemini:gemini-3.5-flash-lite,groq:qwen/qwen3.8-27b".
const DEFAULT_CHAIN: Record<Job, string> = {
  vision: [
    "gemini:gemini-3.5-flash-lite",
    "gemini:gemini-3.1-flash-lite",
    "groq:qwen/qwen3.8-27b",
    "openrouter:nvidia/nemotron-3.5-super-vl:free",
    "openrouter:google/gemma-4-31b-it:free",
    "github:openai/gpt-4.1-mini",
    "mistral:mistral-small-latest",
    "gemini:gemini-3.5-flash",
    "gemini:gemini-3.8-flash",
  ].join(","),
  text: [
    "groq:openai/gpt-oss-20b",
    "gemini:gemini-3.5-flash-lite",
    "groq:openai/gpt-oss-120b",
    "gemini:gemini-3.1-flash-lite",
    "openrouter:nvidia/nemotron-3-ultra-550b-a55b:free",
    "openrouter:openrouter/free",
    "github:openai/gpt-4.1-mini",
    "mistral:mistral-small-latest",
  ].join(","),
};

// "provider:model,provider:model" → steps. The model may itself contain ":" (e.g. OpenRouter's ":free").
export function parseChain(spec: string): Step[] {
  return spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(":");
      return i > 0 ? { provider: s.slice(0, i).trim(), model: s.slice(i + 1).trim() } : null;
    })
    .filter((s): s is Step => !!s && !!PROVIDERS[s.provider] && !!s.model);
}

// The chain for a job, keeping only providers this server has keys (and settings) for.
export function chainFor(job: Job, env: Env = process.env): Step[] {
  // GEMINI_MODEL is Review Scout's setting, so it doesn't steer TallyBack; use the chains instead.
  const spec = (job === "vision" ? env.LLM_VISION_CHAIN : env.LLM_TEXT_CHAIN) || DEFAULT_CHAIN[job];
  return parseChain(spec).filter((s) => usable(s.provider, env));
}

export function usable(provider: string, env: Env = process.env) {
  const p = PROVIDERS[provider];
  return !!p && !!env[p.keyEnv] && (!p.baseUrl || !!p.baseUrl(env));
}

export const anyModel = (env: Env = process.env) => chainFor("vision", env).length > 0 || chainFor("text", env).length > 0;

// ---- the prompts ----

// Free tiers cap output tokens, so non-Gemini models get compact rows instead of verbose objects.
export const COMPACT_PROMPT = `Read this bill, receipt or invoice (any kind, any country). Copy every number exactly as printed; never calculate. Return ONLY JSON:
{"bill":true|false,"m":merchant name,"c":ISO-3166 alpha-2 country,"w":business WhatsApp/phone printed or null,"t":bill type,"n":bill number,
"d":"YYYY-MM-DD","due":"YYYY-MM-DD" or null,"cur":ISO-4217 currency,"tm":"added"|"included"|"none"|"unknown",
"sub":subtotal,"tax":tax total,"rate":tax rate %,"tot":total,
"l":[[description, qty, unit_price, amount, kind]]}
kind: item,fee,late_fee,subscription,service_charge,discount,tax,rounding,previous_balance,payment,subtotal,total,other.
One row per printed line that has an amount, top to bottom. Discounts/payments as positive numbers. null when not printed.
Never include the customer's name, phone, address, account or card numbers.`;

function fromCompact(j: Record<string, unknown>) {
  return {
    is_bill: j.bill,
    merchant_name: j.m,
    merchant_country: j.c,
    merchant_whatsapp: j.w,
    bill_type: j.t,
    bill_number: j.n,
    bill_date: j.d,
    due_date: j.due,
    currency: j.cur,
    tax_mode: j.tm,
    printed_subtotal: j.sub,
    printed_tax_total: j.tax,
    printed_tax_rate_pct: j.rate,
    printed_total: j.tot,
    lines: (Array.isArray(j.l) ? j.l : []).map((r: unknown) => {
      const a = Array.isArray(r) ? r : [];
      return { description: a[0], qty: a[1], unit_price: a[2], amount: a[3], kind: a[4], plain_words: "" };
    }),
  };
}

// Models without a JSON mode sometimes wrap the answer in ``` fences or add a sentence; take the object.
export function parseJsonLoose(text: string): Record<string, unknown> {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {}
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
  throw new Error("The model's answer wasn't JSON");
}

// Gemini's schema (Google's REST format). Gemma models on the same API take the compact prompt instead.
const n = { type: "NUMBER", nullable: true };
const s = { type: "STRING", nullable: true };
const SCHEMA = {
  type: "OBJECT",
  properties: {
    is_bill: { type: "BOOLEAN" },
    merchant_name: s,
    merchant_country: { ...s, description: "ISO-3166 alpha-2, inferred from address/phone/currency" },
    merchant_whatsapp: { ...s, description: "Business WhatsApp or phone number printed on the bill, digits with country code if known" },
    bill_type: { ...s, description: "e.g. grocery receipt, mobile bill, electricity bill, restaurant bill" },
    bill_number: s,
    bill_date: { ...s, description: "YYYY-MM-DD" },
    due_date: { ...s, description: "YYYY-MM-DD" },
    period_start: s,
    period_end: s,
    currency: { ...s, description: "ISO-4217 code, e.g. INR, SGD" },
    tax_mode: { type: "STRING", enum: ["added", "included", "none", "unknown"], description: "added = tax added on top of subtotal; included = prices already include tax" },
    printed_subtotal: n,
    printed_tax_total: n,
    printed_tax_rate_pct: { ...n, description: "Combined rate if one rate applies, e.g. CGST 9 + SGST 9 = 18" },
    printed_total: n,
    lines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          description: { type: "STRING", description: "Exactly as printed" },
          plain_words: { type: "STRING", description: "What this line is, in under 10 plain words" },
          qty: n,
          unit_price: n,
          amount: { type: "NUMBER", description: "Exactly as printed. Discounts/payments as positive numbers." },
          kind: {
            type: "STRING",
            enum: ["item", "fee", "late_fee", "subscription", "service_charge", "discount", "tax", "rounding", "previous_balance", "payment", "subtotal", "total", "other"],
          },
          tax_rate_pct: n,
          box_2d: { type: "ARRAY", nullable: true, items: { type: "INTEGER" }, description: "Bounding box of the whole printed row: [ymin, xmin, ymax, xmax] normalised 0-1000" },
        },
        required: ["description", "plain_words", "amount", "kind"],
        propertyOrdering: ["description", "plain_words", "qty", "unit_price", "amount", "kind", "tax_rate_pct", "box_2d"],
      },
    },
  },
  required: ["is_bill", "tax_mode", "lines"],
};

// ---- calling a provider ----

export class ModelError extends Error {
  constructor(
    message: string,
    public busy: boolean, // rate limited, overloaded or timed out: worth trying the next model
  ) {
    super(message);
  }
}

const isGemma = (model: string) => /gemma/i.test(model);

async function post(url: string, headers: Record<string, string>, body: unknown, ms: number, label: string) {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
  } catch (e) {
    throw new ModelError(`${label}: ${e instanceof Error ? e.name : "network"} (no answer in ${Math.round(ms / 1000)} s)`, true);
  }
  const text = await res.text();
  if (!res.ok) throw new ModelError(`${label} ${res.status}: ${text.slice(0, 200)}`, [408, 429, 500, 502, 503, 504, 529].includes(res.status));
  try {
    return JSON.parse(text);
  } catch {
    throw new ModelError(`${label}: reply wasn't JSON`, true);
  }
}

interface Ask {
  prompt: string;
  image?: { data: string; mime: string };
  json: "schema" | "loose" | false;
  maxTokens: number;
}

async function ask(step: Step, a: Ask, ms: number, env: Env): Promise<string> {
  const p = PROVIDERS[step.provider];
  const key = env[p.keyEnv]!;
  const label = `${step.provider}/${step.model}`;
  if (p.style === "gemini") {
    const parts: unknown[] = [{ text: a.prompt }];
    if (a.image) parts.unshift({ inline_data: { mime_type: a.image.mime, data: a.image.data } });
    const gemma = isGemma(step.model);
    const generationConfig =
      a.json === "schema" && !gemma ? { responseMimeType: "application/json", responseSchema: SCHEMA } : a.json && !gemma ? { responseMimeType: "application/json" } : {};
    const j = await post(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(step.model)}:generateContent`,
      { "x-goog-api-key": key },
      // Gemini's thinking counts against an output cap, so only Gemma gets one.
      { contents: [{ role: "user", parts }], generationConfig: { ...generationConfig, ...(gemma ? { maxOutputTokens: a.maxTokens } : {}) } },
      ms,
      label,
    );
    const text = (j.candidates?.[0]?.content?.parts ?? []).filter((x: { thought?: boolean }) => !x.thought).map((x: { text?: string }) => x.text ?? "").join("");
    if (!text) throw new ModelError(`${label}: empty answer (${j.candidates?.[0]?.finishReason ?? "no candidate"})`, true);
    return text;
  }
  const content = a.image
    ? [
        { type: "text", text: a.prompt },
        { type: "image_url", image_url: { url: `data:${a.image.mime};base64,${a.image.data}` } },
      ]
    : a.prompt;
  const j = await post(
    `${p.baseUrl!(env)}/chat/completions`,
    { Authorization: `Bearer ${key}`, ...p.headers },
    {
      model: step.model,
      messages: [{ role: "user", content }],
      // Groq's free tier caps output tokens per minute, so it keeps the tight limit. Elsewhere, many free
      // models "think" before answering and that thinking counts too: a tight cap left them no room to
      // answer (OpenRouter's Nemotron models came back empty), so they get room and are asked to think less.
      max_tokens: step.provider === "groq" ? a.maxTokens : Math.max(a.maxTokens, 6000),
      ...(a.json ? { response_format: { type: "json_object" } } : {}),
      // Groq's reasoning models think before answering; reading a receipt doesn't need it.
      ...(step.provider === "groq" && /gpt-oss|qwen3/.test(step.model) ? { reasoning_effort: a.image ? "none" : "low" } : {}),
      ...(step.provider === "openrouter" ? { reasoning: { effort: "low", exclude: true } } : {}),
    },
    ms,
    label,
  );
  const text = String(j.choices?.[0]?.message?.content ?? "").trim();
  if (!text) throw new ModelError(`${label}: empty answer (${j.choices?.[0]?.finish_reason ?? "no choice"})`, true);
  return text;
}

// ---- the two jobs ----

/**
 * Executes an AI bill extraction call on a specific provider/model step.
 * @param step Provider and model descriptor.
 * @param data Base64-encoded image or PDF payload.
 * @param mime MIME type of the uploaded document.
 * @param ms Request timeout in milliseconds.
 * @param env Environment variable map containing provider API keys.
 * @returns Normalized structured `Extraction`.
 * @throws {ModelError} If the provider rejects PDFs, times out, or returns malformed JSON.
 */
export async function readBillWith(step: Step, data: string, mime: string, ms: number, env: Env = process.env): Promise<Extraction> {
  if (mime === "application/pdf" && !(step.provider === "gemini" && !isGemma(step.model))) throw new ModelError(`${step.provider}/${step.model}: can't read PDFs`, true);
  const native = step.provider === "gemini" && !isGemma(step.model);
  const text = await ask(step, { prompt: native ? EXTRACT_PROMPT : COMPACT_PROMPT, image: { data, mime }, json: native ? "schema" : "loose", maxTokens: native ? 8192 : 1500 }, ms, env);
  const raw = parseJsonLoose(text);
  return native ? normalize(raw) : normalize(fromCompact(raw), false);
}

export async function writeWith(step: Step, prompt: string, ms: number, env: Env = process.env): Promise<string> {
  const text = await ask(step, { prompt, json: false, maxTokens: 800 }, ms, env);
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

// Walk a chain within a time budget (Vercel stops a function at 60 s). A busy, failing or garbled
// model moves on to the next; each try gets what's left of the budget, capped per model.
/**
 * Walks the configured provider fallback chain for `job` within `budgetMs` until a model succeeds.
 * @param job `"vision"` (receipt scanning) or `"text"` (dispute message drafting).
 * @param fn Callback executing one step within its allotted timeout budget.
 * @param budgetMs Total time budget in milliseconds across all fallback attempts.
 * @param env Environment variable map for resolving configured providers.
 * @returns Winning result value and `"provider/model"` identifier.
 * @throws {Error} If no providers have keys or every attempted model fails.
 */
export async function runChain<T>(job: Job, fn: (step: Step, ms: number) => Promise<T>, budgetMs: number, env: Env = process.env): Promise<{ value: T; model: string }> {
  const steps = chainFor(job, env);
  if (!steps.length) throw new Error(`No AI model is set up for ${job === "vision" ? "reading receipts" : "writing messages"}.`);
  const deadline = Date.now() + budgetMs;
  const errors: string[] = [];
  for (const step of steps) {
    const left = deadline - Date.now();
    if (left < 4000) break;
    try {
      return { value: await fn(step, Math.min(left, job === "vision" ? 30_000 : 15_000)), model: `${step.provider}/${step.model}` };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(msg.slice(0, 160));
      console.warn(`[models] ${job}: ${step.provider}/${step.model} failed, trying the next:`, msg.slice(0, 200));
    }
  }
  const busy = errors.some((m) => /\b(429|503|529)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|high demand|overloaded|no answer/i.test(m));
  throw new Error(`${busy ? "busy: " : ""}every model failed (${errors.length} tried): ${errors.join(" | ")}`);
}
