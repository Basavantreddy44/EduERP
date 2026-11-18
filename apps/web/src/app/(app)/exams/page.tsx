'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PERMISSIONS, PRESET_SCHEMES, ROUNDING_RULES } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { useAcadSections } from '@/components/academics';

interface Scheme {
  id: string; name: string; presetCode: string | null; resultMethod: string; gradeScaleId: string; coScaleId: string | null; boardId: string | null;
  passPercent: number; subjectPassPercent: number; roundingRule: string; exams: number;
  terms: { code: string; name: string; finalWeight: number }[];
  components: { id: string; termCode: string; code: string; name: string; maxMarks: number; weightage: number; isInternal: boolean }[];
  coAreas: { id: string; name: string }[];
  levels: { id: string; name: string }[];
}
interface ExamRow { id: string; name: string; campusId: string; startDate: string; endDate: string; scheme: { name: string }; component: { code: string; name: string; termCode: string; maxMarks: number }; papers: number; sheets: number; verified: number }
type Tab = 'exams' | 'schemes';

/** Exams (M9.1/M9.2): this year's exams, and the schemes and grading they follow. */
export default function ExamsPage() {
  const { can } = useSession();
  const { t } = useI18n();
  const setup = can(PERMISSIONS.EXAM_SETUP);
  const [tab, setTab] = useState<Tab>('exams');
  const [schemes, setSchemes] = useState<Scheme[] | null>(null);
  const loadSchemes = useCallback(() => { api<Scheme[]>('/exams/schemes').then(setSchemes).catch(() => setSchemes([])); }, []);
  useEffect(loadSchemes, [loadSchemes]);
  return (
    <>
      <PageHeader eyebrow={t('nav.exams')} title={t('ex.title')} description={t('ex.desc')}
        actions={<><Link href="/exams/marks" className="btn"><Icon name="edit" /> {t('nav.markEntry')}</Link><Link href="/exams/results" className="btn"><Icon name="star" /> {t('nav.results')}</Link></>} />
      <div className="tabs" role="tablist" aria-label={t('ex.title')}>
        {(['exams', 'schemes'] as Tab[]).map((x) => <button key={x} type="button" role="tab" id={`tab-${x}`} aria-selected={tab === x} aria-controls={`panel-${x}`} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(`ex.tab.${x}` as MessageKey)}</button>)}
      </div>
      <section role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="ac-panel">
        {tab === 'exams' ? <Exams schemes={schemes} setup={setup} onSchemes={() => setTab('schemes')} /> : <Schemes rows={schemes} setup={setup} reload={loadSchemes} />}
      </section>
    </>
  );
}

