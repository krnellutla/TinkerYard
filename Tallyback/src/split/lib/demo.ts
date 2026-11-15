import "server-only";
import { saveBill } from "@tallyback/lib/store";
import { ATTACHMENT_MODEL } from "@tallyback/lib/upload";
import { DEMO_GROUP_NAME, DEMO_RECEIPTS, DEMO_TRIP, buildBangkokDemoEntries, type DemoMemberIds } from "./demoData";
import {
  PALAWAN_GROUP_NAME,
  PALAWAN_MEMBERS,
  PALAWAN_RECEIPTS,
  PALAWAN_ROUNDS,
  PALAWAN_TRIP,
  buildPalawanDemoEntries,
  itineraryText,
  type PalawanMemberIds,
} from "./demoPalawanData";
import type { DemoEntrySpec } from "./demoData";
import { addComment, createGroup, dashboard, deleteGroup, groupDetail, saveEntry, startRounds, updateGroup, updateRounds, type Me } from "./service";

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


export type DemoName = "bangkok" | "palawan";

async function saveDemoEntries(groupId: string, me: Me, entries: DemoEntrySpec[], receiptBillIds: Record<string, string>) {
  const createdByDesc = new Map<string, string>();
  for (const entry of entries) {
    if (entry.kind === "payment") {
      await saveEntry(groupId, me, entry);
      continue;
    }
    const { receiptKey, ...rest } = entry;
    const saved = await saveEntry(groupId, me, { ...rest, receiptBillId: receiptKey ? receiptBillIds[receiptKey] : undefined });
    createdByDesc.set(entry.description, saved.id);
  }
  return createdByDesc;
}

/**
 * Seeds (or cleanly refreshes) the 6-member Palawan 8D7N trip for `me`: itinerary, Cebu Pacific
 * flights, three hotel check-ins, 22 expenses in SGD and PHP (`1 PHP = 0.0228 SGD`), 3 receipts,
 * 3 bar rounds at Pukka Bar, 2 PayNow settlements and comments, all through the real services.
 * @param me Authenticated TallyBack user session.
 * @returns Newly created `{ groupId }` ready to open in `GroupView`.
 */
export async function seedPalawanDemo(me: Me): Promise<{ groupId: string }> {
  const existing = await dashboard(me);
  for (const g of existing.groups) {
    if (g.name === PALAWAN_GROUP_NAME) await deleteGroup(g.id, me);
  }

  const groupId = await createGroup(me, {
    name: PALAWAN_GROUP_NAME,
    kind: "trip",
    currency: "SGD",
    myName: "You",
    members: PALAWAN_MEMBERS.map(({ name, email }) => ({ name, email })),
  });
  await updateGroup(groupId, me, { trip: PALAWAN_TRIP, simplify: true });

  const detail = await groupDetail(groupId, me);
  const idOf = (m: (typeof PALAWAN_MEMBERS)[number]) => detail.members.find((x) => x.email === m.email || x.name === m.name)!.id;
  const ids = { you: detail.meId, ...Object.fromEntries(PALAWAN_MEMBERS.map((m) => [m.key, idOf(m)])) } as PalawanMemberIds;

  const receiptBillIds: Record<string, string> = {};
  for (const rec of PALAWAN_RECEIPTS) {
    const saved = await saveBill({ userId: me.id, deviceId: "" }, rec.extraction, rec.dataUrl, ATTACHMENT_MODEL);
    receiptBillIds[rec.key] = saved.billId;
  }

  const created = await saveDemoEntries(groupId, me, buildPalawanDemoEntries(ids), receiptBillIds);

  // Day 4: three rounds at Pukka Bar for the five who drink, in the order the app suggests.
  await startRounds(groupId, me, { place: PALAWAN_ROUNDS.place, people: [ids.you, ids.marcus, ids.weiLing, ids.arjun, ids.daniel] });
  const order = (await groupDetail(groupId, me)).tab?.people ?? [];
  for (const [i, amount] of PALAWAN_ROUNDS.amounts.entries()) {
    await updateRounds(groupId, me, { action: "turn", round: i + 1, memberId: order[i % order.length], passed: false, amount, date: PALAWAN_ROUNDS.date });
  }
  await updateRounds(groupId, me, { action: "end" });

  const comment = async (description: string, text: string) => {
    const id = created.get(description);
    if (id) await addComment(groupId, id, me, { text });
  };
  await comment("Cebu Pacific return flights SIN ⇄ Palawan (6 pax)", itineraryText());
  await comment("Cebu Pacific return flights SIN ⇄ Palawan (6 pax)", "Web check-in opens 72h before. Seats 14A–F on the way out.");
  await comment("Kinabuch's Grill & Bar", "Billed at ₱1 = S$0.0228 on the YouTrip card, no FX fee. Tamilok: 6/10, would not repeat 😅");
  await comment("Lally & Abet Beach Cottages El Nido (3 rooms, 3 nights)", "Wifi is patchy at the cottages; Globe data works fine on the beach.");
  await comment("Two Seasons Coron Bayside Hotel (3 rooms, 2 nights)", "Front desk let us check in at 11:00 since we came straight off the ferry 🙏");
  await comment("Coron private boat: Kayangan, Twin Lagoon, Barracuda, CYC", "Kayangan viewpoint before 09:00 = no queue. Best day of the trip.");

  return { groupId };
}

/** Seeds the named demo trip (Bangkok by default). */
export function seedDemo(me: Me, name: DemoName = "bangkok") {
  return name === "palawan" ? seedPalawanDemo(me) : seedBangkokDemo(me);
}
