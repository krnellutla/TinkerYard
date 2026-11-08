import { test } from "node:test";
import assert from "node:assert/strict";
import { codeMessage, linkMessage, notificationMessage, resendBody } from "../src/emailPayload";

const FROM = "Tinkeryard <login@tinkeryard.dev>";

test("email: with a template ID, the code goes out through the Resend template", () => {
  const body = resendBody(codeMessage("a@b.co", "482913"), FROM, { RESEND_TEMPLATE_SIGN_IN_CODE: " tmpl_123 " });
  assert.deepEqual(body, {
    from: FROM,
    to: ["a@b.co"],
    subject: "482913 is your Tinkeryard sign-in code",
    template: { id: "tmpl_123", variables: { CODE: "482913", MINUTES: 10 } },
  });
  assert.ok(!("text" in body));
});

test("email: without a template ID (or when falling back), plain text goes out", () => {
  const m = linkMessage("a@b.co", "https://www.tinkeryard.dev/x?token=t");
  const plain = resendBody(m, FROM, {});
  assert.ok("text" in plain && plain.text.includes("https://www.tinkeryard.dev/x?token=t"));
  assert.ok(!("template" in plain));
  const fallback = resendBody(m, FROM, { RESEND_TEMPLATE_SIGN_IN_LINK: "tmpl_9" }, false);
  assert.ok("text" in fallback && !("template" in fallback));
});

test("email: notifications fill every variable the template declares", () => {
  const body = resendBody(
    notificationMessage({ to: "a@b.co", subject: "Added", app: "TallyBack", heading: "You were added", message: "Hi", buttonText: "Open", buttonUrl: "https://x" }),
    FROM,
    { RESEND_TEMPLATE_NOTIFICATION: "tmpl_n" },
  );
  assert.ok("template" in body);
  assert.deepEqual(Object.keys(body.template.variables).sort(), ["APP_NAME", "BUTTON_TEXT", "BUTTON_URL", "HEADING", "MESSAGE", "PREVIEW_TEXT"]);
  assert.equal(body.template.variables.PREVIEW_TEXT, "You were added");
});
