import "server-only";
import { codeMessage, linkMessage, notificationMessage, resendBody, type Message, type Notice } from "./emailPayload";

// Every Tinkeryard email goes out through Resend, using the designed templates in /emails when their
// IDs are set (RESEND_TEMPLATE_*), and plain text otherwise. In local development without
// RESEND_API_KEY, the email is printed to the server console instead, so sign-in works with no setup.
const FROM = () => process.env.EMAIL_FROM || "Tinkeryard <login@tinkeryard.dev>";

async function post(key: string, body: object) {
  return fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function send(m: Message) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") throw new Error("RESEND_API_KEY is not set, so emails can't be sent");
    console.log(`\n[email] to ${m.to} (not sent: no RESEND_API_KEY)\n${m.subject}\n${m.text}\n`);
    return;
  }
  const body = resendBody(m, FROM(), process.env);
  let res = await post(key, body);
  // A template that's missing, unpublished or missing a variable must never stop someone signing in:
  // say why in the logs, and send the plain-text version instead.
  if (!res.ok && "template" in body && res.status < 500) {
    console.error(`[email] template send failed (${res.status}): ${(await res.text()).slice(0, 300)}; sending plain text`);
    res = await post(key, resendBody(m, FROM(), process.env, false));
  }
  if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

export const sendCode = (to: string, code: string) => send(codeMessage(to, code));
export const sendLink = (to: string, url: string) => send(linkMessage(to, url));
// For any app's notices (group invites, reminders): one layout, the "notification" template.
export const sendNotification = (n: Notice) => send(notificationMessage(n));
