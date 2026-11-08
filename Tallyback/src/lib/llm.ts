import "server-only";
import type { Extraction } from "./types";
import { anyModel, readBillWith, runChain, writeWith } from "./models";

// TallyBack's two AI jobs, each walking its chain of free models until one answers (models.ts).
// The AI only reads and words; every number the person sees comes from code (checks.ts, message.ts).
export const llmEnabled = () => anyModel();

// Vercel stops the function at 60 s: leave room to save the bill and the photo afterwards.
const READ_BUDGET_MS = 50_000;
const WRITE_BUDGET_MS = 20_000;

export async function readBill(data: string, mime: string): Promise<{ extraction: Extraction; model: string }> {
  const { value, model } = await runChain("vision", (step, ms) => readBillWith(step, data, mime, ms), READ_BUDGET_MS);
  return { extraction: value, model };
}

export async function writeMessage(prompt: string): Promise<{ text: string; model: string }> {
  const { value, model } = await runChain("text", (step, ms) => writeWith(step, prompt, ms), WRITE_BUDGET_MS);
  return { text: value, model };
}
