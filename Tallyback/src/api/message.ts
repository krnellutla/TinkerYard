import { NextResponse } from "next/server";
import { bestEffort, jsonRoute } from "@tallyback/lib/route";
import { runChecks } from "@tallyback/lib/checks";
import { llmEnabled, writeMessage } from "@tallyback/lib/llm";
import { messagePrompt } from "@tallyback/lib/prompts";
import { buildFacts, fill, templateMessage, verify, type Tone } from "@tallyback/lib/message";
import { findBill, saveDraft } from "@tallyback/lib/store";
import { ownerOf, signedInUser, signInRequired } from "@signin/session";
import type { Extraction, Promise } from "@tallyback/lib/types";


// Writing the message calls the AI: signed-in, invited people only.
export const POST = jsonRoute(async (req: Request) => {
  const user = await signedInUser(req);
  if (!user) return signInRequired("write the message");
  const body = (await req.json()) as {
    billId: string;
    lineIds: string[];
    findingDbIds: Record<string, string>;
    extraction: Extraction;
    promise: Promise;
    findingId: string;
    tone: Tone;
    note: string;
    deviceId?: string;
  };
  const owner = ownerOf(user, body.deviceId);
  const ownsBill = !!owner && !!(await findBill(body.billId, owner));
  const result = runChecks(body.extraction, body.promise);
  const f = result.findings.find((x) => x.id === body.findingId) ?? result.primary;
  if (!f) return NextResponse.json({ error: "Nothing to dispute: every line checks out." }, { status: 400 });

  const facts = buildFacts(body.extraction, f);
  let text = "";
  let source: "model" | "template" = "template";
  let stray: string[] = [];

  if (llmEnabled()) {
    try {
      const { text: draft } = await writeMessage(messagePrompt(facts, body.tone, body.note ?? ""));
      const filled = fill(draft, facts);
      const v = verify(filled, facts);
      stray = v.stray;
      if (v.ok && filled.length > 20) {
        text = filled;
        source = "model";
      }
    } catch (e) {
      console.error("draft failed", e);
    }
  }
  if (!text) text = templateMessage(facts, body.tone);

  const lineItemId = f.lineIndex != null ? (body.lineIds[f.lineIndex] ?? null) : null;
  // Saved only against a bill this person owns; an unsaved bill still gets its message.
  if (!ownsBill) return NextResponse.json({ messageId: "", text, source, rejected: stray, findingId: f.id });
  const messageId = await bestEffort("save draft", () => saveDraft({
    billId: body.billId,
    lineItemId,
    findingId: body.findingDbIds?.[f.id] ?? null,
    text,
    source,
  }), "");
  return NextResponse.json({ messageId, text, source, rejected: stray, findingId: f.id });
});
