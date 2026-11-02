import "server-only";
import type { Extraction } from "./types";
import { normalize } from "./normalize";

// Backup reader. Fast and free, but can't place rows on the photo, so no highlight boxes.
const MODEL = process.env.GROQ_MODEL || "qwen/qwen3.8-27b";
// Text-only model for messages: separate rate limit from the vision model.
const TEXT_MODEL = process.env.GROQ_TEXT_MODEL || "openai/gpt-oss-20b";

export const groqEnabled = () => !!process.env.GROQ_API_KEY;

// Free tier caps output at ~1000 tokens/min, so ask for compact rows instead of verbose objects.
const COMPACT_PROMPT = `Read this bill, receipt or invoice (any kind, any country). Copy every number exactly as printed; never calculate. Return ONLY JSON:
{"bill":true|false,"m":merchant name,"c":ISO-3166 alpha-2 country,"w":business WhatsApp/phone printed or null,"t":bill type,"n":bill number,
"d":"YYYY-MM-DD","due":"YYYY-MM-DD" or null,"cur":ISO-4217 currency,"tm":"added"|"included"|"none"|"unknown",
"sub":subtotal,"tax":tax total,"rate":tax rate %,"tot":total,
"l":[[description, qty, unit_price, amount, kind]]}
kind: item,fee,late_fee,subscription,service_charge,discount,tax,rounding,previous_balance,payment,subtotal,total,other.
One row per printed line that has an amount, top to bottom. Discounts/payments as positive numbers. null when not printed.
Never include the customer's name, phone, address, account or card numbers.`;

interface ChatOpts {
  model: string;
  content: unknown;
  json: boolean;
  maxTokens: number;
  reasoning: "none" | "low";
}

async function chat(o: ChatOpts, retried = false): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: o.model,
      messages: [{ role: "user", content: o.content }],
      max_tokens: o.maxTokens,
      reasoning_effort: o.reasoning,
      ...(o.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    // Free tier is ~1 receipt per minute of output tokens; wait out short limits once.
    const wait = Number(body.match(/try again in ([\d.]+)s/)?.[1]);
    if (res.status === 429 && !retried && wait > 0 && wait <= 10) {
      await new Promise((r) => setTimeout(r, wait * 1000 + 300));
      return chat(o, true);
    }
    throw new Error(`groq ${res.status}: ${body.slice(0, 300)}`);
  }
  const j = await res.json();
  return String(j.choices?.[0]?.message?.content ?? "").trim();
}

export async function extractBillGroq(data: string, mimeType: string): Promise<{ extraction: Extraction; model: string }> {
  if (mimeType === "application/pdf") throw new Error("groq: PDFs not supported");
  const text = await chat({
    model: MODEL,
    content: [
      { type: "text", text: COMPACT_PROMPT },
      { type: "image_url", image_url: { url: `data:${mimeType};base64,${data}` } },
    ],
    json: true,
    maxTokens: 900,
    reasoning: "none",
  });
  const j = JSON.parse(text);
  const raw = {
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
    lines: (Array.isArray(j.l) ? j.l : []).map((r: unknown[]) => ({
      description: r[0],
      qty: r[1],
      unit_price: r[2],
      amount: r[3],
      kind: r[4],
      plain_words: "",
    })),
  };
  return { extraction: normalize(raw, false), model: `groq/${MODEL}` };
}

export async function draftMessageGroq(prompt: string): Promise<{ text: string; model: string }> {
  // Some reasoning models wrap their thinking in <think> tags; drop it.
  const raw = await chat({ model: TEXT_MODEL, content: prompt, json: false, maxTokens: 700, reasoning: "low" });
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return { text, model: `groq/${TEXT_MODEL}` };
}
