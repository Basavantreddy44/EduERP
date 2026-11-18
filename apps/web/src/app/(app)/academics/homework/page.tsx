'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { todayIST } from '@/components/admissions';
import { AcadSection, SectionSelect, useAcadSections, useSectionParam } from '@/components/academics';

interface Hw { id: string; subjectId: string; subject: string; title: string; description: string | null; dueDate: string; allowSubmission: boolean; submitted: number; marked: number; createdAt: string }
interface HwList { section: { id: string; name: string }; students: number; canPost: boolean; items: Hw[] }
interface SubRow { studentId: string; name: string; admissionNo: string; rollNo: string | null; submission: { id: string; text: string | null; submittedAt: string; late: boolean; grade: string | null; feedback: string | null; status: string } | null }
interface Note { id: string; noteDate: string; note: string; studentId: string | null; student: string | null; needsAck: boolean; acks: number; expected: number }
interface DiaryList { section: { id: string; name: string }; students: number; canPost: boolean; roster: { id: string; name: string; rollNo: string | null }[]; items: Note[] }
type Tab = 'homework' | 'diary';

/** Academics → Homework & diary (M8.3): post homework, see and mark submissions; the class diary. */
export default function HomeworkPage() {
  const { t } = useI18n();
  const sections = useAcadSections();
  const [sectionId, choose] = useSectionParam(sections);
  const [tab, setTab] = useState<Tab>('homework');
  const section = sections?.find((s) => s.id === sectionId);
  return (
    <>
      <PageHeader eyebrow={t('nav.academics')} title={t('ac.hw.title')} description={t('ac.hw.desc')} />
      {!sections ? <SkeletonRows rows={5} /> : !sections.length ? <EmptyState icon="book" title={t('ac.hw.noClasses')} text={t('ac.hw.noClassesHint')} /> : (
        <>
          <div className="panel-head">
            <SectionSelect sections={sections} value={sectionId} onChange={choose} />
            <div className="tabs" role="tablist" aria-label={section?.name ?? ''}>
              {(['homework', 'diary'] as Tab[]).map((x) => <button key={x} type="button" role="tab" id={`tab-${x}`} aria-selected={tab === x} aria-controls={`panel-${x}`} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(x === 'homework' ? 'ac.tab.homework' : 'ac.tab.diary')}</button>)}
            </div>
          </div>
          {section && (
            <section role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="ac-panel">
              {tab === 'homework' ? <Homework key={section.id} section={section} /> : <Diary key={section.id} section={section} />}
            </section>
          )}
        </>
      )}
    </>
  );
}

