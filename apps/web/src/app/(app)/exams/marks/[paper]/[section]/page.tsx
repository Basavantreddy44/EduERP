'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ATTENDANCE_CODES } from '@eduerp/shared';
import { ApiError, api } from '@/lib/api';
import { apiErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';

interface SheetView {
  exam: { id: string; name: string }; subject: { name: string; code: string }; section: { id: string; name: string };
  paper: { id: string; examDate: string; maxMarks: number; passMarks: number | null };
  sheet: { id: string; status: string; submittedBy: string | null; submittedAt: string | null; verifiedBy: string | null; verifiedAt: string | null };
  canEnter: boolean; canCorrect: boolean; canVerify: boolean;
  students: { studentId: string; name: string; admissionNo: string; rollNo: string | null; attendanceCode: string | null; marks: number | null }[];
}
type Entry = { code: string; marks: string };

/** Mark entry for one paper and section (M9.2): enter, save, submit; verify or send back; correct with a reason. */
export default function SheetPage() {
  const { paper, section } = useParams<{ paper: string; section: string }>();
  const { t, locale } = useI18n();
  const toast = useToast();
  const [v, setV] = useState<SheetView | null>(null);
  const [missing, setMissing] = useState(false);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState('');
  const path = `/exams/papers/${paper}/sections/${section}`;
  const load = useCallback(() => {
    api<SheetView>(path).then((x) => {
      setV(x);
      setEntries(Object.fromEntries(x.students.map((s) => [s.studentId, { code: s.attendanceCode ?? 'PRESENT', marks: s.marks == null ? '' : String(s.marks) }])));
      setDirty(false); setRowErrors({}); setError(null);
    }).catch(() => setMissing(true));
  }, [path]);
  useEffect(load, [load]);
  const editable = !!v && (v.canEnter || (v.canCorrect && correcting));
  const set = (id: string, k: keyof Entry, val: string) => { setEntries((e) => ({ ...e, [id]: { ...e[id], [k]: val, ...(k === 'code' && val !== 'PRESENT' ? { marks: '' } : {}) } })); setDirty(true); };
  const stats = useMemo(() => {
    if (!v) return null;
    const vals = v.students.map((s) => entries[s.studentId]).filter((e) => e && e.code === 'PRESENT' && e.marks !== '').map((e) => Number(e.marks));
    return { entered: v.students.filter((s) => { const e = entries[s.studentId]; return e && (e.code !== 'PRESENT' || e.marks !== ''); }).length, avg: vals.length ? Math.round((vals.reduce((a, x) => a + x, 0) / vals.length) * 10) / 10 : null, top: vals.length ? Math.max(...vals) : null, below: v.paper.passMarks != null ? vals.filter((x) => x < v.paper.passMarks!).length : null };
  }, [v, entries]);

  const save = async (withReason?: string) => {
    if (!v) return false;
    const marks = v.students.map((s) => entries[s.studentId]).map((e, i) => ({ e, s: v.students[i] })).filter(({ e }) => e && (e.code !== 'PRESENT' || e.marks !== ''))
      .map(({ e, s }) => ({ studentId: s.studentId, attendanceCode: e.code, marks: e.code === 'PRESENT' ? Number(e.marks) : null }));
    setBusy(true); setError(null); setRowErrors({});
    try {
      const r = await api<{ saved: number }>(path, { method: 'PUT', body: JSON.stringify({ marks, reason: withReason ?? null }) });
      toast(t('ex.sheet.saved', { n: r.saved })); load(); setCorrecting(false); return true;
    } catch (x) {
      if (x instanceof ApiError && x.errors?.length) {
        const re: Record<number, string> = {};
        for (const er of x.errors) { const m = er.field.match(/^marks\.(\d+)/); if (m) re[v.students.findIndex((s) => s.studentId === marks[Number(m[1])]?.studentId)] = er.message; }
        setRowErrors(re);
      }
      setError(apiErrors(x).message ?? (x instanceof ApiError ? x.message : null)); return false;
    } finally { setBusy(false); }
  };
  const submit = async () => {
    if (dirty && !(await save())) return;
    setBusy(true); setError(null);
    try { await api(`${path}/submit`, { method: 'POST', body: '{}' }); toast(t('ex.sheet.submitted')); load(); }
    catch (x) { setError(x instanceof ApiError ? `${x.message}${x.errors?.length ? `: ${x.errors.map((e) => e.message).join(', ')}` : ''}` : null); } finally { setBusy(false); }
  };
  const verify = async (accept: boolean) => {
    setBusy(true); setError(null);
    try { await api(`${path}/verify`, { method: 'POST', body: JSON.stringify({ accept }) }); toast(accept ? t('ex.sheet.verifiedToast') : t('ex.sheet.sentBack')); load(); }
    catch (x) { setError(apiErrors(x).message); } finally { setBusy(false); }
  };
  const saveCorrection = async (e?: FormEvent) => { e?.preventDefault(); if (await save(reason)) setReasonOpen(false); };
  const when = (s: string | null) => (s ? new Date(s).toLocaleString(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '');

  if (missing) return <EmptyState icon="edit" title={t('ex.sheet.notFound')} action={<Link href="/exams/marks" className="btn">{t('nav.markEntry')}</Link>} />;
  if (!v) return <SkeletonRows rows={8} />;
  const st = v.sheet.status;
  return (
    <>
      <Link href="/exams/marks" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('nav.markEntry')}</Link>
      <PageHeader eyebrow={v.exam.name} title={`${v.subject.name} · ${v.section.name}`} description={t('ex.sheet.desc', { max: v.paper.maxMarks, pass: v.paper.passMarks ?? '—' })} />
      <div className="tt-status">
        <p>
          <span className={`sheet-chip ${st.toLowerCase()}`}>{t(`ex.sheet.${st}` as MessageKey)}</span>
          {v.sheet.submittedBy && <span className="muted small">{t('ex.sheet.by', { name: v.sheet.submittedBy, when: when(v.sheet.submittedAt) })}</span>}
          {v.sheet.verifiedBy && <span className="muted small">{t('ex.sheet.verifiedBy', { name: v.sheet.verifiedBy, when: when(v.sheet.verifiedAt) })}</span>}
        </p>
        {stats && <p className="muted small">{t('ex.sheet.stats', { n: stats.entered, of: v.students.length })}{stats.avg !== null ? ` · ${t('ex.sheet.avg', { n: stats.avg })}` : ''}{stats.top !== null ? ` · ${t('ex.sheet.top', { n: stats.top })}` : ''}{stats.below ? ` · ${t('ex.sheet.below', { n: stats.below })}` : ''}</p>}
      </div>
      {st === 'VERIFIED' && !correcting && <p className="notice"><Icon name="lock" /> {t('ex.sheet.locked')}{v.canCorrect && <> <button type="button" className="link-btn" onClick={() => setCorrecting(true)}>{t('ex.sheet.correct')}</button></>}</p>}
      {error && <p className="form-error" role="alert"><Icon name="alert" /> {error}</p>}
      {!v.students.length ? <EmptyState icon="users" title={t('ex.sheet.noStudents')} /> : (
        <div className="table-wrap card">
          <table className="table marks-grid">
            <thead><tr><th scope="col">{t('ex.sheet.roll')}</th><th scope="col">{t('ex.card.student')}</th><th scope="col">{t('ex.sheet.attendance')}</th><th scope="col" className="num">{t('ex.sheet.marksOf', { n: v.paper.maxMarks })}</th></tr></thead>
            <tbody>
              {v.students.map((s, i) => {
                const e = entries[s.studentId];
                const over = e?.code === 'PRESENT' && e.marks !== '' && Number(e.marks) > v.paper.maxMarks;
                const low = e?.code === 'PRESENT' && e.marks !== '' && v.paper.passMarks != null && Number(e.marks) < v.paper.passMarks;
                const err = rowErrors[i] ?? (over ? t('ex.sheet.overMax', { n: v.paper.maxMarks }) : null);
                return (
                  <tr key={s.studentId} className={err ? 'row-error' : undefined}>
                    <td>{s.rollNo ?? '—'}</td>
                    <th scope="row">{s.name}<span className="sub-line muted">{s.admissionNo}</span></th>
                    <td>
                      <select aria-label={t('ex.sheet.attendanceOf', { name: s.name })} value={e?.code} disabled={!editable} onChange={(x) => set(s.studentId, 'code', x.target.value)}>
                        {ATTENDANCE_CODES.map((c) => <option key={c} value={c}>{t(`ex.code.${c}` as MessageKey)}</option>)}
                      </select>
                    </td>
                    <td className="num">
                      <input type="number" inputMode="decimal" className={`num-in marks-in${low ? ' low' : ''}`} min={0} max={v.paper.maxMarks} step="0.5" aria-label={t('ex.sheet.marksFor', { name: s.name })} aria-invalid={!!err} aria-describedby={err ? `err-${i}` : undefined}
                        value={e?.marks ?? ''} disabled={!editable || e?.code !== 'PRESENT'} onChange={(x) => set(s.studentId, 'marks', x.target.value)} />
                      {err && <span id={`err-${i}`} className="field-error">{err}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="row-actions end sheet-actions">
        {v.canEnter && <>
          <button type="button" className="btn" onClick={() => void save()} disabled={busy || !dirty}>{t('ex.sheet.save')}</button>
          {st === 'PENDING' && <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}><Icon name="check" /> {t('ex.sheet.submit')}</button>}
        </>}
        {correcting && <>
          <button type="button" className="btn" onClick={() => { setCorrecting(false); load(); }} disabled={busy}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-primary" onClick={() => { setReason(''); setReasonOpen(true); }} disabled={busy || !dirty}>{t('ex.sheet.saveCorrection')}</button>
        </>}
        {v.canVerify && <>
          <button type="button" className="btn" onClick={() => void verify(false)} disabled={busy}>{t('ex.sheet.sendBack')}</button>
          <button type="button" className="btn btn-primary" onClick={() => void verify(true)} disabled={busy}><Icon name="check" /> {t('ex.sheet.verify')}</button>
        </>}
      </div>
      <Modal open={reasonOpen} onClose={() => setReasonOpen(false)} title={t('ex.sheet.correctTitle')} subtitle={`${v.subject.name} · ${v.section.name}`} onSubmit={saveCorrection} submitLabel={t('ex.sheet.saveCorrection')} busy={busy} error={error}>
        <Field id="corr-reason" label={t('ex.sheet.reason')} hint={t('ex.sheet.reasonHint')}><textarea id="corr-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>
    </>
  );
}
