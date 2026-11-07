import type { Extraction } from "@tallyback/lib/types";
import type { Category } from "./types";

// "Split this bill": a checked bill becomes a pre-filled expense in a group. Pure, so it's easy to test.

export interface BillDraft {
  description: string;
  amount: number | null; // cents; null when the bill printed no total
  date: string | null; // YYYY-MM-DD
  category: Category;
  currency: string | null; // the bill's, to warn when the group uses another
  notes: string;
}

// A best guess from what the bill says it is; the person can change it in the form.
const GUESSES: [RegExp, Category][] = [
  [/grocer|supermarket|mart|fairprice|cold storage|giant|sheng siong/i, "groceries"],
  [/restaurant|cafe|café|coffee|food|bar|bistro|hawker|kitchen|dining|pizza|burger/i, "food"],
  [/electric|water|gas|utilit|internet|broadband|mobile|telco|phone/i, "utilities"],
  [/rent|lease|landlord/i, "rent"],
  [/taxi|grab|uber|gojek|transport|fuel|petrol|parking|train|bus/i, "transport"],
  [/hotel|hostel|airbnb|flight|airline|travel/i, "travel"],
  [/cinema|movie|ticket|concert|museum|theme park/i, "fun"],
];

export function billToDraft(ex: Extraction): BillDraft {
  const text = `${ex.bill_type ?? ""} ${ex.merchant_name ?? ""}`;
  const total = ex.printed_total;
  return {
    description: (ex.merchant_name ?? "").trim().slice(0, 120) || "Bill",
    amount: total != null && total > 0 ? Math.round(total * 100) : null,
    date: ex.bill_date && /^\d{4}-\d{2}-\d{2}$/.test(ex.bill_date) ? ex.bill_date : null,
    category: GUESSES.find(([re]) => re.test(text))?.[1] ?? "general",
    currency: ex.currency,
    notes: ex.bill_number ? `Bill ${ex.bill_number}` : "",
  };
}
