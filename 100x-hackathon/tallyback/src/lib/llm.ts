import "server-only";
import type { Extraction } from "./types";
import { converse, draftMessage, extractBill } from "./gemini";
import { converseGroq, draftMessageGroq, extractBillGroq, groqEnabled } from "./groq";

// Gemini first (it can place highlight boxes), Groq if every Gemini model fails.
export const llmEnabled = () => !!process.env.GEMINI_API_KEY || groqEnabled();

async function withFallback<T>(primary: () => Promise<T>, backup: () => Promise<T>, what: string): Promise<T> {
  if (!process.env.GEMINI_API_KEY) return backup();
  try {
    return await primary();
  } catch (e) {
    if (!groqEnabled()) throw e;
    console.warn(`${what}: Gemini failed, falling back to Groq:`, e instanceof Error ? e.message.slice(0, 200) : e);
    return backup();
  }
}

export const readBill = (data: string, mime: string): Promise<{ extraction: Extraction; model: string }> =>
  withFallback(() => extractBill(data, mime), () => extractBillGroq(data, mime), "readBill");

export const writeMessage = (prompt: string): Promise<{ text: string; model: string }> =>
  withFallback(() => draftMessage(prompt), () => draftMessageGroq(prompt), "writeMessage");

// Review Scout: answer from the collected reviews, keeping the whole conversation.
type Turn = { role: "user" | "assistant"; content: string };
export const chatAbout = (system: string, turns: Turn[]): Promise<{ text: string; model: string }> =>
  withFallback(() => converse(system, turns), () => converseGroq(system, turns), "chatAbout");
