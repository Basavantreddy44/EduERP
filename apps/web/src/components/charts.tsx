'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Small single-series charts for the dashboard (M4.3). Plain SVG, one series colour
 * (--chart-1, validated against the white card), recessive grid, a tooltip on hover
 * and a table view underneath for anyone who cannot read the chart.
 */
export interface ChartPoint {
  key: string;
  /** Short axis label, e.g. "17 Nov". */
  axis: string;
  /** Tooltip heading, e.g. "Tue, 17 Nov". */
  title: string;
  /** null = no value that day (a gap). */
  value: number | null;
  /** Tooltip value, e.g. "₹25,000 · 2 receipts". */
  text: string;
}

const PAD = { top: 10, right: 10, bottom: 24, left: 50 };
const H = 190;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function TrendChart({ kind, points, max, tick, label }: {
  kind: 'bar' | 'line';
  points: ChartPoint[];
  /** Top of the value axis. */
  max: number;
  /** Axis label for a value. */
  tick: (v: number) => string;
  /** What the chart shows (read by screen readers). */
  label: string;
}) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const n = points.length;
  const iw = Math.max(0, width - PAD.left - PAD.right);
  const ih = H - PAD.top - PAD.bottom;
  const step = n ? iw / n : 0;
  const x = (i: number) => PAD.left + step * i + step / 2;
  const y = (v: number) => PAD.top + ih - (max ? (v / max) * ih : 0);
  const every = Math.max(1, Math.ceil(n / (width < 420 ? 4 : 7)));
  const ticks = [0, max / 2, max];

  // Line: break at missing days.
  const segments: string[] = [];
  if (kind === 'line') {
    let cur = '';
    points.forEach((p, i) => {
      if (p.value === null) { if (cur) segments.push(cur); cur = ''; return; }
      cur += `${cur ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
    });
    if (cur) segments.push(cur);
  }
  const barW = Math.max(2, step - 2);
  const bar = (i: number, v: number) => {
    const top = y(v);
    const h = PAD.top + ih - top;
    if (h <= 0) return '';
    const r = Math.min(4, barW / 2, h);
    const l = x(i) - barW / 2;
    const b = PAD.top + ih;
    return `M${l},${b}V${top + r}Q${l},${top} ${l + r},${top}H${l + barW - r}Q${l + barW},${top} ${l + barW},${top + r}V${b}Z`;
  };
  const tipX = hover === null ? 0 : Math.min(Math.max(x(hover), 70), width - 70);

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} className="chart-grid" />
              <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" className="chart-tick">{tick(v)}</text>
            </g>
          ))}
          {points.map((p, i) => (i % every === (n - 1) % every ? <text key={p.key} x={x(i)} y={H - 6} textAnchor="middle" className="chart-tick">{p.axis}</text> : null))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + ih} className="chart-cross" />}
          {kind === 'bar' && points.map((p, i) => (p.value ? <path key={p.key} d={bar(i, p.value)} className={`chart-bar${hover === i ? ' on' : ''}`} /> : null))}
          {kind === 'line' && segments.map((d) => <path key={d} d={d} className="chart-line" />)}
          {kind === 'line' && points.map((p, i) => (p.value === null ? null : <circle key={p.key} cx={x(i)} cy={y(p.value)} r={hover === i ? 5.5 : 4} className="chart-dot" />))}
          {points.map((p, i) => (
            <rect key={p.key} x={PAD.left + step * i} y={PAD.top} width={step} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
        </svg>
      )}
      {hover !== null && (
        <div className="chart-tip" style={{ left: tipX }} aria-hidden="true">
          <strong>{points[hover].title}</strong>
          <span>{points[hover].text}</span>
        </div>
      )}
    </div>
  );
}

/** Indian rupees in short form for an axis: ₹0, ₹5k, ₹1.2L, ₹2Cr. */
export function inrShort(rupees: number) {
  const r = Math.round(rupees);
  if (r >= 1e7) return `₹${+(r / 1e7).toFixed(1)}Cr`;
  if (r >= 1e5) return `₹${+(r / 1e5).toFixed(1)}L`;
  if (r >= 1e3) return `₹${+(r / 1e3).toFixed(1)}k`;
  return `₹${r}`;
}

/** A round axis top a little above the largest value. */
export function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)!;
}
