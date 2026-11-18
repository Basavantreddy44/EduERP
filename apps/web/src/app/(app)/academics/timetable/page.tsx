'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PERMISSIONS } from '@eduerp/shared';
import { ApiError, api } from '@/lib/api';
import { apiErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { todayIST } from '@/components/admissions';
import { AcadSection, Lesson, LessonChip, Period, SectionSelect, StaffOpt, WeekGrid, dayKey, shownDays, useAcadSections, useSectionParam } from '@/components/academics';

interface TtView {
  section: { id: string; name: string; campusId: string };
  periods: Period[];
  subjects: { id: string; code: string; name: string; teachers: { id: string; name: string }[] }[];
  rooms: { id: string; name: string; roomType: string }[];
  published: { id: string; version: number; effectiveFrom: string; publishedAt: string; entries: Lesson[] } | null;
  draft: { id: string; version: number; effectiveFrom: string; entries: Lesson[] } | null;
}
interface TeachersView {
  section: { id: string; name: string; campusId: string };
  classTeacher: StaffOpt | null;
  subjects: { subjectId: string; subject: { id: string; code: string; name: string }; subjectGroup: string; isOptional: boolean; teachers: StaffOpt[] }[];
}
type Draft = { dayOfWeek: number; periodId: string; subjectId: string; employeeId: string; roomId: string | null };
type Tab = 'timetable' | 'teachers';

/** Academics → Timetable (M8.1/M8.2): subject teachers of a section and its weekly timetable. */
export default function TimetablePage() {
  const { can } = useSession();
  const { t } = useI18n();
  const setup = can(PERMISSIONS.ACAD_SETUP);
  const sections = useAcadSections();
  const [sectionId, choose] = useSectionParam(sections);
  const [tab, setTab] = useState<Tab>('timetable');
  const section = sections?.find((s) => s.id === sectionId);

  return (
    <>
      <PageHeader eyebrow={t('nav.academics')} title={t('ac.tt.title')} description={t('ac.tt.desc')}
        actions={<Link href="/academics/substitutions" className="btn"><Icon name="swap" /> {t('nav.substitutions')}</Link>} />
      {!sections ? <SkeletonRows rows={5} /> : !sections.length ? <EmptyState icon="layers" title={t('ac.noSections')} text={t('ac.noSectionsHint')} /> : (
        <>
          <div className="panel-head">
            <SectionSelect sections={sections} value={sectionId} onChange={choose} />
            <div className="tabs" role="tablist" aria-label={section?.name ?? ''}>
              {(['timetable', 'teachers'] as Tab[]).map((x) => (
                <button key={x} type="button" role="tab" id={`tab-${x}`} aria-selected={tab === x} aria-controls={`panel-${x}`} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(x === 'timetable' ? 'ac.tab.week' : 'ac.tab.teachers')}</button>
              ))}
            </div>
          </div>
          {section && (
            <section role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="ac-panel">
              {tab === 'timetable' ? <Week key={section.id} section={section} setup={setup} onTeachers={() => setTab('teachers')} /> : <Teachers key={section.id} section={section} setup={setup} />}
            </section>
          )}
        </>
      )}
    </>
  );
}

