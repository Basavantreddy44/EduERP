'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { formatINR, toPaise } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { todayIST } from '@/components/admissions';

interface View {
  event: { id: string; title: string; description: string | null; eventType: string; startDate: string; endDate: string; startTime: string | null; endTime: string | null; venue: string | null; registrationRequired: boolean; maxParticipants: number | null; requiresConsent: boolean; feeAmount: string | null; status: string; organiser: string | null };
  canManage: boolean;
  students: { studentId: string; name: string; admissionNo: string; section: string; response: string | null; billed: boolean; attended: boolean | null }[];
}

/** One event: who it is for, their answers, attendance (M11.2). */
export default function EventPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const toast = useToast();
  const [v, setV] = useState<View | null>(null);
  const [missing, setMissing] = useState(false);
  const [att, setAtt] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState('');
  const load = useCallback(() => { api<View>(`/engagement/events/${id}`).then((x) => { setV(x); setAtt(Object.fromEntries(x.students.map((s) => [s.studentId, !!s.attended]))); }).catch(() => setMissing(true)); }, [id]);
  useEffect(load, [load]);
  const respond = async (sid: string, going: boolean) => {
    try { const r = await api<{ billed: string | null }>(`/engagement/events/${id}/students/${sid}`, { method: 'POST', body: JSON.stringify({ going }) }); toast(r.billed ? t('ev.billedToast', { amount: formatINR(toPaise(r.billed)) }) : t('ev.savedToast')); load(); } catch (x) { toast(apiErrors(x).message ?? t('en.failed')); }
  };
  const saveAtt = async () => {
    try { await api(`/engagement/events/${id}/attendance`, { method: 'POST', body: JSON.stringify({ rows: Object.entries(att).map(([studentId, attended]) => ({ studentId, attended })) }) }); toast(t('ev.attSaved')); load(); } catch (x) { toast(apiErrors(x).message ?? t('en.failed')); }
  };
  const setStatus = async (status: 'PUBLISHED' | 'CANCELLED') => {
    try { await api(`/engagement/events/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }); toast(t(`ev.status.${status}` as MessageKey)); load(); } catch (x) { toast(apiErrors(x).message ?? t('en.failed')); }
  };
  if (missing) return <EmptyState icon="calendar" title={t('ev.notFound')} action={<Link href="/events" className="btn">{t('ev.title')}</Link>} />;
  if (!v) return <SkeletonRows rows={6} />;
  const e = v.event;
  const d = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const needsAnswer = e.registrationRequired || e.requiresConsent;
  const going = v.students.filter((s) => s.response === 'GOING').length;
  const started = e.startDate <= todayIST();
  const shown = v.students.filter((s) => !filter || (filter === 'NONE' ? !s.response : s.response === filter));
  return (
    <>
      <Link href="/events" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('ev.title')}</Link>
      <PageHeader eyebrow={t(`ev.type.${e.eventType}` as MessageKey)} title={e.title} description={`${d(e.startDate)}${e.endDate !== e.startDate ? ` – ${d(e.endDate)}` : ''}${e.startTime ? ` · ${e.startTime}${e.endTime ? `–${e.endTime}` : ''}` : ''}${e.venue ? ` · ${e.venue}` : ''}`}
        actions={v.canManage && e.status !== 'CANCELLED' && <>{e.status === 'DRAFT' && <button type="button" className="btn btn-primary" onClick={() => void setStatus('PUBLISHED')}>{t('ev.publish')}</button>}<button type="button" className="btn" onClick={() => void setStatus('CANCELLED')}>{t('ev.cancel')}</button></>} />
      {e.status !== 'PUBLISHED' && <p className="notice"><Icon name="info" /> {t(`ev.status.${e.status}` as MessageKey)}</p>}
      <dl className="ev-facts card">
        {e.description && <div className="wide"><dt>{t('ev.about')}</dt><dd>{e.description}</dd></div>}
        {e.organiser && <div><dt>{t('ev.organiser')}</dt><dd>{e.organiser}</dd></div>}
        <div><dt>{t('ev.replies')}</dt><dd>{e.requiresConsent ? t('ev.consent') : e.registrationRequired ? t('ev.registration') : t('ev.noReply')}</dd></div>
        {needsAnswer && <div><dt>{t('ev.goingLabel')}</dt><dd>{going}{e.maxParticipants ? ` / ${e.maxParticipants}` : ''}</dd></div>}
        {e.feeAmount && <div><dt>{t('ev.feeShort')}</dt><dd>{formatINR(toPaise(e.feeAmount))}</dd></div>}
      </dl>
      <div className="panel-head">
        <h2 className="section-title">{t('ev.students', { n: v.students.length })}</h2>
        {needsAnswer && <label className="ac-picker" htmlFor="ev-filter"><span>{t('ev.show')}</span><select id="ev-filter" value={filter} onChange={(x) => setFilter(x.target.value)}><option value="">{t('pt.mat.all')}</option><option value="GOING">{t('ev.going')}</option><option value="NOT_GOING">{t('ev.notGoing')}</option><option value="NONE">{t('ev.noAnswer')}</option></select></label>}
      </div>
      {!v.students.length ? <EmptyState icon="users" title={t('ev.noStudents')} /> : (
        <div className="table-wrap card">
          <table className="table">
            <thead><tr><th scope="col">{t('ex.card.student')}</th><th scope="col">{t('ac.section')}</th>{needsAnswer && <th scope="col">{t('ev.answer')}</th>}{started && <th scope="col">{t('ev.attended')}</th>}</tr></thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.studentId}>
                  <th scope="row">{s.name}<span className="sub-line muted">{s.admissionNo}</span></th>
                  <td>{s.section}</td>
                  {needsAnswer && <td>
                    {s.response ? <span className={`pill ${s.response === 'GOING' ? 'pill-ok' : 'pill-muted'}`}>{t(s.response === 'GOING' ? 'ev.going' : 'ev.notGoing')}</span> : <span className="muted">{t('ev.noAnswer')}</span>}
                    {s.billed && <span className="sub-line muted">{t('ev.billed')}</span>}
                    {v.canManage && e.status === 'PUBLISHED' && !started && <span className="row-actions">{s.response !== 'GOING' && <button type="button" className="btn btn-sm" onClick={() => void respond(s.studentId, true)} aria-label={t('ev.markGoing', { name: s.name })}>{t('ev.going')}</button>}{s.response !== 'NOT_GOING' && !s.billed && <button type="button" className="btn btn-sm btn-ghost" onClick={() => void respond(s.studentId, false)} aria-label={t('ev.markNotGoing', { name: s.name })}>{t('ev.notGoing')}</button>}</span>}
                  </td>}
                  {started && <td><label className="check"><input type="checkbox" checked={!!att[s.studentId]} disabled={!v.canManage} onChange={(x) => setAtt((a) => ({ ...a, [s.studentId]: x.target.checked }))} /> <span className="sr-only">{t('ev.attendedName', { name: s.name })}</span></label></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {started && v.canManage && v.students.length > 0 && <div className="row-actions end"><button type="button" className="btn btn-primary" onClick={() => void saveAtt()}><Icon name="check" /> {t('ev.saveAtt')}</button></div>}
    </>
  );
}
