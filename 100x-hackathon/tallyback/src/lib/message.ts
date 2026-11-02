// Every number in the message comes from code. The model may only use {{placeholders}}.
import type { CheckResult, Extraction, Finding } from "./types";
import { fmt } from "./money";

export type Tone = "polite" | "firm";

export interface MessageFacts {
  merchant: string;
  bill_ref: string;
  bill_date: string;
  line: string;
  charged: string;
  expected: string;
  diff: string;
  total: string;
  reason: string;
  maths: string;
  ask: Finding["ask"];
}

export function buildFacts(ex: Extraction, f: Finding): MessageFacts {
  const cur = ex.currency ?? "";
  const line = f.lineIndex != null ? (ex.lines[f.lineIndex]?.description ?? "") : "";
  return {
    merchant: ex.merchant_name ?? "",
    bill_ref: ex.bill_number ?? "",
    bill_date: ex.bill_date ? new Date(ex.bill_date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "",
    line,
    charged: f.charged != null ? fmt(f.charged, cur) : "",
    expected: f.expected != null ? fmt(f.expected, cur) : "",
    diff: fmt(f.diff, cur),
    total: ex.printed_total != null ? fmt(ex.printed_total, cur) : "",
    reason: f.title,
    maths: f.maths,
    ask: f.ask,
  };
}

export function fill(template: string, facts: MessageFacts): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => String((facts as unknown as Record<string, string>)[k] ?? ""));
}

const NUM = /\d+(?:[.,]\d+)*/g;

// Reject any number in the final text that code didn't supply.
export function verify(text: string, facts: MessageFacts): { ok: boolean; stray: string[] } {
  const allowed = new Set(Object.values(facts).join(" ").match(NUM) ?? []);
  const stray = (text.match(NUM) ?? []).filter((n) => !allowed.has(n));
  return { ok: stray.length === 0, stray };
}

// Deterministic fallback when the model is unavailable or fails verification.
export function templateMessage(facts: MessageFacts, tone: Tone): string {
  const ref = [facts.bill_ref && `bill ${facts.bill_ref}`, facts.bill_date && `dated ${facts.bill_date}`].filter(Boolean).join(" ");
  const hi = `Hi${facts.merchant ? ` ${facts.merchant}` : ""} team,`;
  const open = `${hi}\n\nMy ${ref || "recent bill"} looks wrong: ${lowerFirst(facts.reason)}.`;
  const work =
    facts.ask === "refund" && facts.charged && facts.expected
      ? `I expected to pay ${facts.expected}, but was charged ${facts.charged}, a difference of ${facts.diff}.`
      : facts.charged
        ? `The charge is ${facts.charged}${facts.line ? ` for "${facts.line}"` : ""}.`
        : "";
  const ask =
    facts.ask === "refund"
      ? tone === "firm"
        ? `Please refund ${facts.diff} within 7 days and confirm in writing.`
        : `Could you please refund ${facts.diff} and confirm?`
      : `Could you please explain this charge${facts.charged ? ` of ${facts.charged}` : ""}, and reverse it if it doesn't apply?`;
  return `${open}${work ? `\n${work}` : ""}\n\n${ask}\n\nThank you.`;
}

export function allClearSummary(result: CheckResult): string {
  return result.checks
    .filter((c) => c.ok !== null)
    .map((c) => `${c.ok ? "✓" : "✗"} ${c.name}: ${c.maths}`)
    .join("\n");
}

const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

export function wordsChanged(a: string, b: string): number {
  // Word-level edit distance between the drafted and the sent message.
  const x = a.split(/\s+/).filter(Boolean);
  const y = b.split(/\s+/).filter(Boolean);
  const dp = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)]);
  for (let j = 1; j <= y.length; j++) dp[0][j] = j;
  for (let i = 1; i <= x.length; i++)
    for (let j = 1; j <= y.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
  return dp[x.length][y.length];
}
