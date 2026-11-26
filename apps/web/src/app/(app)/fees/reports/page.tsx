'use client';

import { useEffect, useState } from 'react';
import { formatINR } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { EmptyState, PageHeader, SkeletonRows } from '@/components/ui';
import { todayIST, useDay } from '@/components/admissions';
import { paiseOf } from '@/components/fees';
import { AdvancesReport, CarriedReport } from '@/components/FeeGoLiveReports';

type Tab = 'collection' | 'heads' | 'dues' | 'carried' | 'advances';
interface Bucket { key: string; amount: string; count: number }
interface Collection { total: string; receipts: number; byDay: Bucket[]; byMode: Bucket[]; byCashier: Bucket[]; ledgerTotal: string; matchesAccounts: boolean }
interface Heads { heads: { name: string; code: string; feeType: string; amount: string }[]; advance: string; total: string }
interface DuesClass { classes: { programName: string | null; levelName: string | null; students: number; gross: string; concession: string; fine: string; paid: string; balance: string; overdue: string }[]; totalBalance: string; ledgerReceivable: string; matchesAccounts: boolean }

const inr = (v: string) => formatINR(paiseOf(v), { paise: paiseOf(v) % 100 !== 0 });
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

function Matches({ ok, ledger }: { ok: boolean; ledger: string }) {
  const { t } = useI18n();
  return ok
    ? <p className="match ok"><Icon name="check" size={15} /> {t('fee.rep.matches')}</p>
    : <p className="match bad" role="alert"><Icon name="alert" size={15} /> {t('fee.rep.mismatch', { v: inr(ledger) })}</p>;
}