function Week({ section, setup, onTeachers }: { section: AcadSection; setup: boolean; onTeachers: () => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [view, setView] = useState<TtView | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft[]>([]);
  const [from, setFrom] = useState(todayIST());
  const [slot, setSlot] = useState<{ day: number; period: Period } | null>(null);
  const [pick, setPick] = useState<{ subjectId: string; employeeId: string; roomId: string }>({ subjectId: '', employeeId: '', roomId: '' });
  const [clashes, setClashes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<TtView>(`/academics/sections/${section.id}/timetable`).then(setView).catch(() => setView(null)); }, [section.id]);
  useEffect(load, [load]);

  const startEdit = () => {
    const base = view?.draft ?? view?.published;
    setDraft((base?.entries ?? []).map((e) => ({ dayOfWeek: e.dayOfWeek, periodId: e.periodId, subjectId: e.subjectId, employeeId: e.employeeId, roomId: e.roomId })));
    setFrom(view?.draft?.effectiveFrom ?? todayIST());
    setClashes([]); setError(null); setEditing(true);
  };
  const subjects = view?.subjects ?? [];
  const teachable = subjects.filter((s) => s.teachers.length);
  const label = (d: Draft): Lesson => {
    const s = subjects.find((x) => x.id === d.subjectId);
    return { id: '', ...d, subject: s?.name ?? '', subjectCode: s?.code ?? '', teacher: s?.teachers.find((x) => x.id === d.employeeId)?.name ?? '', room: view?.rooms.find((r) => r.id === d.roomId)?.name ?? null };
  };
  const openSlot = (day: number, period: Period) => {
    const cur = draft.find((d) => d.dayOfWeek === day && d.periodId === period.id);
    const s = cur?.subjectId ?? teachable[0]?.id ?? '';
    setPick({ subjectId: s, employeeId: cur?.employeeId ?? teachable.find((x) => x.id === s)?.teachers[0]?.id ?? '', roomId: cur?.roomId ?? '' });
    setSlot({ day, period });
  };
  const putSlot = (e?: FormEvent) => {
    e?.preventDefault();
    if (!slot || !pick.subjectId || !pick.employeeId) return;
    setDraft((d) => [...d.filter((x) => !(x.dayOfWeek === slot.day && x.periodId === slot.period.id)), { dayOfWeek: slot.day, periodId: slot.period.id, subjectId: pick.subjectId, employeeId: pick.employeeId, roomId: pick.roomId || null }]);
    setSlot(null);
  };
  const clearSlot = () => { if (slot) setDraft((d) => d.filter((x) => !(x.dayOfWeek === slot.day && x.periodId === slot.period.id))); setSlot(null); };
  const saveDraft = async () => {
    setBusy(true); setError(null); setClashes([]);
    try {
      await api('/academics/timetable', { method: 'PUT', body: JSON.stringify({ sectionId: section.id, effectiveFrom: from, entries: draft }) });
      toast(t('ac.tt.draftSaved')); load(); return true;
    } catch (x) { setError(apiErrors(x).message ?? Object.values(apiErrors(x).fields)[0] ?? null); return false; } finally { setBusy(false); }
  };
  const publish = async () => {
    if (!(await saveDraft())) return;
    setBusy(true);
    try {
      const r = await api<{ version: number }>(`/academics/sections/${section.id}/timetable/publish`, { method: 'POST', body: '{}' });
      toast(t('ac.tt.published', { v: r.version })); setEditing(false); load();
    } catch (x) {
      if (x instanceof ApiError && x.type === 'timetable-clash') { setClashes((x.errors ?? []).map((e) => e.message)); setError(x.message); } else setError(apiErrors(x).message);
    } finally { setBusy(false); }
  };

  if (!view) return <SkeletonRows rows={6} />;
  const lessons = editing ? draft.map(label) : view.published?.entries ?? [];
  const days = shownDays(lessons);
  const teaching = view.periods.filter((p) => !p.isBreak);
  const perWeek = lessons.length;
  const free = days.length * teaching.length - perWeek;
  const date = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

  if (!view.periods.length) return <EmptyState icon="clock" title={t('ac.tt.noBells')} text={t('ac.tt.noBellsHint')} action={<Link href="/attendance/periods" className="btn">{t('nav.bellTimings')}</Link>} />;
  return (
    <>
      <div className="tt-status">
        <p>
          {view.published ? <><span className="pill pill-ok"><span className="pill-dot" />{t('ac.tt.live', { v: view.published.version })}</span> <span className="muted small">{t('ac.tt.since', { date: date(view.published.effectiveFrom) })}</span></> : <span className="pill pill-muted">{t('ac.tt.notPublished')}</span>}
          {view.draft && !editing && <> <span className="pill pill-warn">{t('ac.tt.draftWaiting', { v: view.draft.version })}</span></>}
        </p>
        {setup && !editing && <button type="button" className="btn btn-primary" onClick={startEdit} disabled={!teachable.length}><Icon name="edit" /> {view.draft ? t('ac.tt.continueDraft') : view.published ? t('ac.tt.newVersion') : t('ac.tt.make')}</button>}
      </div>
      {setup && !teachable.length && (
        <p className="notice"><Icon name="info" /> {t('ac.tt.needTeachers')} <button type="button" className="link-btn" onClick={onTeachers}>{t('ac.tab.teachers')}</button></p>
      )}
      {editing && (
        <div className="card tt-edit-bar">
          <Field id="tt-from" label={t('ac.tt.from')} hint={t('ac.tt.fromHint')}><input id="tt-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <p className="muted small">{t('ac.tt.count', { n: perWeek, free: Math.max(0, free) })}</p>
          <div className="spacer" />
          <button type="button" className="btn" onClick={() => setEditing(false)} disabled={busy}>{t('common.cancel')}</button>
          <button type="button" className="btn" onClick={() => void saveDraft()} disabled={busy}>{t('ac.tt.saveDraft')}</button>
          <button type="button" className="btn btn-primary" onClick={() => void publish()} disabled={busy || !draft.length}><Icon name="check" /> {t('ac.tt.publish')}</button>
        </div>
      )}
      {error && (
        <div className="form-error" role="alert">
          <p><Icon name="alert" /> {error}</p>
          {clashes.length > 0 && <ul className="tt-clashes">{clashes.map((c) => <li key={c}>{c}</li>)}</ul>}
        </div>
      )}
      {!editing && !view.published ? (
        <EmptyState icon="grid" title={t('ac.tt.none')} text={setup ? t('ac.tt.noneHintSetup') : t('ac.tt.noneHint')} />
      ) : (
        <WeekGrid periods={view.periods} days={days} label={t('ac.tt.weekOf', { name: section.name })}
          cell={(d, p) => {
            const l = lessons.find((x) => x.dayOfWeek === d && x.periodId === p.id);
            if (!editing) return l ? <LessonChip l={l} /> : <span className="tt-free">{t('ac.free')}</span>;
            return (
              <button type="button" className={`tt-slot${l ? ' filled' : ''}`} onClick={() => openSlot(d, p)} aria-label={t('ac.tt.slotLabel', { day: t(dayKey(d)), period: p.name, what: l ? `${l.subject}, ${l.teacher}` : t('ac.free') })}>
                {l ? <LessonChip l={l} /> : <span className="tt-add"><Icon name="plus" /> {t('ac.tt.addLesson')}</span>}
              </button>
            );
          }} />
      )}

      <Modal open={!!slot} onClose={() => setSlot(null)} title={slot ? `${t(dayKey(slot.day))} · ${slot.period.name}` : ''} subtitle={slot ? `${slot.period.startTime.slice(0, 5)}–${slot.period.endTime.slice(0, 5)}` : undefined} onSubmit={putSlot} submitLabel={t('ac.tt.setLesson')}>
        <Field id="sl-subject" label={t('ac.subject')}>
          <select id="sl-subject" value={pick.subjectId} onChange={(e) => setPick({ subjectId: e.target.value, employeeId: teachable.find((x) => x.id === e.target.value)?.teachers[0]?.id ?? '', roomId: pick.roomId })}>
            {teachable.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field id="sl-teacher" label={t('ac.teacher')} hint={t('ac.tt.teacherHint')}>
          <select id="sl-teacher" value={pick.employeeId} onChange={(e) => setPick((p) => ({ ...p, employeeId: e.target.value }))}>
            {(teachable.find((x) => x.id === pick.subjectId)?.teachers ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <Field id="sl-room" label={t('ac.room')}>
          <select id="sl-room" value={pick.roomId} onChange={(e) => setPick((p) => ({ ...p, roomId: e.target.value }))}>
            <option value="">{t('ac.tt.ownRoom')}</option>
            {(view.rooms ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        {slot && draft.some((x) => x.dayOfWeek === slot.day && x.periodId === slot.period.id) && (
          <button type="button" className="btn btn-ghost danger-text" onClick={clearSlot}><Icon name="trash" /> {t('ac.tt.clear')}</button>
        )}
      </Modal>
    </>
  );
}

function Teachers({ section, setup }: { section: AcadSection; setup: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const [view, setView] = useState<TeachersView | null>(null);
  const [staff, setStaff] = useState<StaffOpt[]>([]);
  const [classTeacher, setClassTeacher] = useState('');
  const [assigned, setAssigned] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api<TeachersView>(`/academics/sections/${section.id}/teachers`).then((v) => {
      setView(v);
      setClassTeacher(v.classTeacher?.id ?? '');
      setAssigned(Object.fromEntries(v.subjects.map((s) => [s.subjectId, s.teachers.map((x) => x.id)])));
    }).catch(() => setView(null));
    api<StaffOpt[]>(`/academics/staff?campusId=${section.campusId}`).then(setStaff).catch(() => setStaff([]));
  }, [section.id, section.campusId]);
  useEffect(load, [load]);
  const name = useMemo(() => new Map(staff.map((s) => [s.id, s.name])), [staff]);
  const add = (subjectId: string, id: string) => id && setAssigned((a) => ({ ...a, [subjectId]: [...(a[subjectId] ?? []).filter((x) => x !== id), id] }));
  const remove = (subjectId: string, id: string) => setAssigned((a) => ({ ...a, [subjectId]: (a[subjectId] ?? []).filter((x) => x !== id) }));
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api(`/academics/sections/${section.id}/teachers`, { method: 'PUT', body: JSON.stringify({ classTeacherId: classTeacher || null, subjects: Object.entries(assigned).map(([subjectId, employeeIds]) => ({ subjectId, employeeIds })) }) });
      toast(t('ac.teachers.saved', { name: section.name })); load();
    } catch (x) { setError(apiErrors(x).message ?? Object.values(apiErrors(x).fields)[0] ?? null); } finally { setBusy(false); }
  };

  if (!view) return <SkeletonRows rows={5} />;
  return (
    <>
      <div className="card ac-class-teacher">
        <Field id="ct" label={t('ac.classTeacher')} hint={t('ac.classTeacherHint')}>
          <select id="ct" value={classTeacher} disabled={!setup} onChange={(e) => setClassTeacher(e.target.value)}>
            <option value="">{t('tr.later')}</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.code}</option>)}
          </select>
        </Field>
        {setup && <button type="button" className="btn btn-primary" onClick={save} disabled={busy}><Icon name="check" /> {busy ? t('common.saving') : t('ac.teachers.save')}</button>}
      </div>
      {error && <p className="form-error" role="alert"><Icon name="alert" /> {error}</p>}
      {!view.subjects.length ? <EmptyState icon="book" title={t('ac.teachers.noSyllabus')} text={<Link href="/academics/subjects">{t('ac.teachers.noSyllabusHint')}</Link>} /> : (
        <div className="table-wrap card">
          <table className="table">
            <thead><tr><th scope="col">{t('ac.subject')}</th><th scope="col">{t('ac.teachers')}</th></tr></thead>
            <tbody>
              {view.subjects.map((s) => {
                const list = assigned[s.subjectId] ?? [];
                return (
                  <tr key={s.subjectId}>
                    <td><strong>{s.subject.name}</strong> <span className="code">{s.subject.code}</span>{s.isOptional && <span className="sub-line muted">{t('ac.optional')}</span>}</td>
                    <td>
                      <div className="chip-row">
                        {list.length === 0 && <span className="muted">{t('ac.teachers.none')}</span>}
                        {list.map((id) => (
                          <span key={id} className="chip ac-chip">{name.get(id) ?? s.teachers.find((x) => x.id === id)?.name ?? ''}
                            {setup && <button type="button" className="chip-x" onClick={() => remove(s.subjectId, id)} aria-label={t('ac.teachers.remove', { name: name.get(id) ?? '', subject: s.subject.name })}><Icon name="x" /></button>}
                          </span>
                        ))}
                        {setup && list.length < 5 && (
                          <select className="ac-add-teacher" aria-label={t('ac.teachers.addFor', { subject: s.subject.name })} value="" onChange={(e) => add(s.subjectId, e.target.value)}>
                            <option value="">{t('ac.teachers.add')}</option>
                            {staff.filter((x) => !list.includes(x.id)).map((x) => <option key={x.id} value={x.id}>{x.name}{x.designation ? ` · ${x.designation}` : ''}</option>)}
                          </select>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
