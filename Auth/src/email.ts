import "server-only";

// Sign-in emails go out through Resend. In local development without RESEND_API_KEY,
// the email is printed to the server console instead, so sign-in can be tested with no setup.
const FROM = () => process.env.EMAIL_FROM || "Tinkeryard <login@tinkeryard.dev>";

interface Email {
  to: string;
  subject: string;
  text: string;
}

async function send(email: Email) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") throw new Error("RESEND_API_KEY is not set, so sign-in emails can't be sent");
    console.log(`\n[auth] email to ${email.to} (not sent: no RESEND_API_KEY)\n${email.subject}\n${email.text}\n`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM(), to: [email.to], subject: email.subject, text: email.text }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

export const sendCode = (to: string, code: string) =>
  send({
    to,
    subject: `${code} is your Tinkeryard sign-in code`,
    text: `Your sign-in code is ${code}\n\nIt works for 10 minutes. If you didn't try to sign in, you can ignore this email.`,
  });

export const sendLink = (to: string, url: string) =>
  send({
    to,
    subject: "Your Tinkeryard sign-in link",
    text: `Open this link to sign in:\n${url}\n\nIt works once, for 10 minutes. If you didn't try to sign in, you can ignore this email.`,
  });
