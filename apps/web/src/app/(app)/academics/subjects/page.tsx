'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { PERMISSIONS, ROOM_KINDS, SUBJECT_GROUPS, SUBJECT_TYPES } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { useAcadSections } from '@/components/academics';

interface Subject { id: string; code: string; name: string; nameLocal: string | null; subjectType: string; credits: number | null; isLanguage: boolean; status: string; classes: number }
interface SyllabusRow { subjectId: string; subjectGroup: string; isOptional: boolean }
interface Room { id: string; campusId: string; name: string; roomType: string; capacity: number | null; building: string | null; floor: string | null }
type Tab = 'subjects' | 'syllabus' | 'rooms';

/** Academics → Subjects (M8.1): the subject list, each class's syllabus, and rooms. */
export default function SubjectsPage() {
  const { can } = useSession();
  const { t } = useI18n();
  const setup = can(PERMISSIONS.ACAD_SETUP);
  const [tab, setTab] = useState<Tab>('subjects');
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const load = useCallback(() => { api<Subject[]>('/academics/subjects').then(setSubjects).catch(() => setSubjects([])); }, []);
  useEffect(load, [load]);

  return (
    <>
      <PageHeader eyebrow={t('nav.academics')} title={t('ac.subjects.title')} description={t('ac.subjects.desc')} />
      <div className="tabs scroll" role="tablist" aria-label={t('ac.subjects.title')}>
        {(['subjects', 'syllabus', 'rooms'] as Tab[]).map((x) => (
          <button key={x} type="button" role="tab" id={`tab-${x}`} aria-selected={tab === x} aria-controls={`panel-${x}`} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(`ac.tab.${x}` as MessageKey)}</button>
        ))}
      </div>
      <section role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="ac-panel">
        {tab === 'subjects' && <Subjects rows={subjects} setup={setup} reload={load} />}
        {tab === 'syllabus' && <Syllabus subjects={subjects ?? []} setup={setup} />}
        {tab === 'rooms' && <Rooms setup={setup} />}
      </section>
    </>
  );
}

