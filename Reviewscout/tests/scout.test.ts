import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCaptions, withMinuteMarks } from "../src/lib/captions";
import { llmTurns } from "../src/lib/turns";
import { summaryRequest } from "../src/lib/prompts";

test("captions: format 3 (<p t=ms>) with word tags and entities", () => {
  const xml = `<timedtext format="3"><body><p t="0" d="2590">(relaxed music)</p><p t="61500" d="900"><s>it&#39;s</s><s> loud &amp; clear</s></p></body></timedtext>`;
  assert.deepEqual(parseCaptions(xml), [
    { start: 0, text: "(relaxed music)" },
    { start: 61.5, text: "it's loud & clear" },
  ]);
});

test("captions: format 1 (<text start=s>)", () => {
  const xml = `<transcript><text start="3.2" dur="1">hello &quot;world&quot;</text></transcript>`;
  assert.deepEqual(parseCaptions(xml), [{ start: 3.2, text: 'hello "world"' }]);
});

test("transcript gets an [mm:ss] marker about once a minute", () => {
  const text = withMinuteMarks([
    { start: 0, text: "a" },
    { start: 30, text: "b" },
    { start: 65, text: "c" },
    { start: 3725, text: "d" },
  ]);
  assert.equal(text, "\n[00:00] a b \n[01:05] c \n[62:05] d");
});

test("first turn asks for the summary; follow-ups keep the chat with the summary request first", () => {
  assert.deepEqual(llmTurns("XM6", [], null), [{ role: "user", content: summaryRequest("XM6") }]);
  const history = [
    { role: "user" as const, content: "XM6" },
    { role: "assistant" as const, content: "summary" },
  ];
  assert.deepEqual(llmTurns("XM6", history, "battery?"), [
    { role: "user", content: summaryRequest("XM6") },
    { role: "assistant", content: "summary" },
    { role: "user", content: "battery?" },
  ]);
});
