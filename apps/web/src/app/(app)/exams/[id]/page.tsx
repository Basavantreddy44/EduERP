'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';

interface Paper { id: string; subjectId: string; examDate: string; startTime: string | null; endTime: string | null; maxMarks: number; passMarks: number | null; sheets: { sectionId: string; status: string }[] }
interface ExamView {
  exam: { id: string; name: string; startDate: string; endDate: string; scheme: { name: string }; component: { code: string; name: string; maxMarks: number; weightage: number } };
  canSetup: boolean;
  classes: { id: string; name: string; program: string; sections: { id: string; name: string }[]; subjects: { id: string; code: string; name: string }[]; papers: Paper[] }[];
}
type Row = { on: boolean; examDate: string; startTime: string; endTime: string; maxMarks: string; passMarks: string };

/** One exam (M9.2): its timetable per class and the state of every mark sheet. */
export default function ExamPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const [v, setV] = useState<ExamView | null>(null);
  const [missing, setMissing] = useState(false);
  const load = useCallback(() => { api<ExamView>(`/exams/${id}`).then(setV).catch(() => setMissing(true)); }, [id]);
  useEffect(load, [load]);
  if (missing) return <EmptyState icon="calendar" title={t('ex.notFound')} action={<Link href="/exams" className="btn">{t('nav.exams')}</Link>} />;
  if (!v) return <SkeletonRows rows={6} />;
  const d = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return (
    <>
      <Link href="/exams" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('nav.exams')}</Link>
      <PageHeader eyebrow={`${v.exam.scheme.name} · ${v.exam.component.name}`} title={v.exam.name} description={`${d(v.exam.startDate)} – ${d(v.exam.endDate)} · ${t('ex.weightIn', { w: v.exam.component.weightage })}`} />
      {!v.classes.length ? <EmptyState icon="layers" title={t('ex.noClassesInScheme')} text={t('ex.noClassesInSchemeHint')} /> : v.classes.map((c) => <ClassPapers key={c.id} exam={v} cls={c} reload={load} />)}
    </>
  );
}

