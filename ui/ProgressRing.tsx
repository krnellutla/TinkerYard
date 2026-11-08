"use client";

import { useEffect, useRef, useState } from "react";
import { estimatedProgress, percent } from "./progress";

// The loading indicator everywhere in the yard: a circle that fills up, with the percentage inside.
//
//   expectedMs   how long this usually takes; the ring is paced to it (see progress.ts)
//   value        a real progress (0–1) when there is one; overrides the estimate
//   done         fill to 100% (e.g. the moment the data arrives, before it's swapped in)
//
// Screen readers get a progressbar with the same percentage.

function useEstimate(expectedMs: number, done: boolean) {
  const start = useRef<number | null>(null);
  const [p, setP] = useState(0);
  useEffect(() => {
    if (done) return setP(1);
    start.current ??= performance.now();
    const tick = () => setP(estimatedProgress(performance.now() - start.current!, expectedMs));
    tick();
    const t = setInterval(tick, 100);
    return () => clearInterval(t);
  }, [expectedMs, done]);
  return p;
}

export function ProgressRing({
  expectedMs = 1500,
  value,
  done = false,
  size = 56,
  stroke,
  label = "Loading",
  showPercent,
  className = "",
}: {
  expectedMs?: number;
  value?: number;
  done?: boolean;
  size?: number;
  stroke?: number;
  label?: string;
  showPercent?: boolean; // default: when the ring is big enough to fit it
  className?: string;
}) {
  const estimate = useEstimate(expectedMs, done);
  const p = done ? 1 : (value ?? estimate);
  const pct = percent(p);
  const w = stroke ?? Math.max(2, Math.round(size / 12));
  const r = (size - w) / 2;
  const c = 2 * Math.PI * r;
  const text = showPercent ?? size >= 40;
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={`relative inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={w} className="stroke-line" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={w}
          strokeLinecap={p > 0.01 ? "round" : "butt"} // a round end at 0% would show as a stray dot
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p)}
          className="stroke-current transition-[stroke-dashoffset] duration-200 ease-linear motion-reduce:transition-none"
        />
      </svg>
      {text && (
        <span className="absolute font-semibold tabular-nums" style={{ fontSize: Math.max(10, Math.round(size / 4.2)) }} aria-hidden="true">
          {pct}%
        </span>
      )}
    </span>
  );
}

// A ring with a line of text under it, centred: for a page or a section that's still loading.
export function Loading({ label = "Loading", expectedMs = 1500, size = 56, className = "" }: { label?: string; expectedMs?: number; size?: number; className?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-10 text-center text-ink ${className}`}>
      <ProgressRing expectedMs={expectedMs} size={size} label={label} />
      <p className="text-sm text-muted">{label}…</p>
    </div>
  );
}
