'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { MAX_INSTALMENTS, PERMISSIONS, feeStructureSchema, formatINR } from '@eduerp/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { apiErrors, FieldErrors, validate } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { useDay } from '@/components/admissions';
import { FeeOptions, amountOk, paiseOf, useFeeOptions } from '@/components/fees';

interface Structure {
  id: string; name: string; feeGroup: string | null; status: 'DRAFT' | 'ACTIVE' | 'CLOSED'; totalAmount: string; campusId: string; academicYearId: string; programLevelId: string;
  revisionOf: { id: string; name: string; status: string } | null; revisions?: { id: string; status: string; name: string }[]; activatedAt: string | null;
  studentCount?: number; withoutFees?: number;
  academicYear: { id: string; name: string; startDate: string }; level: { id: string; name: string; program: { id: string; name: string } }; campus: { name: string; code: string };
  instalments: { instalmentNo: number; name: string; dueDate: string }[];
  items: { feeHeadId: string; instalmentNo: number; amount: string }[];
}
type Inst = { name: string; dueDate: string };
const GROUP_SUGGESTIONS = ['New admission', 'Existing students', 'Management quota', 'Staff ward'];

/** Instalment presets from the academic-year start (e.g. 1 June): due on the 10th. */
function preset(kind: 'year' | 'terms2' | 'terms3' | 'quarters' | 'monthly', start: string, t: (k: never, v?: Record<string, string | number>) => string): Inst[] {
  const y = Number(start.slice(0, 4));
  const m0 = Number(start.slice(5, 7)) - 1;
  const at = (monthsAfter: number) => {
    const d = new Date(Date.UTC(y, m0 + monthsAfter, 10));
    return d.toISOString().slice(0, 10);
  };
  const month = (monthsAfter: number) => new Date(Date.UTC(y, m0 + monthsAfter, 1)).toLocaleDateString('en-IN', { month: 'long', timeZone: 'UTC' });
  switch (kind) {
    case 'year': return [{ name: t('fee.inst.annual' as never), dueDate: at(0) }];
    case 'terms2': return [0, 6].map((m, i) => ({ name: t('fee.inst.term' as never, { n: i + 1 }), dueDate: at(m) }));
    case 'terms3': return [0, 4, 7].map((m, i) => ({ name: t('fee.inst.term' as never, { n: i + 1 }), dueDate: at(m) }));
    case 'quarters': return [0, 3, 6, 9].map((m, i) => ({ name: t('fee.inst.quarter' as never, { n: i + 1 }), dueDate: at(m) }));
    case 'monthly': return Array.from({ length: 10 }, (_, i) => ({ name: month(i), dueDate: at(i) }));
  }
}

