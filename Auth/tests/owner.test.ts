import { test } from "node:test";
import assert from "node:assert/strict";
import { ownerOf } from "../src/owner";

test("owner: a signed-in user owns by account, keeping the device for claiming", () => {
  assert.deepEqual(ownerOf({ id: "u1" }, "dev-1"), { userId: "u1", deviceId: "dev-1" });
  assert.deepEqual(ownerOf({ id: "u1" }, null), { userId: "u1", deviceId: "" });
});

test("owner: a guest owns by device; no usable device means no owner", () => {
  assert.deepEqual(ownerOf(null, "dev-1"), { userId: null, deviceId: "dev-1" });
  for (const d of [null, undefined, "", "anon", 42]) assert.equal(ownerOf(null, d), null);
});

test("owner: device ids are capped in length", () => {
  assert.equal(ownerOf(null, "x".repeat(500))!.deviceId.length, 64);
});
