import { test } from "node:test";
import assert from "node:assert/strict";
import { receiptActivity, receiptDecision } from "../src/split/lib/receipt";
import { acceptUpload, MAX_UPLOAD } from "../src/lib/upload";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

test("receipt: an edit that doesn't mention the receipt keeps it", () => {
  assert.deepEqual(receiptDecision(A, undefined, false), { action: "keep" });
  assert.deepEqual(receiptDecision(null, undefined, false), { action: "keep" });
});

test("receipt: anyone may keep the receipt someone else attached", () => {
  assert.deepEqual(receiptDecision(A, A, false), { action: "keep" });
});

test("receipt: only your own scan can be attached; someone else's bill is dropped, not attached", () => {
  assert.deepEqual(receiptDecision(null, B, true), { action: "set", billId: B });
  assert.deepEqual(receiptDecision(A, B, true), { action: "set", billId: B });
  assert.deepEqual(receiptDecision(null, B, false), { action: "drop" });
});

test("receipt: null removes it (and does nothing when there was none)", () => {
  assert.deepEqual(receiptDecision(A, null, false), { action: "clear" });
  assert.deepEqual(receiptDecision(null, null, false), { action: "keep" });
});

test("receipt: the activity line says what happened to it", () => {
  assert.equal(receiptActivity({ action: "set", billId: B }, "“Dinner”"), "attached a receipt to “Dinner”");
  assert.equal(receiptActivity({ action: "clear" }, "“Dinner”"), "removed the receipt from “Dinner”");
  assert.equal(receiptActivity({ action: "keep" }, "“Dinner”"), null);
});

test("upload: photos and PDFs only, nothing that could run as a page", () => {
  for (const t of ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf", "IMAGE/JPEG"]) assert.ok(acceptUpload(t, 1000).ok, t);
  for (const t of ["image/svg+xml", "text/html", "application/xhtml+xml", "application/javascript", ""]) {
    const r = acceptUpload(t, 1000);
    assert.ok(!r.ok && r.status === 415, t);
  }
});

test("upload: anything over 4 MB is refused before it reaches the server's limit", () => {
  const r = acceptUpload("image/jpeg", MAX_UPLOAD + 1);
  assert.ok(!r.ok && r.status === 413);
  assert.ok(acceptUpload("image/jpeg", MAX_UPLOAD).ok);
});
