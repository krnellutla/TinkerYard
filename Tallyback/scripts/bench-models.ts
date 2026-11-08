// Which free models can do TallyBack's two jobs? Runs each candidate on the real tasks, through the
// same code the app uses (Tallyback/src/lib/models.ts), and scores it against the known answer.
//
//   npx tsx --env-file=.env.local Tallyback/scripts/bench-models.ts            all candidates with keys
//   npx tsx --env-file=.env.local Tallyback/scripts/bench-models.ts vision     one job only
//   npx tsx --env-file=.env.local Tallyback/scripts/bench-models.ts vision gemini:gemma-4-31b-it
//
// Reading: the sample receipt (public/tallyback/sample-receipt.jpg) against Tallyback/src/lib/sample.json.
// What matters is that every printed number comes back exactly, and that the checks then find nothing
// wrong: a misread number turns into a false "you were overcharged".
// Writing: the overcharge message, which must use {{placeholders}} and no digits of its own.

import { readFileSync } from "fs";
import {
  parseChain,
  readBillWith,
  usable,
  writeWith,
  type Step,
} from "../src/lib/models";
import { runChecks } from "../src/lib/checks";
import { messagePrompt } from "../src/lib/prompts";
import { buildFacts, fill, verify } from "../src/lib/message";
import type { Extraction } from "../src/lib/types";

const CANDIDATES: Record<"vision" | "text", string> = {
  vision: [
    "gemini:gemini-3.8-flash",
    "gemini:gemini-3.5-flash",
    "gemini:gemini-3.5-flash-lite",
    "gemini:gemini-3.1-flash-lite",
    "gemini:gemma-4-31b-it",
    "gemini:gemma-4-26b-a4b-it",
    "groq:qwen/qwen3.8-27b",
    "openrouter:google/gemma-4-31b-it:free",
    "openrouter:nvidia/nemotron-nano-12b-v2-vl:free",
    "github:openai/gpt-4.1-mini",
    "mistral:mistral-small-latest",
    "cloudflare:@cf/meta/llama-4-scout-17b-16e-instruct",
  ].join(","),
  text: [
    "groq:openai/gpt-oss-20b",
    "groq:openai/gpt-oss-120b",
    "gemini:gemini-3.5-flash-lite",
    "gemini:gemma-4-26b-a4b-it",
    "openrouter:google/gemma-4-26b-a4b-it:free",
    "github:openai/gpt-4.1-mini",
    "mistral:mistral-small-latest",
  ].join(","),
};

const truth = JSON.parse(
  readFileSync("Tallyback/src/lib/sample.json", "utf8"),
) as Extraction;
const image = readFileSync("public/tallyback/sample-receipt.jpg").toString(
  "base64",
);
const NO_PROMISE = {
  expectedTotal: null,
  pricesIncludeTax: null,
  paidOn: null,
  lineExpected: {},
  unrecognised: [],
};

const cents = (v: number | null | undefined) =>
  v == null ? null : Math.round(v * 100);

function scoreReading(ex: Extraction) {
  const want = truth.lines.map((l) => cents(l.amount)!);
  const got = ex.lines.map((l) => cents(l.amount));
  let matched = 0;
  const pool = [...got];
  for (const w of want) {
    const i = pool.indexOf(w);
    if (i >= 0) {
      matched++;
      pool.splice(i, 1);
    }
  }
  const checks = runChecks(ex, NO_PROMISE);
  const totalOk = cents(ex.printed_total) === cents(truth.printed_total);
  const subOk = cents(ex.printed_subtotal) === cents(truth.printed_subtotal);
  return {
    totalOk,
    subOk,
    lines: `${matched}/${want.length}`,
    extra: pool.length,
    falseAlarm: checks.outcome !== "all_ok",
    pass: totalOk && matched === want.length && checks.outcome === "all_ok",
    boxes: ex.lines.some((l) =>
      Array.isArray((l as { box_2d?: unknown }).box_2d),
    ),
  };
}

// A finding to write about: say the person expected to pay S$30.
const withPromise = { ...NO_PROMISE, expectedTotal: 30 };
const result = runChecks(truth, withPromise);
const facts = result.primary ? buildFacts(truth, result.primary) : null;

async function bench(job: "vision" | "text", step: Step) {
  const t = Date.now();
  try {
    if (job === "vision") {
      const ex = await readBillWith(step, image, "image/jpeg", 45_000);
      return { ms: Date.now() - t, ...scoreReading(ex) };
    }
    if (!facts) throw new Error("no finding to write about");
    const draft = await writeWith(
      step,
      messagePrompt(facts, "polite", ""),
      30_000,
    );
    const filled = fill(draft, facts);
    const v = verify(filled, facts);
    return {
      ms: Date.now() - t,
      pass: v.ok && filled.length > 20,
      stray: v.stray.join(" "),
      words: filled.split(/\s+/).length,
    };
  } catch (e) {
    return {
      ms: Date.now() - t,
      pass: false,
      error: (e instanceof Error ? e.message : String(e)).slice(0, 140),
    };
  }
}

async function main() {
  const [jobArg, only] = process.argv.slice(2);
  for (const job of ["vision", "text"] as const) {
    if (jobArg && jobArg !== job) continue;
    const steps = parseChain(only || CANDIDATES[job]);
    console.log(
      `\n=== ${job === "vision" ? "Reading the sample receipt" : "Writing the overcharge message"} ===`,
    );
    for (const step of steps) {
      const name = `${step.provider}:${step.model}`;
      if (!usable(step.provider)) {
        console.log(`  ${name.padEnd(52)} skipped (no ${step.provider} key)`);
        continue;
      }
      const r = await bench(job, step);
      console.log(
        `  ${name.padEnd(52)} ${r.pass ? "PASS" : "fail"} ${String(Math.round(r.ms / 100) / 10).padStart(5)} s  ${JSON.stringify({ ...r, ms: undefined, pass: undefined })}`,
      );
    }
  }
}
main();
