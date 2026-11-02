import { NextResponse } from "next/server";
import { bestEffort, jsonRoute } from "@tallyback/lib/route";
import { llmEnabled, readBill } from "@tallyback/lib/llm";
import { saveBill, uploadImage } from "@tallyback/lib/store";
import { historyFor } from "@tallyback/lib/billView";
import { ownerOf, signedInUser, signInRequired } from "@signin/session";
import sample from "@tallyback/lib/sample.json";
import type { Extraction } from "@tallyback/lib/types";


// If saving fails the user still gets their result; ids are just not in the database.
const unsaved = (ex: Extraction) => ({ billId: crypto.randomUUID(), lineIds: ex.lines.map(() => crypto.randomUUID()) });

export const POST = jsonRoute(async (req: Request) => {
  const form = await req.formData();
  const user = await signedInUser(req);
  const owner = ownerOf(user, form.get("deviceId"));

  // The sample receipt costs nothing, so it works for guests too.
  if (form.get("sample") === "1") {
    const ex = sample as unknown as Extraction;
    const save = () => (owner ? saveBill(owner, ex, null, "sample") : Promise.resolve(unsaved(ex)));
    const { billId, lineIds } = await bestEffort("save sample", save, unsaved(ex));
    return NextResponse.json({ billId, lineIds, extraction: ex });
  }

  // Reading a real bill calls the AI: signed-in, invited people only.
  if (!user || !owner) return signInRequired("check a real bill");

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (!llmEnabled())
    return NextResponse.json({ error: "The server has no AI key yet. Try the sample receipt.", code: "no_key" }, { status: 503 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "image/jpeg";
  try {
    const { extraction: ex, model } = await readBill(bytes.toString("base64"), mime);
    if (!ex.is_bill || !ex.lines.length)
      return NextResponse.json({ error: "That doesn't look like a bill. Try a clearer, flatter photo." }, { status: 422 });
    const { billId, lineIds } = await bestEffort("save bill", () => saveBill(owner, ex, null, model), unsaved(ex));
    // Store the image after we have a row to link it to. A storage hiccup must not lose the result.
    await uploadImage(billId, bytes, mime).catch((e) => console.error(e));
    const history = await historyFor(owner, billId, ex).catch(() => ({}));
    return NextResponse.json({ billId, lineIds, extraction: ex, history });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("scan failed", msg);
    const quota = /429|503|quota|RESOURCE_EXHAUSTED|UNAVAILABLE|high demand/i.test(msg);
    return NextResponse.json(
      { error: quota ? "The reader is busy right now. Wait a few seconds and try again." : "Couldn't read the bill. Try again." },
      { status: quota ? 429 : 500 },
    );
  }
});
