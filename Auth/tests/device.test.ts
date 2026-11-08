import { test } from "node:test";
import assert from "node:assert/strict";
import { passkeyOffer } from "../src/ui/device";

const base = { supported: true, deviceHas: false, dismissed: false, accountPasskeys: 0 };

test("passkey offer: a new account gets its first passkey offered", () => {
  assert.equal(passkeyOffer(base), "first");
});

test("passkey offer: device B is offered its own passkey even though device A has one", () => {
  assert.equal(passkeyOffer({ ...base, accountPasskeys: 1 }), "this-device");
  assert.equal(passkeyOffer({ ...base, accountPasskeys: 3 }), "this-device");
});

test("passkey offer: never on a device that has one, after 'Not now', without support, or before the list loads", () => {
  assert.equal(passkeyOffer({ ...base, accountPasskeys: 1, deviceHas: true }), "none");
  assert.equal(passkeyOffer({ ...base, dismissed: true }), "none");
  assert.equal(passkeyOffer({ ...base, supported: false }), "none");
  assert.equal(passkeyOffer({ ...base, accountPasskeys: null }), "none");
});

import { shouldAutoPasskey } from "../src/ui/device";

const back = { supported: true, deviceHas: true, onStartStep: true, signedOutHere: false, alreadyTried: false };

test("auto passkey: back on a device that holds one, the passkey prompt opens by itself", () => {
  assert.equal(shouldAutoPasskey(back), true);
});

test("auto passkey: not on a new device, not without passkey support, not mid email code", () => {
  assert.equal(shouldAutoPasskey({ ...back, deviceHas: false }), false);
  assert.equal(shouldAutoPasskey({ ...back, supported: false }), false);
  assert.equal(shouldAutoPasskey({ ...back, onStartStep: false }), false);
});

test("auto passkey: not right after signing out here, and only once per page load", () => {
  assert.equal(shouldAutoPasskey({ ...back, signedOutHere: true }), false);
  assert.equal(shouldAutoPasskey({ ...back, alreadyTried: true }), false);
});
