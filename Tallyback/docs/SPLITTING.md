# Splitting (TallyBack's Split tab)

Split shared costs with friends in TallyBack's **Split with friends** tab (`/tallyback?tab=split`; old `/splitbill` links redirect there). After checking a bill, **Split this bill** opens the expense form filled in from it (`src/split/lib/fromBill.ts`). It has groups, expenses split four ways, balances, the fewest payments to settle, and a record of who paid whom. Every amount is whole cents, so splits always add up exactly.

## What it does
| | |
|---|---|
| **Groups** | Trip, Home, Couple or Other, with one currency (SGD, INR, USD, EUR, GBP, AUD, MYR). Rename, change type, delete. Currency is fixed once the first expense is in. |
| **Members** | Added by name, optionally with an email. Someone with an email sees the group the first time they sign in with that address; without one, they're tracked only. A member can leave or be removed only when settled up. |
| **Expenses** | Description, amount, date, category, notes. Paid by one person or several (amounts must add up). Split **equally** (tick who's in), by **exact amounts**, **percentages** or **shares**, with each person's share shown as you type. |
| **Payments** | "Settle up" records that one person paid another, with suggestions from the current debts. |
| **Balances** | Each member's balance, plus who should pay whom. **Simplify debts** (on by default) gives the fewest payments that settle the whole group; turned off, debts follow the expenses people actually shared. |
| **Friends** | Everyone you share a group with, and where you stand with them across all groups (matched by email). |
| **Totals** | Group spending, your share, what you paid, spending by category. |
| **Activity & comments** | Every change is logged per group and across groups; each expense has a comment thread. |
| **Delete / restore** | Deleting an expense hides it from balances; it can be restored. |
| **Export** | CSV per group: one row per expense, one column per person (+ lent, − borrowed), totals at the bottom. |

It needs sign-in: groups are shared between real people, so a device id isn't enough. Sign-in is invite-only, so a new member's email must also be in `ALLOWED_EMAILS`.

## Files
| File | What it does |
|---|---|
| `src/split/lib/split.ts` | The four ways to split, exact to the cent; checks payers add up (pure, tested) |
| `src/split/lib/balances.ts` | Balances, simplified debts, pairwise debts (pure, tested) |
| `src/split/lib/money.ts` | Typed amount → cents, and cents → "S$1,234.56" |
| `src/split/lib/types.ts` | Categories, group types, and the shapes the API sends the page |
| `src/split/lib/service.ts` | Every rule: who may see what, validation, activity log, CSV export |
| `src/split/lib/db.ts` | Storage: Postgres when `DATABASE_URL` is set, `.data/splitbill.json` otherwise |
| `src/split/lib/route.ts` | Wraps each API route: sign-in required, JSON errors |
| `src/split/api/handlers.ts` | Every endpoint; `app/api/tallyback/{groups,activity}/**/route.ts` re-export them |
| `src/split/ui/*` | The tab: `SplitPanel` → `Dashboard` / `GroupView`, forms in `EntryForms`, shared bits in `kit` |

## API
All under `/api/tallyback` (`/groups…`, `/activity`), for people with access to TallyBack (`401` with `code: "sign_in"` otherwise).

| Route | |
|---|---|
| `GET /groups`, `POST /groups` | Your groups, friends and totals; create a group |
| `GET /groups/:id`, `PATCH`, `DELETE` | Everything in a group; rename / type / currency / simplify; delete |
| `POST /groups/:id/members`, `PATCH`/`DELETE …/members/:memberId` | Add, rename, remove or leave |
| `POST /groups/:id/expenses`, `PATCH`/`DELETE …/expenses/:expenseId` | Expenses and payments (`kind`); `PATCH {restore: true}` undeletes |
| `POST …/expenses/:expenseId/comments` | Comment on an expense |
| `GET /groups/:id/export` | CSV download |
| `GET /activity` | Recent activity across your groups |

## Data
Five tables, created on first use (`sb_groups`, `sb_members`, `sb_expenses`, `sb_comments`, `sb_activity`). An expense stores `paid` and `owed` as `{member id: cents}`, plus the split as typed so it can be edited the same way; a payment is an expense with `kind = 'payment'`. Balances are always worked out from these rows, never stored, so they can't drift.

Who may see a group: a member row with your account's `user_id`, or with your email and no account yet (that row becomes yours when you open it). Anything else answers "Group not found."

## Not yet
- Emailing people when they're added (today you tell them yourself; their address must be on the allow-list)
- Recurring expenses, receipt photos, several currencies in one group
