import { NextResponse } from "next/server";
import { bestEffort, jsonRoute } from "@/lib/route";
import { runChecks } from "@/lib/checks";
import { llmEnabled, writeMessage } from "@/lib/llm";
import { messagePrompt } from "@/lib/prompts";
import { buildFacts, fill, templateMessage, verify, type Tone } from "@/lib/message";
import { saveDraft } from "@/lib/store";
import type { Extraction, Promise } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = jsonRoute(async (req: Request) => {
  const body = (await req.json()) as {
    billId: string;
    lineIds: string[];
    findingDbIds: Record<string, string>;
    extraction: Extraction;
    promise: Promise;
    findingId: string;
    tone: Tone;
    note: string;
  };
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
  const messageId = await bestEffort("save draft", () => saveDraft({
    billId: body.billId,
    lineItemId,
    findingId: body.findingDbIds?.[f.id] ?? null,
    text,
    source,
  }), "");
  return NextResponse.json({ messageId, text, source, rejected: stray, findingId: f.id });
});
