'use client';

import { FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { todayIST } from '@/components/accounts';
import { ActPill, fmtDay } from '@/components/activities';

interface Opts { sections: { id: string; name: string; campusId: string }[]; subjects: { id: string; name: string }[]; staff: { id: string; name: string; campusId: string }[]; me: string | null; can: { manage: boolean; session: boolean } }
interface Lab { id: string; name: string; campusId: string; isActive: boolean; can: { manage: boolean; session: boolean } }
interface Session { id: string; labId: string; lab: string; section: string; subject: string | null; batchName: string | null; teacher: string; sessionDate: string; startTime: string; endTime: string; experimentTitle: string; status: string; studentsPresent: number | null; remarks: string | null; can: { update: boolean } }
const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Labs → Practical sessions (M18.2): book a lab for a class; a lab is never booked twice at once. */
function Sessions() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const params = useSearchParams();
  const [opts, setOpts] = useState<Opts | null>(null);
  const [labs, setLabs] = useState<Lab[]>([]);
  const [labId, setLabId] = useState(params.get('lab') ?? '');
  const [mine, setMine] = useState(false);
  const [from, setFrom] = useState(todayIST());
  const [rows, setRows] = useState<Session[] | null>(null);
  const [book, setBook] = useState<{ labId: string; sectionId: string; subjectId: string; batchName: string; employeeId: string; sessionDate: string; startTime: string; endTime: string; experimentTitle: string } | null>(null);
  const [close, setClose] = useState<{ s: Session; status: 'COMPLETED' | 'CANCELLED'; studentsPresent: string; remarks: string } | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<Opts>('/labs/options').then(setOpts).catch(() => setOpts(null)); api<Lab[]>('/labs').then((l) => setLabs(l.filter((x) => x.isActive))).catch(() => setLabs([])); }, []);
  const load = useCallback(() => {
    setRows(null);
    const p = new URLSearchParams({ from, to: addDays(from, 13) });
    if (labId) p.set('labId', labId);
    if (mine) p.set('mine', 'true');
    api<{ rows: Session[] }>(`/labs/sessions?${p}`).then((r) => setRows(r.rows)).catch(() => setRows([]));
  }, [from, labId, mine]);
  useEffect(load, [load]);
  const reset = () => { setErrors({}); setError(null); };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!book) return;
    setBusy(true); reset();
    try {
      await api('/labs/sessions', { method: 'POST', body: JSON.stringify({ ...book, subjectId: book.subjectId || null, batchName: book.batchName || null, employeeId: book.employeeId || null }) });
      toast(t('lab.ses.booked')); setBook(null); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const saveClose = async (e: FormEvent) => {
    e.preventDefault();
    if (!close) return;
    setBusy(true); reset();
    try {
      await api(`/labs/sessions/${close.s.id}/status`, { method: 'POST', body: JSON.stringify({ status: close.status, studentsPresent: close.studentsPresent === '' ? null : Number(close.studentsPresent), remarks: close.remarks || null }) });
      toast(close.status === 'COMPLETED' ? t('lab.ses.doneToast') : t('lab.ses.cancelledToast')); setClose(null); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const bookable = labs.filter((l) => l.can.session);
  const bLab = labs.find((l) => l.id === book?.labId);
  const days = [...new Set((rows ?? []).map((r) => r.sessionDate))];
  return (
    <>
      <PageHeader eyebrow={t('nav.labs')} title={t('lab.ses.title')} description={t('lab.ses.desc')}
        actions={bookable.length > 0 && <button type="button" className="btn btn-primary" onClick={() => { reset(); setBook({ labId: labId || bookable[0].id, sectionId: '', subjectId: '', batchName: '', employeeId: '', sessionDate: todayIST(), startTime: '10:00', endTime: '11:00', experimentTitle: '' }); }}><Icon name="plus" /> {t('lab.ses.new')}</button>} />
      <div className="filter-bar card">
        <label className="inv-f">{t('lab.one')}<select value={labId} onChange={(e) => setLabId(e.target.value)}><option value="">{t('lab.allLabs')}</option>{labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label className="inv-f">{t('lab.ses.from')}<input type="date" value={from} onChange={(e) => setFrom(e.target.value || todayIST())} /></label>
        {opts?.me && <label className="check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> {t('lab.ses.mine')}</label>}
      </div>
      {!rows ? <SkeletonRows rows={4} /> : !rows.length ? <EmptyState icon="calendar" title={t('lab.ses.none')} text={t('lab.ses.noneHint')} /> : (
        <div className="act-days">
          {days.map((d) => (
            <section key={d} className="card p12-block" aria-labelledby={`day-${d}`}>
              <h2 id={`day-${d}`} className="section-title">{new Date(`${d}T00:00:00Z`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</h2>
              <ul className="act-sessions">{rows.filter((r) => r.sessionDate === d).map((s) => (
                <li key={s.id} className={s.status === 'CANCELLED' ? 'muted' : undefined}>
                  <span className="act-time mono">{s.startTime}–{s.endTime}</span>
                  <span className="act-what"><strong>{s.experimentTitle}</strong><span className="sub-line muted small">{[s.lab, s.section, s.batchName, s.subject, s.teacher].filter(Boolean).join(' · ')}</span>{s.remarks && <span className="sub-line small">{s.remarks}</span>}</span>
                  <span className="act-actions">
                    <ActPill prefix="lab.ses.st" status={s.status} />
                    {s.status === 'COMPLETED' && s.studentsPresent != null && <span className="muted small">{t('lab.ses.present', { n: s.studentsPresent })}</span>}
                    {s.can.update && <>
                      {s.sessionDate <= todayIST() && <button type="button" className="btn btn-sm" onClick={() => { reset(); setClose({ s, status: 'COMPLETED', studentsPresent: '', remarks: '' }); }}>{t('lab.ses.done')}</button>}
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => { reset(); setClose({ s, status: 'CANCELLED', studentsPresent: '', remarks: '' }); }}>{t('lab.ses.cancel')}</button>
                    </>}
                    {s.status !== 'CANCELLED' && <Link href={`/labs/breakages?new=1&lab=${s.labId}&session=${s.id}`} className="btn btn-sm btn-ghost">{t('lab.br.report')}</Link>}
                  </span>
                </li>
              ))}</ul>
            </section>
          ))}
        </div>
      )}

      <Modal open={!!book} onClose={() => setBook(null)} title={t('lab.ses.new')} subtitle={t('lab.ses.sub')} onSubmit={save} submitLabel={t('lab.ses.book')} busy={busy} error={error} wide>
        {book && opts && <>
          <div className="grid-3">
            <Field id="bs-lab" label={t('lab.one')} error={errors.labId}><select id="bs-lab" value={book.labId} onChange={(e) => setBook({ ...book, labId: e.target.value, sectionId: '' })}>{bookable.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
            <Field id="bs-sec" label={t('lab.ses.class')} error={errors.sectionId}><select id="bs-sec" value={book.sectionId} onChange={(e) => setBook({ ...book, sectionId: e.target.value })}><option value="">{t('act.choose')}</option>{opts.sections.filter((s) => !bLab || s.campusId === bLab.campusId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field id="bs-batch" label={t('lab.ses.batch')} hint={t('act.optional')} error={errors.batchName}><input id="bs-batch" value={book.batchName} placeholder={t('lab.ses.batchPh')} onChange={(e) => setBook({ ...book, batchName: e.target.value })} /></Field>
          </div>
          <Field id="bs-exp" label={t('lab.ses.experiment')} error={errors.experimentTitle}><input id="bs-exp" value={book.experimentTitle} onChange={(e) => setBook({ ...book, experimentTitle: e.target.value })} /></Field>
          <div className="grid-3">
            <Field id="bs-date" label={t('act.date')} error={errors.sessionDate}><input id="bs-date" type="date" min={todayIST()} value={book.sessionDate} onChange={(e) => setBook({ ...book, sessionDate: e.target.value })} /></Field>
            <Field id="bs-start" label={t('lab.ses.start')} error={errors.startTime}><input id="bs-start" type="time" value={book.startTime} onChange={(e) => setBook({ ...book, startTime: e.target.value })} /></Field>
            <Field id="bs-end" label={t('lab.ses.end')} error={errors.endTime}><input id="bs-end" type="time" value={book.endTime} onChange={(e) => setBook({ ...book, endTime: e.target.value })} /></Field>
          </div>
          <div className="grid-2">
            <Field id="bs-sub" label={t('lab.ses.subject')} hint={t('act.optional')} error={errors.subjectId}><select id="bs-sub" value={book.subjectId} onChange={(e) => setBook({ ...book, subjectId: e.target.value })}><option value="">—</option>{opts.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            {bLab?.can.manage
              ? <Field id="bs-who" label={t('lab.ses.teacher')} hint={t('lab.ses.teacherHint')} error={errors.employeeId}><select id="bs-who" value={book.employeeId} onChange={(e) => setBook({ ...book, employeeId: e.target.value })}><option value="">{t('lab.ses.me')}</option>{opts.staff.filter((s) => s.campusId === bLab.campusId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
              : <p className="muted small act-self">{t('lab.ses.forYou')}</p>}
          </div>
        </>}
      </Modal>

      <Modal open={!!close} onClose={() => setClose(null)} title={close?.status === 'COMPLETED' ? t('lab.ses.doneTitle') : t('lab.ses.cancelTitle')} subtitle={close ? `${close.s.experimentTitle} · ${fmtDay(locale, close.s.sessionDate)} ${close.s.startTime}` : undefined} onSubmit={saveClose} submitLabel={close?.status === 'COMPLETED' ? t('lab.ses.done') : t('lab.ses.cancel')} busy={busy} error={error} danger={close?.status === 'CANCELLED'}>
        {close && <>
          {close.status === 'COMPLETED' && <Field id="cl-n" label={t('lab.ses.presentLabel')} error={errors.studentsPresent}><input id="cl-n" inputMode="numeric" value={close.studentsPresent} onChange={(e) => setClose({ ...close, studentsPresent: e.target.value })} /></Field>}
          <Field id="cl-r" label={t('act.remarks')} error={errors.remarks}><input id="cl-r" value={close.remarks} onChange={(e) => setClose({ ...close, remarks: e.target.value })} /></Field>
        </>}
      </Modal>
    </>
  );
}

export default function LabSessionsPage() {
  return <Suspense fallback={<SkeletonRows rows={4} />}><Sessions /></Suspense>;
}
