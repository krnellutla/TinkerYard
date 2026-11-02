// Mask before saving: long digit runs (account, card, phone numbers) keep only their last 4.
export function maskDigits(s: string | null): string | null {
  if (!s) return s;
  return s.replace(/\d[\d\s-]{5,}\d/g, (run) => {
    const digits = run.replace(/\D/g, "");
    return digits.length >= 6 ? "•".repeat(digits.length - 4) + digits.slice(-4) : run;
  });
}
