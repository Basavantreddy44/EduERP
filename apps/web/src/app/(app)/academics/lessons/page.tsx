'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { todayIST } from '@/components/admissions';
import { AcadSection, SectionSelect, useAcadSections, useSectionParam } from '@/components/academics';

interface Topic { id: string; title: string; taughtOn: string | null }
interface Unit { id: string; title: string; plannedHours: number | null; topics: Topic[] }
interface Plan { id: string; topicId: string; plannedDate: string; objectives: string | null; teachingMethod: string | null; resources: string | null; status: string; completedOn: string | null; notes: string | null; teacher: string | null }
interface View { section: { id: string; name: string; programLevelId: string }; canPlan: boolean; units: Unit[]; completion: { taught: number; total: number; percent: number | null }; plans: Plan[] }
interface Progress { subjects: { subject: { id: string; code: string; name: string }; total: number; taught: number; upcoming: number; percent: number | null }[] }

/** Academics → Lesson plans (M10.1): a class's syllabus by unit and topic, lesson plans and how far each subject has got. */
export default function LessonsPage() {
  const { t } = useI18n();
  const sections = useAcadSections();
  const [sectionId, choose] = useSectionParam(sections);
  const section = sections?.find((s) => s.id === sectionId);
  return (
    <>
      <PageHeader eyebrow={t('nav.academics')} title={t('lp.title')} description={t('lp.desc')} />
      {!sections ? <SkeletonRows rows={5} /> : !sections.length ? <EmptyState icon="layers" title={t('ac.noSections')} text={t('ac.noSectionsHint')} /> : (
        <>
          <div className="panel-head"><SectionSelect sections={sections} value={sectionId} onChange={choose} /></div>
          {section && <SectionLessons key={section.id} section={section} />}
        </>
      )}
    </>
  );
}

function SectionLessons({ section }: { section: AcadSection }) {
  const { t } = useI18n();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [subjectId, setSubjectId] = useState('');
  const loadProgress = useCallback(() => { api<Progress>(`/academics/sections/${section.id}/progress`).then((p) => { setProgress(p); setSubjectId((cur) => cur || p.subjects[0]?.subject.id || ''); }).catch(() => setProgress({ subjects: [] })); }, [section.id]);
  useEffect(loadProgress, [loadProgress]);
  if (!progress) return <SkeletonRows rows={4} />;
  if (!progress.subjects.length) return <EmptyState icon="book" title={t('ac.teachers.noSyllabus')} text={t('ac.teachers.noSyllabusHint')} />;
  return (
    <>
      <h2 className="section-title first">{t('lp.progress')}</h2>
      <ul className="lp-progress" aria-label={t('lp.progress')}>
        {progress.subjects.map((s) => (
          <li key={s.subject.id}>
            <button type="button" className={`card lp-subject${s.subject.id === subjectId ? ' on' : ''}`} aria-pressed={s.subject.id === subjectId} onClick={() => setSubjectId(s.subject.id)}>
              <span className="lp-subject-name">{s.subject.name}</span>
              <span className="lp-bar" role="img" aria-label={t('lp.percentOf', { p: s.percent ?? 0, name: s.subject.name })}><span style={{ width: `${s.percent ?? 0}%` }} /></span>
              <span className="muted small">{s.total ? t('lp.topicsDone', { n: s.taught, of: s.total }) : t('lp.noTopics')}{s.upcoming ? ` · ${t('lp.upcoming', { n: s.upcoming })}` : ''}</span>
            </button>
          </li>
        ))}
      </ul>
      {subjectId && <SubjectLessons key={subjectId} section={section} subject={progress.subjects.find((s) => s.subject.id === subjectId)!.subject} onChange={loadProgress} />}
    </>
  );
}

