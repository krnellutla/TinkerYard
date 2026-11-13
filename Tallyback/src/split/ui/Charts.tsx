"use client";

import { useState } from "react";
import { formatMoney, formatRate } from "../lib/money";
import type { CategorySlice, CurrencySlice, DailySpendSeries, MemberSpendRow } from "../lib/analytics";

const PALETTE = ["#1c1b19", "#15803d", "#c2410c", "#b45309", "#0f766e", "#4f46e5", "#6b675f"];

/**
 * Interactive SVG Donut Chart breaking down group expenses by category.
 */
export function CategoryDonutChart({ data, total, currency }: { data: CategorySlice[]; total: number; currency: string }) {
  const [active, setActive] = useState<string | null>(null);
  if (!data.length || total <= 0) return null;

  const size = 148;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 54;
  const strokeWidth = 22;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const segments = data.map((item, idx) => {
    const length = (item.amount / total) * circumference;
    const gap = data.length > 1 ? Math.min(3, length * 0.15) : 0;
    const seg = {
      ...item,
      color: PALETTE[idx % PALETTE.length],
      dashArray: `${Math.max(1, length - gap)} ${circumference}`,
      dashOffset: -offset,
    };
    offset += length;
    return seg;
  });

  const focused = segments.find((s) => s.category === active) ?? null;

  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">Spending by category</h3>
        <span className="text-xs text-muted">{data.reduce((n, d) => n + d.count, 0)} expenses</span>
      </div>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
        <div className="relative h-[148px] w-[148px] shrink-0">
          <svg viewBox={`0 0 ${size} ${size}`} className="-rotate-90 h-full w-full" role="img" aria-label="Category spending donut chart">
            <circle cx={cx} cy={cy} r={radius} fill="none" stroke="var(--color-paper, #f6f4ef)" strokeWidth={strokeWidth} />
            {segments.map((seg) => {
              const dim = active && active !== seg.category;
              return (
                <circle
                  key={seg.category}
                  cx={cx}
                  cy={cy}
                  r={radius}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={active === seg.category ? strokeWidth + 3 : strokeWidth}
                  strokeDasharray={seg.dashArray}
                  strokeDashoffset={seg.dashOffset}
                  strokeLinecap="butt"
                  opacity={dim ? 0.35 : 1}
                  className="cursor-pointer transition-all duration-150"
                  onClick={() => setActive((cur) => (cur === seg.category ? null : seg.category))}
                />
              );
            })}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-3 text-center">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
              {focused ? focused.label : "Total"}
            </span>
            <span className="mt-0.5 truncate text-sm font-semibold tabular-nums text-ink">
              {formatMoney(focused ? focused.amount : total, currency)}
            </span>
            {focused && <span className="text-[11px] font-mono text-muted">{focused.pct}%</span>}
          </div>
        </div>

        <ul className="w-full min-w-0 flex-1 space-y-2 text-sm">
          {segments.map((seg) => {
            const isSelected = active === seg.category;
            return (
              <li key={seg.category}>
                <button
                  type="button"
                  onClick={() => setActive((cur) => (cur === seg.category ? null : seg.category))}
                  className={`flex w-full items-center justify-between gap-2 rounded-xl px-2 py-1 text-left transition-colors ${isSelected ? "bg-paper" : "hover:bg-paper/60"}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: seg.color }} aria-hidden="true" />
                    <span className="truncate">
                      {seg.icon} {seg.label}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-ink">
                    {formatMoney(seg.amount, currency)} <span className="text-muted">({seg.pct}%)</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/**
 * Dual-bar chart comparing what each member paid out of pocket vs. their consumed share.
 */
export function MemberPaidVsShareChart({ rows, currency, meId }: { rows: MemberSpendRow[]; currency: string; meId: string }) {
  if (!rows.length) return null;
  const maxVal = Math.max(1, ...rows.flatMap((r) => [r.paid, r.share]));

  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">Paid vs. fair share</h3>
        <div className="flex items-center gap-3 text-[11px] text-muted">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded-full bg-ink" /> Paid
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded-full bg-line" /> Share
          </span>
        </div>
      </div>

      <ul className="space-y-3">
        {rows.map((r) => {
          const paidPct = (r.paid / maxVal) * 100;
          const sharePct = (r.share / maxVal) * 100;
          const label = r.id === meId ? "You" : r.name;
          return (
            <li key={r.id} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium text-ink">{label}</span>
                <span className={`font-mono text-xs font-semibold tabular-nums ${r.net > 0 ? "text-good" : r.net < 0 ? "text-bad" : "text-muted"}`}>
                  {r.net === 0 ? "Even" : `${r.net > 0 ? "+" : "−"}${formatMoney(Math.abs(r.net), currency)}`}
                </span>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-paper">
                    <div className="h-full rounded-full bg-ink transition-all duration-300" style={{ width: `${Math.max(paidPct, r.paid > 0 ? 2 : 0)}%` }} />
                  </div>
                  <span className="w-20 text-right font-mono text-[11px] tabular-nums text-ink">{formatMoney(r.paid, currency)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-paper">
                    <div className="h-full rounded-full bg-muted/45 transition-all duration-300" style={{ width: `${Math.max(sharePct, r.share > 0 ? 2 : 0)}%` }} />
                  </div>
                  <span className="w-20 text-right font-mono text-[11px] tabular-nums text-muted">{formatMoney(r.share, currency)}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en", { day: "numeric", month: "short" });
}

/**
 * Daily expenditure bar chart + cumulative trend polyline.
 */
export function DailySpendChart({ series, currency }: { series: DailySpendSeries; currency: string }) {
  if (series.days.length === 0) return null;

  const w = 360;
  const h = 140;
  const padX = 16;
  const padTop = 18;
  const padBot = 24;
  const plotW = w - padX * 2;
  const plotH = h - padTop - padBot;
  const maxY = Math.max(1, series.maxDayCents);
  const slotW = plotW / series.days.length;
  const barW = Math.min(34, slotW * 0.54);
  const avgY = padTop + plotH - (series.averagePerDay / maxY) * plotH;

  // Cumulative line scaled against series.total so trend is clearly visible alongside daily bars.
  const linePts = series.days
    .map((d, idx) => {
      const x = padX + slotW * idx + slotW / 2;
      const y = padTop + plotH - (d.cumulative / Math.max(1, series.total)) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">Daily &amp; cumulative spend</h3>
        <span className="font-mono text-xs text-muted">Avg {formatMoney(series.averagePerDay, currency)} / day</span>
      </div>

      <svg viewBox={`0 0 ${w} ${h}`} className="w-full overflow-visible" role="img" aria-label="Daily spending bar and cumulative trend chart">
        {/* Daily average dashed reference */}
        <line x1={padX} y1={avgY} x2={w - padX} y2={avgY} stroke="var(--color-muted, #6b675f)" strokeDasharray="3 3" strokeOpacity="0.45" />

        {series.days.map((d, idx) => {
          const barH = Math.max(4, (d.amount / maxY) * plotH);
          const x = padX + slotW * idx + (slotW - barW) / 2;
          const y = padTop + plotH - barH;
          const centerX = x + barW / 2;
          return (
            <g key={d.date}>
              <rect x={x} y={y} width={barW} height={barH} rx={6} fill="var(--color-ink, #1c1b19)" fillOpacity="0.88" />
              <text x={centerX} y={Math.max(11, y - 5)} fontSize="9.5" textAnchor="middle" fill="var(--color-muted, #6b675f)" fontFamily="var(--font-geist-mono), monospace">
                {(d.amount / 100).toFixed(0)}
              </text>
              <text x={centerX} y={h - 6} fontSize="10" textAnchor="middle" fill="var(--color-muted, #6b675f)">
                {shortDate(d.date)}
              </text>
            </g>
          );
        })}

        {series.days.length > 1 && (
          <polyline fill="none" stroke="var(--color-good, #15803d)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" points={linePts} />
        )}
        {series.days.map((d, idx) => {
          const cx = padX + slotW * idx + slotW / 2;
          const cy = padTop + plotH - (d.cumulative / Math.max(1, series.total)) * plotH;
          return <circle key={`pt-${d.date}`} cx={cx} cy={cy} r="3.2" fill="var(--color-good, #15803d)" stroke="var(--color-card, #ffffff)" strokeWidth="1.5" />;
        })}
      </svg>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-ink/85" /> Daily spend ({currency})
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 bg-good" /> Cumulative
          </span>
        </span>
        {series.days.some((d) => Object.keys(d.foreignTotals).length > 0) && (
          <span>
            {series.days
              .flatMap((d) => Object.entries(d.foreignTotals))
              .reduce<string[]>((acc, [c]) => (acc.includes(c) ? acc : [...acc, c]), [])
              .map((cur) => {
                const sumCur = series.days.reduce((s, d) => s + (d.foreignTotals[cur] ?? 0), 0);
                return `${formatMoney(sumCur, cur)} local`;
              })
              .join(" · ")}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Currency exposure stacked bar comparing native group currency vs converted foreign spend (e.g. SGD vs THB).
 */
export function CurrencyExposureCard({ rows, groupCurrency }: { rows: CurrencySlice[]; groupCurrency: string }) {
  if (!rows.length) return null;
  const barColors = ["#1c1b19", "#0f766e", "#b45309", "#4f46e5"];

  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">Currency breakdown</h3>
        <span className="text-xs text-muted">Settled in {groupCurrency}</span>
      </div>

      <div className="flex h-3 w-full overflow-hidden rounded-full bg-paper">
        {rows.map((r, idx) => (
          <div
            key={r.currency}
            style={{ width: `${Math.max(2, r.pct)}%`, backgroundColor: barColors[idx % barColors.length] }}
            title={`${r.currency}: ${r.pct}%`}
          />
        ))}
      </div>

      <ul className="mt-3 space-y-2 text-sm">
        {rows.map((r, idx) => (
          <li key={r.currency} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: barColors[idx % barColors.length] }} aria-hidden="true" />
              <span className="font-medium">{r.currency}</span>
              <span className="truncate text-xs text-muted">
                {r.count} expense{r.count === 1 ? "" : "s"} · {r.pct}%
              </span>
            </span>
            <span className="shrink-0 text-right font-mono text-xs tabular-nums">
              <b className="text-ink">{formatMoney(r.groupCents, groupCurrency)}</b>
              {r.currency !== groupCurrency && (
                <span className="block text-[11px] text-muted">
                  {formatMoney(r.originalCents, r.currency)}
                  {r.avgRate ? ` · ${formatRate(r.avgRate, r.currency, groupCurrency)}` : ""}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

