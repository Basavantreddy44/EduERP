'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { ClPill } from '@/components/campuslife';

interface Mine { member: { name: string; code: string }; limit: number; out: number; loans: { id: string; title: string; authors: string | null; accessionNo: string; dueDate: string; daysLate: number; canRenew: boolean; renewCount: number }[]; history: { id: string; title: string; returnDate: string | null; status: string }[]; reservations: { id: string; title: string; status: string; expiresOn: string | null }[] }

/** My library: the signed-in staff member's books, renewals and reservations. */
export default function MyLibraryPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [v, setV] = useState<Mine | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Mine | null>('/library/my').then(setV).catch(() => setV(null)); }, []);
  useEffect(load, [load]);
  const act = async (path: string, done: string) => {
    setBusy(true);
    try { await api(path, { method: 'POST', body: '{}' }); toast(done); load(); } catch (x) { toast(apiErrors(x).message ?? t('en.failed'), 'bad'); } finally { setBusy(false); }
  };
  const d = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
  return (
    <>
      <PageHeader eyebrow={t('nav.library')} title={t('lib.my.title')} description={v ? t('lib.memberLine', { out: v.out, limit: v.limit }) : t('lib.my.desc')} />
      {v === undefined ? <SkeletonRows rows={3} /> : !v ? <EmptyState icon="users" title={t('lib.my.noStaff')} /> : (
        <>
          {!v.loans.length ? <EmptyState icon="book" title={t('lib.my.none')} text={t('lib.my.noneHint')} /> : (
            <ul className="pay-mine">{v.loans.map((l) => (
              <li key={l.id} className="card">
                <span><strong>{l.title}</strong><span className="sub-line muted small">{[l.authors, l.accessionNo].filter(Boolean).join(' · ')}</span></span>
                <span className="pay-mine-amt"><span className="muted small">{t('lib.dueOn')}</span><strong className={l.daysLate ? 'text-bad' : undefined}>{d(l.dueDate)}</strong>{l.daysLate > 0 && <span className="small text-bad">{t('lib.daysLate', { n: l.daysLate })}</span>}</span>
                <button type="button" className="btn btn-sm" disabled={busy || !l.canRenew} onClick={() => void act(`/library/loans/${l.id}/renew`, t('lib.renewed'))} aria-label={t('lib.renewNamed', { title: l.title })}>{t('lib.renew')}</button>
              </li>
            ))}</ul>
          )}
          {v.reservations.length > 0 && (
            <section className="card p12-block" aria-labelledby="my-res">
              <h2 id="my-res" className="section-title">{t('lib.my.reservations')}</h2>
              <ul className="p12-action-list">{v.reservations.map((r) => (
                <li key={r.id}><span><strong>{r.title}</strong>{r.expiresOn && <span className="sub-line muted small">{t('lib.book.keptUntil', { d: d(r.expiresOn) })}</span>}</span>
                  <span className="row-actions"><ClPill prefix="lib.rs" status={r.status} /><button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void act(`/library/reservations/${r.id}/cancel`, t('lib.book.resCancelled'))}>{t('lib.book.cancelRes')}</button></span></li>
              ))}</ul>
            </section>
          )}
          {v.history.length > 0 && (
            <section className="card p12-block" aria-labelledby="my-hist">
              <h2 id="my-hist" className="section-title">{t('lib.my.history')}</h2>
              <ul className="p12-action-list">{v.history.map((h) => <li key={h.id}><span>{h.title}</span><span className="muted small">{h.status === 'LOST' ? t('lib.cs.LOST') : t('lib.my.returnedOn', { d: d(h.returnDate) })}</span></li>)}</ul>
            </section>
          )}
        </>
      )}
    </>
  );
}