const shortDate = (d: string, locale: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

function Homework({ section }: { section: AcadSection }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [list, setList] = useState<HwList | null>(null);
  const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<Hw | null>(null);
  const load = useCallback(() => { api<HwList>(`/academics/sections/${section.id}/homework`).then(setList).catch(() => setList(null)); }, [section.id]);
  useEffect(load, [load]);
  useEffect(() => { api<{ subjects: { subject: { id: string; name: string } }[] }>(`/academics/sections/${section.id}/teachers`).then((r) => setSubjects(r.subjects.map((s) => s.subject))).catch(() => setSubjects([])); }, [section.id]);
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const tomorrow = new Date(Date.parse(`${todayIST()}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const start = () => { setForm({ subjectId: subjects[0]?.id ?? '', title: '', description: '', dueDate: tomorrow, allowSubmission: true }); setErrors({}); setError(null); setOpen(true); };
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try {
      const r = await api<{ notified: number }>('/academics/homework', { method: 'POST', body: JSON.stringify({ sectionId: section.id, ...form, description: form.description || null }) });
      toast(t('ac.hw.posted', { n: r.notified }));
      setOpen(false); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  if (!list) return <SkeletonRows rows={4} />;
  const today = todayIST();
  return (
    <>
      <div className="panel-head">
        <p className="muted">{t('ac.hw.studentsN', { n: list.students })}</p>
        {list.canPost && <button type="button" className="btn btn-primary" onClick={start} disabled={!subjects.length}><Icon name="plus" /> {t('ac.hw.give')}</button>}
      </div>
      {!list.items.length ? <EmptyState icon="book" title={t('ac.hw.none')} text={list.canPost ? t('ac.hw.noneHint') : undefined} /> : (
        <ul className="hw-list">
          {list.items.map((h) => {
            const overdue = h.dueDate < today;
            return (
              <li key={h.id} className="card hw-card">
                <div className="hw-main">
                  <span className="hw-subject">{h.subject}</span>
                  <strong className="hw-title">{h.title}</strong>
                  {h.description && <p className="hw-desc">{h.description}</p>}
                </div>
                <div className="hw-side">
                  <span className={`pill ${h.dueDate === today ? 'pill-warn' : overdue ? 'pill-muted' : 'pill-info'}`}>{h.dueDate === today ? t('ac.hw.dueToday') : t('ac.hw.due', { date: shortDate(h.dueDate, locale) })}</span>
                  {h.allowSubmission ? (
                    <>
                      <span className="hw-count"><strong>{h.submitted}</strong> / {list.students} {t('ac.hw.submitted')}{h.marked ? ` · ${t('ac.hw.markedN', { n: h.marked })}` : ''}</span>
                      <button type="button" className="btn btn-sm" onClick={() => setView(h)} aria-label={t('ac.hw.viewFor', { title: h.title })}><Icon name="eye" /> {t('ac.hw.view')}</button>
                    </>
                  ) : <span className="muted small">{t('ac.hw.noSubmit')}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('ac.hw.give')} subtitle={section.name} onSubmit={save} submitLabel={t('ac.hw.post')} busy={busy} error={error}>
        <div className="grid-2">
          <Field id="hw-subject" label={t('ac.subject')} error={errors.subjectId}><select id="hw-subject" value={String(form.subjectId)} onChange={set('subjectId')}>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field id="hw-due" label={t('ac.hw.dueLabel')} error={errors.dueDate}><input id="hw-due" type="date" min={today} value={String(form.dueDate)} onChange={set('dueDate')} /></Field>
        </div>
        <Field id="hw-title" label={t('ac.hw.what')} error={errors.title}><input id="hw-title" value={String(form.title ?? '')} onChange={set('title')} placeholder={t('ac.hw.whatPh')} /></Field>
        <Field id="hw-desc" label={t('ac.hw.details')} error={errors.description}><textarea id="hw-desc" rows={4} value={String(form.description ?? '')} onChange={set('description')} /></Field>
        <label className="check"><input type="checkbox" checked={!!form.allowSubmission} onChange={(e) => setForm((f) => ({ ...f, allowSubmission: e.target.checked }))} /> {t('ac.hw.allowSubmit')}</label>
        <p className="muted small">{t('ac.hw.parentsTold')}</p>
      </Modal>
      {view && <Submissions hw={view} onClose={() => { setView(null); load(); }} />}
    </>
  );
}

function Submissions({ hw, onClose }: { hw: Hw; onClose: () => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [data, setData] = useState<{ canMark: boolean; students: SubRow[] } | null>(null);
  const [marking, setMarkingState] = useState<SubRow | null>(null);
  // While the marking form is open the list dialog closes itself; that close must not end the whole view.
  const markingRef = useRef(false);
  const setMarking = (s: SubRow | null) => { markingRef.current = !!s; setMarkingState(s); };
  const [form, setForm] = useState({ grade: '', feedback: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<{ canMark: boolean; students: SubRow[] }>(`/academics/homework/${hw.id}/submissions`).then(setData).catch(() => setData({ canMark: false, students: [] })); }, [hw.id]);
  useEffect(load, [load]);
  const mark = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!marking?.submission) return;
    setBusy(true); setError(null);
    try {
      await api(`/academics/submissions/${marking.submission.id}/mark`, { method: 'POST', body: JSON.stringify({ grade: form.grade, feedback: form.feedback || null }) });
      toast(t('ac.hw.markedFor', { name: marking.name })); setMarking(null); load();
    } catch (x) { setError(apiErrors(x).message ?? Object.values(apiErrors(x).fields)[0] ?? null); } finally { setBusy(false); }
  };
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  return (
    <>
      <Modal open={!marking} onClose={() => { if (!markingRef.current) onClose(); }} title={hw.title} subtitle={`${hw.subject} · ${t('ac.hw.due', { date: shortDate(hw.dueDate, locale) })}`} wide onSubmit={onClose} hideCancel submitLabel={t('common.close')}>
        {!data ? <SkeletonRows rows={4} /> : (
          <ul className="sub-list">
            {data.students.map((s) => (
              <li key={s.studentId} className={s.submission ? undefined : 'row-dim'}>
                <div className="sub-who"><strong>{s.name}</strong><span className="muted small">{s.rollNo ? t('ac.hw.roll', { n: s.rollNo }) : s.admissionNo}</span></div>
                {s.submission ? (
                  <div className="sub-what">
                    <p className="sub-text">{s.submission.text}</p>
                    <p className="muted small">{when(s.submission.submittedAt)}{s.submission.late ? ` · ${t('ac.hw.late')}` : ''}</p>
                    {s.submission.status === 'MARKED' ? <p className="sub-grade"><span className="pill pill-ok">{t('ac.hw.grade', { g: s.submission.grade ?? '' })}</span> {s.submission.feedback}</p>
                      : data.canMark && <button type="button" className="btn btn-sm" onClick={() => { setForm({ grade: '', feedback: '' }); setError(null); setMarking(s); }}><Icon name="check" /> {t('ac.hw.mark')}</button>}
                  </div>
                ) : <span className="muted">{t('ac.hw.notYet')}</span>}
              </li>
            ))}
          </ul>
        )}
      </Modal>
      <Modal open={!!marking} onClose={() => setMarking(null)} title={t('ac.hw.markTitle', { name: marking?.name ?? '' })} subtitle={hw.title} onSubmit={mark} submitLabel={t('ac.hw.saveMark')} busy={busy} error={error}>
        {marking?.submission?.text && <blockquote className="sub-quote">{marking.submission.text}</blockquote>}
        <Field id="mk-grade" label={t('ac.hw.gradeLabel')} hint={t('ac.hw.gradeHint')}><input id="mk-grade" value={form.grade} maxLength={10} onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value }))} placeholder="A" /></Field>
        <Field id="mk-feedback" label={t('ac.hw.feedback')}><textarea id="mk-feedback" rows={3} value={form.feedback} onChange={(e) => setForm((f) => ({ ...f, feedback: e.target.value }))} /></Field>
      </Modal>
    </>
  );
}

function Diary({ section }: { section: AcadSection }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [list, setList] = useState<DiaryList | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<DiaryList>(`/academics/sections/${section.id}/diary`).then(setList).catch(() => setList(null)); }, [section.id]);
  useEffect(load, [load]);
  const start = () => { setForm({ studentId: '', noteDate: todayIST(), note: '', needsAck: true }); setErrors({}); setError(null); setOpen(true); };
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try {
      const r = await api<{ notified: number }>('/academics/diary', { method: 'POST', body: JSON.stringify({ sectionId: section.id, ...form, studentId: form.studentId || null }) });
      toast(t('ac.diary.sent', { n: r.notified })); setOpen(false); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  if (!list) return <SkeletonRows rows={4} />;
  return (
    <>
      <div className="panel-head">
        <p className="muted">{t('ac.diary.hint')}</p>
        {list.canPost && <button type="button" className="btn btn-primary" onClick={start}><Icon name="plus" /> {t('ac.diary.write')}</button>}
      </div>
      {!list.items.length ? <EmptyState icon="clipboard" title={t('ac.diary.none')} text={list.canPost ? t('ac.diary.noneHint') : undefined} /> : (
        <ul className="diary-list">
          {list.items.map((n) => (
            <li key={n.id} className="card diary-card">
              <div className="diary-head">
                <span className="muted small">{shortDate(n.noteDate, locale)}</span>
                <span className={`pill ${n.studentId ? 'pill-info' : 'pill-muted'}`}>{n.student ? t('ac.diary.forOne', { name: n.student }) : t('ac.diary.forClass')}</span>
              </div>
              <p className="diary-note">{n.note}</p>
              {n.needsAck && <p className="muted small"><Icon name="eye" /> {t('ac.diary.seenBy', { n: n.acks, of: n.expected })}</p>}
            </li>
          ))}
        </ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('ac.diary.write')} subtitle={section.name} onSubmit={save} submitLabel={t('ac.diary.send')} busy={busy} error={error}>
        <div className="grid-2">
          <Field id="dn-for" label={t('ac.diary.to')} error={errors.studentId}>
            <select id="dn-for" value={String(form.studentId)} onChange={(e) => setForm((f) => ({ ...f, studentId: e.target.value }))}>
              <option value="">{t('ac.diary.wholeClass', { n: list.students })}</option>
              {list.roster.map((r) => <option key={r.id} value={r.id}>{r.rollNo ? `${r.rollNo}. ` : ''}{r.name}</option>)}
            </select>
          </Field>
          <Field id="dn-date" label={t('ac.diary.date')} error={errors.noteDate}><input id="dn-date" type="date" value={String(form.noteDate)} onChange={(e) => setForm((f) => ({ ...f, noteDate: e.target.value }))} /></Field>
        </div>
        <Field id="dn-note" label={t('ac.diary.note')} error={errors.note}><textarea id="dn-note" rows={4} value={String(form.note ?? '')} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder={t('ac.diary.notePh')} /></Field>
        <label className="check"><input type="checkbox" checked={!!form.needsAck} onChange={(e) => setForm((f) => ({ ...f, needsAck: e.target.checked }))} /> {t('ac.diary.askSeen')}</label>
      </Modal>
    </>
  );
}
