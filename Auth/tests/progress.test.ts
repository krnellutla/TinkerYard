import { test } from "node:test";
import assert from "node:assert/strict";
import { pickProgress, PROGRESS_TTL_MS, restoreProgress } from "../src/ui/progress";

const at = 1_000_000;
const saved = (p: object) => JSON.stringify({ step: "code", email: "a@b.co", at, ...p });

test("sign-in progress: back from the mail app, you're still on 'Enter the code'", () => {
  assert.deepEqual(restoreProgress(saved({}), at + 60_000), { step: "code", email: "a@b.co", at });
  assert.equal(restoreProgress(saved({ step: "link-sent" }), at + 1)?.step, "link-sent");
});

test("sign-in progress: forgotten once the code has expired", () => {
  assert.equal(restoreProgress(saved({}), at + PROGRESS_TTL_MS + 1), null);
});

test("sign-in progress: anything odd is ignored", () => {
  assert.equal(restoreProgress(null, at), null);
  assert.equal(restoreProgress("not json", at), null);
  assert.equal(restoreProgress(saved({ step: "start" }), at), null);
  assert.equal(restoreProgress(saved({ email: "nobody" }), at), null);
  assert.equal(restoreProgress(saved({ at: at + 5_000 }), at), null); // from the future
});

test("sign-in progress: the newest stored copy wins; the URL marker alone still lands on the code step", () => {
  const older = { step: "code" as const, email: "old@b.co", at: 1 };
  const newer = { step: "code" as const, email: "new@b.co", at: 2 };
  assert.equal(pickProgress(older, newer, "")?.email, "new@b.co");
  assert.equal(pickProgress(null, older, "#signin-code")?.email, "old@b.co");
  assert.deepEqual(pickProgress(null, null, "#signin-code"), { step: "code", email: "", at: 0 });
  assert.equal(pickProgress(null, null, "#signin-link")?.step, "link-sent");
  assert.equal(pickProgress(null, null, "#something-else"), null);
});
