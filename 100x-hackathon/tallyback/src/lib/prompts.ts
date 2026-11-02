import type { MessageFacts, Tone } from "./message";

export const EXTRACT_PROMPT = `You are reading a bill, receipt or invoice of any kind, from any country.
Transcribe it into the schema. Rules:
- Copy every number exactly as printed. Never calculate, correct or infer an amount.
- One entry in "lines" per printed row that carries an amount, top to bottom, including subtotal, tax, service charge, rounding, total and payment rows (use the matching kind).
- If a value isn't printed, use null.
- Do NOT include any personal data of the customer (name, phone, address, account or card numbers) anywhere.
- box_2d must tightly cover the full printed row of that line.
- If this is not a bill, set is_bill=false and lines=[].`;

export function messagePrompt(facts: MessageFacts, tone: Tone, note: string): string {
  const placeholders = Object.keys(facts)
    .filter((k) => k !== "ask")
    .map((k) => `{{${k}}}`)
    .join(", ");
  return `Write a short message (max 90 words) a customer will send on WhatsApp to a business about one line on their bill.
Tone: ${tone === "firm" ? "firm, factual, no apologies" : "polite and friendly, but clear"}.
Goal: ${facts.ask === "refund" ? "ask for a refund of {{diff}}" : "ask them to explain the charge and reverse it if it doesn't apply"}.
Context (for your understanding only): ${facts.reason}. Working: ${facts.maths}.
${note ? `Customer's own words about it: "${note}"` : ""}

STRICT RULES:
- Never write any digit (0-9). For every amount, date or reference use ONLY these placeholders: ${placeholders}.
- Write in the first person, as the customer.
- Mention the bill using {{bill_ref}} and {{bill_date}}. State what you expected ({{expected}}), what you were charged ({{charged}}) and the difference ({{diff}}), where those apply.
- Do not use {{maths}} or {{reason}} verbatim; put the reason in your own words.
- No subject line, no sign-off name, no emojis. Plain text only. Output only the message.`;
}
