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
