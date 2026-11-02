import type { ScoutTurn } from "../store";
import { summaryRequest } from "./prompts";

// What the LLM sees. The chat starts with the product question; the model gets the full
// summary request in its place, so follow-ups are answered with the same instructions.
export function llmTurns(topic: string, history: ScoutTurn[], message: string | null): ScoutTurn[] {
  if (!history.length || message == null) return [{ role: "user", content: summaryRequest(topic) }];
  return [{ role: "user", content: summaryRequest(topic) }, ...history.slice(1), { role: "user", content: message }];
}
