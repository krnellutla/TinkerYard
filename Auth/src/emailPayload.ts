// What we ask Resend to send. Pure, so it's easy to test (email.ts does the sending).
//
// Each email has a designed template in Resend (HTML in /emails) and a plain-text version.
// When the template's ID is set in the environment, Resend renders the template with our variables;
// without it (local development, or before a template is published) the plain text goes out instead.

export type Variables = Record<string, string | number>;

export interface Message {
  to: string;
  subject: string;
  text: string; // always present: the fallback, and what's printed in local development
  template?: { envKey: string; variables: Variables };
}

export function resendBody(m: Message, from: string, env: Record<string, string | undefined>, useTemplate = true) {
  const id = m.template ? env[m.template.envKey]?.trim() : undefined;
  const base = { from, to: [m.to], subject: m.subject };
  return useTemplate && id && m.template ? { ...base, template: { id, variables: m.template.variables } } : { ...base, text: m.text };
}

// The template IDs, one environment variable each (copied from Resend → Templates after publishing).
export const TEMPLATE_ENV = {
  code: "RESEND_TEMPLATE_SIGN_IN_CODE",
  link: "RESEND_TEMPLATE_SIGN_IN_LINK",
  notification: "RESEND_TEMPLATE_NOTIFICATION",
} as const;

const MINUTES = 10;

export const codeMessage = (to: string, code: string): Message => ({
  to,
  subject: `${code} is your Tinkeryard sign-in code`,
  text: `Your sign-in code is ${code}\n\nIt works for ${MINUTES} minutes. If you didn't try to sign in, you can ignore this email.`,
  template: { envKey: TEMPLATE_ENV.code, variables: { CODE: code, MINUTES } },
});

export const linkMessage = (to: string, url: string): Message => ({
  to,
  subject: "Your Tinkeryard sign-in link",
  text: `Open this link to sign in:\n${url}\n\nIt works once, for ${MINUTES} minutes. If you didn't try to sign in, you can ignore this email.`,
  template: { envKey: TEMPLATE_ENV.link, variables: { SIGN_IN_URL: url, MINUTES } },
});

export interface Notice {
  to: string;
  subject: string;
  app: string; // e.g. "TallyBack"
  heading: string;
  message: string;
  buttonText: string;
  buttonUrl: string;
  preview?: string;
}

export const notificationMessage = (n: Notice): Message => ({
  to: n.to,
  subject: n.subject,
  text: `${n.heading}\n\n${n.message}\n\n${n.buttonText}: ${n.buttonUrl}`,
  template: {
    envKey: TEMPLATE_ENV.notification,
    variables: {
      APP_NAME: n.app,
      HEADING: n.heading,
      MESSAGE: n.message,
      BUTTON_TEXT: n.buttonText,
      BUTTON_URL: n.buttonUrl,
      PREVIEW_TEXT: n.preview ?? n.heading,
    },
  },
});