function Exams({ schemes, setup, onSchemes }: { schemes: Scheme[] | null; setup: boolean; onSchemes: () => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const sections = useAcadSections();
  const campuses = useMemo(() => [...new Map((sections ?? []).map((s) => [s.campusId, s.campus])).entries()].map(([id, name]) => ({ id, name })), [sections]);
  const [rows, setRows] = useState<ExamRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<ExamRow[]>('/exams').then(setRows).catch(() => setRows([])); }, []);
  useEffect(load, [load]);
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => {
    const n = { ...f, [k]: e.target.value };
    if (k === 'schemeId') n.componentId = schemes?.find((s) => s.id === e.target.value)?.components[0]?.id ?? '';
    if (k === 'componentId' || k === 'schemeId') { const c = schemes?.find((s) => s.id === n.schemeId)?.components.find((x) => x.id === n.componentId); if (c && (!f.name || schemes?.some((s) => s.components.some((x) => x.name === f.name)))) n.name = c.name; }
    return n;
  });
  const start = () => {
    const s = schemes?.[0];
    setForm({ campusId: campuses[0]?.id ?? '', schemeId: s?.id ?? '', componentId: s?.components[0]?.id ?? '', name: s?.components[0]?.name ?? '', startDate: '', endDate: '' });
    setErrors({}); setError(null); setOpen(true);
  };
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try {
      const x = await api<{ id: string }>('/exams', { method: 'POST', body: JSON.stringify(form) });
      toast(t('ex.added', { name: form.name })); setOpen(false); window.location.href = `/exams/${x.id}`;
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const d = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const scheme = schemes?.find((s) => s.id === form.schemeId);

  if (!rows || !schemes) return <SkeletonRows rows={4} />;
  return (
    <>
      <div className="panel-head">
        <p className="muted">{t('ex.examsHint')}</p>
        {setup && <button type="button" className="btn btn-primary" onClick={start} disabled={!schemes.length || !campuses.length}><Icon name="plus" /> {t('ex.add')}</button>}
      </div>
      {!schemes.length ? (
        <EmptyState icon="layers" title={t('ex.noScheme')} text={t('ex.noSchemeHint')} action={<button type="button" className="btn btn-primary" onClick={onSchemes}>{t('ex.tab.schemes')}</button>} />
      ) : !rows.length ? <EmptyState icon="calendar" title={t('ex.none')} text={setup ? t('ex.noneHint') : undefined} /> : (
        <ul className="exam-cards">
          {rows.map((x) => {
            const pct = x.sheets ? Math.round((x.verified / x.sheets) * 100) : 0;
            return (
              <li key={x.id}>
                <Link href={`/exams/${x.id}`} className="card exam-card">
                  <span className="hw-subject">{x.scheme.name} · {x.component.code}</span>
                  <strong className="card-title">{x.name}</strong>
                  <span className="muted small">{d(x.startDate)} – {d(x.endDate)} · {t('ex.papersN', { n: x.papers })}</span>
                  <span className="exam-progress" role="img" aria-label={t('ex.verifiedOf', { n: x.verified, of: x.sheets })}><span style={{ width: `${pct}%` }} /></span>
                  <span className="small">{x.sheets ? t('ex.verifiedOf', { n: x.verified, of: x.sheets }) : t('ex.noSheets')}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('ex.add')} subtitle={t('ex.addSub')} onSubmit={save} submitLabel={t('ex.create')} busy={busy} error={error}>
        {campuses.length > 1 && <Field id="e-campus" label={t('common.campus')} error={errors.campusId}><select id="e-campus" value={form.campusId} onChange={set('campusId')}>{campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
        <div className="grid-2">
          <Field id="e-scheme" label={t('ex.scheme')} error={errors.schemeId}><select id="e-scheme" value={form.schemeId} onChange={set('schemeId')}>{schemes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field id="e-comp" label={t('ex.component')} error={errors.componentId} hint={t('ex.componentHint')}>
            <select id="e-comp" value={form.componentId} onChange={set('componentId')}>
              {scheme?.terms.map((term) => <optgroup key={term.code} label={term.name}>{scheme.components.filter((c) => c.termCode === term.code).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}</optgroup>)}
            </select>
          </Field>
        </div>
        <Field id="e-name" label={t('ex.name')} error={errors.name}><input id="e-name" value={form.name ?? ''} onChange={set('name')} /></Field>
        <div className="grid-2">
          <Field id="e-start" label={t('ex.from')} error={errors.startDate}><input id="e-start" type="date" value={form.startDate ?? ''} onChange={set('startDate')} /></Field>
          <Field id="e-end" label={t('ex.to')} error={errors.endDate}><input id="e-end" type="date" min={form.startDate} value={form.endDate ?? ''} onChange={set('endDate')} /></Field>
        </div>
      </Modal>
    </>
  );
}

function Schemes({ rows, setup, reload }: { rows: Scheme[] | null; setup: boolean; reload: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const sections = useAcadSections();
  const classes = useMemo(() => { const m = new Map<string, string>(); for (const s of sections ?? []) if (!m.has(s.programLevelId)) m.set(s.programLevelId, `${s.program} · ${s.name.split(' – ')[0]}`); return [...m.entries()].map(([id, name]) => ({ id, name })); }, [sections]);
  const used = new Set((rows ?? []).flatMap((s) => s.levels.map((l) => l.id)));
  const [preset, setPreset] = useState<string | null>(null);
  const [edit, setEdit] = useState<Scheme | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const togglePick = (id: string, on: boolean) => setPicked((p) => (on ? [...p, id] : p.filter((x) => x !== id)));
  const applyPreset = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setError(null);
    try { const r = await api<{ name: string }>(`/exams/presets/${preset}`, { method: 'POST', body: JSON.stringify({ programLevelIds: picked }) }); toast(t('ex.sch.added', { name: r.name })); setPreset(null); reload(); }
    catch (x) { setError(apiErrors(x).message ?? Object.values(apiErrors(x).fields)[0] ?? null); } finally { setBusy(false); }
  };
  const openEdit = (s: Scheme) => { setEdit(s); setPicked(s.levels.map((l) => l.id)); setForm({ name: s.name, passPercent: String(s.passPercent), subjectPassPercent: String(s.subjectPassPercent), roundingRule: s.roundingRule }); setError(null); };
  const saveEdit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!edit) return;
    setBusy(true); setError(null);
    const body = {
      name: form.name, boardId: edit.boardId, resultMethod: edit.resultMethod, gradeScaleId: edit.gradeScaleId, coScaleId: edit.coScaleId, passPercent: form.passPercent, subjectPassPercent: form.subjectPassPercent, roundingRule: form.roundingRule,
      terms: edit.terms, components: edit.components.map(({ termCode, code, name, maxMarks, weightage, isInternal }) => ({ termCode, code, name, maxMarks, weightage, isInternal })), coAreas: edit.coAreas.map((a) => a.name), programLevelIds: picked,
    };
    try { await api(`/exams/schemes/${edit.id}`, { method: 'PUT', body: JSON.stringify(body) }); toast(t('ex.sch.saved', { name: form.name })); setEdit(null); reload(); }
    catch (x) { setError(apiErrors(x).message ?? Object.values(apiErrors(x).fields)[0] ?? null); } finally { setBusy(false); }
  };
  const classPicker = (own: string[] = []) => (
    <fieldset className="check-group"><legend>{t('ex.sch.classes')}</legend>
      {classes.length === 0 && <p className="muted small">{t('ac.noSections')}</p>}
      {classes.map((c) => { const taken = used.has(c.id) && !own.includes(c.id); return <label key={c.id} className="check"><input type="checkbox" checked={picked.includes(c.id)} disabled={taken} onChange={(e) => togglePick(c.id, e.target.checked)} /> {c.name}{taken && <span className="muted small"> · {t('ex.sch.hasScheme')}</span>}</label>; })}
    </fieldset>
  );

  if (!rows) return <SkeletonRows rows={4} />;
  return (
    <>
      <div className="panel-head">
        <p className="muted">{t('ex.sch.hint')}</p>
        {setup && <button type="button" className="btn btn-primary" onClick={() => { setPreset(PRESET_SCHEMES[0].code); setPicked([]); setError(null); }}><Icon name="plus" /> {t('ex.sch.usePattern')}</button>}
      </div>
      {!rows.length ? <EmptyState icon="layers" title={t('ex.noScheme')} text={t('ex.noSchemeHint')} /> : rows.map((s) => (
        <section key={s.id} className="card scheme-card" aria-labelledby={`sch-${s.id}`}>
          <div className="scheme-head">
            <div>
              <h2 id={`sch-${s.id}`} className="card-title">{s.name}</h2>
              <p className="muted small">{t('ex.sch.pass', { p: s.passPercent, s: s.subjectPassPercent })} · {t(`ex.round.${s.roundingRule}` as MessageKey)}</p>
              <p className="small">{s.levels.length ? s.levels.map((l) => l.name).join(', ') : <span className="muted">{t('ex.sch.noClasses')}</span>}</p>
            </div>
            {setup && <button type="button" className="btn btn-sm" onClick={() => openEdit(s)} aria-label={t('ac.editNamed', { name: s.name })}><Icon name="edit" /> {t('common.edit')}</button>}
          </div>
          <div className="table-wrap" role="region" aria-label={s.name} tabIndex={0}>
            <table className="table scheme-table">
              <thead><tr><th scope="col">{t('ex.sch.term')}</th><th scope="col">{t('ex.component')}</th><th scope="col" className="num">{t('ex.sch.max')}</th><th scope="col" className="num">{t('ex.sch.weight')}</th></tr></thead>
              <tbody>
                {s.terms.map((term) => s.components.filter((c) => c.termCode === term.code).map((c, i, arr) => (
                  <tr key={c.id}>
                    {i === 0 && <th scope="rowgroup" rowSpan={arr.length}>{term.name}{s.terms.length > 1 && <span className="sub-line muted">{t('ex.sch.ofFinal', { n: term.finalWeight })}</span>}</th>}
                    <td>{c.name} <span className="code">{c.code}</span>{c.isInternal && <span className="sub-line muted">{t('ex.sch.internal')}</span>}</td>
                    <td className="num">{c.maxMarks}</td>
                    <td className="num">{c.weightage}%</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
          {s.coAreas.length > 0 && <p className="small"><strong>{t('ex.card.co')}:</strong> {s.coAreas.map((a) => a.name).join(', ')}</p>}
        </section>
      ))}
      <Modal open={!!preset} onClose={() => setPreset(null)} title={t('ex.sch.usePattern')} subtitle={t('ex.sch.patternSub')} onSubmit={applyPreset} submitLabel={t('ex.sch.apply')} busy={busy} error={error}>
        <fieldset className="check-group"><legend>{t('ex.sch.pattern')}</legend>
          {PRESET_SCHEMES.map((p) => <label key={p.code} className="check"><input type="radio" name="preset" checked={preset === p.code} onChange={() => setPreset(p.code)} /> <span><strong>{p.name}</strong><span className="sub-line muted">{t(`ex.preset.${p.code}` as MessageKey)}</span></span></label>)}
        </fieldset>
        {classPicker()}
      </Modal>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={t('ex.sch.edit')} subtitle={edit?.exams ? t('ex.sch.inUse', { n: edit.exams }) : undefined} onSubmit={saveEdit} submitLabel={t('tr.save')} busy={busy} error={error}>
        <Field id="sc-name" label={t('ex.name')}><input id="sc-name" value={form.name ?? ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
        <div className="grid-2">
          <Field id="sc-pass" label={t('ex.sch.passLabel')}><input id="sc-pass" type="number" min={0} max={100} value={form.passPercent ?? ''} onChange={(e) => setForm((f) => ({ ...f, passPercent: e.target.value }))} /></Field>
          <Field id="sc-spass" label={t('ex.sch.subjectPassLabel')}><input id="sc-spass" type="number" min={0} max={100} value={form.subjectPassPercent ?? ''} onChange={(e) => setForm((f) => ({ ...f, subjectPassPercent: e.target.value }))} /></Field>
        </div>
        <Field id="sc-round" label={t('ex.sch.rounding')}><select id="sc-round" value={form.roundingRule} onChange={(e) => setForm((f) => ({ ...f, roundingRule: e.target.value }))}>{ROUNDING_RULES.map((r) => <option key={r} value={r}>{t(`ex.round.${r}` as MessageKey)}</option>)}</select></Field>
        {edit && classPicker(edit.levels.map((l) => l.id))}
      </Modal>
    </>
  );
}