function SubjectLessons({ section, subject, onChange }: { section: AcadSection; subject: { id: string; name: string }; onChange: () => void }) {
  const { can } = useSession();
  const { t, locale } = useI18n();
  const toast = useToast();
  const setup = can(PERMISSIONS.ACAD_SETUP);
  const [v, setV] = useState<View | null>(null);
  const [plan, setPlan] = useState<Topic | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [postpone, setPostpone] = useState<Plan | null>(null);
  const [editUnits, setEditUnits] = useState(false);
  const [draftUnits, setDraftUnits] = useState<{ id?: string; title: string; plannedHours: string; topics: { id?: string; title: string }[] }[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<View>(`/academics/sections/${section.id}/subjects/${subject.id}/lessons`).then(setV).catch(() => setV(null)); }, [section.id, subject.id]);
  useEffect(load, [load]);
  const after = () => { load(); onChange(); };
  const d = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const today = todayIST();

  const savePlan = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!plan) return;
    setBusy(true); setErrors({}); setError(null);
    try { await api('/academics/lesson-plans', { method: 'POST', body: JSON.stringify({ sectionId: section.id, subjectId: subject.id, topicId: plan.id, plannedDate: form.plannedDate, objectives: form.objectives || null, teachingMethod: form.teachingMethod || null, resources: form.resources || null }) }); toast(t('lp.planned')); setPlan(null); after(); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const taught = async (p: Plan) => {
    try { await api(`/academics/lesson-plans/${p.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'COMPLETED' }) }); toast(t('lp.taughtToast')); after(); }
    catch (x) { toast(apiErrors(x).message ?? t('lp.failed')); }
  };
  const savePostpone = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!postpone) return;
    setBusy(true); setErrors({}); setError(null);
    try { await api(`/academics/lesson-plans/${postpone.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'POSTPONED', newDate: form.newDate, notes: form.notes || null }) }); toast(t('lp.postponedToast')); setPostpone(null); after(); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const startUnits = () => { setDraftUnits((v?.units ?? []).map((u) => ({ id: u.id, title: u.title, plannedHours: u.plannedHours == null ? '' : String(u.plannedHours), topics: u.topics.map((x) => ({ id: x.id, title: x.title })) }))); setError(null); setEditUnits(true); };
  const saveUnits = async () => {
    setBusy(true); setError(null);
    const units = draftUnits.filter((u) => u.title.trim()).map((u) => ({ id: u.id ?? null, title: u.title, plannedHours: u.plannedHours === '' ? null : u.plannedHours, topics: u.topics.filter((x) => x.title.trim()).map((x) => ({ id: x.id ?? null, title: x.title })) }));
    try { await api('/academics/units', { method: 'PUT', body: JSON.stringify({ programLevelId: section.programLevelId, subjectId: subject.id, units }) }); toast(t('lp.unitsSaved')); setEditUnits(false); after(); }
    catch (x) { setError(apiErrors(x).message ?? Object.values(apiErrors(x).fields)[0] ?? null); } finally { setBusy(false); }
  };
  const setUnit = (i: number, patch: Partial<(typeof draftUnits)[number]>) => setDraftUnits((u) => u.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  if (!v) return <SkeletonRows rows={5} />;
  const plansOf = (topicId: string) => v.plans.filter((p) => p.topicId === topicId);
  return (
    <section className="lp-subject-panel" aria-labelledby="lp-subject-title">
      <div className="panel-head">
        <h2 id="lp-subject-title" className="card-title">{subject.name} · {section.name}{v.completion.percent !== null && <span className="muted small"> · {t('lp.percentDone', { p: v.completion.percent })}</span>}</h2>
        {setup && !editUnits && <button type="button" className="btn btn-sm" onClick={startUnits}><Icon name="edit" /> {v.units.length ? t('lp.editUnits') : t('lp.addUnits')}</button>}
      </div>
      {error && !plan && !postpone && <p className="form-error" role="alert"><Icon name="alert" /> {error}</p>}
      {editUnits ? (
        <div className="card lp-units-edit">
          <p className="muted small">{t('lp.unitsHint')}</p>
          {draftUnits.map((u, i) => (
            <fieldset key={u.id ?? `n${i}`} className="lp-unit-edit">
              <legend>{t('lp.unitN', { n: i + 1 })}</legend>
              <div className="grid-2">
                <Field id={`u-${i}`} label={t('lp.unitTitle')}><input id={`u-${i}`} value={u.title} onChange={(e) => setUnit(i, { title: e.target.value })} /></Field>
                <Field id={`uh-${i}`} label={t('lp.hours')}><input id={`uh-${i}`} type="number" min={0} step="0.5" value={u.plannedHours} onChange={(e) => setUnit(i, { plannedHours: e.target.value })} /></Field>
              </div>
              <ol className="lp-topic-edit">
                {u.topics.map((x, j) => (
                  <li key={x.id ?? `t${j}`}>
                    <input aria-label={t('lp.topicN', { n: j + 1, unit: i + 1 })} value={x.title} onChange={(e) => setUnit(i, { topics: u.topics.map((y, k) => (k === j ? { ...y, title: e.target.value } : y)) })} />
                    <button type="button" className="btn btn-ghost icon-btn" aria-label={t('lp.removeTopic', { n: j + 1 })} onClick={() => setUnit(i, { topics: u.topics.filter((_, k) => k !== j) })}><Icon name="x" /></button>
                  </li>
                ))}
              </ol>
              <div className="row-actions">
                <button type="button" className="btn btn-sm" onClick={() => setUnit(i, { topics: [...u.topics, { title: '' }] })}><Icon name="plus" /> {t('lp.addTopic')}</button>
                <button type="button" className="btn btn-sm btn-ghost danger-text" onClick={() => setDraftUnits((all) => all.filter((_, k) => k !== i))}><Icon name="trash" /> {t('lp.removeUnit')}</button>
              </div>
            </fieldset>
          ))}
          <div className="row-actions end">
            <button type="button" className="btn" onClick={() => setDraftUnits((u) => [...u, { title: '', plannedHours: '', topics: [{ title: '' }] }])}><Icon name="plus" /> {t('lp.addUnit')}</button>
            <span className="spacer" />
            <button type="button" className="btn" onClick={() => setEditUnits(false)} disabled={busy}>{t('common.cancel')}</button>
            <button type="button" className="btn btn-primary" onClick={() => void saveUnits()} disabled={busy}><Icon name="check" /> {busy ? t('common.saving') : t('lp.saveUnits')}</button>
          </div>
        </div>
      ) : !v.units.length ? <EmptyState icon="book" title={t('lp.noUnits')} text={setup ? t('lp.noUnitsSetup') : t('lp.noUnitsHint')} /> : v.units.map((u, i) => (
        <section key={u.id} className="card lp-unit" aria-labelledby={`unit-${u.id}`}>
          <h3 id={`unit-${u.id}`} className="lp-unit-title">{t('lp.unitN', { n: i + 1 })} · {u.title}{u.plannedHours != null && <span className="muted small"> · {t('lp.hoursN', { n: u.plannedHours })}</span>}</h3>
          <ol className="lp-topics">
            {u.topics.map((x) => (
              <li key={x.id} className={x.taughtOn ? 'done' : undefined}>
                <div className="lp-topic-head">
                  <span className="lp-check" aria-hidden="true">{x.taughtOn ? <Icon name="check" size={14} /> : null}</span>
                  <strong>{x.title}</strong>
                  {x.taughtOn ? <span className="pill pill-ok">{t('lp.taughtOn', { date: d(x.taughtOn) })}</span> : v.canPlan && <button type="button" className="btn btn-sm" onClick={() => { setForm({ plannedDate: today, objectives: '', teachingMethod: '', resources: '' }); setErrors({}); setError(null); setPlan(x); }}><Icon name="plus" /> {t('lp.plan')}</button>}
                </div>
                {plansOf(x.id).length > 0 && (
                  <ul className="lp-plans">
                    {plansOf(x.id).map((p) => (
                      <li key={p.id}>
                        <span className={`pill ${p.status === 'COMPLETED' ? 'pill-ok' : p.status === 'POSTPONED' ? 'pill-muted' : p.plannedDate < today ? 'pill-warn' : 'pill-info'}`}>{t(`lp.status.${p.status}` as MessageKey)}</span>
                        <span>{d(p.plannedDate)}{p.teacher ? ` · ${p.teacher}` : ''}{p.objectives ? ` · ${p.objectives}` : ''}{p.notes ? ` · “${p.notes}”` : ''}</span>
                        {v.canPlan && p.status === 'PLANNED' && <span className="row-actions">
                          {p.plannedDate <= today && <button type="button" className="btn btn-sm btn-primary" onClick={() => void taught(p)}><Icon name="check" /> {t('lp.markTaught')}</button>}
                          <button type="button" className="btn btn-sm" onClick={() => { setForm({ newDate: p.plannedDate > today ? p.plannedDate : today, notes: '' }); setErrors({}); setError(null); setPostpone(p); }}>{t('lp.postpone')}</button>
                        </span>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
      <Modal open={!!plan} onClose={() => setPlan(null)} title={t('lp.planTitle')} subtitle={plan?.title} onSubmit={savePlan} submitLabel={t('lp.savePlan')} busy={busy} error={error}>
        <Field id="lp-date" label={t('lp.date')} error={errors.plannedDate}><input id="lp-date" type="date" value={form.plannedDate ?? ''} onChange={(e) => setForm((f) => ({ ...f, plannedDate: e.target.value }))} /></Field>
        <Field id="lp-obj" label={t('lp.objectives')} error={errors.objectives}><textarea id="lp-obj" rows={3} value={form.objectives ?? ''} onChange={(e) => setForm((f) => ({ ...f, objectives: e.target.value }))} placeholder={t('lp.objectivesPh')} /></Field>
        <div className="grid-2">
          <Field id="lp-method" label={t('lp.method')} error={errors.teachingMethod}><input id="lp-method" value={form.teachingMethod ?? ''} onChange={(e) => setForm((f) => ({ ...f, teachingMethod: e.target.value }))} placeholder={t('lp.methodPh')} /></Field>
          <Field id="lp-res" label={t('lp.resources')} error={errors.resources}><input id="lp-res" value={form.resources ?? ''} onChange={(e) => setForm((f) => ({ ...f, resources: e.target.value }))} placeholder={t('lp.resourcesPh')} /></Field>
        </div>
      </Modal>
      <Modal open={!!postpone} onClose={() => setPostpone(null)} title={t('lp.postponeTitle')} onSubmit={savePostpone} submitLabel={t('lp.postpone')} busy={busy} error={error}>
        <Field id="pp-date" label={t('lp.newDate')} error={errors.newDate}><input id="pp-date" type="date" min={today} value={form.newDate ?? ''} onChange={(e) => setForm((f) => ({ ...f, newDate: e.target.value }))} /></Field>
        <Field id="pp-notes" label={t('lp.why')} error={errors.notes}><input id="pp-notes" value={form.notes ?? ''} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder={t('lp.whyPh')} /></Field>
      </Modal>
    </section>
  );
}