function ClassPapers({ exam, cls, reload }: { exam: ExamView; cls: ExamView['classes'][number]; reload: () => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const start = () => {
    setRows(Object.fromEntries(cls.subjects.map((s) => {
      const p = cls.papers.find((x) => x.subjectId === s.id);
      return [s.id, { on: !!p, examDate: p?.examDate ?? exam.exam.startDate, startTime: p?.startTime ?? '', endTime: p?.endTime ?? '', maxMarks: String(p?.maxMarks ?? exam.exam.component.maxMarks), passMarks: p?.passMarks == null ? '' : String(p.passMarks) }];
    })));
    setError(null); setEditing(true);
  };
  const setRow = (sid: string, k: keyof Row, val: string | boolean) => setRows((r) => ({ ...r, [sid]: { ...r[sid], [k]: val } }));
  const save = async () => {
    setBusy(true); setError(null);
    const subjects = Object.entries(rows).filter(([, r]) => r.on).map(([subjectId, r]) => ({ subjectId, examDate: r.examDate, startTime: r.startTime || null, endTime: r.endTime || null, maxMarks: r.maxMarks, passMarks: r.passMarks || null }));
    try { await api(`/exams/${exam.exam.id}/schedule`, { method: 'PUT', body: JSON.stringify({ programLevelId: cls.id, subjects }) }); toast(t('ex.sched.saved', { name: cls.name })); setEditing(false); reload(); }
    catch (x) { const a = apiErrors(x); setError(a.message ?? Object.values(a.fields)[0] ?? null); } finally { setBusy(false); }
  };
  const subj = (sid: string) => cls.subjects.find((s) => s.id === sid);
  const d = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const papers = [...cls.papers].sort((a, b) => a.examDate.localeCompare(b.examDate) || (a.startTime ?? '').localeCompare(b.startTime ?? ''));

  return (
    <section className="card exam-class" aria-labelledby={`cls-${cls.id}`}>
      <div className="scheme-head">
        <div><h2 id={`cls-${cls.id}`} className="card-title">{cls.program} · {cls.name}</h2><p className="muted small">{t('ex.sectionsN', { n: cls.sections.length })}</p></div>
        {exam.canSetup && !editing && <button type="button" className="btn btn-sm" onClick={start}><Icon name="edit" /> {cls.papers.length ? t('ex.sched.edit') : t('ex.sched.make')}</button>}
      </div>
      {error && <p className="form-error" role="alert"><Icon name="alert" /> {error}</p>}
      {editing ? (
        <>
          <div className="table-wrap" role="region" aria-label={`${cls.program} · ${cls.name}`} tabIndex={0}>
            <table className="table sched-edit">
              <thead><tr><th scope="col">{t('ac.subject')}</th><th scope="col">{t('ac.sub.date')}</th><th scope="col">{t('ex.sched.from')}</th><th scope="col">{t('ex.sched.to')}</th><th scope="col">{t('ex.sched.max')}</th><th scope="col">{t('ex.sched.pass')}</th></tr></thead>
              <tbody>
                {cls.subjects.map((s) => {
                  const r = rows[s.id];
                  return (
                    <tr key={s.id} className={r.on ? undefined : 'row-dim'}>
                      <td><label className="check"><input type="checkbox" checked={r.on} onChange={(e) => setRow(s.id, 'on', e.target.checked)} /> {s.name}</label></td>
                      <td><input type="date" aria-label={t('ex.sched.dateOf', { s: s.name })} min={exam.exam.startDate} max={exam.exam.endDate} value={r.examDate} disabled={!r.on} onChange={(e) => setRow(s.id, 'examDate', e.target.value)} /></td>
                      <td><input type="time" aria-label={t('ex.sched.fromOf', { s: s.name })} value={r.startTime} disabled={!r.on} onChange={(e) => setRow(s.id, 'startTime', e.target.value)} /></td>
                      <td><input type="time" aria-label={t('ex.sched.toOf', { s: s.name })} value={r.endTime} disabled={!r.on} onChange={(e) => setRow(s.id, 'endTime', e.target.value)} /></td>
                      <td><input type="number" className="num-in" aria-label={t('ex.sched.maxOf', { s: s.name })} min={1} value={r.maxMarks} disabled={!r.on} onChange={(e) => setRow(s.id, 'maxMarks', e.target.value)} /></td>
                      <td><input type="number" className="num-in" aria-label={t('ex.sched.passOf', { s: s.name })} min={0} value={r.passMarks} disabled={!r.on} onChange={(e) => setRow(s.id, 'passMarks', e.target.value)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="row-actions end"><button type="button" className="btn" onClick={() => setEditing(false)} disabled={busy}>{t('common.cancel')}</button><button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}><Icon name="check" /> {busy ? t('common.saving') : t('ex.sched.save')}</button></div>
        </>
      ) : !papers.length ? <p className="muted">{t('ex.sched.none')}</p> : (
        <div className="table-wrap" role="region" aria-label={`${cls.program} · ${cls.name}`} tabIndex={0}>
          <table className="table">
            <thead><tr><th scope="col">{t('ac.sub.date')}</th><th scope="col">{t('ac.subject')}</th><th scope="col">{t('ex.sched.marks')}</th>{cls.sections.map((s) => <th key={s.id} scope="col">{t('ex.sched.section', { s: s.name })}</th>)}</tr></thead>
            <tbody>
              {papers.map((p) => (
                <tr key={p.id}>
                  <td>{d(p.examDate)}{p.startTime && <span className="sub-line muted">{p.startTime}{p.endTime ? `–${p.endTime}` : ''}</span>}</td>
                  <td><strong>{subj(p.subjectId)?.name}</strong></td>
                  <td>{p.maxMarks}{p.passMarks != null && <span className="sub-line muted">{t('ex.sched.passN', { n: p.passMarks })}</span>}</td>
                  {cls.sections.map((s) => {
                    const st = p.sheets.find((x) => x.sectionId === s.id)?.status ?? 'PENDING';
                    return <td key={s.id}><Link href={`/exams/marks/${p.id}/${s.id}`} className={`sheet-chip ${st.toLowerCase()}`}>{t(`ex.sheet.${st}` as MessageKey)}<span className="sr-only"> — {subj(p.subjectId)?.name}, {s.name}</span></Link></td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
