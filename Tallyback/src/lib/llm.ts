import "server-only";
import type { Extraction } from "./types";
import { anyModel, readBillWith, runChain, writeWith } from "./models";

// TallyBack's two AI jobs, each walking its chain of free models until one answers (models.ts).
// The AI only reads and words; every number the person sees comes from code (checks.ts, message.ts).
export const llmEnabled = () => anyModel();

// Vercel stops the function at 60 s: leave room to save the bill and the photo afterwards.
const READ_BUDGET_MS = 50_000;
const WRITE_BUDGET_MS = 20_000;

/**
 * Extracts structured bill lines and metadata from a base64 receipt image or PDF via the Vision fallback chain.
 * @param data Base64-encoded receipt payload.
 * @param mime MIME type (`image/jpeg`, `image/png`, `image/webp`, or `application/pdf`).
 * @returns Normalized `Extraction` and the `"provider/model"` string that succeeded.
 * @throws {Error} When all configured Vision providers fail or rate-limit within the 50s budget.
 */
export async function readBill(data: string, mime: string): Promise<{ extraction: Extraction; model: string }> {
  const { value, model } = await runChain("vision", (step, ms) => readBillWith(step, data, mime, ms), READ_BUDGET_MS);
  return { extraction: value, model };
}

/**
 * Generates a placeholder-based customer dispute message via the Text model fallback chain.
 * @param prompt Rendered prompt containing billing facts and strict placeholder rules.
 * @returns Generated draft text and winning `"provider/model"` string.
 * @throws {Error} When all configured Text providers fail within the 20s budget.
 */
export async function writeMessage(prompt: string): Promise<{ text: string; model: string }> {
  const { value, model } = await runChain("text", (step, ms) => writeWith(step, prompt, ms), WRITE_BUDGET_MS);
  return { text: value, model };
}
