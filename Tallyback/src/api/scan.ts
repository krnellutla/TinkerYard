import { NextResponse } from "next/server";
import { bestEffort, jsonRoute } from "@tallyback/lib/route";
import { llmEnabled, readBill } from "@tallyback/lib/llm";
import { saveBill, uploadImage } from "@tallyback/lib/store";
import { historyFor } from "@tallyback/lib/billView";
import { ATTACHMENT_MODEL, acceptUpload } from "@tallyback/lib/upload";
import { appUser, ownerOf, type Owner } from "@signin/session";
import sample from "@tallyback/lib/sample.json";
import type { Extraction } from "@tallyback/lib/types";


// If saving fails the user still gets their result; ids are just not in the database.
const unsaved = (ex: Extraction) => ({ billId: crypto.randomUUID(), lineIds: ex.lines.map(() => crypto.randomUUID()) });

// A photo kept without a reading: what an expense's receipt is when the reader couldn't make sense of it.
const EMPTY: Extraction = {
  is_bill: false,
  merchant_name: null,
  merchant_country: null,
  merchant_whatsapp: null,
  bill_type: null,
  bill_number: null,
  bill_date: null,
  due_date: null,
  period_start: null,
  period_end: null,
  currency: null,
  tax_mode: "unknown",
  printed_subtotal: null,
  printed_tax_total: null,
  printed_tax_rate_pct: null,
  printed_total: null,
  lines: [],
};

// keep=1 (an expense's receipt): when the photo can't be read, keep it anyway as a plain attachment and
// say so with the error, so the person types the amount and the receipt still goes on the expense.
async function keepAsPhoto(owner: Owner, bytes: Buffer, mime: string, error: string, status: number) {
  const billId = await bestEffort(
    "save receipt photo",
    async () => {
      const { billId } = await saveBill(owner, EMPTY, null, ATTACHMENT_MODEL);
      const link = await uploadImage(billId, bytes, mime);
      return link ? billId : null;
    },
    null,
  );
  return NextResponse.json({ error, billId, kept: !!billId }, { status });
}

export const POST = jsonRoute(async (req: Request) => {
  const form = await req.formData();
  // Every TallyBack action needs an account, even the free sample receipt.
  const user = await appUser(req, "tallyback");
  if (user instanceof Response) return user;
  const owner = ownerOf(user, form.get("deviceId"))!;

  if (form.get("sample") === "1") {
    const ex = sample as unknown as Extraction;
    const { billId, lineIds } = await bestEffort("save sample", () => saveBill(owner, ex, null, "sample"), unsaved(ex));
    return NextResponse.json({ billId, lineIds, extraction: ex });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  // Only photos and PDFs: receipts are shown to everyone in a group, so nothing that could run as a page.
  const mime = file.type || "image/jpeg";
  const allowed = acceptUpload(mime, file.size);
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });
  const keep = form.get("keep") === "1";
  const bytes = Buffer.from(await file.arrayBuffer());

  if (!llmEnabled()) {
    const error = "The server has no AI key yet, so the receipt can't be read.";
    if (keep) return keepAsPhoto(owner, bytes, mime, `${error} The photo is saved; enter the amount yourself.`, 503);
    return NextResponse.json({ error: `${error} Try the sample receipt.`, code: "no_key" }, { status: 503 });
  }
  try {
    const { extraction: ex, model } = await readBill(bytes.toString("base64"), mime);
    if (!ex.is_bill || !ex.lines.length) {
      if (keep) return keepAsPhoto(owner, bytes, mime, "Couldn't read that as a receipt. The photo is saved; enter the amount yourself.", 422);
      return NextResponse.json({ error: "That doesn't look like a bill. Try a clearer, flatter photo." }, { status: 422 });
    }
    const { billId, lineIds } = await bestEffort("save bill", () => saveBill(owner, ex, null, model), unsaved(ex));
    // Store the image after we have a row to link it to. A storage hiccup must not lose the result.
    await uploadImage(billId, bytes, mime).catch((e) => console.error(e));
    const history = await historyFor(owner, billId, ex).catch(() => ({}));
    return NextResponse.json({ billId, lineIds, extraction: ex, history });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("scan failed", msg);
    const quota = /429|503|quota|RESOURCE_EXHAUSTED|UNAVAILABLE|high demand/i.test(msg);
    const error = quota ? "The reader is busy right now." : "Couldn't read the receipt.";
    if (keep) return keepAsPhoto(owner, bytes, mime, `${error} The photo is saved; enter the amount yourself.`, quota ? 429 : 500);
    return NextResponse.json({ error: quota ? `${error} Wait a few seconds and try again.` : `${error} Try again.` }, { status: quota ? 429 : 500 });
  }
});
