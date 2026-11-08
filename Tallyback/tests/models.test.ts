import { test } from "node:test";
import assert from "node:assert/strict";
import { chainFor, parseChain, parseJsonLoose, runChain } from "../src/lib/models";

test("models: a chain is provider:model pairs, and OpenRouter's ':free' stays part of the model", () => {
  assert.deepEqual(parseChain("gemini:gemini-3.5-flash-lite, openrouter:google/gemma-4-31b-it:free"), [
    { provider: "gemini", model: "gemini-3.5-flash-lite" },
    { provider: "openrouter", model: "google/gemma-4-31b-it:free" },
  ]);
  assert.deepEqual(parseChain("nope:model,gemini:,groq:qwen/qwen3.8-27b"), [{ provider: "groq", model: "qwen/qwen3.8-27b" }]);
});

test("models: providers without a key are skipped, so adding a free key just adds to the chain", () => {
  const onlyGroq = chainFor("vision", { GROQ_API_KEY: "k" });
  assert.ok(onlyGroq.length > 0 && onlyGroq.every((s) => s.provider === "groq"));
  const both = chainFor("vision", { GROQ_API_KEY: "k", GEMINI_API_KEY: "k" });
  assert.equal(both[0].model, "gemini-3.5-flash-lite"); // the benchmark's pick comes first
  assert.deepEqual(chainFor("vision", {}), []);
  // Cloudflare needs its account id as well as a token.
  assert.equal(chainFor("vision", { CLOUDFLARE_API_TOKEN: "k", LLM_VISION_CHAIN: "cloudflare:@cf/x" }).length, 0);
  assert.equal(chainFor("vision", { CLOUDFLARE_API_TOKEN: "k", CLOUDFLARE_ACCOUNT_ID: "a", LLM_VISION_CHAIN: "cloudflare:@cf/x" }).length, 1);
});

test("models: an explicit chain replaces the defaults", () => {
  const env = { GEMINI_API_KEY: "k", GROQ_API_KEY: "k", LLM_TEXT_CHAIN: "gemini:gemini-3.1-flash-lite" };
  assert.deepEqual(chainFor("text", env), [{ provider: "gemini", model: "gemini-3.1-flash-lite" }]);
});

test("models: answers wrapped in fences, prose or <think> still parse", () => {
  assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('<think>hmm {"x":0}</think>Here you go: {"a":2} hope that helps'), { a: 2 });
  assert.throws(() => parseJsonLoose("no json here"));
});

test("models: a failing or busy model hands over to the next one in the chain", async () => {
  const env = { GEMINI_API_KEY: "k", GROQ_API_KEY: "k", LLM_TEXT_CHAIN: "gemini:a,groq:b,gemini:c" };
  const tried: string[] = [];
  const out = await runChain(
    "text",
    async (step) => {
      tried.push(step.model);
      if (step.model === "a") throw new Error("gemini 429: quota");
      return `answer from ${step.model}`;
    },
    20_000,
    env,
  );
  assert.deepEqual(tried, ["a", "b"]);
  assert.deepEqual(out, { value: "answer from b", model: "groq/b" });
});

test("models: when every model fails, the error says so (and that it was busy, for a friendly retry)", async () => {
  const env = { GEMINI_API_KEY: "k", LLM_TEXT_CHAIN: "gemini:a,gemini:b" };
  await assert.rejects(
    runChain("text", async () => {
      throw new Error("gemini 503: overloaded");
    }, 20_000, env),
    /^Error: busy: every model failed \(2 tried\)/,
  );
});
