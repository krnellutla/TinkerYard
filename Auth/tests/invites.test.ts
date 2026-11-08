import { test } from "node:test";
import assert from "node:assert/strict";
import { cannotInvite, cannotInviteEmail, cannotRevoke, hashToken, inviteLimit, invitesLeft, inviteStatus, newToken, TOKEN, type Inviter } from "../src/invites";

const member: Inviter = { email: "me@x.dev", admin: false, hasPasskey: true, apps: ["tallyback"] };

test("invites: three each by default, set by INVITES_PER_PERSON (0 turns them off)", () => {
  assert.equal(inviteLimit(undefined), 3);
  assert.equal(inviteLimit("5"), 5);
  assert.equal(inviteLimit("0"), 0);
  assert.equal(inviteLimit("lots"), 3);
});

test("invites: only after adding a passkey, and only up to the limit (admins have none)", () => {
  assert.match(cannotInvite({ ...member, hasPasskey: false }, 0, 3)!, /passkey first/);
  assert.equal(cannotInvite(member, 2, 3), null);
  assert.match(cannotInvite(member, 3, 3)!, /all 3/);
  assert.equal(cannotInvite({ ...member, admin: true }, 50, 3), null);
  assert.equal(invitesLeft(member, 1, 3), 2);
  assert.equal(invitesLeft({ admin: true }, 9, 3), null);
  assert.match(cannotInvite({ ...member, apps: [] }, 0, 3)!, /apps/);
});

test("invites: not yourself, not someone already on the list", () => {
  assert.equal(cannotInviteEmail(member, "friend@x.dev", false), null);
  assert.match(cannotInviteEmail(member, "me@x.dev", false)!, /you/);
  assert.match(cannotInviteEmail(member, "old@x.dev", true)!, /already/);
});

test("invites: taken back only by the sender, only before the friend joins", () => {
  const inv = { inviter: "me@x.dev", revokedAt: null };
  assert.equal(cannotRevoke("me@x.dev", inv, false), null);
  assert.match(cannotRevoke("other@x.dev", inv, false)!, /isn't your/);
  assert.match(cannotRevoke("me@x.dev", inv, true)!, /joined/);
  assert.equal(inviteStatus({ revokedAt: null }, true), "joined");
  assert.equal(inviteStatus({ revokedAt: "2026-11-08" }, false), "revoked");
});

test("invites: link tokens are random, URL-safe, and stored only as a hash", async () => {
  const a = newToken();
  assert.match(a, TOKEN);
  assert.notEqual(a, newToken());
  const h = await hashToken(a);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, await hashToken(a));
});
