# Email templates (Resend)

Every Tinkeryard email uses the same layout: the wordmark, a white card on the paper background
(#f6f4ef), and a short footer. The HTML is built for email clients: tables, inline styles and
system fonts, so it renders the same in Gmail, Apple Mail and Outlook.

| File | Use | Subject (set in Resend) | Variables |
|---|---|---|---|
| `sign-in-code.html` | 6-digit email code | `{{{CODE}}} is your Tinkeryard sign-in code` | `CODE`, `MINUTES` (fallback `10`) |
| `sign-in-link.html` | Magic sign-in link | `Your Tinkeryard sign-in link` | `SIGN_IN_URL`, `MINUTES` (fallback `10`) |
| `notification.html` | Any other notice (invites, "you were added to a group", reminders) | set per email | `APP_NAME`, `HEADING`, `MESSAGE`, `BUTTON_TEXT`, `BUTTON_URL`, `PREVIEW_TEXT` |

## Adding them in Resend

1. Resend dashboard → **Templates** → **Create template**.
2. Name it (e.g. `tinkeryard-sign-in-code`), set the sender to the `EMAIL_FROM` address, and the subject from the table.
3. Paste the HTML file's contents.
4. Declare each variable in the editor, using the names in the table. Give `MINUTES` the fallback `10`.
5. Send yourself a test, then **Publish**. Only published templates can be sent.
6. Copy the template ID into Vercel (Production and Preview) and redeploy:

| Template | Environment variable |
|---|---|
| `sign-in-code.html` | `RESEND_TEMPLATE_SIGN_IN_CODE` |
| `sign-in-link.html` | `RESEND_TEMPLATE_SIGN_IN_LINK` |
| `notification.html` | `RESEND_TEMPLATE_NOTIFICATION` |

`Auth/src/email.ts` then sends `{ from, to, subject, template: { id, variables } }`. Until an ID is set,
that email goes out as plain text, so the templates can be added one at a time. If Resend rejects a
template (unpublished, wrong ID, missing variable), the reason is logged and the plain-text version is
sent instead, so sign-in never breaks. The subject sent by the app overrides the template's own.

Other apps send notices with `sendNotification({ to, subject, app, heading, message, buttonText, buttonUrl })`
from `Auth/src/email.ts`.

Variable names are uppercase. Resend reserves `FIRST_NAME`, `LAST_NAME`, `EMAIL`, `UNSUBSCRIBE_URL`,
`contact` and `this`, so none of these templates use them. A variable with no fallback must be sent
every time; if it's missing, Resend refuses the email.
