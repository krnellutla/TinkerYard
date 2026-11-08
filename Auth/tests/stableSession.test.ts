import { test } from "node:test";
import assert from "node:assert/strict";
import { stableSessionState } from "../src/ui/useStableSession";

test("session: the very first check shows loading, or 'not set up' if it fails", () => {
  assert.deepEqual(stableSessionState({ isPending: true, error: null }, false), { loading: true, configError: false });
  assert.deepEqual(stableSessionState({ isPending: false, error: new Error("no secret") }, false), { loading: false, configError: true });
});

test("session: re-checks after coming back to the tab never reset the screen", () => {
  // Signed out, back from the mail app: Better Auth reports pending again, or an error while the
  // network wakes up. Neither may swap out the sign-in step.
  assert.deepEqual(stableSessionState({ isPending: true, error: null }, true), { loading: false, configError: false });
  assert.deepEqual(stableSessionState({ isPending: false, error: new Error("offline") }, true), { loading: false, configError: false });
});
