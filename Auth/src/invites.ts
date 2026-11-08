// Invites from members: once you've registered and added a passkey, you can invite a few friends by
// email. Each invite puts that email on the list (with the apps you can open) and emails a personal
// link. Pure (no server code), so the API, the page and the tests share the same rules.
//
//   limit    INVITES_PER_PERSON (default 3). Admins aren't limited: they add people in /admin anyway.
//   counts   every invite you've sent, except ones you took back before the person joined
//   take back only while the person hasn't joined yet, and that gives the invite back

import type { AppId } from "./policy";

export const DEFAULT_INVITES = 3;

export function inviteLimit(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 100) : DEFAULT_INVITES;
}

export interface Inviter {
  email: string;
  admin: boolean;
  hasPasskey: boolean;
  apps: AppId[]; // what they can open: the invitee gets the same, never more
}

// Why you can't invite at all right now, or null. Shown instead of the form.
export function cannotInvite(me: Inviter, used: number, limit: number): string | null {
  if (!me.hasPasskey) return "Add a passkey first, then you can invite friends.";
  if (!me.apps.length) return "You don't have any apps to share yet.";
  if (!me.admin && used >= limit) return `You've used all ${limit} of your invites.`;
  return null;
}

// Why this particular email can't be invited, or null.
export function cannotInviteEmail(me: Inviter, email: string, alreadyOnList: boolean): string | null {
  if (!email.includes("@")) return "That email doesn't look right.";
  if (email === me.email) return "That's you.";
  if (alreadyOnList) return "They're already on Tinkeryard, so they can sign in now.";
  return null;
}

export const invitesLeft = (me: Pick<Inviter, "admin">, used: number, limit: number): number | null => (me.admin ? null : Math.max(0, limit - used));

export type InviteStatus = "pending" | "joined" | "revoked";

export interface InviteView {
  id: string;
  email: string;
  status: InviteStatus;
  createdAt: string;
}
export interface InvitesReply {
  allowed: boolean;
  reason: string | null; // why you can't invite right now
  left: number | null; // null: no limit (admins)
  limit: number;
  invites: InviteView[];
}

export function inviteStatus(i: { revokedAt: string | null }, joined: boolean): InviteStatus {
  return i.revokedAt ? "revoked" : joined ? "joined" : "pending";
}

// Only the person who sent it, only before the friend has joined.
export function cannotRevoke(me: string, i: { inviter: string; revokedAt: string | null }, joined: boolean): string | null {
  if (i.inviter !== me) return "That isn't your invite.";
  if (i.revokedAt) return "That invite was already taken back.";
  if (joined) return "They've already joined, so it can't be taken back. An admin can remove them.";
  return null;
}

// What the link in the email holds: a random token, stored only as a hash, so the database alone
// can't be used to make links. The link just fills in the email on the sign-in screen; the email
// itself is what's on the list, so a forwarded link doesn't let anyone else in.
export async function hashToken(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
