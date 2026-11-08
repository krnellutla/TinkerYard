import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { accessFor, createInvite, inviteByToken, invitesBy, revokeInvite } from "./access";
import { ensureAuthTables, getAuth } from "./auth";
import { sendNotification } from "./email";
import { cannotInvite, cannotInviteEmail, cannotRevoke, hashToken, inviteLimit, invitesLeft, inviteStatus, newToken, TOKEN, type Inviter, type InvitesReply, type InviteView } from "./invites";
import { appLabel, appsFor, can, normalEmail } from "./policy";
import { signedInUser, signInRequired } from "./session";

// /api/invites: invite friends (GET what you've sent and how many are left, POST invite, DELETE take one back)
// /api/invites/lookup?t=…: what the link in an invite email fills in on the sign-in screen

function json(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    try {
      return await fn(req);
    } catch (e) {
      console.error("invite route failed:", e);
      return NextResponse.json({ error: "Something went wrong on our side. Please try again." }, { status: 500 });
    }
  };
}
const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });

async function authCtx() {
  await ensureAuthTables();
  return getAuth().$context;
}

const joined = async (email: string) => !!(await (await authCtx()).internalAdapter.findUserByEmail(email));

async function inviterFor(req: Request): Promise<{ me: Inviter } | Response> {
  const user = await signedInUser(req);
  if (!user) return signInRequired("invite friends");
  const access = await accessFor(user.email);
  if (!can(access, { type: "sign-in" })) return refuse(403, "Your access has been paused.");
  const ctx = await authCtx();
  const keys = await ctx.adapter.count({ model: "passkey", where: [{ field: "userId", value: user.id }] });
  return { me: { email: normalEmail(user.email), admin: can(access, { type: "users:manage" }), hasPasskey: keys > 0, apps: appsFor(access) } };
}

const limit = () => inviteLimit(process.env.INVITES_PER_PERSON);
const used = (invites: { revokedAt: string | null }[]) => invites.filter((i) => !i.revokedAt).length;

async function reply(me: Inviter): Promise<InvitesReply> {
  const mine = await invitesBy(me.email);
  const n = used(mine);
  const reason = cannotInvite(me, n, limit());
  const invites: InviteView[] = [];
  for (const i of mine) invites.push({ id: i.id, email: i.email, status: inviteStatus(i, await joined(i.email)), createdAt: i.createdAt });
  return { allowed: !reason, reason, left: invitesLeft(me, n, limit()), limit: limit(), invites };
}

export const list = json(async (req) => {
  const who = await inviterFor(req);
  if (who instanceof Response) return who;
  return NextResponse.json(await reply(who.me));
});

const inviteIn = z.object({ email: z.string().trim().toLowerCase().pipe(z.email("That email doesn't look right.")) });

export const send = json(async (req) => {
  const who = await inviterFor(req);
  if (who instanceof Response) return who;
  const { me } = who;
  const parsed = inviteIn.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return refuse(400, parsed.error.issues[0]?.message ?? "That email doesn't look right.");
  const email = parsed.data.email;
  const blocked = cannotInvite(me, used(await invitesBy(me.email)), limit()) ?? cannotInviteEmail(me, email, !!(await accessFor(email)));
  if (blocked) return refuse(409, blocked);

  const token = newToken();
  await createInvite(me.email, email, me.apps, await hashToken(token));
  const origin = new URL(process.env.BETTER_AUTH_URL || req.url).origin;
  const apps = me.apps.map(appLabel).join(" and ");
  try {
    await sendNotification({
      to: email,
      subject: `${me.email} invited you to Tinkeryard`,
      app: "Tinkeryard",
      heading: "You're invited",
      message: `${me.email} invited you to Tinkeryard, where you can use ${apps}. It's invite-only: sign in with this email address (${email}), and we'll send you a 6-digit code. No password needed.`,
      buttonText: "Accept the invite",
      buttonUrl: `${origin}/home?invite=${token}`,
      preview: `${me.email} invited you to ${apps}`,
    });
  } catch (e) {
    // They're on the list either way, so they can still sign in at tinkeryard.dev: say so rather than fail.
    console.error("invite email failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ...(await reply(me)), warning: `${email} can sign in now, but the email didn't go out. Tell them to sign in at ${origin} with that address.` });
  }
  return NextResponse.json(await reply(me));
});

export const revoke = json(async (req) => {
  const who = await inviterFor(req);
  if (who instanceof Response) return who;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const inv = (await invitesBy(who.me.email)).find((i) => i.id === id);
  if (!inv) return refuse(404, "Invite not found.");
  const problem = cannotRevoke(who.me.email, inv, await joined(inv.email));
  if (problem) return refuse(409, problem);
  await revokeInvite(inv);
  return NextResponse.json(await reply(who.me));
});

// No sign-in needed (that's the point of the link); says only who invited the holder of the link, and to which email.
export const lookup = json(async (req) => {
  const t = new URL(req.url).searchParams.get("t") ?? "";
  if (!TOKEN.test(t)) return refuse(404, "That invite link isn't valid.");
  const inv = await inviteByToken(await hashToken(t));
  if (!inv || inv.revokedAt || !(await accessFor(inv.email))) return refuse(404, "That invite is no longer valid. Ask your friend to send a new one.");
  return NextResponse.json({ email: inv.email, inviter: inv.inviter });
});
