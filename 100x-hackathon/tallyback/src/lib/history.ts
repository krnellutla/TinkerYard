// "Has this charge shown up on my earlier bills?": code, not the model.
import type { ExtractedLine } from "./types";

export interface PastLine extends ExtractedLine {
  bill_date: string;
}

export interface LineHistory {
  times: number; // earlier bills with this line
  lastDate: string;
  change: "same" | "up" | "down" | "new_amount" | null;
  note: string; // built by code
}

const SKIP = new Set(["subtotal", "total", "tax", "rounding", "payment"]);

// "4. Carrot 0.88 2.46" and "15. Carrot" are the same line: drop the row number and
// any qty/amount the model copied into the description. "Moong dal 1kg" keeps its "1kg".
export const lineKey = (d: string) =>
  d
    .toLowerCase()
    .replace(/^\s*\d+[.)]\s*/, "")
    .replace(/(\s+[\d.,]+)+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();

// Price per unit as a range: weights are printed to 2 dp, so 0.14 kg could be 0.135–0.145.
function unitRange(l: ExtractedLine): [number, number] | null {
  if (l.qty == null || l.qty <= 0) return [l.amount, l.amount];
  if (Number.isInteger(l.qty)) return [l.amount / l.qty, l.amount / l.qty];
  return [l.amount / (l.qty + 0.005), l.amount / Math.max(l.qty - 0.005, 0.001)];
}

const shortDate = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export function compareHistory(lines: ExtractedLine[], past: PastLine[], fmtMoney: (n: number) => string): Record<number, LineHistory> {
  const out: Record<number, LineHistory> = {};
  lines.forEach((l, i) => {
    if (SKIP.has(l.kind)) return;
    const prev = past
      .filter((p) => !SKIP.has(p.kind) && lineKey(p.description) === lineKey(l.description))
      .sort((a, b) => b.bill_date.localeCompare(a.bill_date));
    if (!prev.length) return;
    const last = prev[0];
    const now = unitRange(l);
    const then = unitRange(last);
    const dates = new Set(prev.map((p) => p.bill_date)).size;
    const base = { times: dates, lastDate: last.bill_date };
    const when = shortDate(last.bill_date);
    if (!now || !then) {
      out[i] = { ...base, change: null, note: `Also on ${dates} earlier bill${dates > 1 ? "s" : ""}` };
      return;
    }
    const overlap = Math.max(now[0], then[0]) <= Math.min(now[1], then[1]) + 0.005;
    const weighed = l.qty != null && !Number.isInteger(l.qty);
    const per = weighed ? "/kg" : "";
    const mid = (r: [number, number]) => (r[0] + r[1]) / 2;
    if (overlap) {
      out[i] = { ...base, change: "same", note: `Same price as ${when}` };
    } else {
      const pct = Math.round(((mid(now) - mid(then)) / mid(then)) * 100);
      const up = pct > 0;
      out[i] = {
        ...base,
        change: up ? "up" : "down",
        note: `${up ? "Up" : "Down"} ${Math.abs(pct)}% since ${when} (${fmtMoney(mid(then))}${per} → ${fmtMoney(mid(now))}${per})`,
      };
    }
  });
  return out;
}
