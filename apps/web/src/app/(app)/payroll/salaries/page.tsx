'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { EmptyState, PageHeader, SkeletonRows } from '@/components/ui';
import { rupees } from '@/components/accounts';

interface Row { employeeId: string; name: string; code: string; designation: string | null; campusId: string; salary: { id: string; structure: string; monthlyGross: string; effectiveFrom: string; pf: boolean; esi: boolean; pt: boolean; tdsOverride: string | null } | null; loanOwed: string | null }

/** Payroll → Staff salaries (M15.1): who has a salary, how much, from when. */
export default function SalariesPage() {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [campuses, setCampuses] = useState<{ id: string; name: string }[]>([]);
  const [campusId, setCampusId] = useState('');
  const [q, setQ] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  useEffect(() => { api<{ id: string; name: string }[]>('/campuses').then(setCampuses).catch(() => setCampuses([])); }, []);
  useEffect(() => { setRows(null); api<Row[]>(`/payroll/salaries${campusId ? `?campusId=${campusId}` : ''}`).then(setRows).catch(() => setRows([])); }, [campusId]);
  const list = useMemo(() => (rows ?? []).filter((r) => (!onlyMissing || !r.salary) && (!q || `${r.name} ${r.code} ${r.designation ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [rows, q, onlyMissing]);
  const without = (rows ?? []).filter((r) => !r.salary).length;
  const total = (rows ?? []).reduce((s, r) => s + (r.salary ? Number(r.salary.monthlyGross) : 0), 0);
  const d = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const campusName = (id: string) => campuses.find((c) => c.id === id)?.name ?? '';
  return (
    <>
      <PageHeader eyebrow={t('nav.payroll')} title={t('pay.sal.title')} description={t('pay.sal.desc')} />
      <div className="filter-bar">
        <label className="sr-only" htmlFor="sal-q">{t('pay.sal.search')}</label>
        <input id="sal-q" type="search" placeholder={t('pay.sal.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        {campuses.length > 1 && <><label className="sr-only" htmlFor="sal-campus">{t('pay.campus')}</label><select id="sal-campus" value={campusId} onChange={(e) => setCampusId(e.target.value)}><option value="">{t('pay.allCampuses')}</option>{campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></>}
        <label className="check"><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> {t('pay.sal.onlyMissing', { n: without })}</label>
      </div>
      {rows && rows.length > 0 && <p className="muted small">{t('pay.sal.summary', { n: rows.length - without, total: rupees(total) })}</p>}
      {!rows ? <SkeletonRows rows={6} /> : !list.length ? <EmptyState icon="users" title={t('pay.sal.none')} /> : (
        <div className="table-wrap card" role="region" aria-label={t('pay.sal.title')} tabIndex={0}>
          <table className="table">
            <thead><tr><th scope="col">{t('pay.name')}</th><th scope="col">{t('pay.sal.structure')}</th><th scope="col" className="num">{t('pay.sal.gross')}</th><th scope="col">{t('pay.sal.from')}</th><th scope="col">{t('pay.sal.statutory')}</th><th scope="col"><span className="sr-only">{t('pay.open')}</span></th></tr></thead>
            <tbody>{list.map((r) => (
              <tr key={r.employeeId}>
                <td><Link href={`/payroll/salaries/${r.employeeId}`}><strong>{r.name}</strong></Link><span className="sub-line muted small">{r.code}{r.designation ? ` · ${r.designation}` : ''}{campuses.length > 1 ? ` · ${campusName(r.campusId)}` : ''}</span></td>
                <td>{r.salary?.structure ?? <span className="pill pill-warn"><span className="pill-dot" />{t('pay.sal.notSet')}</span>}</td>
                <td className="num">{r.salary ? <strong>{rupees(r.salary.monthlyGross)}</strong> : '—'}{r.loanOwed && <span className="sub-line muted small">{t('pay.sal.loanOwed', { amt: rupees(r.loanOwed) })}</span>}</td>
                <td>{r.salary ? d(r.salary.effectiveFrom) : '—'}</td>
                <td className="small">{r.salary ? [r.salary.pf && 'PF', r.salary.esi && 'ESI', r.salary.pt && 'PT', r.salary.tdsOverride != null && t('pay.sal.tdsFixed')].filter(Boolean).join(' · ') || '—' : '—'}</td>
                <td><Link className="btn btn-sm" href={`/payroll/salaries/${r.employeeId}`}>{r.salary ? t('pay.open') : <><Icon name="plus" size={14} /> {t('pay.sal.set')}</>}</Link></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
