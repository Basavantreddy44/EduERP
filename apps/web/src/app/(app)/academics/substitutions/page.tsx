'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { todayIST } from '@/components/admissions';
import { Lesson, Period, SectionSelect, StaffOpt, Sub, dayKey, hm, useAcadSections, weekdayOf } from '@/components/academics';

interface TtView { periods: Period[]; published: { entries: Lesson[] } | null }

/** Academics → Substitutions (M8.2): who covers which lesson on a day; arrange a free teacher. */
export default function SubstitutionsPage() {
  const { can } = useSession();
  const { t, locale } = useI18n();
  const toast = useToast();
  const setup = can(PERMISSIONS.ACAD_SETUP);
  const sections = useAcadSections();
  const campuses = useMemo(() => [...new Map((sections ?? []).map((s) => [s.campusId, s.campus])).entries()].map(([id, name]) => ({ id, name })), [sections]);
  const [campusId, setCampusId] = useState('');
  const [date, setDate] = useState(todayIST());
  const [rows, setRows] = useState<Sub[] | null>(null);
  // Arrange: section → lesson (of that weekday) → free teacher.
  const [open, setOpen] = useState(false);
  const [sectionId, setSectionId] = useState('');
  const [week, setWeek] = useState<TtView | null>(null);
  const [lessonId, setLessonId] = useState('');
  const [free, setFree] = useState<StaffOpt[] | null>(null);
  const [form, setForm] = useState({ substituteEmployeeId: '', reason: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!campusId && campuses[0]) setCampusId(campuses[0].id); }, [campuses, campusId]);
  const load = useCallback(() => {
    if (!campusId) return;
    setRows(null);
    api<Sub[]>(`/academics/substitutions?campusId=${campusId}&date=${date}`).then(setRows).catch(() => setRows([]));
  }, [campusId, date]);
  useEffect(load, [load]);

  const campusSections = (sections ?? []).filter((s) => s.campusId === campusId);
  const wd = weekdayOf(date);
  const lessons = (week?.published?.entries ?? []).filter((e) => e.dayOfWeek === wd).sort((a, b) => (week?.periods.findIndex((p) => p.id === a.periodId) ?? 0) - (week?.periods.findIndex((p) => p.id === b.periodId) ?? 0));
  const periodName = (id: string) => week?.periods.find((p) => p.id === id);

  const start = () => {
    setSectionId(campusSections[0]?.id ?? ''); setLessonId(''); setFree(null);
    setForm({ substituteEmployeeId: '', reason: '' }); setErrors({}); setError(null); setOpen(true);
  };
  useEffect(() => {
    if (!open || !sectionId) return;
    setWeek(null); setLessonId(''); setFree(null);
    api<TtView>(`/academics/sections/${sectionId}/timetable`).then(setWeek).catch(() => setWeek({ periods: [], published: null }));
  }, [open, sectionId]);
  useEffect(() => {
    if (!lessonId) { setFree(null); return; }
    setFree(null);
    api<StaffOpt[]>(`/academics/lessons/${lessonId}/free-teachers?date=${date}`).then((r) => { setFree(r); setForm((f) => ({ ...f, substituteEmployeeId: r[0]?.id ?? '' })); }).catch(() => setFree([]));
  }, [lessonId, date]);

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!lessonId || !form.substituteEmployeeId) { setError(t('ac.sub.pickLesson')); return; }
    setBusy(true); setErrors({}); setError(null);
    try {
      const r = await api<Sub & { notified: boolean }>('/academics/substitutions', { method: 'POST', body: JSON.stringify({ timetableEntryId: lessonId, date, ...form }) });
      toast(r.notified ? t('ac.sub.doneNotified', { name: r.substitute }) : t('ac.sub.done', { name: r.substitute }));
      setOpen(false); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const cancel = async (s: Sub) => {
    try { await api(`/academics/substitutions/${s.id}/cancel`, { method: 'POST', body: '{}' }); toast(t('ac.sub.cancelled')); load(); } catch (x) { toast(apiErrors(x).message ?? t('ac.sub.cancelFailed')); }
  };
  const longDate = new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const past = date < todayIST();

  return (
    <>
      <PageHeader eyebrow={t('nav.academics')} title={t('ac.sub.title')} description={t('ac.sub.desc')}
        actions={setup && <button type="button" className="btn btn-primary" onClick={start} disabled={!campusSections.length || past}><Icon name="plus" /> {t('ac.sub.arrange')}</button>} />
      <div className="panel-head">
        <label className="ac-picker" htmlFor="sub-date"><span>{t('ac.sub.date')}</span><input id="sub-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
        {campuses.length > 1 && (
          <label className="ac-picker" htmlFor="sub-campus"><span>{t('common.campus')}</span>
            <select id="sub-campus" value={campusId} onChange={(e) => setCampusId(e.target.value)}>{campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </label>
        )}
      </div>
      <h2 className="section-title">{longDate}</h2>
      {!sections || !rows ? <SkeletonRows rows={4} /> : rows.length === 0 ? <EmptyState icon="swap" title={t('ac.sub.none')} text={setup && !past ? t('ac.sub.noneHint') : undefined} /> : (
        <div className="table-wrap card">
          <table className="table">
            <thead><tr><th scope="col">{t('ac.period')}</th><th scope="col">{t('ac.section')}</th><th scope="col">{t('ac.subject')}</th><th scope="col">{t('ac.sub.absent')}</th><th scope="col">{t('ac.sub.covers')}</th><th scope="col">{t('common.status')}</th>{setup && <th scope="col"><span className="sr-only">{t('common.actions')}</span></th>}</tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className={s.status !== 'ASSIGNED' ? 'row-dim' : undefined}>
                  <td><strong>{s.period}</strong>{s.startTime && <span className="sub-line muted">{hm(s.startTime)}</span>}</td>
                  <td>{s.section}</td>
                  <td>{s.subject}</td>
                  <td>{s.absent}<span className="sub-line muted">{s.reason}</span></td>
                  <td><strong>{s.substitute}</strong></td>
                  <td><StatusBadge status={s.status} /></td>
                  {setup && <td className="row-actions">{s.status === 'ASSIGNED' && !past && <button type="button" className="btn btn-sm" onClick={() => void cancel(s)} aria-label={t('ac.sub.cancelFor', { name: s.substitute, period: s.period })}>{t('common.cancel')}</button>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={t('ac.sub.arrange')} subtitle={longDate} onSubmit={save} submitLabel={t('ac.sub.assign')} busy={busy} error={error}>
        {sections && <SectionSelect id="sub-section" sections={campusSections} value={sectionId} onChange={setSectionId} />}
        {!week ? <SkeletonRows rows={2} /> : !lessons.length ? <p className="notice"><Icon name="info" /> {t('ac.sub.noLessons', { day: t(dayKey(wd)) })}</p> : (
          <fieldset className="check-group sub-lessons"><legend>{t('ac.sub.whichLesson')}</legend>
            {lessons.map((l) => (
              <label key={l.id} className="check"><input type="radio" name="lesson" value={l.id} checked={lessonId === l.id} onChange={() => setLessonId(l.id)} />
                <span><strong>{periodName(l.periodId)?.name}</strong> · {l.subject} · {l.teacher}<span className="muted small"> {hm(periodName(l.periodId)?.startTime)}</span></span>
              </label>
            ))}
          </fieldset>
        )}
        {lessonId && (
          free === null ? <SkeletonRows rows={1} /> : !free.length ? <p className="notice"><Icon name="alert" /> {t('ac.sub.nobodyFree')}</p> : (
            <Field id="sub-who" label={t('ac.sub.who')} hint={t('ac.sub.whoHint')} error={errors.substituteEmployeeId}>
              <select id="sub-who" value={form.substituteEmployeeId} onChange={(e) => setForm((f) => ({ ...f, substituteEmployeeId: e.target.value }))}>{free.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.code}</option>)}</select>
            </Field>
          )
        )}
        <Field id="sub-reason" label={t('ac.sub.reason')} error={errors.reason}><input id="sub-reason" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder={t('ac.sub.reasonPh')} /></Field>
      </Modal>
    </>
  );
}
