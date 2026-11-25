'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { EmptyState, PageHeader, SkeletonRows } from '@/components/ui';
import { useDay } from '@/components/admissions';
import type { MoveRow } from '@/components/residential';

/** Moves between schools (Phase 21 R2): every student and staff move, newest first. */
export default function MovesPage() {
  const { t } = useI18n();
  const day = useDay();
  const [rows, setRows] = useState<MoveRow[] | null>(null);
  const [kind, setKind] = useState<'' | 'STUDENT' | 'STAFF'>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    const p = new URLSearchParams();
    if (kind) p.set('personType', kind);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    api<MoveRow[]>(`/moves?${p}`).then(setRows).catch(() => setRows([]));
  }, [kind, from, to]);

  return (
    <>
      <PageHeader eyebrow={t('nav.students')} title={t('mv.listTitle')} description={t('mv.listDesc')} />
      <div className="toolbar">
        <select value={kind} onChange={(e) => setKind(e.target.value as '' | 'STUDENT' | 'STAFF')} aria-label={t('mv.who')}>
          <option value="">{t('mv.everyone')}</option>
          <option value="STUDENT">{t('mv.students')}</option>
          <option value="STAFF">{t('mv.staff')}</option>
        </select>
        <label className="inline-field">{t('mv.from')} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline-field">{t('mv.to')} <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {rows && <span className="muted">{t('mv.count', { n: rows.length })}</span>}
      </div>
      {!rows ? <SkeletonRows /> : !rows.length ? <EmptyState icon="swap" title={t('mv.none')} text={t('mv.noneText')} /> : (
        <div className="table-wrap" role="region" aria-label={t('mv.listTitle')} tabIndex={0}>
          <table>
            <thead><tr><th scope="col">{t('mv.date')}</th><th scope="col">{t('mv.person')}</th><th scope="col">{t('mv.fromSchool')}</th><th scope="col">{t('mv.toSchoolCol')}</th><th scope="col">{t('mv.orderNo')}</th><th scope="col">{t('mv.reason')}</th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>{day(m.transferDate)}</td>
                  <td>
                    <Link href={m.personType === 'STUDENT' ? `/students/${m.personId}` : `/hr/staff/${m.personId}`}>{m.name}</Link>
                    <span className="sub-line muted small">{m.personType === 'STUDENT' ? t('mv.student') : t('mv.staffOne')} · {m.code}</span>
                  </td>
                  <td>{m.from}</td>
                  <td><Icon name="arrowRight" size={14} className="muted" /> {m.to}</td>
                  <td>{m.orderNo ?? '—'}</td>
                  <td className="small">{m.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
