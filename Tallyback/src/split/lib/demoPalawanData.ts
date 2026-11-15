import type { Extraction } from "@tallyback/lib/types";
import { convert } from "./money";
import { buildItemizedSplit, buildMockReceiptSvg, type DemoEntrySpec } from "./demoData";
import type { Trip } from "./trip";

// The Palawan demo: six friends from Singapore on an 8-day, 7-night island-hopping trip
// (Puerto Princesa → El Nido → Coron). Balances are in SGD; most spending on the ground is in pesos.
// Pure data, so tests can check every number without a database.

export const PALAWAN_GROUP_NAME = "Palawan 8D7N · Puerto Princesa → El Nido → Coron 🇵🇭";
/** 1 PHP = 0.0228 SGD (about ₱43.86 to the dollar), the rate the group's cards were billed at. */
export const PALAWAN_RATE_PHP_TO_SGD = 0.0228;

export const PALAWAN_TRIP: Trip = {
  destination: "Palawan, Philippines",
  start: "2026-11-06",
  end: "2026-11-13",
  currency: "PHP",
};

export const PALAWAN_MEMBERS = [
  { key: "marcus", name: "Marcus", email: "marcus@demo.tinkeryard.dev" },
  { key: "weiLing", name: "Wei Ling", email: "weiling@demo.tinkeryard.dev" },
  { key: "arjun", name: "Arjun", email: "arjun@demo.tinkeryard.dev" },
  { key: "sofia", name: "Sofia", email: "sofia@demo.tinkeryard.dev" },
  { key: "daniel", name: "Daniel", email: "daniel@demo.tinkeryard.dev" },
] as const;

export interface PalawanMemberIds {
  you: string;
  marcus: string;
  weiLing: string;
  arjun: string;
  sofia: string;
  daniel: string;
}

// ---- itinerary ----

export interface ItineraryDay {
  day: number;
  date: string; // YYYY-MM-DD
  base: string; // where everyone sleeps that night (or "Home")
  plan: string;
}

/** The day-by-day plan the group agreed on. It's posted as the first comment on the flights. */
export const PALAWAN_ITINERARY: ItineraryDay[] = [
  { day: 1, date: "2026-11-06", base: "Puerto Princesa", plan: "SIN → MNL → PPS, check in at Canvas Boutique Hotel, dinner at Kinabuch's" },
  { day: 2, date: "2026-11-07", base: "Puerto Princesa", plan: "Underground River day tour from Sabang, dinner at Ka Lui" },
  { day: 3, date: "2026-11-08", base: "El Nido", plan: "06:30 private van to El Nido (~5.5h), check in at Lally & Abet, dinner at Trattoria Altrove" },
  { day: 4, date: "2026-11-09", base: "El Nido", plan: "Tour A: Big & Small Lagoon, Secret Lagoon, Shimizu, 7 Commando; rounds at Pukka Bar" },
  { day: 5, date: "2026-11-10", base: "El Nido", plan: "Tour C (Arjun diving instead), supplies run, sunset + zipline at Las Cabañas" },
  { day: 6, date: "2026-11-11", base: "Coron", plan: "06:00 fast craft to Coron, check in at Two Seasons Bayside, Mt Tapyas + Maquinit Hot Spring" },
  { day: 7, date: "2026-11-12", base: "Coron", plan: "Private boat: Kayangan Lake, Twin Lagoon, Barracuda Lake, CYC Beach; farewell at Kawayanan Grill" },
  { day: 8, date: "2026-11-13", base: "Home", plan: "Shuttle to Busuanga (USU), USU → MNL → SIN, home by 20:20" },
];

/** The itinerary as one comment (the app's comments hold up to 1,000 characters). */
export function itineraryText(days: ItineraryDay[] = PALAWAN_ITINERARY): string {
  const lines = days.map((d) => {
    const label = new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
    return `D${d.day} ${label}: ${d.plan}`;
  });
  return [`🗺️ Our 8D7N plan`, ...lines].join("\n");
}