function Subjects({ rows, setup, reload }: { rows: Subject[] | null; setup: boolean; reload: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [edit, setEdit] = useState<Subject | 'new' | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = (s: Subject | 'new') => {
    setForm(s === 'new' ? { code: '', name: '', nameLocal: '', subjectType: 'THEORY', credits: '', isLanguage: false, status: 'ACTIVE' } : { code: s.code, name: s.name, nameLocal: s.nameLocal ?? '', subjectType: s.subjectType, credits: s.credits == null ? '' : String(s.credits), isLanguage: s.isLanguage, status: s.status });
    setErrors({}); setError(null); setEdit(s);
  };
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    const body = { code: form.code, name: form.name, nameLocal: form.nameLocal || null, subjectType: form.subjectType, credits: form.credits === '' ? null : form.credits, isLanguage: form.isLanguage, ...(edit !== 'new' ? { status: form.status } : {}) };
    try {
      await api(edit === 'new' ? '/academics/subjects' : `/academics/subjects/${(edit as Subject).id}`, { method: edit === 'new' ? 'POST' : 'PATCH', body: JSON.stringify(body) });
      toast(t('ac.subjects.saved', { name: String(form.name) }));
      setEdit(null); reload();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="panel-head">
        <p className="muted">{t('ac.subjects.hint')}</p>
        {setup && <button type="button" className="btn btn-primary" onClick={() => open('new')}><Icon name="plus" /> {t('ac.subjects.add')}</button>}
      </div>
      {!rows ? <SkeletonRows rows={5} /> : rows.length === 0 ? <EmptyState icon="book" title={t('ac.subjects.none')} text={t('ac.subjects.noneHint')} /> : (
        <div className="table-wrap card">
          <table className="table">
            <thead><tr><th scope="col">{t('ac.code')}</th><th scope="col">{t('ac.subject')}</th><th scope="col">{t('ac.type')}</th><th scope="col">{t('ac.inClasses')}</th><th scope="col">{t('common.status')}</th>{setup && <th scope="col"><span className="sr-only">{t('common.actions')}</span></th>}</tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className={s.status !== 'ACTIVE' ? 'row-dim' : undefined}>
                  <td><span className="code">{s.code}</span></td>
                  <td><strong>{s.name}</strong>{s.nameLocal && <span className="sub-line muted" lang="kn">{s.nameLocal}</span>}{s.isLanguage && <span className="sub-line muted">{t('ac.language')}</span>}</td>
                  <td>{t(`ac.stype.${s.subjectType}` as MessageKey)}{s.credits != null && <span className="sub-line muted">{t('ac.credits', { n: s.credits })}</span>}</td>
                  <td>{s.classes}</td>
                  <td><StatusBadge status={s.status} /></td>
                  {setup && <td className="row-actions"><button type="button" className="btn btn-sm" onClick={() => open(s)} aria-label={t('ac.editNamed', { name: s.name })}><Icon name="edit" /> {t('common.edit')}</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? t('ac.subjects.add') : t('ac.subjects.edit')} onSubmit={save} submitLabel={t('tr.save')} busy={busy} error={error}>
        <div className="grid-2">
          <Field id="s-code" label={t('ac.code')} error={errors.code} hint={t('ac.codeHint')}><input id="s-code" value={String(form.code ?? '')} onChange={set('code')} placeholder="MAT" maxLength={20} /></Field>
          <Field id="s-type" label={t('ac.type')} error={errors.subjectType}>
            <select id="s-type" value={String(form.subjectType)} onChange={set('subjectType')}>{SUBJECT_TYPES.map((x) => <option key={x} value={x}>{t(`ac.stype.${x}` as MessageKey)}</option>)}</select>
          </Field>
        </div>
        <Field id="s-name" label={t('ac.subjectName')} error={errors.name}><input id="s-name" value={String(form.name ?? '')} onChange={set('name')} placeholder="Mathematics" /></Field>
        <Field id="s-local" label={t('ac.nameLocal')} error={errors.nameLocal}><input id="s-local" lang="kn" value={String(form.nameLocal ?? '')} onChange={set('nameLocal')} placeholder="ಗಣಿತ" /></Field>
        <div className="grid-2">
          <Field id="s-credits" label={t('ac.creditsLabel')} error={errors.credits} hint={t('ac.creditsHint')}><input id="s-credits" type="number" min={0} max={40} step="0.5" value={String(form.credits ?? '')} onChange={set('credits')} /></Field>
          {edit !== 'new' && (
            <Field id="s-status" label={t('common.status')} error={errors.status}>
              <select id="s-status" value={String(form.status)} onChange={set('status')}><option value="ACTIVE">{t('ac.active')}</option><option value="INACTIVE">{t('ac.inactive')}</option></select>
            </Field>
          )}
        </div>
        <label className="check"><input type="checkbox" checked={!!form.isLanguage} onChange={(e) => setForm((f) => ({ ...f, isLanguage: e.target.checked }))} /> {t('ac.isLanguage')}</label>
      </Modal>
    </>
  );
}

function Syllabus({ subjects, setup }: { subjects: Subject[]; setup: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const sections = useAcadSections();
  const classes = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sections ?? []) if (!m.has(s.programLevelId)) m.set(s.programLevelId, `${s.program} · ${s.name.split(' – ')[0]}`);
    return [...m.entries()].map(([id, name]) => ({ id, name }));
  }, [sections]);
  const [level, setLevel] = useState('');
  const [rows, setRows] = useState<SyllabusRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!level && classes[0]) setLevel(classes[0].id); }, [classes, level]);
  useEffect(() => {
    if (!level) return;
    setRows(null); setError(null);
    api<{ subjects: SyllabusRow[] }>(`/academics/classes/${level}/syllabus`).then((r) => setRows(r.subjects.map(({ subjectId, subjectGroup, isOptional }) => ({ subjectId, subjectGroup, isOptional })))).catch(() => setRows([]));
  }, [level]);
  const active = subjects.filter((s) => s.status === 'ACTIVE');
  const on = (id: string) => rows?.find((r) => r.subjectId === id);
  const toggle = (s: Subject, yes: boolean) => setRows((r) => (yes ? [...(r ?? []), { subjectId: s.id, subjectGroup: s.isLanguage ? 'LANGUAGE_1' : 'CORE', isOptional: false }] : (r ?? []).filter((x) => x.subjectId !== s.id)));
  const change = (id: string, patch: Partial<SyllabusRow>) => setRows((r) => (r ?? []).map((x) => (x.subjectId === id ? { ...x, ...patch } : x)));
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api('/academics/syllabus', { method: 'PUT', body: JSON.stringify({ programLevelId: level, subjects: rows }) });
      toast(t('ac.syl.saved', { n: rows?.length ?? 0 }));
    } catch (x) { setError(apiErrors(x).message ?? Object.values(apiErrors(x).fields)[0] ?? null); } finally { setBusy(false); }
  };

  if (!sections) return <SkeletonRows rows={4} />;
  if (!classes.length) return <EmptyState icon="layers" title={t('ac.noSections')} text={t('ac.noSectionsHint')} />;
  return (
    <>
      <div className="panel-head">
        <label className="ac-picker" htmlFor="syl-class"><span>{t('ac.class')}</span>
          <select id="syl-class" value={level} onChange={(e) => setLevel(e.target.value)}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
        {setup && <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !rows}><Icon name="check" /> {busy ? t('common.saving') : t('ac.syl.save')}</button>}
      </div>
      <p className="muted small">{t('ac.syl.hint')}</p>
      {error && <p className="form-error" role="alert"><Icon name="alert" /> {error}</p>}
      {!rows ? <SkeletonRows rows={5} /> : active.length === 0 ? <EmptyState icon="book" title={t('ac.subjects.none')} text={t('ac.subjects.noneHint')} /> : (
        <div className="table-wrap card">
          <table className="table">
            <thead><tr><th scope="col">{t('ac.inSyllabus')}</th><th scope="col">{t('ac.group')}</th><th scope="col">{t('ac.optional')}</th></tr></thead>
            <tbody>
              {active.map((s) => {
                const r = on(s.id);
                return (
                  <tr key={s.id} className={r ? undefined : 'row-dim'}>
                    <td><label className="check"><input type="checkbox" checked={!!r} disabled={!setup} onChange={(e) => toggle(s, e.target.checked)} /> <span><strong>{s.name}</strong> <span className="code">{s.code}</span></span></label></td>
                    <td>{r ? (
                      <select aria-label={t('ac.groupOf', { name: s.name })} value={r.subjectGroup} disabled={!setup} onChange={(e) => change(s.id, { subjectGroup: e.target.value })}>{SUBJECT_GROUPS.map((g) => <option key={g} value={g}>{t(`ac.group.${g}` as MessageKey)}</option>)}</select>
                    ) : <span className="muted">—</span>}</td>
                    <td>{r ? <label className="check"><input type="checkbox" checked={r.isOptional} disabled={!setup} onChange={(e) => change(s.id, { isOptional: e.target.checked })} /> {t('ac.studentsChoose')}</label> : <span className="muted">—</span>}</td>
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

function Rooms({ setup }: { setup: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const sections = useAcadSections();
  const campuses = useMemo(() => [...new Map((sections ?? []).map((s) => [s.campusId, s.campus])).entries()].map(([id, name]) => ({ id, name })), [sections]);
  const [rows, setRows] = useState<Room[] | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Room[]>('/academics/rooms').then(setRows).catch(() => setRows([])); }, []);
  useEffect(load, [load]);
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const start = () => { setForm({ campusId: campuses[0]?.id ?? '', name: '', roomType: 'CLASSROOM', capacity: '', building: '', floor: '' }); setErrors({}); setError(null); setOpen(true); };
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try {
      await api('/academics/rooms', { method: 'POST', body: JSON.stringify({ ...form, capacity: form.capacity || null, building: form.building || null, floor: form.floor || null }) });
      toast(t('ac.rooms.added', { name: form.name }));
      setOpen(false); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const campusName = (id: string) => campuses.find((c) => c.id === id)?.name ?? '';

  return (
    <>
      <div className="panel-head">
        <p className="muted">{t('ac.rooms.hint')}</p>
        {setup && <button type="button" className="btn btn-primary" onClick={start} disabled={!campuses.length}><Icon name="plus" /> {t('ac.rooms.add')}</button>}
      </div>
      {!rows ? <SkeletonRows rows={4} /> : rows.length === 0 ? <EmptyState icon="building" title={t('ac.rooms.none')} text={t('ac.rooms.noneHint')} /> : (
        <div className="table-wrap card">
          <table className="table">
            <thead><tr><th scope="col">{t('ac.room')}</th><th scope="col">{t('ac.type')}</th><th scope="col">{t('ac.seats')}</th><th scope="col">{t('ac.where')}</th>{campuses.length > 1 && <th scope="col">{t('common.campus')}</th>}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.name}</strong></td>
                  <td>{t(`ac.rtype.${r.roomType}` as MessageKey)}</td>
                  <td>{r.capacity ?? '—'}</td>
                  <td>{[r.building, r.floor && t('ac.floorN', { f: r.floor })].filter(Boolean).join(' · ') || '—'}</td>
                  {campuses.length > 1 && <td>{campusName(r.campusId)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('ac.rooms.add')} onSubmit={save} submitLabel={t('tr.save')} busy={busy} error={error}>
        {campuses.length > 1 && (
          <Field id="r-campus" label={t('common.campus')} error={errors.campusId}><select id="r-campus" value={form.campusId} onChange={set('campusId')}>{campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        )}
        <div className="grid-2">
          <Field id="r-name" label={t('ac.roomName')} error={errors.name}><input id="r-name" value={form.name ?? ''} onChange={set('name')} placeholder="Room 12" /></Field>
          <Field id="r-type" label={t('ac.type')} error={errors.roomType}><select id="r-type" value={form.roomType} onChange={set('roomType')}>{ROOM_KINDS.map((x) => <option key={x} value={x}>{t(`ac.rtype.${x}` as MessageKey)}</option>)}</select></Field>
        </div>
        <div className="grid-2">
          <Field id="r-building" label={t('ac.building')} error={errors.building}><input id="r-building" value={form.building ?? ''} onChange={set('building')} placeholder="Main block" /></Field>
          <Field id="r-floor" label={t('ac.floor')} error={errors.floor}><input id="r-floor" value={form.floor ?? ''} onChange={set('floor')} placeholder="1" /></Field>
        </div>
        <Field id="r-cap" label={t('ac.seats')} error={errors.capacity}><input id="r-cap" type="number" min={1} value={form.capacity ?? ''} onChange={set('capacity')} /></Field>
      </Modal>
    </>
  );
}
