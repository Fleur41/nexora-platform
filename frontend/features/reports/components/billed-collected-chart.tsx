"use client";

import * as React from "react";

import { formatMoney } from "@/lib/utils";

/**
 * Billed vs received per month: a grouped column chart.
 *
 * Colours are the validated reference pair (blue / aqua), not the brand navy, which fails
 * the lightness and chroma checks for data marks. Aqua is under 3:1 on white, so the
 * chart always has a legend, a per-month tooltip and a "Show as table" view.
 */
const SERIES = [
  { key: "billed", label: "Billed", color: "#2a78d6" },
  { key: "collected", label: "Received", color: "#1baf7a" },
] as const;

type Point = { label: string; month: string; billed: string; collected: string };

const HEIGHT = 220;
const PAD = { top: 12, right: 8, bottom: 28, left: 52 };
const BAR = 24; // max column width
const GAP = 2; // surface gap between the two columns of a month

function compact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${+(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${+(abs / 1_000).toFixed(1)}K`;
  return `${n}`;
}

/** Clean tick steps (1, 2, 5 × 10ⁿ) covering [min, max], always including zero. */
function ticks(min: number, max: number): number[] {
  const span = max - min || 1;
  const raw = span / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

/** A column with a 4px rounded data end and a square end on the baseline. */
function columnPath(x: number, w: number, y0: number, y1: number): string {
  const up = y1 <= y0; // positive values grow up from the baseline
  const h = Math.abs(y1 - y0);
  const r = Math.min(4, h, w / 2);
  if (h === 0) return "";
  if (up) {
    return `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z`;
  }
  return `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 - r} V${y0} Z`;
}

export function BilledCollectedChart({ data, currency }: { data: Point[]; currency: string }) {
  const [width, setWidth] = React.useState(640);
  const [active, setActive] = React.useState<number | null>(null);
  const [table, setTable] = React.useState(false);
  const box = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry!.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const values = data.flatMap((d) => [Number(d.billed), Number(d.collected)]);
  const scale = ticks(Math.min(0, ...values), Math.max(0, ...values));
  const lo = scale[0]!;
  const hi = scale[scale.length - 1]!;
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const band = plotW / Math.max(data.length, 1);
  const barW = Math.min(BAR, (band * 0.7 - GAP) / 2);
  const step = Math.max(1, Math.ceil(data.length / Math.floor(plotW / 56))); // thin x labels when crowded
  const point = active !== null ? data[active] : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <ul className="flex gap-4 text-xs text-muted-foreground" aria-label="Legend">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
              {s.label}
            </li>
          ))}
        </ul>
        <button type="button" className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => setTable((t) => !t)}>
          {table ? "Show as chart" : "Show as table"}
        </button>
      </div>
      {table ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-1.5 font-medium">Month</th>
              {SERIES.map((s) => <th key={s.key} className="py-1.5 text-right font-medium">{s.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.month} className="border-b last:border-0">
                <td className="py-1.5">{d.label}</td>
                <td className="py-1.5 text-right tabular-nums">{formatMoney(d.billed, currency)}</td>
                <td className="py-1.5 text-right tabular-nums">{formatMoney(d.collected, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div ref={box} className="relative" onPointerLeave={() => setActive(null)}>
          {/* A group, not an image: each month inside is a focusable control with its own label. */}
          <svg width={width} height={HEIGHT} role="group" aria-label={`Billed and received per month in ${currency}`} className="block">
            {scale.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={t === 0 ? 1.5 : 1} />
                <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                  {compact(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = PAD.left + band * i + band / 2;
              const x0 = cx - barW - GAP / 2;
              return (
                <g key={d.month}>
                  {/* The whole month band is the hit target, larger than the columns. */}
                  <rect
                    x={PAD.left + band * i}
                    y={PAD.top}
                    width={band}
                    height={plotH}
                    fill={active === i ? "var(--muted)" : "transparent"}
                    tabIndex={0}
                    role="button"
                    aria-label={`${d.label}: billed ${formatMoney(d.billed, currency)}, received ${formatMoney(d.collected, currency)}`}
                    onPointerMove={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    className="cursor-default outline-none focus-visible:[stroke-width:2] focus-visible:[stroke:var(--ring)]"
                  />
                  {SERIES.map((s, j) => (
                    <path
                      key={s.key}
                      d={columnPath(x0 + j * (barW + GAP), barW, y(0), y(Number(d[s.key])))}
                      fill={s.color}
                      opacity={active === null || active === i ? 1 : 0.55}
                      pointerEvents="none"
                    />
                  ))}
                  {i % step === 0 && (
                    <text x={cx} y={HEIGHT - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                      {d.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {point && (
            <div
              role="status"
              className="pointer-events-none absolute top-1 z-10 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md"
              style={{ left: Math.min(Math.max(PAD.left + band * active! + band / 2 - 80, 0), width - 170), width: 160 }}
            >
              <p className="mb-1 font-medium">{point.label}</p>
              {SERIES.map((s) => (
                <p key={s.key} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} aria-hidden />
                    {s.label}
                  </span>
                  <strong className="tabular-nums">{formatMoney(point[s.key], currency)}</strong>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