// ---- receipts ----

export type PalawanReceiptKey = "kinabuch" | "altrove" | "coronBoat";

export interface PalawanBillSeed {
  key: PalawanReceiptKey;
  extraction: Extraction;
  dataUrl: string;
}

const r = PALAWAN_RATE_PHP_TO_SGD;
const vatIncluded = (totalCents: number) => Math.round((totalCents * 12) / 112); // PH VAT is 12%, inside the price

// Kinabuch's Grill & Bar, Puerto Princesa (Day 1). Sofia doesn't drink.
const kinabuchItems = [
  { label: "Crocodile Sisig", qty: 1, amountCents: 42000 },
  { label: "Tamilok Kinilaw", qty: 1, amountCents: 28000 },
  { label: "Grilled Tuna Belly", qty: 1, amountCents: 56000 },
  { label: "Chicken Inasal", qty: 2, amountCents: 46000 },
  { label: "Garlic Rice", qty: 6, amountCents: 36000 },
  { label: "Red Horse Beer (500ml)", qty: 8, amountCents: 72000, isDrink: true },
  { label: "Fresh Calamansi Juice", qty: 1, amountCents: 8500 },
];
const kinabuchSub = kinabuchItems.reduce((s, i) => s + i.amountCents, 0); // 288,500
const kinabuchService = Math.round(kinabuchSub / 10); // 28,850
const kinabuchTotal = kinabuchSub + kinabuchService; // 317,350
const kinabuchVat = vatIncluded(kinabuchTotal);

// Trattoria Altrove, El Nido (Day 3).
const altroveItems = [
  { label: "Quattro Formaggi Pizza", qty: 1, amountCents: 52000 },
  { label: "Diavola Pizza", qty: 1, amountCents: 49000 },
  { label: "Seafood Linguine", qty: 1, amountCents: 48000 },
  { label: "Margherita Pizza", qty: 1, amountCents: 39000 },
  { label: "Tiramisu", qty: 2, amountCents: 36000 },
  { label: "San Miguel Pale Pilsen", qty: 6, amountCents: 54000, isDrink: true },
  { label: "Mango Shake", qty: 1, amountCents: 15000 },
];
const altroveSub = altroveItems.reduce((s, i) => s + i.amountCents, 0); // 293,000
const altroveService = Math.round(altroveSub / 10); // 29,300
const altroveTotal = altroveSub + altroveService; // 322,300
const altroveVat = vatIncluded(altroveTotal);

// Private island-hopping boat in Coron (Day 7). Arjun and Daniel brought their own snorkel gear.
const coronItems = [
  { label: "Private Boat Hire (Ultimate Tour)", qty: 1, amountCents: 850000 },
  { label: "Kayangan Lake Entrance", qty: 6, amountCents: 240000 },
  { label: "Twin Lagoon Entrance", qty: 6, amountCents: 180000 },
  { label: "Barracuda Lake Entrance", qty: 6, amountCents: 120000 },
  { label: "CYC Beach Entrance", qty: 6, amountCents: 90000 },
  { label: "Boat Lunch (Grilled Fish, Adobo)", qty: 6, amountCents: 210000 },
  { label: "Snorkel & Fins Rental", qty: 4, amountCents: 60000 },
];
const coronTotal = coronItems.reduce((s, i) => s + i.amountCents, 0); // 1,750,000

const lineOf = (i: { label: string; qty: number; amountCents: number }, plain: string): Extraction["lines"][number] => ({
  description: i.label,
  plain_words: plain,
  qty: i.qty,
  unit_price: i.amountCents / 100 / i.qty,
  amount: i.amountCents / 100,
  kind: "item",
  tax_rate_pct: 12,
  box_2d: null,
});

