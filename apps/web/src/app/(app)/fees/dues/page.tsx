'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PERMISSIONS, formatINR } from '@eduerp/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { apiErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { ExportButton } from '@/components/ExportButton';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { useDay } from '@/components/admissions';
import { paiseOf, useFeeOptions } from '@/components/fees';
import { initials, studentName } from '@/components/students';

interface Row {
  studentId: string; admissionNo: string; firstName: string; lastName: string | null; levelName: string | null; sectionName: string | null;
  guardianName: string | null; guardianPhone: string | null; guardianEmail: string | null; bills: number;
  balance: string; overdue: string; notDue: string; d1_30: string; d31_60: string; d61_90: string; d90_plus: string; earlier: string; oldestDue: string | null; lastReminder: string | null;
}
interface Dues { today: string; total: number; page: number; pageSize: number; totals: Record<'balance' | 'overdue' | 'notDue' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus' | 'earlier', string> & { students: number }; items: Row[] }

const BUCKETS = [['notDue', 'fee.due.b.notDue'], ['d1_30', 'fee.due.b.d1_30'], ['d31_60', 'fee.due.b.d31_60'], ['d61_90', 'fee.due.b.d61_90'], ['d90_plus', 'fee.due.b.d90_plus']] as const;
const inr = (v: string) => formatINR(paiseOf(v));

export default function DuesPage() {
  const { can, campusId } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const day = useDay();
  const { opts } = useFeeOptions();
  const canBill = can(PERMISSIONS.FEE_BILL);
  const [f, setF] = useState({ q: '', level: '', minDays: '', earlier: false, sort: 'overdue', page: 1 });
  useEffect(() => { if (new URLSearchParams(window.location.search).get('overdue') === '1') setF((x) => ({ ...x, minDays: '1' })); }, []); // from the dashboard
  const [text, setText] = useState('');
  const [d, setD] = useState<Dues | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<null | 'remind' | 'late'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [withLink, setWithLink] = useState(true);

  useEffect(() => { const h = setTimeout(() => setF((x) => (x.q === text.trim() ? x : { ...x, q: text.trim(), page: 1 })), 250); return () => clearTimeout(h); }, [text]);
  const query = useMemo(() => {
    const p = new URLSearchParams({ sort: f.sort, page: String(f.page), pageSize: '50' });
    if (f.q) p.set('q', f.q);
    if (f.level) p.set('programLevelId', f.level);
    if (f.minDays) p.set('minDaysOverdue', f.minDays);
    if (f.earlier) p.set('earlier', 'only');
    if (campusId) p.set('campusId', campusId);
    return p.toString();
  }, [f, campusId]);
  const load = useCallback(() => { api<Dues>(`/fees/dues?${query}`).then(setD).catch(() => setD(null)); }, [query]);
  useEffect(load, [load]);

  const programs = (opts?.programs ?? []).filter((p) => !campusId || p.campusId === campusId);
  const maxBucket = d ? Math.max(1, ...BUCKETS.map(([k]) => paiseOf(d.totals[k]))) : 1;
  const pageIds = d?.items.map((r) => r.studentId) ?? [];
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.includes(id));
  const daysLate = (iso: string | null) => (iso ? Math.max(0, Math.round((Date.parse(`${d?.today}T00:00:00Z`) - Date.parse(iso)) / 86_400_000)) : 0);

  async function act(kind: 'remind' | 'late') {
    setBusy(true); setError(null);
    try {
      if (kind === 'late') {
        const r = await api<{ invoiceCount: number; totalFine: string }>('/fees/late-fees/apply', { method: 'POST', body: '{}' });
        toast(r.invoiceCount ? t('fee.due.lateDone', { n: r.invoiceCount, v: inr(r.totalFine) }) : t('fee.due.lateNone'));
      } else {
        const r = await api<{ sent: number; skipped: { reason: string }[] }>('/fees/reminders', { method: 'POST', body: JSON.stringify({ studentIds: selected, includePayLink: withLink }) });
        toast(t('fee.due.remindDone', { n: r.sent, s: r.skipped.length }));
        setSelected([]);
      }
      setDialog(null);
      load();
    } catch (e) { setError(apiErrors(e).message); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader
        eyebrow={t('nav.fees')}
        title={t('fee.due.title')}
        description={t('fee.due.desc')}
        actions={
          <>
            {canBill && <button type="button" className="btn" onClick={() => { setError(null); setDialog('late'); }}><Icon name="clock" /> {t('fee.due.applyLate')}</button>}
            <ExportButton type="FEE_DUES" />
          </>
        }
      />

      {!d ? <SkeletonRows rows={6} /> : (
        <>
          <section className="card dues-summary" aria-label={t('fee.due.summary')}>
            <div className="dues-headline">
              <div><span className="muted small">{t('fee.due.totalDue')}</span><strong>{inr(d.totals.balance)}</strong><span className="muted small">{t('fee.due.students', { n: d.totals.students })}</span></div>
              <div className="overdue"><span className="small">{t('fee.due.overdue')}</span><strong>{inr(d.totals.overdue)}</strong></div>
              {paiseOf(d.totals.earlier) > 0 && <div className="earlier"><span className="small">{t('cr.earlierYears')}</span><strong>{inr(d.totals.earlier)}</strong></div>}
            </div>
            <ul className="ageing" aria-label={t('fee.due.ageing')}>
              {BUCKETS.map(([k, label]) => {
                const v = paiseOf(d.totals[k]);
                return (
                  <li key={k} title={`${t(label)}: ${formatINR(v)}`}>
                    <span className="ageing-label">{t(label)}</span>
                    <span className="ageing-track" aria-hidden><span className={`ageing-bar ${k === 'notDue' ? 'soft' : ''}`} style={{ width: `${v ? Math.max(2, (v / maxBucket) * 100) : 0}%` }} /></span>
                    <span className="ageing-value">{formatINR(v)}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          <div className="card filter-bar">
            <label className="search-box"><Icon name="search" size={18} /><span className="sr-only">{t('common.search')}</span><input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('fee.due.search')} /></label>
            <label className="filter"><span>{t('stu.col.class')}</span>
              <select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value, page: 1 })}>
                <option value="">{t('stu.allClasses')}</option>
                {programs.map((p) => <optgroup key={p.id} label={p.name}>{p.levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</optgroup>)}
              </select>
            </label>
            <label className="filter"><span>{t('fee.due.overdueFor')}</span>
              <select value={f.minDays} onChange={(e) => setF({ ...f, minDays: e.target.value, page: 1 })}>
                <option value="">{t('fee.due.anyDues')}</option>
                {['1', '30', '60', '90'].map((n) => <option key={n} value={n}>{t('fee.due.moreThan', { n })}</option>)}
              </select>
            </label>
            <label className="check filter-check"><input type="checkbox" checked={f.earlier} onChange={(e) => setF({ ...f, earlier: e.target.checked, page: 1 })} /> {t('cr.onlyEarlier')}</label>
            <label className="filter"><span>{t('fee.due.sort')}</span>
              <select value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value, page: 1 })}>
                {['overdue', 'balance', 'oldest', 'class', 'name'].map((s) => <option key={s} value={s}>{t(`fee.due.sortBy.${s}` as MessageKey)}</option>)}
              </select>
            </label>
          </div>

          {d.items.length === 0 ? <EmptyState icon="check" title={t('fee.due.noneTitle')} text={t('fee.due.noneText')} /> : (
            <>
              {canBill && (
                <div className="bulk-bar">
                  <span className="muted small">{selected.length ? t('fee.due.selected', { n: selected.length }) : t('fee.due.selectHint')}</span>
                  <button type="button" className="btn btn-sm btn-primary" disabled={!selected.length} onClick={() => { setError(null); setDialog('remind'); }}><Icon name="mail" size={15} /> {t('fee.due.remind', { n: selected.length })}</button>
                </div>
              )}
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">{t('fee.due.title')}</caption>
                  <thead>
                    <tr>
                      {canBill && <th scope="col" className="check-col"><input type="checkbox" aria-label={t('fee.due.selectPage')} checked={allOnPage} onChange={() => setSelected((s) => (allOnPage ? s.filter((x) => !pageIds.includes(x)) : [...new Set([...s, ...pageIds])]))} /></th>}
                      <th scope="col">{t('stu.col.student')}</th>
                      <th scope="col" className="hide-sm">{t('stu.col.class')}</th>
                      <th scope="col">{t('stu.col.parent')}</th>
                      <th scope="col" className="num">{t('fee.acct.balance')}</th>
                      <th scope="col" className="num">{t('fee.due.overdue')}</th>
                      <th scope="col" className="hide-sm">{t('fee.due.oldest')}</th>
                      <th scope="col" className="hide-sm">{t('fee.due.reminded')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((r) => {
                      const late = daysLate(r.oldestDue);
                      return (
                        <tr key={r.studentId}>
                          {canBill && <td className="check-col"><input type="checkbox" aria-label={`${t('fee.due.select')} ${studentName(r)}`} checked={selected.includes(r.studentId)} onChange={() => setSelected((s) => (s.includes(r.studentId) ? s.filter((x) => x !== r.studentId) : [...s, r.studentId]))} /></td>}
                          <td>
                            <Link href={`/students/${r.studentId}`} className="person-cell">
                              <span className="avatar avatar-sm" aria-hidden>{initials(r)}</span>
                              <span><strong>{studentName(r)}</strong><span className="sub-line muted mono">{r.admissionNo}</span></span>
                            </Link>
                          </td>
                          <td className="hide-sm">{r.levelName ? `${r.levelName} – ${r.sectionName}` : <span className="muted">—</span>}</td>
                          <td>{r.guardianName ?? '—'}{r.guardianPhone && <span className="sub-line"><a className="muted" href={`tel:${r.guardianPhone}`}>{r.guardianPhone}</a></span>}{!r.guardianEmail && <span className="sub-line muted small">{t('fee.due.noEmail')}</span>}</td>
                          <td className="num strong">{inr(r.balance)}{paiseOf(r.earlier) > 0 && <span className="sub-line small earlier-text">{t('cr.earlierShort', { v: inr(r.earlier) })}</span>}</td>
                          <td className={`num ${paiseOf(r.overdue) ? 'overdue-text' : 'muted'}`}>{paiseOf(r.overdue) ? inr(r.overdue) : '—'}</td>
                          <td className="hide-sm">{r.oldestDue ? <>{day(r.oldestDue)}{late > 0 && <span className={`sub-line small ${late > 90 ? 'overdue-text' : 'muted'}`}>{t('fee.due.daysLate', { n: late })}</span>}</> : '—'}</td>
                          <td className="hide-sm">{r.lastReminder ? day(r.lastReminder) : <span className="muted">—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {d.total > d.pageSize && (
                  <div className="pager">
                    <span className="muted" aria-live="polite">{t('common.showing', { from: (d.page - 1) * d.pageSize + 1, to: Math.min(d.page * d.pageSize, d.total), total: d.total })}</span>
                    <div className="pager-buttons">
                      <button type="button" className="btn btn-sm" disabled={d.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })} aria-label={t('common.previous')}><Icon name="chevronRight" size={16} className="flip" /></button>
                      <span className="pager-page">{d.page} / {Math.ceil(d.total / d.pageSize)}</span>
                      <button type="button" className="btn btn-sm" disabled={d.page * d.pageSize >= d.total} onClick={() => setF({ ...f, page: f.page + 1 })} aria-label={t('common.next')}><Icon name="chevronRight" size={16} /></button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {dialog === 'remind' && (
        <Modal open onClose={() => setDialog(null)} title={t('fee.due.remindTitle')} subtitle={t('fee.due.selected', { n: selected.length })} submitLabel={t('fee.due.send')} busy={busy} error={error} onSubmit={(e) => { e.preventDefault(); void act('remind'); }}>
          <p>{t('fee.due.remindText')}</p>
          <label className="check"><input type="checkbox" checked={withLink} onChange={(e) => setWithLink(e.target.checked)} /> {t('fee.due.withLink')}</label>
        </Modal>
      )}
      {dialog === 'late' && (
        <Modal open onClose={() => setDialog(null)} title={t('fee.due.lateTitle')} submitLabel={t('fee.due.applyLate')} busy={busy} error={error} onSubmit={(e) => { e.preventDefault(); void act('late'); }}>
          <p>{t('fee.due.lateText')}</p>
          <p className="note-info"><Icon name="info" size={15} /> {t('fee.due.lateAuto')}</p>
        </Modal>
      )}
    </>
  );
}
