import type { Extraction } from "@tallyback/lib/types";
import { convert } from "./money";
import { allocate, allocateItemized, type Split } from "./split";
import type { Trip } from "./trip";
import type { Category } from "./types";

export const DEMO_GROUP_NAME = "Bangkok Long Weekend 🇹🇭";
export const DEMO_RATE_THB_TO_SGD = 0.0385;

export const DEMO_TRIP: Trip = {
  destination: "Bangkok",
  start: "2026-11-12",
  end: "2026-11-15",
  currency: "THB",
};

export interface MockReceiptSpec {
  merchant: string;
  subtitle: string;
  date: string;
  billNumber: string;
  currency: "THB";
  items: { label: string; qty: number; amountCents: number; isDrink?: boolean }[];
  subtotalCents: number;
  serviceChargeCents: number;
  vatCents: number;
  totalCents: number;
  groupCurrency: "SGD";
  rate: number;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function thb(cents: number): string {
  return (cents / 100).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Generates a crisp thermal-receipt SVG encoded as a base64 `data:image/svg+xml` URI
 * so demo expenses display real receipts inside `ReceiptViewer` without external Blob or AI calls.
 */
export function buildMockReceiptSvg(spec: MockReceiptSpec): string {
  const convertedSgd = (convert(spec.totalCents, spec.rate) / 100).toFixed(2);
  const rowHeight = 26;
  const itemsStartY = 148;
  const summaryStartY = itemsStartY + spec.items.length * rowHeight + 22;
  const height = summaryStartY + 180;

  const itemRows = spec.items
    .map((item, idx) => {
      const y = itemsStartY + idx * rowHeight;
      const prefix = item.qty > 1 ? `${item.qty}x ` : "";
      const drinkTag = item.isDrink ? " [Drink]" : "";
      const label = escapeXml(`${prefix}${item.label}${drinkTag}`.slice(0, 34));
      return `<text x="28" y="${y}" font-size="13" fill="#1c1b19">${label}</text><text x="392" y="${y}" font-size="13" text-anchor="end" fill="#1c1b19">${thb(item.amountCents)}</text>`;
    })
    .join("");

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="${height}" viewBox="0 0 420 ${height}">`,
    `<rect width="420" height="${height}" fill="#e9e4d9"/>`,
    `<rect x="16" y="16" width="388" height="${height - 32}" rx="12" fill="#fcfaf5" stroke="#d8d1c2" stroke-width="1.5"/>`,
    `<text x="210" y="54" font-family="ui-monospace, Menlo, monospace" font-size="18" font-weight="700" text-anchor="middle" fill="#1c1b19">${escapeXml(spec.merchant)}</text>`,
    `<text x="210" y="74" font-family="ui-monospace, Menlo, monospace" font-size="11" text-anchor="middle" fill="#6b675f">${escapeXml(spec.subtitle)}</text>`,
    `<text x="28" y="102" font-family="ui-monospace, Menlo, monospace" font-size="11" fill="#6b675f">DATE: ${escapeXml(spec.date)}</text>`,
    `<text x="392" y="102" font-family="ui-monospace, Menlo, monospace" font-size="11" text-anchor="end" fill="#6b675f">BILL #${escapeXml(spec.billNumber)}</text>`,
    `<line x1="28" y1="116" x2="392" y2="116" stroke="#d8d1c2" stroke-dasharray="4 4"/>`,
    `<g font-family="ui-monospace, Menlo, monospace">${itemRows}</g>`,
    `<line x1="28" y1="${summaryStartY - 8}" x2="392" y2="${summaryStartY - 8}" stroke="#d8d1c2" stroke-dasharray="4 4"/>`,
    `<g font-family="ui-monospace, Menlo, monospace" font-size="13" fill="#4f4b44">`,
    `<text x="28" y="${summaryStartY + 14}">Subtotal (THB)</text><text x="392" y="${summaryStartY + 14}" text-anchor="end">฿${thb(spec.subtotalCents)}</text>`,
    `<text x="28" y="${summaryStartY + 38}">Service Charge (10%)</text><text x="392" y="${summaryStartY + 38}" text-anchor="end">฿${thb(spec.serviceChargeCents)}</text>`,
    `<text x="28" y="${summaryStartY + 62}">VAT (7%)</text><text x="392" y="${summaryStartY + 62}" text-anchor="end">฿${thb(spec.vatCents)}</text>`,
    `</g>`,
    `<line x1="28" y1="${summaryStartY + 76}" x2="392" y2="${summaryStartY + 76}" stroke="#1c1b19" stroke-width="1.5"/>`,
    `<text x="28" y="${summaryStartY + 102}" font-family="ui-monospace, Menlo, monospace" font-size="16" font-weight="700" fill="#1c1b19">TOTAL THB</text>`,
    `<text x="392" y="${summaryStartY + 102}" font-family="ui-monospace, Menlo, monospace" font-size="16" font-weight="700" text-anchor="end" fill="#1c1b19">฿${thb(spec.totalCents)}</text>`,
    `<rect x="28" y="${summaryStartY + 118}" width="364" height="34" rx="6" fill="#eef6f0"/>`,
    `<text x="210" y="${summaryStartY + 139}" font-family="ui-monospace, Menlo, monospace" font-size="11" font-weight="600" text-anchor="middle" fill="#15803d">1 THB = ${spec.rate} SGD · Converted S$${convertedSgd}</text>`,
    `</svg>`,
  ].join("");

  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

export interface DemoBillSeed {
  key: "somboon" | "spa" | "octave";
  extraction: Extraction;
  dataUrl: string;
}

export const DEMO_RECEIPTS: DemoBillSeed[] = [
  {
    key: "somboon",
    dataUrl: buildMockReceiptSvg({
      merchant: "SOMBOON SEAFOOD",
      subtitle: "Bantadthong Road · Bangkok",
      date: "2026-11-12",
      billNumber: "BKK-4820",
      currency: "THB",
      items: [
        { label: "Signature Curry Crab (L)", qty: 1, amountCents: 140000 },
        { label: "Tom Yum Goong Hotpot", qty: 1, amountCents: 65000 },
        { label: "Stir-Fried Garlic Prawns", qty: 1, amountCents: 85000 },
        { label: "Morning Glory Sambal", qty: 1, amountCents: 32000 },
        { label: "Mango Sticky Rice", qty: 2, amountCents: 48000 },
        { label: "Chang Draft Beer Tower", qty: 1, amountCents: 39000, isDrink: true },
      ],
      subtotalCents: 409000,
      serviceChargeCents: 40900,
      vatCents: 32135,
      totalCents: 482035,
      groupCurrency: "SGD",
      rate: DEMO_RATE_THB_TO_SGD,
    }),
    extraction: {
      is_bill: true,
      merchant_name: "Somboon Seafood Bantadthong",
      merchant_country: "TH",
      merchant_whatsapp: null,
      bill_type: "restaurant",
      bill_number: "BKK-4820",
      bill_date: "2026-11-12",
      due_date: null,
      period_start: null,
      period_end: null,
      currency: "THB",
      tax_mode: "added",
      printed_subtotal: 4090.0,
      printed_tax_total: 321.35,
      printed_tax_rate_pct: 7,
      printed_total: 4820.35,
      lines: [
        { description: "Signature Curry Crab (L)", plain_words: "Crab curry", qty: 1, unit_price: 1400, amount: 1400, kind: "item", tax_rate_pct: 7, box_2d: null },
        { description: "Tom Yum Goong Hotpot", plain_words: "Prawn soup", qty: 1, unit_price: 650, amount: 650, kind: "item", tax_rate_pct: 7, box_2d: null },
        { description: "Stir-Fried Garlic Prawns", plain_words: "Garlic prawns", qty: 1, unit_price: 850, amount: 850, kind: "item", tax_rate_pct: 7, box_2d: null },
        { description: "Morning Glory Sambal", plain_words: "Vegetables", qty: 1, unit_price: 320, amount: 320, kind: "item", tax_rate_pct: 7, box_2d: null },
        { description: "Mango Sticky Rice", plain_words: "Dessert", qty: 2, unit_price: 240, amount: 480, kind: "item", tax_rate_pct: 7, box_2d: null },
        { description: "Chang Draft Beer Tower", plain_words: "Beer tower", qty: 1, unit_price: 390, amount: 390, kind: "item", tax_rate_pct: 7, box_2d: null },
        { description: "Service Charge 10%", plain_words: "Service charge", qty: null, unit_price: null, amount: 409, kind: "service_charge", tax_rate_pct: null, box_2d: null },
        { description: "VAT 7%", plain_words: "VAT", qty: null, unit_price: null, amount: 321.35, kind: "tax", tax_rate_pct: 7, box_2d: null },
      ],
    },
  },
  {
    key: "spa",
    dataUrl: buildMockReceiptSvg({
      merchant: "LET'S RELAX SPA",
      subtitle: "Thonglor Branch · Sukhumvit 55",
      date: "2026-11-13",
      billNumber: "LRS-6200",
      currency: "THB",
      items: [
        { label: "Thai Massage + Herbal (90m)", qty: 2, amountCents: 260000 },
        { label: "Aromatherapy Oil (60m)", qty: 2, amountCents: 240000 },
        { label: "Foot Reflexology (60m)", qty: 1, amountCents: 60000 },
        { label: "Therapist Gratuity Pool", qty: 5, amountCents: 60000 },
      ],
      subtotalCents: 620000,
      serviceChargeCents: 0,
      vatCents: 0,
      totalCents: 620000,
      groupCurrency: "SGD",
      rate: DEMO_RATE_THB_TO_SGD,
    }),
    extraction: {
      is_bill: true,
      merchant_name: "Let's Relax Spa Thonglor",
      merchant_country: "TH",
      merchant_whatsapp: null,
      bill_type: "other",
      bill_number: "LRS-6200",
      bill_date: "2026-11-13",
      due_date: null,
      period_start: null,
      period_end: null,
      currency: "THB",
      tax_mode: "included",
      printed_subtotal: 6200,
      printed_tax_total: null,
      printed_tax_rate_pct: 7,
      printed_total: 6200,
      lines: [
        { description: "Thai Massage + Herbal (You & Liam)", plain_words: "Thai massage", qty: 2, unit_price: 1300, amount: 2600, kind: "item", tax_rate_pct: null, box_2d: null },
        { description: "Aromatherapy Oil (Aisha & Priya)", plain_words: "Oil massage", qty: 2, unit_price: 1200, amount: 2400, kind: "item", tax_rate_pct: null, box_2d: null },
        { description: "Foot Reflexology (Kenji)", plain_words: "Foot massage", qty: 1, unit_price: 600, amount: 600, kind: "item", tax_rate_pct: null, box_2d: null },
        { description: "Therapist Tips (Shared)", plain_words: "Tips", qty: 5, unit_price: 120, amount: 600, kind: "service_charge", tax_rate_pct: null, box_2d: null },
      ],
    },
  },
  {
    key: "octave",
    dataUrl: buildMockReceiptSvg({
      merchant: "OCTAVE ROOFTOP BAR",
      subtitle: "Marriott Sukhumvit · Floor 45",
      date: "2026-11-14",
      billNumber: "OCT-5350",
      currency: "THB",
      items: [
        { label: "Bangkok Sunset Cocktails", qty: 4, amountCents: 192000, isDrink: true },
        { label: "Lychee Rose Zero-Proof Mocktail", qty: 1, amountCents: 32000 },
        { label: "Wagyu Sliders & Truffle Fries", qty: 1, amountCents: 230555 },
      ],
      subtotalCents: 454555,
      serviceChargeCents: 45456,
      vatCents: 34989,
      totalCents: 535000,
      groupCurrency: "SGD",
      rate: DEMO_RATE_THB_TO_SGD,
    }),
    extraction: {
      is_bill: true,
      merchant_name: "Octave Rooftop Lounge & Bar",
      merchant_country: "TH",
      merchant_whatsapp: null,
      bill_type: "restaurant",
      bill_number: "OCT-5350",
      bill_date: "2026-11-14",
      due_date: null,
      period_start: null,
      period_end: null,
      currency: "THB",
      tax_mode: "added",
      printed_subtotal: 4545.55,
      printed_tax_total: 349.89,
      printed_tax_rate_pct: 7,
      printed_total: 5350.0,
      lines: [
        { description: "Bangkok Sunset Cocktails", plain_words: "Cocktails", qty: 4, unit_price: 480, amount: 1920, kind: "item", tax_rate_pct: 7, box_2d: null },
        { description: "Lychee Rose Zero-Proof Mocktail", plain_words: "Mocktail", qty: 1, unit_price: 320, amount: 320, kind: "item", tax_rate_pct: 7, box_2d: null },
        { description: "Wagyu Sliders & Truffle Fries", plain_words: "Bar food", qty: 1, unit_price: 2305.55, amount: 2305.55, kind: "item", tax_rate_pct: 7, box_2d: null },
        { description: "Service Charge 10%", plain_words: "Service charge", qty: null, unit_price: null, amount: 454.56, kind: "service_charge", tax_rate_pct: null, box_2d: null },
        { description: "VAT 7%", plain_words: "VAT", qty: null, unit_price: null, amount: 349.89, kind: "tax", tax_rate_pct: 7, box_2d: null },
      ],
    },
  },
];

export interface DemoMemberIds {
  you: string;
  aisha: string;
  liam: string;
  priya: string;
  kenji: string;
}

export type DemoEntrySpec =
  | {
      kind: "expense";
      description: string;
      category: Category;
      date: string;
      amount: number;
      paid: Record<string, number>;
      split: Split;
      notes: string;
      receiptKey?: "somboon" | "spa" | "octave";
      original: { currency: "THB"; amount: number; rate: number } | null;
    }
  | {
      kind: "payment";
      from: string;
      to: string;
      amount: number;
      date: string;
      notes: string;
    };

function buildItemizedSplit(
  memberIds: string[],
  nonDrinkers: string[],
  totalGroupCents: number,
  lines: {
    lineIndex: number;
    description: string;
    qty: number;
    centsThb: number;
    isDrink: boolean;
    claimants: string[];
  }[],
): Split {
  const native = allocateItemized(
    lines.reduce((s, l) => s + l.centsThb, 0) + Math.max(0, totalGroupCents), // total ratio only weights items
    lines.map((l) => ({ amountCents: l.centsThb, members: l.claimants })),
    memberIds,
  );
  // Compute exact group-currency allocation using the member pre-tax item subtotals (matching EntryForms.tsx)
  const weights = memberIds.map((id) => (native.ok ? native.itemSubtotals[id] ?? 0 : 1));
  const parts = allocate(totalGroupCents, weights);
  const values = Object.fromEntries(memberIds.map((id, i) => [id, parts[i]]));
  return {
    method: "itemized",
    members: memberIds,
    values,
    itemized: {
      useVerifiedTotal: true,
      nonDrinkers,
      items: lines.map((l) => ({
        lineIndex: l.lineIndex,
        description: l.description,
        qty: l.qty,
        printedCents: l.centsThb,
        verifiedCents: l.centsThb,
        isDrink: l.isDrink,
        members: l.claimants,
      })),
    },
  };
}

/**
 * Builds the 8 deterministic demo entries (7 expenses across 4 days + 1 partial settlement)
 * for a 5-member group (`You`, `Aisha`, `Liam`, `Priya`, `Kenji`), exercising `SGD ↔ THB` FX
 * (`1 THB = 0.0385 SGD`) and all 5 split methods (`shares`, `equal`, `percent`, `itemized`, `payment`).
 */
export function buildBangkokDemoEntries(ids: DemoMemberIds): DemoEntrySpec[] {
  const all5 = [ids.you, ids.aisha, ids.liam, ids.priya, ids.kenji];
  const drinkers = [ids.you, ids.liam, ids.priya, ids.kenji];
  const r = DEMO_RATE_THB_TO_SGD;

  const vanSgd = convert(140000, r); // 5390
  const somboonSgd = convert(482035, r); // 18558
  const chatuchakSgd = convert(165000, r); // 6353
  const spaSgd = convert(620000, r); // 23870
  const octaveSgd = convert(535000, r); // 20598
  const bigCSgd = convert(240000, r); // 9240

  return [
    {
      kind: "expense",
      description: "The Standard Mahanakhon Hotel (2 rooms, 3 nights)",
      category: "travel",
      date: "2026-11-12",
      amount: 120000,
      paid: { [ids.liam]: 120000 },
      split: {
        method: "shares",
        members: all5,
        values: { [ids.you]: 2, [ids.aisha]: 2, [ids.liam]: 2, [ids.priya]: 2, [ids.kenji]: 1 },
      },
      notes: "Paid upfront in SGD; Kenji arrived 1 night later (1 share vs 2 shares each).",
      original: null,
    },
    {
      kind: "expense",
      description: "Suvarnabhumi Airport SUV Van + Expressway Toll",
      category: "transport",
      date: "2026-11-12",
      amount: vanSgd,
      paid: { [ids.you]: vanSgd },
      split: { method: "equal", members: all5 },
      notes: "Klook private 6-seater pickup from BKK to Silom.",
      original: { currency: "THB", amount: 140000, rate: r },
    },
    {
      kind: "expense",
      description: "Somboon Seafood Bantadthong",
      category: "food",
      date: "2026-11-12",
      amount: somboonSgd,
      paid: { [ids.kenji]: somboonSgd },
      split: buildItemizedSplit(all5, [ids.aisha], somboonSgd, [
        { lineIndex: 0, description: "Signature Curry Crab (L)", qty: 1, centsThb: 140000, isDrink: false, claimants: all5 },
        { lineIndex: 1, description: "Tom Yum Goong Hotpot", qty: 1, centsThb: 65000, isDrink: false, claimants: all5 },
        { lineIndex: 2, description: "Stir-Fried Garlic Prawns", qty: 1, centsThb: 85000, isDrink: false, claimants: all5 },
        { lineIndex: 3, description: "Morning Glory Sambal", qty: 1, centsThb: 32000, isDrink: false, claimants: all5 },
        { lineIndex: 4, description: "Mango Sticky Rice", qty: 2, centsThb: 48000, isDrink: false, claimants: all5 },
        { lineIndex: 5, description: "Chang Draft Beer Tower", qty: 1, centsThb: 39000, isDrink: true, claimants: drinkers },
      ]),
      notes: "Aisha excluded from Chang beer tower; 10% service charge & 7% VAT split proportionally.",
      receiptKey: "somboon",
      original: { currency: "THB", amount: 482035, rate: r },
    },
    {
      kind: "expense",
      description: "Chatuchak Weekend Market & Coconut Ice Cream",
      category: "food",
      date: "2026-11-13",
      amount: chatuchakSgd,
      paid: { [ids.priya]: chatuchakSgd },
      split: { method: "equal", members: all5 },
      notes: "Shared street food stalls, iced Thai milk tea, and mango shakes.",
      original: { currency: "THB", amount: 165000, rate: r },
    },
    {
      kind: "expense",
      description: "Let's Relax Spa Thonglor (Massage & Herbal Compress)",
      category: "fun",
      date: "2026-11-13",
      amount: spaSgd,
      paid: { [ids.you]: 13870, [ids.priya]: 10000 },
      split: buildItemizedSplit(all5, [], spaSgd, [
        { lineIndex: 0, description: "Thai Massage + Herbal (90m) — You & Liam", qty: 2, centsThb: 260000, isDrink: false, claimants: [ids.you, ids.liam] },
        { lineIndex: 1, description: "Aromatherapy Oil Massage (60m) — Aisha & Priya", qty: 2, centsThb: 240000, isDrink: false, claimants: [ids.aisha, ids.priya] },
        { lineIndex: 2, description: "Foot Reflexology (60m) — Kenji", qty: 1, centsThb: 60000, isDrink: false, claimants: [ids.kenji] },
      ]),
      notes: "You & Priya split the card payment at checkout; each person pays their treatment tier.",
      receiptKey: "spa",
      original: { currency: "THB", amount: 620000, rate: r },
    },
    {
      kind: "expense",
      description: "Octave Rooftop Lounge & Bar (Marriott Sukhumvit)",
      category: "food",
      date: "2026-11-14",
      amount: octaveSgd,
      paid: { [ids.you]: octaveSgd },
      split: buildItemizedSplit(all5, [ids.aisha], octaveSgd, [
        { lineIndex: 0, description: "Bangkok Sunset Cocktails", qty: 4, centsThb: 192000, isDrink: true, claimants: drinkers },
        { lineIndex: 1, description: "Lychee Rose Zero-Proof Mocktail", qty: 1, centsThb: 32000, isDrink: false, claimants: [ids.aisha] },
        { lineIndex: 2, description: "Wagyu Sliders & Truffle Fries", qty: 1, centsThb: 230555, isDrink: false, claimants: all5 },
      ]),
      notes: "Cocktail round split among drinkers only; Aisha had the mocktail + bar bites.",
      receiptKey: "octave",
      original: { currency: "THB", amount: 535000, rate: r },
    },
    {
      kind: "expense",
      description: "Big C Supercenter Thai Snacks & Souvenir Run",
      category: "groceries",
      date: "2026-11-14",
      amount: bigCSgd,
      paid: { [ids.aisha]: bigCSgd },
      split: {
        method: "percent",
        members: all5,
        values: { [ids.you]: 25, [ids.aisha]: 25, [ids.liam]: 20, [ids.priya]: 15, [ids.kenji]: 15 },
      },
      notes: "Dried mango, Tao Kae Noi seaweed packs & Thai chili paste haul.",
      original: { currency: "THB", amount: 240000, rate: r },
    },
    {
      kind: "payment",
      from: ids.priya,
      to: ids.liam,
      amount: 15000,
      date: "2026-11-15",
      notes: "PayNow partial transfer towards Mahanakhon hotel room.",
    },
  ];
}
