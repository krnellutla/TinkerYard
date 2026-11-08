import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { addFeedback, feedbackCountSince, listFeedback, setFeedbackResolved } from "./access";
import { sendNotification } from "./email";
import { appLabel, isAppId, normalEmail } from "./policy";
import { adminUser, signedInUser, signInRequired } from "./session";

// /api/feedback: anyone signed in can send feedback from an app (POST); admins read it and mark it
// done in /admin (GET, PATCH). When FEEDBACK_EMAIL is set, each one is also emailed there.

export const FEEDBACK_KINDS = ["idea", "problem", "praise"] as const;
const DAILY_LIMIT = 20;

function json(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    try {
      return await fn(req);
    } catch (e) {
      console.error("feedback route failed:", e);
      return NextResponse.json({ error: "Something went wrong on our side. Please try again." }, { status: 500 });
    }
  };
}
const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });

const feedbackIn = z.object({
  app: z.string().refine(isAppId, "Unknown app."),
  mood: z.number().int().min(1).max(5).nullable().default(null),
  kind: z.enum(FEEDBACK_KINDS),
  message: z.string().trim().min(1, "Tell us a little more.").max(2000, "That's a lot! Keep it under 2,000 characters."),
  page: z.string().max(300).default(""),
});

export const send = json(async (req) => {
  const user = await signedInUser(req);
  if (!user) return signInRequired("send feedback");
  const parsed = feedbackIn.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return refuse(400, parsed.error.issues[0]?.message ?? "Something in the form isn't right.");
  const email = normalEmail(user.email);
  const since = new Date(Date.now() - 864e5).toISOString();
  if ((await feedbackCountSince(email, since)) >= DAILY_LIMIT) return refuse(429, "Thanks, that's plenty for today! Send more tomorrow.");
  const f = parsed.data;
  // Only the path, never the query or anything after #, which could hold something private.
  const page = f.page.split(/[?#]/)[0].slice(0, 200);
  const device = (req.headers.get("user-agent") ?? "").slice(0, 300);
  await addFeedback({ email, app: f.app, mood: f.mood, kind: f.kind, message: f.message, page, device });

  const to = process.env.FEEDBACK_EMAIL?.trim();
  if (to) {
    const origin = new URL(process.env.BETTER_AUTH_URL || req.url).origin;
    sendNotification({
      to,
      subject: `${appLabel(f.app as never)} feedback (${f.kind}) from ${email}`,
      app: appLabel(f.app as never),
      heading: `New ${f.kind}${f.mood ? ` · ${"★".repeat(f.mood)}` : ""}`,
      message: `${email} wrote: ${f.message}`,
      buttonText: "Open feedback",
      buttonUrl: `${origin}/admin#feedback`,
    }).catch((e) => console.error("feedback email failed:", e instanceof Error ? e.message : e));
  }
  return NextResponse.json({ ok: true });
});

export const list = json(async (req) => {
  const admin = await adminUser(req);
  if (admin instanceof Response) return admin;
  return NextResponse.json({ feedback: await listFeedback() });
});

export const resolve = json(async (req) => {
  const admin = await adminUser(req);
  if (admin instanceof Response) return admin;
  const b = z.object({ id: z.uuid(), resolved: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!b.success) return refuse(400, "Which feedback?");
  await setFeedbackResolved(b.data.id, b.data.resolved);
  return NextResponse.json({ ok: true });
});
