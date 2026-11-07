import { test } from "node:test";
import assert from "node:assert/strict";
import { appOfPath, appsFor, can, parseEmails, resolveAccess, type Access } from "../src/policy";

const settings = { admins: parseEmails("Owner@Example.com"), allowed: parseEmails("old@example.com, owner@example.com") };
const member = (apps: Access["apps"], status: Access["status"] = "active"): Access => ({ email: "m@x.dev", role: "member", apps, status, source: "dashboard" });

test("policy: admins can use every app and manage users", () => {
  const a = resolveAccess("OWNER@example.com ", settings, null)!;
  assert.equal(a.role, "admin");
  assert.equal(a.source, "settings");
  assert.ok(can(a, { type: "users:manage" }));
  assert.deepEqual(appsFor(a), ["tallyback", "reviewscout", "splitbill"]);
});

test("policy: members use only the apps they're granted, and never manage users", () => {
  const m = member(["splitbill"]);
  assert.ok(can(m, { type: "app:use", app: "splitbill" }));
  assert.ok(!can(m, { type: "app:use", app: "tallyback" }));
  assert.ok(!can(m, { type: "users:manage" }));
  assert.deepEqual(appsFor(m), ["splitbill"]);
  assert.ok(can(member([]), { type: "sign-in" }), "a member with no apps can still sign in and see why");
});

test("policy: suspended or unknown people can do nothing, not even sign in", () => {
  const s = member(["splitbill"], "suspended");
  for (const action of [{ type: "sign-in" }, { type: "users:manage" }, { type: "app:use", app: "splitbill" }] as const) {
    assert.ok(!can(s, action));
    assert.ok(!can(null, action));
  }
  assert.equal(resolveAccess("stranger@example.com", settings, null), null);
});

test("policy: a dashboard record beats the old invite list, but never a settings admin", () => {
  assert.deepEqual(appsFor(resolveAccess("old@example.com", settings, null)), ["tallyback", "reviewscout", "splitbill"]);
  const restricted = resolveAccess("old@example.com", settings, { email: "old@example.com", role: "member", apps: ["reviewscout"], status: "active" });
  assert.deepEqual(appsFor(restricted), ["reviewscout"]);
  const ownerRecord = resolveAccess("owner@example.com", settings, { email: "owner@example.com", role: "member", apps: [], status: "suspended" });
  assert.equal(ownerRecord?.role, "admin", "the owner can't be locked out from the dashboard");
  assert.ok(can(ownerRecord, { type: "users:manage" }));
});

test("policy: pages map to apps by path", () => {
  assert.equal(appOfPath("/splitbill"), "splitbill");
  assert.equal(appOfPath("/tallyback/anything"), "tallyback");
  assert.equal(appOfPath("/tallybackish"), null);
  assert.equal(appOfPath("/admin"), null);
});

test("emails: commas, spaces and newlines; case and whitespace ignored; empty means nobody", () => {
  const list = parseEmails(" Krishna@Example.com, friend@example.org\nthird@x.dev ;; not-an-email ");
  assert.deepEqual([...list].sort(), ["friend@example.org", "krishna@example.com", "third@x.dev"]);
  assert.equal(parseEmails(undefined).size, 0);
  assert.equal(parseEmails("").size, 0);
  for (const v of [undefined, null, 42, { email: "a@b.c" }]) assert.equal(resolveAccess(v, settings, null), null);
});
