import { test } from "node:test";
import assert from "node:assert/strict";
import { siteFor } from "../src/site";

test("site: the bare domain also trusts www (tinkeryard.dev redirects there)", () => {
  const s = siteFor("https://tinkeryard.dev");
  assert.equal(s.rpID, "tinkeryard.dev");
  assert.deepEqual(s.origins.sort(), ["https://tinkeryard.dev", "https://www.tinkeryard.dev"]);
});

test("site: www also trusts the bare domain, and keeps its own passkey site", () => {
  const s = siteFor("https://www.tinkeryard.dev/");
  assert.equal(s.rpID, "www.tinkeryard.dev");
  assert.deepEqual(s.origins.sort(), ["https://tinkeryard.dev", "https://www.tinkeryard.dev"]);
});

test("site: localhost and preview URLs trust only themselves", () => {
  assert.deepEqual(siteFor(undefined).origins, ["http://localhost:3000"]);
  assert.deepEqual(siteFor("https://tinkeryard-git-x.vercel.app").origins, ["https://tinkeryard-git-x.vercel.app"]);
  assert.deepEqual(siteFor("not a url").origins, ["http://localhost:3000"]);
});
