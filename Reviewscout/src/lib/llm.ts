import "server-only";
import { GoogleGenAI } from "@google/genai";

// Gemini first; Groq if every Gemini model fails or is busy. Keys come from the environment only.
export type Turn = { role: "user" | "assistant"; content: string };

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
// Free tier gets "high demand" 503s; fall back to other Flash models rather than fail.
const GEMINI_FALLBACKS = ["gemini-3.5-flash", "gemini-flash-latest"].filter((m) => m !== GEMINI_MODEL);
const GROQ_MODEL = process.env.GROQ_TEXT_MODEL || "openai/gpt-oss-20b";

// Leave time for the Groq backup inside Vercel's 60 s function limit.
const BUDGET_MS = 35_000;
// A model that hangs shouldn't use the whole budget: give the next one a turn.
const ATTEMPT_MS = 20_000;

export const llmEnabled = () => !!process.env.GEMINI_API_KEY || !!process.env.GROQ_API_KEY;

const busy = (e: unknown) => /\b(429|500|503)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand|abort|timeout/i.test(String(e instanceof Error ? e.message : e));

async function gemini(system: string, turns: Turn[]): Promise<{ text: string; model: string }> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const deadline = Date.now() + BUDGET_MS;
  let last: unknown = new Error("Gemini time budget used up");
  for (const model of [GEMINI_MODEL, ...GEMINI_FALLBACKS]) {
    // Try each model twice, then move to the next one in the list.
    for (let attempt = 0; attempt < 2; attempt++) {
      const left = deadline - Date.now();
      if (left < 3000) throw last;
      try {
        const res = await ai.models.generateContent({
          model,
          // Gemini calls the assistant "model" and wraps text in "parts".
          contents: turns.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] })),
          config: { systemInstruction: system, abortSignal: AbortSignal.timeout(Math.min(left, ATTEMPT_MS)) },
        });
        const text = (res.text ?? "").trim();
        if (!text) throw new Error("Empty response from model");
        return { text, model };
      } catch (e) {
        last = e;
        if (!busy(e)) throw e;
        if (/abort|timeout/i.test(String(e instanceof Error ? e.message : e))) break; // timed out: next model
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      }
    }
  }
  throw last;
}

async function groq(system: string, turns: Turn[], retried = false): Promise<{ text: string; model: string }> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "system", content: system }, ...turns],
      max_tokens: 1500,
      reasoning_effort: "low",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    // Free tier limits are per minute; wait out a short one once.
    const wait = Number(body.match(/try again in ([\d.]+)s/)?.[1]);
    if (res.status === 429 && !retried && wait > 0 && wait <= 10) {
      await new Promise((r) => setTimeout(r, wait * 1000 + 300));
      return groq(system, turns, true);
    }
    throw new Error(`groq ${res.status}: ${body.slice(0, 300)}`);
  }
  const j = await res.json();
  // Some reasoning models wrap their thinking in <think> tags; drop it.
  const text = String(j.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return { text, model: `groq/${GROQ_MODEL}` };
}

// Answer from the collected reviews, keeping the whole conversation.
export async function chatAbout(system: string, turns: Turn[]): Promise<{ text: string; model: string }> {
  if (!process.env.GEMINI_API_KEY) return groq(system, turns);
  try {
    return await gemini(system, turns);
  } catch (e) {
    if (!process.env.GROQ_API_KEY) throw e;
    console.warn("chatAbout: Gemini failed, falling back to Groq:", e instanceof Error ? e.message.slice(0, 200) : e);
    return groq(system, turns);
  }
}
