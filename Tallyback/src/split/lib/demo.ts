import "server-only";
import { saveBill } from "@tallyback/lib/store";
import { ATTACHMENT_MODEL } from "@tallyback/lib/upload";
import { DEMO_GROUP_NAME, DEMO_RECEIPTS, DEMO_TRIP, buildBangkokDemoEntries, type DemoMemberIds } from "./demoData";
import { addComment, createGroup, dashboard, deleteGroup, groupDetail, saveEntry, updateGroup, type Me } from "./service";

const DEMO_MEMBERS = [
  { name: "Aisha", email: "aisha@demo.tinkeryard.dev" },
  { name: "Liam", email: "liam@demo.tinkeryard.dev" },
  { name: "Priya", email: "priya@demo.tinkeryard.dev" },
  { name: "Kenji", email: "kenji@demo.tinkeryard.dev" },
];

/**
 * Seeds (or cleanly refreshes) the 5-member `"Bangkok Long Weekend 🇹🇭"` demo group for `me`,
 * saving 3 SVG mock receipts, 7 multi-currency expenses (`SGD` + `THB` @ `0.0385`), 1 PayNow
 * settlement, and sample comments through the real Split & Bill storage services.
 * @param me Authenticated TallyBack user session.
 * @returns Newly created `{ groupId }` ready to open in `GroupView`.
 */
export async function seedBangkokDemo(me: Me): Promise<{ groupId: string }> {
  // Soft-delete any existing live Bangkok demo group so repeated clicks reset cleanly without duplicate clutter.
  const existing = await dashboard(me);
  for (const g of existing.groups) {
    if (g.name === DEMO_GROUP_NAME) await deleteGroup(g.id, me);
  }

  const groupId = await createGroup(me, {
    name: DEMO_GROUP_NAME,
    kind: "trip",
    currency: "SGD",
    myName: "You",
    members: DEMO_MEMBERS,
  });

  await updateGroup(groupId, me, { trip: DEMO_TRIP, simplify: true });

  const detail = await groupDetail(groupId, me);
  const byEmail = new Map(detail.members.map((m) => [m.email ?? "", m.id]));
  const byName = new Map(detail.members.map((m) => [m.name, m.id]));
  const ids: DemoMemberIds = {
    you: detail.meId,
    aisha: byEmail.get("aisha@demo.tinkeryard.dev") ?? byName.get("Aisha")!,
    liam: byEmail.get("liam@demo.tinkeryard.dev") ?? byName.get("Liam")!,
    priya: byEmail.get("priya@demo.tinkeryard.dev") ?? byName.get("Priya")!,
    kenji: byEmail.get("kenji@demo.tinkeryard.dev") ?? byName.get("Kenji")!,
  };

  // Persist 3 SVG mock receipts owned by this user so /receipt streams them securely in both DB & .data modes.
  const receiptBillIds: Record<string, string> = {};
  for (const rec of DEMO_RECEIPTS) {
    const saved = await saveBill({ userId: me.id, deviceId: "" }, rec.extraction, rec.dataUrl, ATTACHMENT_MODEL);
    receiptBillIds[rec.key] = saved.billId;
  }

  const entries = buildBangkokDemoEntries(ids);
  const createdByDesc = new Map<string, string>();

  for (const entry of entries) {
    if (entry.kind === "payment") {
      await saveEntry(groupId, me, entry);
      continue;
    }
    const { receiptKey, ...rest } = entry;
    const saved = await saveEntry(groupId, me, {
      ...rest,
      receiptBillId: receiptKey ? receiptBillIds[receiptKey] : undefined,
    });
    createdByDesc.set(entry.description, saved.id);
  }

  const somboonId = createdByDesc.get("Somboon Seafood Bantadthong");
  if (somboonId) {
    await addComment(groupId, somboonId, me, { text: "Curry crab was unreal! Took Aisha off the Chang tower with the drink toggle." });
  }
  const octaveId = createdByDesc.get("Octave Rooftop Lounge & Bar (Marriott Sukhumvit)");
  if (octaveId) {
    await addComment(groupId, octaveId, me, { text: "Billed at S$1 = ฿25.97 (0.0385) on YouTrip card with 0% FX fee." });
  }

  return { groupId };
}

