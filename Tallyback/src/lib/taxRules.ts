// Statutory headline rates by country and date. Data, not judgement.
// Add rows as new countries show up in testing.
interface RateRow {
  from: string; // inclusive, YYYY-MM-DD
  rate: number;
}

const STANDARD_RATE: Record<string, RateRow[]> = {
  SG: [
    { from: "1994-04-01", rate: 3 },
    { from: "2003-01-01", rate: 4 },
    { from: "2004-01-01", rate: 5 },
    { from: "2007-07-01", rate: 7 },
    { from: "2023-01-01", rate: 8 },
    { from: "2024-01-01", rate: 9 },
  ],
  GB: [{ from: "2011-01-04", rate: 20 }],
  AU: [{ from: "2000-07-01", rate: 10 }],
  NZ: [{ from: "2010-10-01", rate: 15 }],
  AE: [{ from: "2018-01-01", rate: 5 }],
};

// Countries with several legitimate slabs: we only check the rate is one of them.
const SLABS: Record<string, { from: string; rates: number[] }[]> = {
  IN: [
    { from: "2017-07-01", rates: [0, 0.25, 3, 5, 12, 18, 28] },
    { from: "2025-09-22", rates: [0, 0.25, 3, 5, 18, 40] },
  ],
};

export type RateCheck =
  | { kind: "standard"; rate: number }
  | { kind: "slabs"; rates: number[] }
  | { kind: "unknown" };

export function statutoryRate(country: string | null, date: string | null): RateCheck {
  if (!country || !date) return { kind: "unknown" };
  const c = country.toUpperCase();
  const std = STANDARD_RATE[c];
  if (std) {
    const row = [...std].reverse().find((r) => date >= r.from);
    return row ? { kind: "standard", rate: row.rate } : { kind: "unknown" };
  }
  const slabs = SLABS[c];
  if (slabs) {
    const row = [...slabs].reverse().find((r) => date >= r.from);
    return row ? { kind: "slabs", rates: row.rates } : { kind: "unknown" };
  }
  return { kind: "unknown" };
}

// Where retailers must show tax-inclusive shelf prices to consumers.
export const INCLUSIVE_DISPLAY_COUNTRIES = new Set(["SG", "GB", "AU", "NZ", "AE", "IN"]);
