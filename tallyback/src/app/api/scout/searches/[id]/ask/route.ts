import { NextResponse } from "next/server";
import { jsonRoute } from "@/lib/route";
import { chatAbout, llmEnabled } from "@/lib/llm";
import { getSearch, saveTurns, type ScoutTurn } from "@/lib/store";
import { SCOUT_SYSTEM_PROMPT } from "@/lib/scout/prompts";
import { llmTurns } from "@/lib/scout/turns";

export const runtime = "nodejs";
export const maxDuration = 60;

// Step 2: no message = write the summary; a message = answer a follow-up from the same videos.
export const POST = jsonRoute(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = (await req.json()) as { deviceId?: string; message?: string };
  const s = await getSearch(id, String(body.deviceId ?? "anon"));
  if (!s) return NextResponse.json({ error: "Search not found on this device" }, { status: 404 });

  const message = body.message?.trim() ? body.message.trim().slice(0, 2000) : null;
  if (message == null && s.messages.length > 1) return NextResponse.json({ messages: s.messages }); // summary already written

  // No key yet: show what was collected instead of a summary, as the first version did.
  if (!llmEnabled()) {
    const list = s.found.filter((f) => !f.skipped).map((f) => `- [${f.title}](${f.url}) - ${f.channel}`).join("\n");
    const reply = `**Placeholder** (set \`GEMINI_API_KEY\` or \`GROQ_API_KEY\` to get the summary).\n\nCollected ${s.corpus.length.toLocaleString("en")} characters of reviews from:\n${list}`;
    return NextResponse.json({ messages: [...s.messages, ...(message ? [{ role: "user", content: message }] : []), { role: "assistant", content: reply }] });
  }

  let answer: { text: string; model: string };
  try {
    answer = await chatAbout(SCOUT_SYSTEM_PROMPT + "\n\nSOURCES:\n" + s.corpus, llmTurns(s.topic, s.messages, message));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("scout answer failed", msg);
    const busy = /429|503|quota|RESOURCE_EXHAUSTED|UNAVAILABLE|high demand/i.test(msg);
    return NextResponse.json(
      { error: busy ? "The summariser is busy right now. Wait a few seconds and try again." : "The summary step failed. Please try again." },
      { status: busy ? 429 : 500 },
    );
  }
  console.log(`[review-scout] answer written by ${answer.model}`);
  const messages: ScoutTurn[] = [...s.messages, ...(message ? [{ role: "user" as const, content: message }] : []), { role: "assistant", content: answer.text }];
  await saveTurns(id, messages, answer.model);
  return NextResponse.json({ messages });
});
