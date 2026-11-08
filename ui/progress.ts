// How far along something is, when the server can't say: an estimate from how long it usually takes.
// Pure, so it's easy to test.
//
// It climbs quickly at first and slows as it nears the usual time (about 86% when that time is up),
// then keeps creeping towards 99% for as long as it takes. It never reaches 100% by itself, so it
// can't claim to be finished before the work is: the caller shows 100% (or removes it) when it's done.

export function estimatedProgress(elapsedMs: number, expectedMs: number): number {
  if (elapsedMs <= 0 || expectedMs <= 0) return 0;
  return Math.min(0.99, 1 - Math.exp((-2 * elapsedMs) / expectedMs));
}

export const percent = (p: number) => Math.round(Math.max(0, Math.min(1, p)) * 100);
