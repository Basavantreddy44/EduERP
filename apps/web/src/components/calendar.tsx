'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { todayIST } from '@/components/admissions';

/** A calendar entry (events, holidays, exam papers, PTM days). */
export interface CalItem { date: string; endDate?: string; kind: 'EVENT' | 'HOLIDAY' | 'EXAM' | 'PTM'; title: string; time?: string | null; id?: string }

const pad = (n: number) => String(n).padStart(2, '0');
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
const addMonths = (m: string, n: number) => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`; };
const lastDay = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

/**
 * Month view (Monday first) on wide screens and an agenda list on phones. `load` fetches the items of
 * a date range; `link` turns an item into a link (or null).
 */
export function CalendarMonth({ load, link }: { load: (from: string, to: string) => Promise<CalItem[]>; link?: (i: CalItem) => string | null }) {
  const { t, locale } = useI18n();
  const [month, setMonth] = useState(monthStart(todayIST()));
  const [items, setItems] = useState<CalItem[] | null>(null);
  // The loader may be a new function on every render: keep the latest without refetching.
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => { setItems(null); loader.current(month, lastDay(month)).then(setItems).catch(() => setItems([])); }, [month]);
  const first = new Date(`${month}T00:00:00Z`);
  const lead = (first.getUTCDay() + 6) % 7;
  const days = Number(lastDay(month).slice(8));
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${month.slice(0, 8)}${pad(i + 1)}`)];
  while (cells.length % 7) cells.push(null);
  const on = (d: string) => (items ?? []).filter((i) => i.date === d || (i.endDate && i.date <= d && i.endDate >= d));
  const today = todayIST();
  const label = first.toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' }));
  const chip = (i: CalItem, k: number) => {
    const href = link?.(i);
    const body = <><span className="sr-only">{t(`cal.kind.${i.kind}` as MessageKey)}: </span>{i.time ? `${i.time} ` : ''}{i.title}</>;
    return href ? <Link key={k} href={href} className={`ecal-chip k-${i.kind.toLowerCase()}`} title={`${i.time ? `${i.time} ` : ""}${i.title}`}>{body}</Link> : <span key={k} className={`ecal-chip k-${i.kind.toLowerCase()}`} title={`${i.time ? `${i.time} ` : ""}${i.title}`}>{body}</span>;
  };
  const agenda = [...new Set((items ?? []).map((i) => i.date))].sort();
  return (
    <div className="ecal">
      <div className="ecal-head">
        <button type="button" className="btn btn-sm btn-ghost icon-btn" onClick={() => setMonth(addMonths(month, -1))} aria-label={t('cal.prev')}><Icon name="chevronRight" className="flip" /></button>
        <h2 className="ecal-title" aria-live="polite">{label}</h2>
        <button type="button" className="btn btn-sm btn-ghost icon-btn" onClick={() => setMonth(addMonths(month, 1))} aria-label={t('cal.next')}><Icon name="chevronRight" /></button>
        <button type="button" className="btn btn-sm" onClick={() => setMonth(monthStart(today))}>{t('cal.today')}</button>
        <ul className="ecal-key" aria-label={t('cal.key')}>{(['EVENT', 'HOLIDAY', 'EXAM', 'PTM'] as const).map((k) => <li key={k}><i className={`ecal-dot k-${k.toLowerCase()}`} aria-hidden="true" />{t(`cal.kind.${k}` as MessageKey)}</li>)}</ul>
      </div>
      {!items ? <p className="muted">{t('en.loading')}</p> : (
        <>
          <table className="ecal-grid" aria-label={label}>
            <thead><tr>{weekdays.map((w) => <th key={w} scope="col">{w}</th>)}</tr></thead>
            <tbody>
              {Array.from({ length: cells.length / 7 }, (_, r) => (
                <tr key={r}>{cells.slice(r * 7, r * 7 + 7).map((d, c) => (
                  <td key={c} className={!d ? 'ecal-empty' : d === today ? 'ecal-today' : undefined}>
                    {d && <><span className="ecal-day">{Number(d.slice(8))}</span><div className="ecal-items">{on(d).slice(0, 4).map(chip)}{on(d).length > 4 && <span className="muted small">{t('cal.more', { n: on(d).length - 4 })}</span>}</div></>}
                  </td>
                ))}</tr>
              ))}
            </tbody>
          </table>
          <div className="ecal-agenda">
            {!agenda.length ? <p className="muted">{t('cal.empty')}</p> : agenda.map((d) => (
              <section key={d} className="ecal-agenda-day">
                <h3 className={d === today ? 'ecal-today' : undefined}>{new Date(`${d}T00:00:00Z`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</h3>
                <div className="ecal-items">{(items ?? []).filter((i) => i.date === d).map(chip)}</div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
