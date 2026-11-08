import { test } from "node:test";
import assert from "node:assert/strict";
import { afterPendingCleared, isPendingError } from "../src/ui/webauthn";

test("passkey: the browser's 'request is already pending' is recognised", () => {
  assert.ok(isPendingError("A request is already pending."));
  assert.ok(!isPendingError("The operation either timed out or was not allowed."));
  assert.ok(!isPendingError(undefined));
});

test("passkey: a pending-request failure is retried once, anything else is returned as is", async () => {
  let calls = 0;
  const r = await afterPendingCleared(async () => (++calls === 1 ? { error: { message: "A request is already pending." } } : { error: null }));
  assert.equal(calls, 2);
  assert.equal(r.error, null);

  calls = 0;
  const cancelled = await afterPendingCleared(async () => (++calls, { error: { code: "AUTH_CANCELLED", message: "cancelled" } }));
  assert.equal(calls, 1);
  assert.equal(cancelled.error?.code, "AUTH_CANCELLED");
});
