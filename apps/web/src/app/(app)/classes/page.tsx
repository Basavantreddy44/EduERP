'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PERMISSIONS, PROGRAM_PRESETS, PROGRAM_TYPES, ProgramType, STREAMS, createProgramSchema, createSectionsSchema, generateLevelNames } from '@eduerp/shared';
import { api, ApiError, newIdempotencyKey } from '@/lib/api';
import { useSession } from '@/lib/session';
import { apiErrors, FieldErrors, validate } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { CampusPicker } from '@/components/CampusPicker';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';

interface Level { id: string; name: string; sequence: number; isFinal: boolean }
interface Program {
  id: string; campusId: string; name: string; code: string; programType: ProgramType; stream: string | null; status: string;
  levels: Level[]; board: { id: string; name: string } | null; campus: { code: string; name: string };
}
interface Board { id: string; name: string }
interface Year { id: string; name: string; isCurrent: boolean; status: string }
interface Section { id: string; name: string; capacity: number; programLevelId: string; level: { id: string; programId: string } }

const QUICK = ['A', 'B', 'C', 'D', 'E', 'F'];

export default function ClassesPage() {
  const { can, campusId } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const canManage = can(PERMISSIONS.ORG_ACADEMIC_MANAGE);
  const allScope = can(PERMISSIONS.ORG_ACADEMIC_MANAGE, { allCampuses: true });
  const [tab, setTab] = useState<'programs' | 'sections'>('programs');
  const [programs, setPrograms] = useState<Program[] | null>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [years, setYears] = useState<Year[]>([]);
  const [yearId, setYearId] = useState('');
  const [sections, setSections] = useState<Section[] | null>(null);

  // add programme
  const [open, setOpen] = useState(false);
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);
  const blank = { campusId: '', boardId: '', name: '', code: '', programType: 'SCHOOL' as ProgramType, stream: '', levelLabel: 'Class', durationLevels: '10', startAt: '1', custom: false, customNames: '' };
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // add sections / rename
  const [secFor, setSecFor] = useState<{ level: Level; program: Program } | null>(null);
  const [secNames, setSecNames] = useState('A, B');
  const [secCap, setSecCap] = useState('40');
  const [secError, setSecError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Level | null>(null);
  const [newName, setNewName] = useState('');

  const loadPrograms = useCallback(() => {
    api<Program[]>('/programs').then(setPrograms).catch(() => setPrograms([]));
    api<Board[]>('/boards').then(setBoards).catch(() => setBoards([]));
  }, []);
  useEffect(() => {
    loadPrograms();
    api<Year[]>('/academic-years').then((y) => {
      setYears(y);
      setYearId((cur) => cur || (y.find((x) => x.isCurrent)?.id ?? ''));
    }).catch(() => setYears([]));
  }, [loadPrograms]);
  const loadSections = useCallback(() => {
    if (!yearId) return setSections([]);
    api<Section[]>(`/sections?academicYearId=${yearId}`).then(setSections).catch(() => setSections([]));
  }, [yearId]);
  useEffect(loadSections, [loadSections]);

  const shown = useMemo(() => (programs ?? []).filter((p) => !campusId || p.campusId === campusId), [programs, campusId]);
  const byCampus = useMemo(() => {
    const m = new Map<string, Program[]>();
    for (const p of shown) m.set(p.campus.name, [...(m.get(p.campus.name) ?? []), p]);
    return [...m.entries()];
  }, [shown]);

  const preview = useMemo(() => {
    if (form.custom) return form.customNames.split('\n').map((s) => s.trim()).filter(Boolean);
    const n = Number(form.durationLevels);
    if (!Number.isInteger(n) || n < 1 || n > 15) return [];
    return generateLevelNames(form.programType, form.levelLabel || 'Class', n, Number(form.startAt) || 1);
  }, [form]);

  function openCreate() {
    setIdemKey(newIdempotencyKey());
    setForm({ ...blank, campusId: campusId ?? '' });
    setErrors({});
    setFormError(null);
    setOpen(true);
  }

  function pickType(type: ProgramType) {
    const p = PROGRAM_PRESETS[type];
    setForm((f) => ({ ...f, programType: type, levelLabel: p.levelLabel, durationLevels: String(p.durationLevels), startAt: String(p.startAt), stream: type === 'PU' ? f.stream || 'SCIENCE' : '' }));
  }

  async function createProgram() {
    const payload = {
      campusId: form.campusId, boardId: form.boardId || null, name: form.name, code: form.code, programType: form.programType, stream: form.stream || null,
      levelLabel: form.levelLabel, durationLevels: preview.length || Number(form.durationLevels), startAt: Number(form.startAt) || 1, levelNames: form.custom ? preview : undefined,
    };
    const v = validate(createProgramSchema, payload);
    if (!v.ok) return setErrors(v.errors);
    setBusy(true);
    try {
      const p = await api<Program>('/programs', { method: 'POST', headers: { 'Idempotency-Key': idemKey }, body: JSON.stringify(v.data) });
      setOpen(false);
      toast(t('cls.created', { name: p.name, n: p.levels.length }));
      loadPrograms();
    } catch (e) {
      const { fields, message } = apiErrors(e);
      setErrors(fields);
      setFormError(message);
    } finally {
      setBusy(false);
    }
  }

  async function addCommonBoards() {
    try {
      setBoards(await api<Board[]>('/boards/common', { method: 'POST' }));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Error', 'bad');
    }
  }

  async function toggleProgram(p: Program) {
    try {
      await api(`/programs/${p.id}`, { method: 'PATCH', body: JSON.stringify({ status: p.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }) });
      loadPrograms();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Error', 'bad');
    }
  }

  async function rename() {
    if (!renaming) return;
    try {
      await api(`/program-levels/${renaming.id}`, { method: 'PATCH', body: JSON.stringify({ name: newName }) });
      toast(t('cls.renamed', { name: newName }));
      setRenaming(null);
      loadPrograms();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Error', 'bad');
    }
  }

  async function addSections() {
    if (!secFor) return;
    const names = secNames.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    const v = validate(createSectionsSchema, { academicYearId: yearId, programLevelId: secFor.level.id, names, capacity: Number(secCap) });
    if (!v.ok) return setSecError(Object.values(v.errors)[0] ?? null);
    setBusy(true);
    try {
      await api('/sections', { method: 'POST', body: JSON.stringify(v.data) });
      toast(t('cls.sectionsAdded', { n: names.length, name: secFor.level.name }));
      setSecFor(null);
      loadSections();
    } catch (e) {
      setSecError(e instanceof ApiError ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  const toggleQuick = (n: string) => {
    const set = new Set(secNames.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean));
    if (set.has(n)) set.delete(n);
    else set.add(n);
    setSecNames([...set].sort().join(', '));
  };

  const year = years.find((y) => y.id === yearId);
  const typeLabel = (p: Program) => t(`type.${p.programType}` as MessageKey) + (p.stream ? ` · ${t(`stream.${p.stream}` as MessageKey)}` : '');

  return (
    <>
      <PageHeader
        eyebrow={t('nav.setup')}
        title={t('cls.title')}
        description={t('cls.desc')}
        actions={canManage && <button className="btn btn-primary" onClick={openCreate}><Icon name="plus" /> {t('cls.addProgram')}</button>}
      />

      <div className="review-bar first">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'programs'} className={tab === 'programs' ? 'on' : ''} onClick={() => setTab('programs')}>{t('cls.tabPrograms')}</button>
          <button role="tab" aria-selected={tab === 'sections'} className={tab === 'sections' ? 'on' : ''} onClick={() => setTab('sections')}>{t('cls.tabSections')}</button>
        </div>
        {tab === 'sections' && years.length > 0 && (
          <label className="inline-field">
            {t('cls.year')}
            <select value={yearId} onChange={(e) => setYearId(e.target.value)}>
              {years.map((y) => <option key={y.id} value={y.id}>{y.name}{y.isCurrent ? ` ✓` : ''}</option>)}
            </select>
          </label>
        )}
      </div>

      {programs === null ? (
        <SkeletonRows />
      ) : shown.length === 0 ? (
        <EmptyState icon="layers" title={t('cls.emptyTitle')} text={t('cls.emptyText')} action={canManage && <button className="btn btn-primary" onClick={openCreate}><Icon name="plus" /> {t('cls.addProgram')}</button>} />
      ) : tab === 'programs' ? (
        byCampus.map(([campusName, list]) => (
          <section key={campusName}>
            <h3 className="section-title">{campusName}</h3>
            <div className="program-grid">
              {list.map((p) => (
                <article key={p.id} className={`card program-card ${p.status !== 'ACTIVE' ? 'row-dim' : ''}`}>
                  <div className="program-head">
                    <div>
                      <h2 className="import-title">{p.name}</h2>
                      <p className="muted small">{typeLabel(p)} · {p.board?.name ?? t('cls.noBoard')}</p>
                    </div>
                    <span className="code">{p.code}</span>
                  </div>
                  <ol className="level-chips" aria-label={p.name}>
                    {p.levels.map((l) => (
                      <li key={l.id}>
                        {canManage ? (
                          <button className={`level-chip ${l.isFinal ? 'final' : ''}`} title={t('cls.rename')} onClick={() => { setRenaming(l); setNewName(l.name); }}>{l.name}</button>
                        ) : (
                          <span className={`level-chip ${l.isFinal ? 'final' : ''}`}>{l.name}</span>
                        )}
                      </li>
                    ))}
                  </ol>
                  <div className="program-foot">
                    {p.status !== 'ACTIVE' ? <StatusBadge status={p.status} /> : <span className="muted small"><Icon name="star" size={13} /> {t('cls.final')}: {p.levels.find((l) => l.isFinal)?.name}</span>}
                    {canManage && <button className="btn btn-sm btn-ghost" onClick={() => toggleProgram(p)}>{p.status === 'ACTIVE' ? t('cls.deactivate') : t('cls.reactivate')}</button>}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))
      ) : !yearId ? (
        <EmptyState icon="calendar" title={t('cls.noYear')} />
      ) : sections === null ? (
        <SkeletonRows />
      ) : (
        shown.filter((p) => p.status === 'ACTIVE').map((p) => {
          const own = sections.filter((s) => s.level.programId === p.id);
          return (
            <section key={p.id} className="card sections-card">
              <div className="program-head">
                <div>
                  <h2 className="import-title">{p.name}</h2>
                  <p className="muted small">{p.campus.name} · {year?.name} · {t('cls.totalSeats', { sections: own.length, seats: own.reduce((n, s) => n + s.capacity, 0) })}</p>
                </div>
              </div>
              <div className="level-rows">
                {p.levels.map((l) => {
                  const secs = own.filter((s) => s.programLevelId === l.id);
                  return (
                    <div key={l.id} className="level-row">
                      <strong className="level-name">{l.name}</strong>
                      <div className="section-chips">
                        {secs.length === 0 ? <span className="muted small">{t('cls.noSections')}</span> : secs.map((s) => (
                          <span key={s.id} className="section-chip"><b>{s.name}</b><span>{t('cls.seats', { n: s.capacity })}</span></span>
                        ))}
                      </div>
                      {canManage && year?.status !== 'CLOSED' && (
                        <button className="btn btn-sm" onClick={() => { setSecFor({ level: l, program: p }); setSecNames(secs.length ? '' : 'A, B'); setSecCap('40'); setSecError(null); }}>
                          <Icon name="plus" size={15} /> {t('cls.addSections')}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}

      <Modal open={open} onClose={() => setOpen(false)} wide title={t('cls.addProgram')} onSubmit={createProgram} submitLabel={t('cls.addProgram')} busy={busy} error={formError}>
        <Field id="p-type" label={t('cls.programType')}>
          <div className="segmented" role="radiogroup" aria-label={t('cls.programType')}>
            {PROGRAM_TYPES.map((pt) => (
              <button key={pt} type="button" role="radio" aria-checked={form.programType === pt} className={form.programType === pt ? 'on' : ''} onClick={() => pickType(pt)}>{t(`type.${pt}` as MessageKey)}</button>
            ))}
          </div>
        </Field>
        <div className="grid-2">
          <Field id="p-name" label={t('common.name')} error={errors.name}>
            <input id="p-name" value={form.name} placeholder={form.programType === 'PU' ? 'PU Science (PCMB)' : form.programType === 'SCHOOL' ? 'State Board School' : 'B.Com'} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </Field>
          <Field id="p-code" label={t('common.code')} error={errors.code}>
            <input id="p-code" value={form.code} placeholder="SBS" onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </Field>
          <Field id="p-campus" label={t('common.campus')} error={errors.campusId}>
            <CampusPicker id="p-campus" value={form.campusId} allowInstitution={false} onChange={(v) => setForm((f) => ({ ...f, campusId: v }))} />
          </Field>
          <Field id="p-board" label={t('cls.board')}>
            {boards.length === 0 && allScope ? (
              <button type="button" className="btn btn-gold" onClick={addCommonBoards}><Icon name="plus" /> {t('cls.addCommonBoards')}</button>
            ) : (
              <select id="p-board" value={form.boardId} onChange={(e) => setForm({ ...form, boardId: e.target.value })}>
                <option value="">{t('cls.noBoard')}</option>
                {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
          </Field>
        </div>
        {form.programType === 'PU' && (
          <Field id="p-stream" label={t('cls.stream')}>
            <select id="p-stream" value={form.stream} onChange={(e) => setForm({ ...form, stream: e.target.value })}>
              {STREAMS.map((s) => <option key={s} value={s}>{t(`stream.${s}` as MessageKey)}</option>)}
            </select>
          </Field>
        )}
        {!form.custom && (
          <div className="grid-3">
            <Field id="p-label" label={t('cls.levelLabel')}>
              <input id="p-label" value={form.levelLabel} onChange={(e) => setForm({ ...form, levelLabel: e.target.value })} />
            </Field>
            <Field id="p-count" label={t('cls.levels')} error={errors.durationLevels}>
              <input id="p-count" type="number" min={1} max={15} value={form.durationLevels} onChange={(e) => setForm({ ...form, durationLevels: e.target.value })} />
            </Field>
            {form.programType === 'SCHOOL' && (
              <Field id="p-start" label={t('cls.startAt')}>
                <input id="p-start" type="number" min={1} max={12} value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} />
              </Field>
            )}
          </div>
        )}
        <label className="check"><input type="checkbox" checked={form.custom} onChange={(e) => setForm({ ...form, custom: e.target.checked, customNames: e.target.checked ? preview.join('\n') : '' })} /> {t('cls.customNames')}</label>
        {form.custom && (
          <Field id="p-names" label={t('cls.levels')} hint={t('cls.customHint')} error={errors.levelNames}>
            <textarea id="p-names" rows={5} value={form.customNames} onChange={(e) => setForm({ ...form, customNames: e.target.value })} />
          </Field>
        )}
        <div className="preview-box" aria-live="polite">
          <span className="module-group-name">{t('cls.preview')} · {preview.length}</span>
          <ol className="level-chips">{preview.map((n, i) => <li key={i}><span className={`level-chip ${i === preview.length - 1 ? 'final' : ''}`}>{n}</span></li>)}</ol>
        </div>
      </Modal>

      <Modal open={!!secFor} onClose={() => setSecFor(null)} title={secFor ? t('cls.addSectionsTo', { name: secFor.level.name }) : ''} subtitle={secFor ? `${secFor.program.name} · ${year?.name ?? ''}` : ''} onSubmit={addSections} submitLabel={t('cls.addSections')} busy={busy} error={secError}>
        <Field id="s-names" label={t('cls.sectionNames')} hint={t('cls.sectionNamesHint')}>
          <div className="quick-row">
            {QUICK.map((q) => {
              const on = secNames.toUpperCase().split(/[,\s]+/).includes(q);
              return <button key={q} type="button" className={`quick ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggleQuick(q)}>{q}</button>;
            })}
          </div>
          <input id="s-names" value={secNames} onChange={(e) => setSecNames(e.target.value)} />
        </Field>
        <Field id="s-cap" label={t('cls.capacity')}>
          <input id="s-cap" type="number" min={1} max={500} value={secCap} onChange={(e) => setSecCap(e.target.value)} />
        </Field>
      </Modal>

      <Modal open={!!renaming} onClose={() => setRenaming(null)} title={t('cls.rename')} onSubmit={rename} submitLabel={t('common.save')}>
        <Field id="r-name" label={t('common.name')}>
          <input id="r-name" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
        </Field>
      </Modal>
    </>
  );
}