export const PALAWAN_RECEIPTS: PalawanBillSeed[] = [
  {
    key: "kinabuch",
    dataUrl: buildMockReceiptSvg({
      merchant: "KINABUCH'S GRILL & BAR",
      subtitle: "Rizal Avenue · Puerto Princesa City",
      date: "2026-11-06",
      billNumber: "KGB-10394",
      currency: "PHP",
      items: kinabuchItems,
      subtotalCents: kinabuchSub,
      serviceChargeCents: kinabuchService,
      vatCents: kinabuchVat,
      totalCents: kinabuchTotal,
      groupCurrency: "SGD",
      rate: r,
      summary: [
        { label: "Subtotal (PHP)", cents: kinabuchSub },
        { label: "Service Charge (10%)", cents: kinabuchService },
        { label: "VAT 12% (included)", cents: kinabuchVat },
      ],
    }),
    extraction: {
      is_bill: true,
      merchant_name: "Kinabuch's Grill & Bar",
      merchant_country: "PH",
      merchant_whatsapp: null,
      bill_type: "restaurant",
      bill_number: "KGB-10394",
      bill_date: "2026-11-06",
      due_date: null,
      period_start: null,
      period_end: null,
      currency: "PHP",
      tax_mode: "included",
      printed_subtotal: kinabuchSub / 100,
      printed_tax_total: kinabuchVat / 100,
      printed_tax_rate_pct: 12,
      printed_total: kinabuchTotal / 100,
      lines: [
        lineOf(kinabuchItems[0], "Crocodile meat sisig"),
        lineOf(kinabuchItems[1], "Woodworm ceviche (local delicacy)"),
        lineOf(kinabuchItems[2], "Grilled tuna"),
        lineOf(kinabuchItems[3], "Grilled chicken"),
        lineOf(kinabuchItems[4], "Rice"),
        lineOf(kinabuchItems[5], "Beer"),
        lineOf(kinabuchItems[6], "Juice"),
        { description: "Service Charge 10%", plain_words: "Service charge", qty: null, unit_price: null, amount: kinabuchService / 100, kind: "service_charge", tax_rate_pct: null, box_2d: null },
        { description: "VAT 12% (included)", plain_words: "VAT already in the prices", qty: null, unit_price: null, amount: kinabuchVat / 100, kind: "tax", tax_rate_pct: 12, box_2d: null },
      ],
    },
  },
  {
    key: "altrove",
    dataUrl: buildMockReceiptSvg({
      merchant: "TRATTORIA ALTROVE",
      subtitle: "Hama Street · El Nido, Palawan",
      date: "2026-11-08",
      billNumber: "ALT-55821",
      currency: "PHP",
      items: altroveItems,
      subtotalCents: altroveSub,
      serviceChargeCents: altroveService,
      vatCents: altroveVat,
      totalCents: altroveTotal,
      groupCurrency: "SGD",
      rate: r,
      summary: [
        { label: "Subtotal (PHP)", cents: altroveSub },
        { label: "Service Charge (10%)", cents: altroveService },
        { label: "VAT 12% (included)", cents: altroveVat },
      ],
    }),
    extraction: {
      is_bill: true,
      merchant_name: "Trattoria Altrove El Nido",
      merchant_country: "PH",
      merchant_whatsapp: null,
      bill_type: "restaurant",
      bill_number: "ALT-55821",
      bill_date: "2026-11-08",
      due_date: null,
      period_start: null,
      period_end: null,
      currency: "PHP",
      tax_mode: "included",
      printed_subtotal: altroveSub / 100,
      printed_tax_total: altroveVat / 100,
      printed_tax_rate_pct: 12,
      printed_total: altroveTotal / 100,
      lines: [
        lineOf(altroveItems[0], "Four-cheese pizza"),
        lineOf(altroveItems[1], "Spicy salami pizza"),
        lineOf(altroveItems[2], "Seafood pasta"),
        lineOf(altroveItems[3], "Tomato & mozzarella pizza"),
        lineOf(altroveItems[4], "Dessert"),
        lineOf(altroveItems[5], "Beer"),
        lineOf(altroveItems[6], "Fruit shake"),
        { description: "Service Charge 10%", plain_words: "Service charge", qty: null, unit_price: null, amount: altroveService / 100, kind: "service_charge", tax_rate_pct: null, box_2d: null },
        { description: "VAT 12% (included)", plain_words: "VAT already in the prices", qty: null, unit_price: null, amount: altroveVat / 100, kind: "tax", tax_rate_pct: 12, box_2d: null },
      ],
    },
  },
  {
    key: "coronBoat",
    dataUrl: buildMockReceiptSvg({
      merchant: "BUSUANGA BAY ISLAND TOURS",
      subtitle: "Coron Town Pier · Coron, Palawan",
      date: "2026-11-12",
      billNumber: "BBT-2611-07",
      currency: "PHP",
      items: coronItems,
      subtotalCents: coronTotal,
      serviceChargeCents: 0,
      vatCents: 0,
      totalCents: coronTotal,
      groupCurrency: "SGD",
      rate: r,
      summary: [
        { label: "Boat, fees & lunch (PHP)", cents: coronTotal },
        { label: "Non-VAT registered operator", cents: 0 },
        { label: "Paid by card, no surcharge", cents: 0 },
      ],
    }),
    extraction: {
      is_bill: true,
      merchant_name: "Busuanga Bay Island Tours",
      merchant_country: "PH",
      merchant_whatsapp: null,
      bill_type: "other",
      bill_number: "BBT-2611-07",
      bill_date: "2026-11-12",
      due_date: null,
      period_start: null,
      period_end: null,
      currency: "PHP",
      tax_mode: "none",
      printed_subtotal: coronTotal / 100,
      printed_tax_total: null,
      printed_tax_rate_pct: null,
      printed_total: coronTotal / 100,
      lines: [
        { ...lineOf(coronItems[0], "Private boat for the day"), tax_rate_pct: null },
        { ...lineOf(coronItems[1], "Lake entrance fee"), tax_rate_pct: null },
        { ...lineOf(coronItems[2], "Lagoon entrance fee"), tax_rate_pct: null },
        { ...lineOf(coronItems[3], "Lake entrance fee"), tax_rate_pct: null },
        { ...lineOf(coronItems[4], "Beach entrance fee"), tax_rate_pct: null },
        { ...lineOf(coronItems[5], "Lunch on the boat"), tax_rate_pct: null },
        { ...lineOf(coronItems[6], "Snorkel gear rental"), tax_rate_pct: null },
      ],
    },
  },
];

