import "server-only";
import { GoogleGenAI, Type, type Schema } from "@google/genai";
import type { Extraction } from "./types";
import { EXTRACT_PROMPT } from "./prompts";
import { normalize } from "./normalize";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
// Free tier gets "high demand" 503s; fall back to other Flash models rather than fail.
const FALLBACKS = ["gemini-3.5-flash", "gemini-flash-latest"].filter((m) => m !== MODEL);

function client() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenAI({ apiKey });
}

const busy = (e: unknown) => /\b(429|500|503)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand|abort|timeout/i.test(String(e instanceof Error ? e.message : e));

type GenArgs = Omit<Parameters<GoogleGenAI["models"]["generateContent"]>[0], "model">;

// Leave time for the Groq backup inside Vercel's 60 s function limit.
const BUDGET_MS = 35_000;

async function generate(args: GenArgs): Promise<{ text: string; model: string }> {
  const ai = client();
  const deadline = Date.now() + BUDGET_MS;
  let last: unknown = new Error("Gemini time budget used up");
  for (const model of [MODEL, ...FALLBACKS]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const left = deadline - Date.now();
      if (left < 3000) throw last;
      try {
        const res = await ai.models.generateContent({ ...args, model, config: { ...args.config, abortSignal: AbortSignal.timeout(left) } });
        return { text: res.text ?? "", model };
      } catch (e) {
        last = e;
        if (!busy(e)) throw e;
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      }
    }
  }
  throw last;
}

const num = { type: Type.NUMBER, nullable: true } as const;
const str = { type: Type.STRING, nullable: true } as const;

const EXTRACTION_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    is_bill: { type: Type.BOOLEAN },
    merchant_name: str,
    merchant_country: { ...str, description: "ISO-3166 alpha-2, inferred from address/phone/currency" },
    merchant_whatsapp: { ...str, description: "Business WhatsApp or phone number printed on the bill, digits with country code if known" },
    bill_type: { ...str, description: "e.g. grocery receipt, mobile bill, electricity bill, restaurant bill" },
    bill_number: str,
    bill_date: { ...str, description: "YYYY-MM-DD" },
    due_date: { ...str, description: "YYYY-MM-DD" },
    period_start: str,
    period_end: str,
    currency: { ...str, description: "ISO-4217 code, e.g. INR, SGD" },
    tax_mode: {
      type: Type.STRING,
      enum: ["added", "included", "none", "unknown"],
      description: "added = tax added on top of subtotal; included = prices already include tax (e.g. 'GST included')",
    },
    printed_subtotal: num,
    printed_tax_total: num,
    printed_tax_rate_pct: { ...num, description: "Combined rate if one rate applies, e.g. CGST 9 + SGST 9 = 18" },
    printed_total: num,
    lines: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          description: { type: Type.STRING, description: "Exactly as printed" },
          plain_words: { type: Type.STRING, description: "What this line is, in under 10 plain words" },
          qty: num,
          unit_price: num,
          amount: { type: Type.NUMBER, description: "Exactly as printed. Discounts/payments as positive numbers." },
          kind: {
            type: Type.STRING,
            enum: ["item", "fee", "late_fee", "subscription", "service_charge", "discount", "tax", "rounding", "previous_balance", "payment", "subtotal", "total", "other"],
          },
          tax_rate_pct: num,
          box_2d: {
            type: Type.ARRAY,
            nullable: true,
            items: { type: Type.INTEGER },
            description: "Bounding box of the whole printed row: [ymin, xmin, ymax, xmax] normalised 0-1000",
          },
        },
        required: ["description", "plain_words", "amount", "kind"],
        propertyOrdering: ["description", "plain_words", "qty", "unit_price", "amount", "kind", "tax_rate_pct", "box_2d"],
      },
    },
  },
  required: ["is_bill", "tax_mode", "lines"],
};



export async function extractBill(data: string, mimeType: string): Promise<{ extraction: Extraction; model: string }> {
  const res = await generate({
    contents: [{ role: "user", parts: [{ inlineData: { data, mimeType } }, { text: EXTRACT_PROMPT }] }],
    config: { responseMimeType: "application/json", responseSchema: EXTRACTION_SCHEMA },
  });
  const text = res.text;
  if (!text) throw new Error("Empty response from model");
  return { extraction: normalize(JSON.parse(text)), model: res.model };
}

export async function draftMessage(prompt: string): Promise<{ text: string; model: string }> {
  const res = await generate({ contents: [{ role: "user", parts: [{ text: prompt }] }] });
  return { text: res.text.trim(), model: res.model };
}
