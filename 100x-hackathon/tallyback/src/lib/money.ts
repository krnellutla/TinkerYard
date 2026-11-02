// Integer cents everywhere so 0.1 + 0.2 never bites us.
export const toCents = (n: number) => Math.round(n * 100);
export const fromCents = (c: number) => c / 100;

export function fmt(amount: number, currency: string): string {
  const sym: Record<string, string> = { INR: "₹", SGD: "S$", USD: "$", GBP: "£", EUR: "€", AUD: "A$", AED: "AED " };
  const s = sym[currency] ?? `${currency} `;
  const sign = amount < 0 ? "-" : "";
  return `${sign}${s}${Math.abs(amount).toFixed(2)}`;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