export default function FeeReportsPage() {
  const { campusId } = useSession();
  const { t, locale } = useI18n();
  const day = useDay();
  const today = todayIST();
  const [tab, setTab] = useState<Tab>('collection');
  const [range, setRange] = useState({ from: today, to: today });
  const [col, setCol] = useState<Collection | null>(null);
  const [heads, setHeads] = useState<Heads | null>(null);
  const [dues, setDues] = useState<DuesClass | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    const q = new URLSearchParams({ from: range.from, to: range.to, ...(campusId ? { campusId } : {}) }).toString();
    if (tab === 'collection') { setCol(null); api<Collection>(`/fees/reports/collection?${q}`).then(setCol).catch((e) => setError(apiErrors(e).message)); }
    if (tab === 'heads') { setHeads(null); api<Heads>(`/fees/reports/by-head?${q}`).then(setHeads).catch((e) => setError(apiErrors(e).message)); }
    if (tab === 'dues') { setDues(null); api<DuesClass>(`/fees/reports/dues-by-class${campusId ? `?campusId=${campusId}` : ''}`).then(setDues).catch((e) => setError(apiErrors(e).message)); }
  }, [tab, range, campusId]);

  const monthStart = `${today.slice(0, 8)}01`;
  const presets: [string, { from: string; to: string }][] = [
    [t('fee.rep.today'), { from: today, to: today }],
    [t('fee.rep.yesterday'), { from: shift(today, -1), to: shift(today, -1) }],
    [t('fee.rep.last7'), { from: shift(today, -6), to: today }],
    [t('fee.rep.thisMonth'), { from: monthStart, to: today }],
  ];
  const TABS: [Tab, string][] = [['collection', t('fee.rep.collection')], ['heads', t('fee.rep.heads')], ['dues', t('fee.rep.dues')], ['carried', t('cr.rep.carried')], ['advances', t('cr.rep.advances')]];

  return (
    <>
      <PageHeader eyebrow={t('nav.fees')} title={t('fee.rep.title')} description={t('fee.rep.desc')} actions={<button type="button" className="btn no-print" onClick={() => window.print()}><Icon name="receipt" /> {t('fee.rc.print')}</button>} />
      <div className="tabs scroll no-print" role="tablist" aria-label={t('fee.rep.title')}>
        {TABS.map(([k, label]) => <button key={k} role="tab" type="button" aria-selected={tab === k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{label}</button>)}
      </div>

      {(tab === 'collection' || tab === 'heads') && (
        <div className="card filter-bar no-print">
          <div className="preset-row" role="group" aria-label={t('fee.rep.period')}>
            {presets.map(([label, r]) => <button key={label} type="button" className={`btn btn-sm ${range.from === r.from && range.to === r.to ? 'btn-primary' : ''}`} onClick={() => setRange(r)}>{label}</button>)}
          </div>
          <label className="filter"><span>{t('fee.rep.from')}</span><input className="input" type="date" max={today} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
          <label className="filter"><span>{t('fee.rep.to')}</span><input className="input" type="date" max={today} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
        </div>
      )}
      <p className="print-only muted">{tab !== 'collection' && tab !== 'heads' ? t('fee.rep.asOf', { date: day(today) }) : `${day(range.from)} – ${day(range.to)}`}</p>
      {error && <div className="alert" role="alert"><Icon name="alert" />{error}</div>}

      {tab === 'collection' && (!col ? !error && <SkeletonRows rows={5} /> : col.receipts === 0 ? <EmptyState icon="receipt" title={t('fee.rep.noneTitle')} text={t('fee.rep.noneText')} /> : (
        <div className="report-grid">
          <section className="card report-hero">
            <span className="muted small">{t('fee.rep.received')}</span>
            <strong>{inr(col.total)}</strong>
            <span className="muted small">{t('fee.rep.receipts', { n: col.receipts })}</span>
            <Matches ok={col.matchesAccounts} ledger={col.ledgerTotal} />
          </section>
          <ReportTable title={t('fee.rep.byMode')} rows={col.byMode.map((m) => [t(`fee.mode.${m.key}` as MessageKey), m.count, m.amount])} total={col.total} countLabel={t('fee.rep.count')} />
          <ReportTable title={t('fee.rep.byCashier')} rows={col.byCashier.map((m) => [m.key === 'ONLINE' ? t('fee.rep.onlineCashier') : m.key, m.count, m.amount])} total={col.total} countLabel={t('fee.rep.count')} />
          <ReportTable title={t('fee.rep.byDay')} rows={col.byDay.map((m) => [new Date(m.key).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }), m.count, m.amount])} total={col.total} countLabel={t('fee.rep.count')} />
        </div>
      ))}

      {tab === 'heads' && (!heads ? !error && <SkeletonRows rows={5} /> : paiseOf(heads.total) === 0 ? <EmptyState icon="receipt" title={t('fee.rep.noneTitle')} text={t('fee.rep.noneText')} /> : (
        <section className="card">
          <p className="muted small">{t('fee.rep.headsHint')}</p>
          <table className="report-table">
            <caption className="sr-only">{t('fee.rep.heads')}</caption>
            <thead><tr><th scope="col">{t('fee.tab.heads')}</th><th scope="col">{t('common.type')}</th><th scope="col" className="num">{t('fee.acct.amount')}</th><th scope="col" className="num">{t('fee.rep.share')}</th></tr></thead>
            <tbody>
              {heads.heads.map((h) => <tr key={h.code}><td><strong>{h.name}</strong><span className="sub-line muted mono">{h.code}</span></td><td>{t(`fee.type.${h.feeType}` as MessageKey)}</td><td className="num">{inr(h.amount)}</td><td className="num muted">{Math.round((paiseOf(h.amount) / paiseOf(heads.total)) * 100)}%</td></tr>)}
              {paiseOf(heads.advance) > 0 && <tr><td><strong>{t('fee.rep.advance')}</strong></td><td>—</td><td className="num">{inr(heads.advance)}</td><td className="num muted">{Math.round((paiseOf(heads.advance) / paiseOf(heads.total)) * 100)}%</td></tr>}
            </tbody>
            <tfoot><tr><th scope="row" colSpan={2}>{t('fee.struct.total')}</th><td className="num">{inr(heads.total)}</td><td className="num">100%</td></tr></tfoot>
          </table>
        </section>
      ))}

      {tab === 'dues' && (!dues ? !error && <SkeletonRows rows={5} /> : (
        <section className="card">
          <Matches ok={dues.matchesAccounts} ledger={dues.ledgerReceivable} />
          <div className="table-wrap">
            <table className="report-table">
              <caption className="sr-only">{t('fee.rep.dues')}</caption>
              <thead><tr><th scope="col">{t('stu.col.class')}</th><th scope="col" className="num">{t('fee.rep.withDues')}</th><th scope="col" className="num hide-sm">{t('fee.acct.billed')}</th><th scope="col" className="num hide-sm">{t('fee.acct.concession')}</th><th scope="col" className="num hide-sm">{t('fee.rep.fines')}</th><th scope="col" className="num hide-sm">{t('fee.acct.paid')}</th><th scope="col" className="num">{t('fee.acct.balance')}</th><th scope="col" className="num">{t('fee.due.overdue')}</th></tr></thead>
              <tbody>
                {dues.classes.map((c, i) => (
                  <tr key={i}><td><strong>{c.levelName ?? t('fee.rep.noClass')}</strong>{c.programName && <span className="sub-line muted">{c.programName}</span>}</td><td className="num">{c.students}</td><td className="num hide-sm">{inr(c.gross)}</td><td className="num hide-sm">{inr(c.concession)}</td><td className="num hide-sm">{inr(c.fine)}</td><td className="num hide-sm">{inr(c.paid)}</td><td className="num strong">{inr(c.balance)}</td><td className={`num ${paiseOf(c.overdue) ? 'overdue-text' : 'muted'}`}>{inr(c.overdue)}</td></tr>
                ))}
              </tbody>
              <tfoot><tr><th scope="row">{t('fee.struct.total')}</th><td className="num">{dues.classes.reduce((a, c) => a + c.students, 0)}</td><td className="hide-sm" /><td className="hide-sm" /><td className="hide-sm" /><td className="hide-sm" /><td className="num">{inr(dues.totalBalance)}</td><td className="num">{inr(String(dues.classes.reduce((a, c) => a + paiseOf(c.overdue), 0) / 100))}</td></tr></tfoot>
            </table>
          </div>
        </section>
      ))}
      {tab === 'carried' && <CarriedReport campusId={campusId ?? null} />}
      {tab === 'advances' && <AdvancesReport campusId={campusId ?? null} />}
    </>
  );
}

function ReportTable({ title, rows, total, countLabel }: { title: string; rows: [string, number, string][]; total: string; countLabel: string }) {
  const { t } = useI18n();
  return (
    <section className="card">
      <h2 className="card-title">{title}</h2>
      <table className="report-table">
        <caption className="sr-only">{title}</caption>
        <thead><tr><th scope="col">{title}</th><th scope="col" className="num">{countLabel}</th><th scope="col" className="num">{t('fee.acct.amount')}</th></tr></thead>
        <tbody>{rows.map(([k, n, a]) => <tr key={k}><td>{k}</td><td className="num muted">{n}</td><td className="num">{inr(a)}</td></tr>)}</tbody>
        <tfoot><tr><th scope="row">{t('fee.struct.total')}</th><td className="num">{rows.reduce((s, r) => s + r[1], 0)}</td><td className="num">{inr(total)}</td></tr></tfoot>
      </table>
    </section>
  );
}