// ---- bar rounds (Day 4) ----

/** Three rounds at Pukka Bar, El Nido, for the five who drink. Amounts are in SGD (rounds are always in the group's currency). */
export const PALAWAN_ROUNDS = {
  place: "Pukka Bar El Nido",
  date: "2026-11-09",
  amounts: [convert(120000, r), convert(132000, r), convert(108000, r)], // ₱1,200, ₱1,320, ₱1,080
};

// ---- the expenses ----

const php = (pesoCents: number) => ({ amount: convert(pesoCents, r), original: { currency: "PHP" as const, amount: pesoCents, rate: r } });

/**
 * Builds the Palawan trip's 22 expenses and 2 PayNow settlements for six members, day by day.
 * Uses every split method (equal, exact, percent, shares, itemized), split payers, SGD-only
 * bookings, and PHP spending converted at `PALAWAN_RATE_PHP_TO_SGD`.
 */
export function buildPalawanDemoEntries(ids: PalawanMemberIds): DemoEntrySpec[] {
  const all6 = [ids.you, ids.marcus, ids.weiLing, ids.arjun, ids.sofia, ids.daniel];
  const drinkers = [ids.you, ids.marcus, ids.weiLing, ids.arjun, ids.daniel];
  const notArjun = [ids.you, ids.marcus, ids.weiLing, ids.sofia, ids.daniel];
  const withSnorkelRental = [ids.you, ids.marcus, ids.weiLing, ids.sofia];

  const tricycles = php(45000);
  const kalui = php(486000);
  const van = php(780000);
  const etdf = php(240000);
  const tourA = php(840000);
  const tourC = php(800000);
  const supplies = php(325000);
  const lasCabanas = php(570000);
  const ferry = php(1170000);
  const tapyas = php(180000);
  const kawayanan = php(624000);
  const shuttle = php(180000);
  const pasalubong = php(260000);
  const kinabuch = php(kinabuchTotal);
  const altrove = php(altroveTotal);
  const coron = php(coronTotal);

  // Las Cabañas: zipline ₱800 for Marcus, Arjun and Daniel; ₱600 of cocktails each for the drinkers; Sofia's ₱300 mocktail.
  const cab = (pesoCents: number) => convert(pesoCents, r);

  return [
    // ── Day 1 · Fri 6 Nov · Singapore → Puerto Princesa ──
    {
      kind: "expense",
      description: "Cebu Pacific return flights SIN ⇄ Palawan (6 pax)",
      category: "travel",
      date: "2026-11-06",
      amount: 246000,
      paid: { [ids.you]: 246000 },
      split: { method: "equal", members: all6 },
      notes:
        "Booked 14 Sep, S$410 pp incl. 7kg cabin bag. Out (Fri 6 Nov): 5J 812 SIN 08:05 → MNL 11:45, then 5J 637 MNL 14:20 → PPS 15:35. Back (Fri 13 Nov): 5J 324 USU 12:10 → MNL 13:20, then 5J 805 MNL 16:45 → SIN 20:20. Booking ref K7Q2LM.",
      original: null,
    },
    {
      kind: "expense",
      description: "Extra 20kg checked bags (Wei Ling, Sofia, Daniel)",
      category: "travel",
      date: "2026-11-06",
      amount: 11400,
      paid: { [ids.you]: 11400 },
      split: { method: "exact", members: [ids.weiLing, ids.sofia, ids.daniel], values: { [ids.weiLing]: 3800, [ids.sofia]: 3800, [ids.daniel]: 3800 } },
      notes: "Added on the same booking, S$38 each return. Everyone else went cabin-only.",
      original: null,
    },
    {
      kind: "expense",
      description: "Canvas Boutique Hotel Puerto Princesa (3 rooms, 2 nights)",
      category: "travel",
      date: "2026-11-06",
      amount: 49800,
      paid: { [ids.marcus]: 49800 },
      split: { method: "equal", members: all6 },
      notes:
        "Agoda, prepaid in SGD. Check-in Fri 6 Nov 14:00, check-out Sun 8 Nov 06:15 (early van). 3 twin rooms: You + Marcus, Arjun + Daniel, Wei Ling + Sofia. Breakfast included.",
      original: null,
    },
    {
      kind: "expense",
      description: "Tricycles: PPS airport → Canvas Hotel",
      category: "transport",
      date: "2026-11-06",
      ...tricycles,
      paid: { [ids.daniel]: tricycles.amount },
      split: { method: "equal", members: all6 },
      notes: "3 tricycles at ₱150 each, cash.",
    },
    {
      kind: "expense",
      description: "Kinabuch's Grill & Bar",
      category: "food",
      date: "2026-11-06",
      ...kinabuch,
      paid: { [ids.arjun]: kinabuch.amount },
      split: buildItemizedSplit(all6, [ids.sofia], kinabuch.amount, [
        { lineIndex: 0, description: "Crocodile Sisig", qty: 1, centsThb: 42000, isDrink: false, claimants: all6 },
        { lineIndex: 1, description: "Tamilok Kinilaw", qty: 1, centsThb: 28000, isDrink: false, claimants: [ids.you, ids.marcus, ids.arjun, ids.daniel] },
        { lineIndex: 2, description: "Grilled Tuna Belly", qty: 1, centsThb: 56000, isDrink: false, claimants: all6 },
        { lineIndex: 3, description: "Chicken Inasal", qty: 2, centsThb: 46000, isDrink: false, claimants: all6 },
        { lineIndex: 4, description: "Garlic Rice", qty: 6, centsThb: 36000, isDrink: false, claimants: all6 },
        { lineIndex: 5, description: "Red Horse Beer (500ml)", qty: 8, centsThb: 72000, isDrink: true, claimants: drinkers },
        { lineIndex: 6, description: "Fresh Calamansi Juice", qty: 1, centsThb: 8500, isDrink: false, claimants: [ids.sofia] },
      ]),
      notes: "Only four were brave enough for the tamilok. Sofia's off the beers; 10% service shared in proportion. VAT is inside the prices.",
      receiptKey: "kinabuch",
    },

    // ── Day 2 · Sat 7 Nov · Underground River ──
    {
      kind: "expense",
      description: "Puerto Princesa Underground River day tour (6 pax)",
      category: "fun",
      date: "2026-11-07",
      ...php(1320000),
      paid: { [ids.weiLing]: convert(1320000, r) },
      split: { method: "equal", members: all6 },
      notes: "₱2,200 pp: 07:00 hotel pick-up, Sabang wharf boat, permit, environmental fee, audio guide and buffet lunch.",
    },
    {
      kind: "expense",
      description: "Ka Lui Restaurant dinner",
      category: "food",
      date: "2026-11-07",
      ...kalui,
      paid: { [ids.sofia]: kalui.amount },
      split: { method: "equal", members: all6 },
      notes: "Barefoot seafood set for six, 19:00 booking. Includes ₱300 tip.",
    },

    // ── Day 3 · Sun 8 Nov · Puerto Princesa → El Nido ──
    {
      kind: "expense",
      description: "Private van Puerto Princesa → El Nido",
      category: "transport",
      date: "2026-11-08",
      ...van,
      paid: { [ids.daniel]: van.amount },
      split: { method: "equal", members: all6 },
      notes: "06:30 pick-up at Canvas, about 5.5h with a stop in Roxas. Driver Jun dropped us at the door.",
    },
    {
      kind: "expense",
      description: "El Nido Eco-Tourism Development Fee (ETDF)",
      category: "travel",
      date: "2026-11-08",
      ...etdf,
      paid: { [ids.marcus]: etdf.amount },
      split: { method: "equal", members: all6 },
      notes: "₱400 pp, valid 10 days. Keep the ticket: every island tour checks it.",
    },
    {
      kind: "expense",
      description: "Lally & Abet Beach Cottages El Nido (3 rooms, 3 nights)",
      category: "travel",
      date: "2026-11-08",
      amount: 84600,
      paid: { [ids.weiLing]: 84600 },
      split: {
        method: "shares",
        members: all6,
        values: { [ids.you]: 2, [ids.marcus]: 2, [ids.weiLing]: 2, [ids.sofia]: 2, [ids.arjun]: 3, [ids.daniel]: 3 },
      },
      notes: "Booking.com, paid in SGD. Check-in Sun 8 Nov 14:00, check-out Wed 11 Nov 05:15. Arjun + Daniel took the sea-view room, so 3 shares each vs 2.",
      original: null,
    },
    {
      kind: "expense",
      description: "Trattoria Altrove",
      category: "food",
      date: "2026-11-08",
      ...altrove,
      paid: { [ids.you]: altrove.amount },
      split: buildItemizedSplit(all6, [ids.sofia], altrove.amount, [
        { lineIndex: 0, description: "Quattro Formaggi Pizza", qty: 1, centsThb: 52000, isDrink: false, claimants: all6 },
        { lineIndex: 1, description: "Diavola Pizza", qty: 1, centsThb: 49000, isDrink: false, claimants: [ids.you, ids.marcus, ids.arjun, ids.daniel] },
        { lineIndex: 2, description: "Seafood Linguine", qty: 1, centsThb: 48000, isDrink: false, claimants: [ids.weiLing, ids.sofia] },
        { lineIndex: 3, description: "Margherita Pizza", qty: 1, centsThb: 39000, isDrink: false, claimants: all6 },
        { lineIndex: 4, description: "Tiramisu", qty: 2, centsThb: 36000, isDrink: false, claimants: all6 },
        { lineIndex: 5, description: "San Miguel Pale Pilsen", qty: 6, centsThb: 54000, isDrink: true, claimants: drinkers },
        { lineIndex: 6, description: "Mango Shake", qty: 1, centsThb: 15000, isDrink: false, claimants: [ids.sofia] },
      ]),
      notes: "45-minute queue, worth it. Wei Ling and Sofia shared the linguine.",
      receiptKey: "altrove",
    },

    // ── Day 4 · Mon 9 Nov · Tour A (rounds at Pukka Bar are added by the seeder) ──
    {
      kind: "expense",
      description: "El Nido Tour A: Big & Small Lagoon, Secret Lagoon, Shimizu, 7 Commando",
      category: "fun",
      date: "2026-11-09",
      ...tourA,
      paid: { [ids.marcus]: tourA.amount },
      split: { method: "equal", members: all6 },
      notes: "₱1,400 pp incl. lunch on the beach. Boat left Corong-Corong at 09:00. Small Lagoon kayaks included.",
    },

    // ── Day 5 · Tue 10 Nov · Tour C, Las Cabañas ──
    {
      kind: "expense",
      description: "El Nido Tour C: Hidden Beach, Matinloc Shrine, Helicopter Island",
      category: "fun",
      date: "2026-11-10",
      ...tourC,
      paid: { [ids.sofia]: tourC.amount },
      split: { method: "equal", members: notArjun },
      notes: "₱1,600 pp for five. Arjun skipped it for two dives with a local dive shop (paid himself, not in the group).",
    },
    {
      kind: "expense",
      description: "Puregold & 7-Eleven supplies (water, sunscreen, snacks)",
      category: "groceries",
      date: "2026-11-10",
      ...supplies,
      paid: { [ids.daniel]: supplies.amount },
      split: {
        method: "percent",
        members: all6,
        values: { [ids.you]: 15, [ids.marcus]: 15, [ids.weiLing]: 20, [ids.arjun]: 15, [ids.sofia]: 20, [ids.daniel]: 15 },
      },
      notes: "Wei Ling and Sofia took the reef-safe sunscreen and two dry bags, so 20% each.",
    },
    {
      kind: "expense",
      description: "Las Cabañas sunset: zipline & cocktails",
      category: "fun",
      date: "2026-11-10",
      ...lasCabanas,
      paid: { [ids.you]: lasCabanas.amount },
      split: {
        method: "exact",
        members: all6,
        values: {
          [ids.marcus]: cab(140000),
          [ids.arjun]: cab(140000),
          [ids.daniel]: cab(140000),
          [ids.you]: cab(60000),
          [ids.weiLing]: cab(60000),
          [ids.sofia]: cab(30000),
        },
      },
      notes: "Zipline ₱800 for Marcus, Arjun and Daniel. Cocktails ₱600 each; Sofia had a ₱300 mocktail.",
    },

    // ── Day 6 · Wed 11 Nov · El Nido → Coron ──
    {
      kind: "expense",
      description: "Montenegro Lines fast craft El Nido → Coron",
      category: "transport",
      date: "2026-11-11",
      ...ferry,
      paid: { [ids.arjun]: ferry.amount },
      split: { method: "equal", members: all6 },
      notes: "₱1,950 pp incl. terminal fee. 06:00 departure, about 4h. Bought at the port office on Monday.",
    },
    {
      kind: "expense",
      description: "Two Seasons Coron Bayside Hotel (3 rooms, 2 nights)",
      category: "travel",
      date: "2026-11-11",
      amount: 61200,
      paid: { [ids.arjun]: 40800, [ids.daniel]: 20400 },
      split: { method: "equal", members: all6 },
      notes: "Paid at the front desk in SGD. Check-in Wed 11 Nov (early, at 11:00), check-out Fri 13 Nov 10:00. Arjun's card hit its limit, so Daniel paid for one room.",
      original: null,
    },
    {
      kind: "expense",
      description: "Mt Tapyas hike & Maquinit Hot Spring",
      category: "fun",
      date: "2026-11-11",
      ...tapyas,
      paid: { [ids.weiLing]: tapyas.amount },
      split: { method: "equal", members: all6 },
      notes: "Hot spring entry ₱200 pp plus tricycles. Sunset from the top of the 700 steps.",
    },

    // ── Day 7 · Thu 12 Nov · Coron island hopping, farewell dinner ──
    {
      kind: "expense",
      description: "Coron private boat: Kayangan, Twin Lagoon, Barracuda, CYC",
      category: "fun",
      date: "2026-11-12",
      ...coron,
      paid: { [ids.you]: coron.amount },
      split: buildItemizedSplit(all6, [], coron.amount, [
        { lineIndex: 0, description: "Private Boat Hire (Ultimate Tour)", qty: 1, centsThb: 850000, isDrink: false, claimants: all6 },
        { lineIndex: 1, description: "Kayangan Lake Entrance", qty: 6, centsThb: 240000, isDrink: false, claimants: all6 },
        { lineIndex: 2, description: "Twin Lagoon Entrance", qty: 6, centsThb: 180000, isDrink: false, claimants: all6 },
        { lineIndex: 3, description: "Barracuda Lake Entrance", qty: 6, centsThb: 120000, isDrink: false, claimants: all6 },
        { lineIndex: 4, description: "CYC Beach Entrance", qty: 6, centsThb: 90000, isDrink: false, claimants: all6 },
        { lineIndex: 5, description: "Boat Lunch (Grilled Fish, Adobo)", qty: 6, centsThb: 210000, isDrink: false, claimants: all6 },
        { lineIndex: 6, description: "Snorkel & Fins Rental", qty: 4, centsThb: 60000, isDrink: false, claimants: withSnorkelRental },
      ]),
      notes: "Our own boat, 08:00 to 16:30. Arjun and Daniel brought their own snorkel gear, so they skip that line.",
      receiptKey: "coronBoat",
    },
    {
      kind: "expense",
      description: "Kawayanan Grill farewell dinner",
      category: "food",
      date: "2026-11-12",
      ...kawayanan,
      paid: { [ids.marcus]: kawayanan.amount },
      split: { method: "equal", members: all6 },
      notes: "Last night: grilled seafood platter, kare-kare and a cake for Daniel's birthday.",
    },

    // ── Day 8 · Fri 13 Nov · Coron → Singapore ──
    {
      kind: "expense",
      description: "Shuttle van Coron Town → Busuanga Airport (USU)",
      category: "transport",
      date: "2026-11-13",
      ...shuttle,
      paid: { [ids.daniel]: shuttle.amount },
      split: { method: "equal", members: all6 },
      notes: "₱300 pp, 09:30 pick-up at the hotel for the 12:10 flight.",
    },
    {
      kind: "expense",
      description: "Pasalubong: cashews & dried mangoes",
      category: "shopping",
      date: "2026-11-13",
      ...pasalubong,
      paid: { [ids.sofia]: pasalubong.amount },
      split: {
        method: "shares",
        members: all6,
        values: { [ids.you]: 1, [ids.marcus]: 1, [ids.weiLing]: 2, [ids.arjun]: 1, [ids.sofia]: 2, [ids.daniel]: 1 },
      },
      notes: "Bought at the shop by the town market. Wei Ling and Sofia took double for their offices.",
    },

    // ── Back home: settling up ──
    {
      kind: "payment",
      from: ids.sofia,
      to: ids.you,
      amount: 30000,
      date: "2026-11-14",
      notes: "PayNow, first part of what Sofia owes for the flights.",
    },
    {
      kind: "payment",
      from: ids.marcus,
      to: ids.weiLing,
      amount: 3866,
      date: "2026-11-14",
      notes: "PayNow, squaring up with Wei Ling before the final tally.",
    },
  ];
}
