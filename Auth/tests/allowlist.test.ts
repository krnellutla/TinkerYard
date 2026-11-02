import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowed, parseAllowList } from "../src/allowlist";

test("allow-list: commas, spaces and newlines; case and whitespace ignored", () => {
  const list = parseAllowList(" Krishna@Example.com, friend@example.org\nthird@x.dev ;; not-an-email ");
  assert.deepEqual([...list].sort(), ["friend@example.org", "krishna@example.com", "third@x.dev"]);
  assert.ok(isAllowed("KRISHNA@example.com ", list));
  assert.ok(!isAllowed("stranger@example.com", list));
});

test("allow-list: empty or missing means nobody", () => {
  assert.equal(parseAllowList(undefined).size, 0);
  assert.equal(parseAllowList("").size, 0);
  assert.ok(!isAllowed("anyone@example.com", parseAllowList("")));
});

test("allow-list: non-strings are never allowed", () => {
  const list = parseAllowList("a@b.c");
  for (const v of [undefined, null, 42, { email: "a@b.c" }]) assert.ok(!isAllowed(v, list));
});
