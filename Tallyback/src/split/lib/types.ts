import type { Amounts, Split } from "./split";
import type { Transfer } from "./balances";
import type { Repeat } from "./repeat";

// What the API sends the page. Shared by both, so they can't drift apart.

export const GROUP_KINDS = [
  { id: "trip", label: "Trip", icon: "✈️" },
  { id: "home", label: "Home", icon: "🏠" },
  { id: "couple", label: "Couple", icon: "💞" },
  { id: "other", label: "Other", icon: "📁" },
] as const;
export type GroupKind = (typeof GROUP_KINDS)[number]["id"];

export const CATEGORIES = [
  { id: "general", label: "General", icon: "🧾" },
  { id: "food", label: "Food & drink", icon: "🍽️" },
  { id: "groceries", label: "Groceries", icon: "🛒" },
  { id: "rent", label: "Rent", icon: "🏠" },
  { id: "utilities", label: "Utilities", icon: "💡" },
  { id: "transport", label: "Transport", icon: "🚕" },
  { id: "travel", label: "Travel & stays", icon: "🏨" },
  { id: "fun", label: "Entertainment", icon: "🎟️" },
  { id: "shopping", label: "Shopping", icon: "🛍️" },
  { id: "other", label: "Other", icon: "📦" },
] as const;
export type Category = (typeof CATEGORIES)[number]["id"];
export const categoryOf = (id: string) => CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0];
export const kindOf = (id: string) => GROUP_KINDS.find((k) => k.id === id) ?? GROUP_KINDS[3];

export interface Member {
  id: string;
  name: string;
  email: string | null;
  joined: boolean; // has signed in and opened the group
  removed: boolean; // left the group; kept so old expenses still show their name
}

export interface Expense {
  id: string;
  kind: "expense" | "payment";
  description: string;
  amount: number;
  category: Category;
  date: string; // YYYY-MM-DD
  paid: Amounts;
  owed: Amounts;
  split: Split | null; // null for payments
  notes: string;
  // A receipt photo is attached. Only the group's current members can open it (through the group's receipt
  // route); the photo's own id stays on the server, so it can't be used anywhere else.
  hasReceipt: boolean;
  // Spent in another currency (e.g. pesos on a trip from Singapore): the amount there, in its cents,
  // and the rate used. `amount` is always in the group's currency.
  original: { currency: string; amount: number; rate: number } | null;
  repeat: Repeat; // "never", or how often a copy is added
  nextRepeat: string | null; // YYYY-MM-DD
  createdBy: string; // display name
  createdAt: string;
  deleted: boolean;
}

export interface Comment {
  id: string;
  expenseId: string;
  author: string;
  body: string;
  createdAt: string;
  mine: boolean; // you wrote it, so you can delete it
}

export interface Activity {
  id: string;
  groupId: string;
  groupName: string;
  actor: string;
  text: string;
  expenseId: string | null;
  createdAt: string;
  mine: boolean;
}

export interface GroupSummary {
  id: string;
  name: string;
  kind: GroupKind;
  currency: string;
  members: number;
  myBalance: number; // + you are owed, − you owe
  updatedAt: string;
}

// Someone you share a group with, and where you stand with them across every group.
export interface Friend {
  key: string;
  name: string;
  email: string | null;
  // per currency: + they owe you, − you owe them
  balances: Record<string, number>;
  groups: { groupId: string; groupName: string; currency: string; amount: number }[];
}

export interface Dashboard {
  me: { email: string };
  groups: GroupSummary[];
  friends: Friend[];
  // per currency
  totals: Record<string, { owe: number; owed: number }>;
  // Groups deleted in the last 30 days, which any member can restore.
  deleted: { id: string; name: string; deletedAt: string }[];
}

export interface GroupDetail {
  id: string;
  name: string;
  kind: GroupKind;
  currency: string;
  simplify: boolean;
  meId: string;
  members: Member[];
  expenses: Expense[]; // newest first, deleted ones included
  comments: Comment[];
  activity: Activity[];
  balances: Amounts;
  debts: Transfer[];
}