function EditorInner() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const router = useRouter();
  const params = useSearchParams();
  const { can, campusId } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const day = useDay();
  const { opts } = useFeeOptions();
  const canManage = can(PERMISSIONS.FEE_SETUP_MANAGE);

  const [s, setS] = useState<Structure | null>(null);
  const [missing, setMissing] = useState(false);
  const [form, setForm] = useState({ levelId: '', yearId: params.get('year') ?? '', name: '', feeGroup: '' });
  const [insts, setInsts] = useState<Inst[]>([]);
  const [cells, setCells] = useState<Record<string, string>>({}); // `${headId}|${instNo}` → text
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [dialog, setDialog] = useState<null | 'activate' | 'close' | 'delete' | 'copy'>(null);

  const load = (structure: Structure) => {
    setS(structure);
    setForm({ levelId: structure.programLevelId, yearId: structure.academicYearId, name: structure.name, feeGroup: structure.feeGroup ?? '' });
    setInsts(structure.instalments.map((i) => ({ name: i.name, dueDate: i.dueDate.slice(0, 10) })));
    setCells(Object.fromEntries(structure.items.map((i) => [`${i.feeHeadId}|${i.instalmentNo}`, String(Number(i.amount))])));
    setDirty(false);
  };
  useEffect(() => {
    if (isNew) return;
    api<Structure>(`/fees/structures/${id}`).then(load).catch(() => setMissing(true));
  }, [id, isNew]);

  // New structure: default year (current) and a 3-term plan.
  useEffect(() => {
    if (!isNew || !opts || insts.length) return;
    const y = opts.years.find((x) => x.id === form.yearId) ?? opts.years.find((x) => x.isCurrent) ?? opts.years[0];
    if (!y) return;
    setForm((f) => ({ ...f, yearId: y.id }));
    setInsts(preset('terms3', y.startDate.slice(0, 10), t as never));
  }, [isNew, opts]); // eslint-disable-line react-hooks/exhaustive-deps

  const editable = canManage && (isNew || s?.status === 'DRAFT');
  const year = opts?.years.find((y) => y.id === form.yearId);
  const programs = (opts?.programs ?? []).filter((p) => !campusId || p.campusId === campusId);
  const multiCampus = new Set(programs.map((p) => p.campusId)).size > 1;
  const campusOf = (levelId: string) => programs.find((p) => p.levels.some((l) => l.id === levelId))?.campusId ?? '';
  const level = programs.flatMap((p) => p.levels.map((l) => ({ ...l, program: p }))).find((l) => l.id === form.levelId);

  // Heads shown as rows: active heads, plus any inactive head already used here.
  const heads = useMemo(() => {
    const used = new Set(Object.entries(cells).filter(([, v]) => paiseOf(v) > 0).map(([k]) => k.split('|')[0]));
    return (opts?.heads ?? []).filter((h) => h.status === 'ACTIVE' || used.has(h.id));
  }, [opts, cells]);
  const cell = (h: string, n: number) => cells[`${h}|${n}`] ?? '';
  const colTotal = (n: number) => heads.reduce((a, h) => a + paiseOf(cell(h.id, n)), 0);
  const rowTotal = (h: string) => insts.reduce((a, _, i) => a + paiseOf(cell(h, i + 1)), 0);
  const grand = insts.reduce((a, _, i) => a + colTotal(i + 1), 0);
  const badCells = Object.values(cells).some((v) => !amountOk(v));

  const setCell = (h: string, n: number, v: string) => { setCells((c) => ({ ...c, [`${h}|${n}`]: v })); setDirty(true); };
  const setInst = (i: number, patch: Partial<Inst>) => { setInsts((x) => x.map((it, j) => (j === i ? { ...it, ...patch } : it))); setDirty(true); };
  const addInst = () => {
    const last = insts[insts.length - 1];
    const next = last ? new Date(Date.UTC(Number(last.dueDate.slice(0, 4)), Number(last.dueDate.slice(5, 7)), Number(last.dueDate.slice(8, 10)))).toISOString().slice(0, 10) : year?.startDate.slice(0, 10) ?? '';
    setInsts((x) => [...x, { name: t('fee.inst.instalment', { n: x.length + 1 }), dueDate: next }]);
    setDirty(true);
  };
  const removeInst = (i: number) => {
    // Cells shift left with their instalment.
    setCells((c) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(c)) {
        const [h, n] = k.split('|');
        const no = Number(n);
        if (no === i + 1) continue;
        out[`${h}|${no > i + 1 ? no - 1 : no}`] = v;
      }
      return out;
    });
    setInsts((x) => x.filter((_, j) => j !== i));
    setDirty(true);
  };
  const applyPreset = (k: Parameters<typeof preset>[0]) => {
    if (!year) return;
    const next = preset(k, year.startDate.slice(0, 10), t as never);
    setCells((c) => Object.fromEntries(Object.entries(c).filter(([key]) => Number(key.split('|')[1]) <= next.length)));
    setInsts(next);
    setDirty(true);
  };

  const body = () => ({
    campusId: campusOf(form.levelId), academicYearId: form.yearId, programLevelId: form.levelId, name: form.name.trim(), feeGroup: form.feeGroup.trim() || null,
    instalments: insts.map((i, n) => ({ instalmentNo: n + 1, name: i.name.trim(), dueDate: i.dueDate })),
    items: Object.entries(cells).filter(([, v]) => v.trim() !== '' && paiseOf(v) > 0).map(([k, v]) => ({ feeHeadId: k.split('|')[0], instalmentNo: Number(k.split('|')[1]), amount: v.replace(/,/g, '').trim() })),
  });

  async function save() {
    setError(null);
    if (badCells) return setError(t('fee.struct.badCells'));
    const b = body();
    const r = validate(feeStructureSchema, b);
    if (!r.ok) {
      setErrors(r.errors);
      const first = Object.entries(r.errors)[0];
      return setError(first ? (first[0].startsWith('instalments') ? `${t('fee.struct.instalments')}: ${first[1]}` : first[0].startsWith('programLevelId') ? t('adm.chooseClass') : first[1]) : null);
    }
    setBusy(true);
    try {
      const saved = isNew
        ? await api<Structure>('/fees/structures', { method: 'POST', body: JSON.stringify(b) })
        : await api<Structure>(`/fees/structures/${id}`, { method: 'PATCH', body: JSON.stringify({ name: b.name, feeGroup: b.feeGroup, instalments: b.instalments, items: b.items }) });
      toast(t('fee.struct.saved'));
      setErrors({});
      if (isNew) router.replace(`/fees/structures/${saved.id}`);
      else load({ ...saved, revisions: s?.revisions });
      return true;
    } catch (err) {
      const x = apiErrors(err); setErrors(x.fields); setError(x.message ?? Object.values(x.fields)[0] ?? null);
      return false;
    } finally { setBusy(false); }
  }

  async function act(path: string, done: string, after?: (r: Structure & Structure[]) => void) {
    setBusy(true); setError(null);
    try {
      const r = await api<Structure & Structure[]>(`/fees/structures/${id}/${path}`, { method: 'POST', body: '{}' });
      toast(done);
      setDialog(null);
      if (after) after(r); else load(r);
    } catch (err) {
      setError(apiErrors(err).message ?? t('fee.struct.failed'));
    } finally { setBusy(false); }
  }

  if (missing) return <EmptyState icon="search" title={t('fee.struct.notFound')} action={<Link className="btn" href="/fees/setup"><Icon name="chevronRight" className="flip" /> {t('fee.setup.title')}</Link>} />;
  if (!opts || (!isNew && !s)) return <SkeletonRows rows={8} />;

  const status = isNew ? 'DRAFT' : s!.status;
  const title = isNew ? t('fee.struct.new') : s!.name;

  return (
    // Not a <form>: the dialogs below are forms of their own, and nested forms would submit both.
    <div className="editor-page">
      <Link href="/fees/setup" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('fee.setup.title')}</Link>

      <header className="editor-head">
        <div>
          <p className="eyebrow">{t('fee.struct.eyebrow')}</p>
          <h1 className="page-title">{title}</h1>
          <p className="page-desc">
            {level ? `${level.program.name} · ${level.name}` : t('fee.struct.pickClass')}{year ? ` · ${year.name}` : ''}{form.feeGroup ? ` · ${form.feeGroup}` : ''}
          </p>
        </div>
        <div className="editor-status">
          <StatusBadge status={status} />
          <span className="editor-total"><span className="muted small">{t('fee.struct.yearTotal')}</span><strong>{formatINR(grand, { paise: grand % 100 !== 0 })}</strong></span>
        </div>
      </header>

      {s?.revisionOf && status === 'DRAFT' && <p className="note-info"><Icon name="info" size={15} /> {t('fee.struct.revisionNote', { name: s.revisionOf.name })}</p>}
      {status === 'ACTIVE' && <p className="note-info"><Icon name="info" size={15} /> {t('fee.struct.activeNote')}</p>}
      {status === 'ACTIVE' && s && (
        <div className="assign-strip">
          <Icon name="users" size={16} />
          <span>{t('fee.struct.onIt', { n: s.studentCount ?? 0 })}{s.feeGroup ? ` · ${t('fee.struct.groupOneByOne')}` : ''}</span>
          {!!s.withoutFees && (
            <>
              <span className="assign-warn">{t('fee.struct.without', { n: s.withoutFees })}</span>
              {canManage && <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={async () => {
                setBusy(true);
                try { const r = await api<{ assigned: number }>(`/fees/structures/${id}/assign`, { method: 'POST', body: '{}' }); toast(t('fee.struct.assigned', { n: r.assigned })); load(await api<Structure>(`/fees/structures/${id}`)); }
                catch (err) { setError(apiErrors(err).message); } finally { setBusy(false); }
              }}>{t('fee.struct.assign')}</button>}
            </>
          )}
        </div>
      )}
      {status === 'CLOSED' && <p className="note-warn"><Icon name="info" size={15} /> {t('fee.struct.closedNote')}</p>}
      {error && <div className="alert" role="alert"><Icon name="alert" />{error}</div>}

      <section className="card editor-card">
        <h2 className="card-title">{t('fee.struct.details')}</h2>
        <div className="grid-2">
          <Field id="f-class" label={t('stu.col.class')} error={errors.programLevelId}>
            <select id="f-class" value={form.levelId} disabled={!isNew} onChange={(e) => { setForm({ ...form, levelId: e.target.value, name: form.name || '' }); setDirty(true); }}>
              <option value="">{t('adm.chooseClass')}</option>
              {programs.map((p) => (
                <optgroup key={p.id} label={multiCampus ? `${opts.campuses.find((c) => c.id === p.campusId)?.name ?? ''} · ${p.name}` : p.name}>
                  {p.levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field id="f-year" label={t('adm.year')} error={errors.academicYearId}>
            <select id="f-year" value={form.yearId} disabled={!isNew} onChange={(e) => { const y = opts.years.find((x) => x.id === e.target.value); setForm({ ...form, yearId: e.target.value }); if (y) setInsts(preset('terms3', y.startDate.slice(0, 10), t as never)); setDirty(true); }}>
              {opts.years.filter((y) => !isNew || y.status !== 'CLOSED').map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
            </select>
          </Field>
          <Field id="f-name" label={t('fee.struct.name')} error={errors.name}>
            <input id="f-name" value={form.name} disabled={!editable} placeholder={level && year ? `${level.name} fees ${year.name}` : ''} onChange={(e) => { setForm({ ...form, name: e.target.value }); setDirty(true); }}
              onFocus={() => { if (!form.name && level && year) setForm({ ...form, name: `${level.name} fees ${year.name}` }); }} />
          </Field>
          <Field id="f-group" label={t('fee.struct.group')} hint={t('fee.struct.groupHint')} error={errors.feeGroup}>
            <input id="f-group" list="fee-groups" value={form.feeGroup} disabled={!editable} onChange={(e) => { setForm({ ...form, feeGroup: e.target.value }); setDirty(true); }} />
            <datalist id="fee-groups">{GROUP_SUGGESTIONS.map((g) => <option key={g} value={g} />)}</datalist>
          </Field>
        </div>
      </section>

      <section className="card editor-card">
        <div className="card-head-row">
          <h2 className="card-title">{t('fee.struct.instalments')}</h2>
          {editable && (
            <div className="preset-row" role="group" aria-label={t('fee.inst.quick')}>
              <span className="muted small">{t('fee.inst.quick')}</span>
              {(['year', 'terms2', 'terms3', 'quarters', 'monthly'] as const).map((k) => <button key={k} type="button" className="btn btn-sm" onClick={() => applyPreset(k)}>{t(`fee.inst.preset.${k}` as never)}</button>)}
            </div>
          )}
        </div>
        <ol className="inst-list">
          {insts.map((i, n) => (
            <li key={n}>
              <span className="inst-no" aria-hidden>{n + 1}</span>
              {editable ? (
                <>
                  <label className="sr-only" htmlFor={`i-name-${n}`}>{t('fee.inst.name', { n: n + 1 })}</label>
                  <input id={`i-name-${n}`} className="input" value={i.name} onChange={(e) => setInst(n, { name: e.target.value })} aria-invalid={!!errors[`instalments.${n}.name`] || undefined} />
                  <label className="sr-only" htmlFor={`i-due-${n}`}>{t('fee.inst.due', { n: n + 1 })}</label>
                  <input id={`i-due-${n}`} className="input" type="date" value={i.dueDate} onChange={(e) => setInst(n, { dueDate: e.target.value })} aria-invalid={!!errors[`instalments.${n}.dueDate`] || undefined} />
                  <span className="inst-sum money">{formatINR(colTotal(n + 1))}</span>
                  <button type="button" className="btn btn-sm btn-ghost" disabled={insts.length === 1} onClick={() => removeInst(n)} aria-label={t('fee.inst.remove', { n: n + 1 })}><Icon name="trash" size={15} /></button>
                </>
              ) : (
                <>
                  <strong>{i.name}</strong>
                  <span className="muted">{t('fee.inst.dueOn', { date: day(i.dueDate) })}</span>
                  <span className="inst-sum money">{formatINR(colTotal(n + 1))}</span>
                </>
              )}
            </li>
          ))}
        </ol>
        {editable && insts.length < MAX_INSTALMENTS && <button type="button" className="btn btn-sm" onClick={addInst}><Icon name="plus" size={15} /> {t('fee.inst.add')}</button>}
      </section>

      <section className="card editor-card">
        <h2 className="card-title">{t('fee.struct.amounts')}</h2>
        <p className="muted small">{editable ? t('fee.struct.amountsHint') : t('fee.struct.amountsRead')}</p>
        <div className="matrix-wrap">
          <table className="fee-matrix">
            <caption className="sr-only">{t('fee.struct.amounts')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('fee.tab.heads')}</th>
                {insts.map((i, n) => <th key={n} scope="col" className="num"><span>{i.name || n + 1}</span><span className="sub-line muted">{i.dueDate ? day(i.dueDate) : ''}</span></th>)}
                <th scope="col" className="num">{t('fee.struct.total')}</th>
              </tr>
            </thead>
            <tbody>
              {heads.map((h) => (
                <tr key={h.id} className={rowTotal(h.id) === 0 ? 'row-empty' : ''}>
                  <th scope="row"><span>{h.name}</span><span className="sub-line muted mono">{h.code}</span></th>
                  {insts.map((_, n) => {
                    const v = cell(h.id, n + 1);
                    return (
                      <td key={n} className="num">
                        {editable ? (
                          <input className={`cell-input ${amountOk(v) ? '' : 'bad'}`} inputMode="decimal" value={v} placeholder="—" aria-label={`${h.name}, ${insts[n].name}`} aria-invalid={!amountOk(v) || undefined}
                            onChange={(e) => setCell(h.id, n + 1, e.target.value)} />
                        ) : paiseOf(v) ? formatINR(paiseOf(v)) : <span className="muted">—</span>}
                      </td>
                    );
                  })}
                  <td className="num strong">{rowTotal(h.id) ? formatINR(rowTotal(h.id)) : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{t('fee.struct.total')}</th>
                {insts.map((_, n) => <td key={n} className="num">{formatINR(colTotal(n + 1))}</td>)}
                <td className="num grand">{formatINR(grand, { paise: grand % 100 !== 0 })}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {canManage && (
        <div className="action-bar">
          {status === 'DRAFT' && (
            <>
              {!isNew && <button type="button" className="btn btn-ghost danger-text" onClick={() => setDialog('delete')}><Icon name="trash" size={16} /> {t('fee.struct.delete')}</button>}
              <span className="action-bar-spacer" />
              {dirty && <span className="muted small">{t('fee.struct.unsaved')}</span>}
              <button type="button" className="btn" disabled={busy} onClick={() => void save()}><Icon name="check" size={16} /> {busy ? t('common.saving') : t('fee.struct.saveDraft')}</button>
              {!isNew && <button type="button" className="btn btn-primary" disabled={busy || grand === 0} onClick={() => setDialog('activate')}><Icon name="sparkle" size={16} /> {t('fee.struct.activate')}</button>}
            </>
          )}
          {status === 'ACTIVE' && (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setDialog('close')}><Icon name="x" size={16} /> {t('fee.struct.close')}</button>
              <span className="action-bar-spacer" />
              <button type="button" className="btn" onClick={() => setDialog('copy')}><Icon name="copy" size={16} /> {t('fee.struct.copy')}</button>
              {s?.revisions?.some((r) => r.status === 'DRAFT')
                ? <Link className="btn btn-primary" href={`/fees/structures/${s.revisions.find((r) => r.status === 'DRAFT')!.id}`}><Icon name="edit" size={16} /> {t('fee.struct.openRevision')}</Link>
                : <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act('revise', t('fee.struct.revised'), (r) => router.push(`/fees/structures/${r.id}`))}><Icon name="edit" size={16} /> {t('fee.struct.revise')}</button>}
            </>
          )}
          {status === 'CLOSED' && (
            <>
              <span className="action-bar-spacer" />
              <button type="button" className="btn" onClick={() => setDialog('copy')}><Icon name="copy" size={16} /> {t('fee.struct.copy')}</button>
            </>
          )}
        </div>
      )}

      {dialog === 'activate' && (
        <Modal open onClose={() => setDialog(null)} title={t('fee.struct.activateTitle')} subtitle={s?.name} submitLabel={t('fee.struct.activate')} busy={busy} error={error}
          onSubmit={async (e) => { e.preventDefault(); if (dirty && !(await save())) return; void act('activate', t('fee.struct.activated'), async () => load(await api<Structure>(`/fees/structures/${id}`))); }}>
          <p>{t('fee.struct.activateText', { total: formatINR(grand), n: insts.length })}</p>
          {s?.revisionOf && <p className="note-info"><Icon name="info" size={15} /> {t('fee.struct.activateReplaces', { name: s.revisionOf.name })}</p>}
        </Modal>
      )}
      {dialog === 'close' && (
        <Modal open danger onClose={() => setDialog(null)} title={t('fee.struct.closeTitle')} subtitle={s?.name} submitLabel={t('fee.struct.close')} busy={busy} error={error}
          onSubmit={(e) => { e.preventDefault(); void act('close', t('fee.struct.closed')); }}>
          <p>{t('fee.struct.closeText')}</p>
        </Modal>
      )}
      {dialog === 'delete' && (
        <Modal open danger onClose={() => setDialog(null)} title={t('fee.struct.deleteTitle')} subtitle={s?.name} submitLabel={t('fee.struct.delete')} busy={busy} error={error}
          onSubmit={async (e) => {
            e.preventDefault(); setBusy(true);
            try { await api(`/fees/structures/${id}`, { method: 'DELETE' }); toast(t('fee.struct.deleted')); router.push('/fees/setup'); } catch (err) { setError(apiErrors(err).message); } finally { setBusy(false); }
          }}>
          <p>{t('fee.struct.deleteText')}</p>
        </Modal>
      )}
      {dialog === 'copy' && s && <CopyDialog s={s} opts={opts} onClose={() => setDialog(null)} onDone={(first) => { setDialog(null); router.push(`/fees/structures/${first}`); }} />}
    </div>
  );
}

function CopyDialog({ s, opts, onClose, onDone }: { s: Structure; opts: FeeOptions; onClose: () => void; onDone: (firstId: string) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const program = opts.programs.find((p) => p.id === s.level.program.id);
  const later = opts.years.filter((y) => y.status !== 'CLOSED' && y.id !== s.academicYearId);
  const [yearId, setYearId] = useState(later.find((y) => y.startDate > s.academicYear.startDate)?.id ?? later[0]?.id ?? s.academicYearId);
  const [levels, setLevels] = useState<string[]>([s.programLevelId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (id: string) => setLevels((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  return (
    <Modal open onClose={onClose} title={t('fee.struct.copyTitle')} subtitle={s.name} submitLabel={t('fee.struct.copyGo', { n: levels.length })} busy={busy} error={error}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!levels.length) return setError(t('fee.struct.copyPick'));
        setBusy(true);
        try {
          const r = await api<{ id: string }[]>(`/fees/structures/${s.id}/copy`, { method: 'POST', body: JSON.stringify({ academicYearId: yearId, programLevelIds: levels }) });
          toast(t('fee.struct.copied', { n: r.length }));
          onDone(r[0].id);
        } catch (err) { setError(apiErrors(err).message); } finally { setBusy(false); }
      }}>
      <p className="muted small">{t('fee.struct.copyHint')}</p>
      <Field id="c-year" label={t('adm.year')}>
        <select id="c-year" value={yearId} onChange={(e) => setYearId(e.target.value)}>
          {[...later, ...(later.some((y) => y.id === s.academicYearId) ? [] : [{ id: s.academicYearId, name: s.academicYear.name }])].map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
        </select>
      </Field>
      <fieldset className="field">
        <legend className="label">{t('fee.struct.copyClasses', { program: s.level.program.name })}</legend>
        <div className="check-grid">
          {(program?.levels ?? []).map((l) => (
            <label key={l.id} className="check"><input type="checkbox" checked={levels.includes(l.id)} onChange={() => toggle(l.id)} /> {l.name}</label>
          ))}
        </div>
      </fieldset>
    </Modal>
  );
}

export default function FeeStructurePage() {
  return (
    <Suspense fallback={<SkeletonRows rows={8} />}>
      <EditorInner />
    </Suspense>
  );
}
