'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { todayIST } from '@/components/admissions';

interface Opts { years: { id: string; name: string; isCurrent: boolean }[]; levels: string[]; items: { id: string; name: string; unit: string; itemCode: string }[]; stores: { id: string; name: string; campusId: string }[]; campuses: { id: string; name: string }[]; sections: { id: string; name: string; levelName: string; campusId: string }[]; inventory: boolean; canManage: boolean }
interface Scheme { id: string; academicYearId: string; name: string; kind: 'ITEM' | 'CASH'; inventoryItemId: string | null; item: string | null; unit: string | null; quantityPerStudent: number | null; amountPerStudent: string | null; levelNames: string[]; gender: string; status: string; eligible: number; fullyGiven: number }
interface SectionView { scheme: Scheme; section: { id: string; name: string; campusId: string }; students: { studentId: string; name: string; admissionNo: string; rollNo: string | null; gender: string; eligible: boolean; entitled: string; received: string; pending: string; lastGiven: string | null }[]; canGive: boolean }

const inr = (v: string | number) => `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Students → Welfare (G2): schemes for the year, hand out to a class, who received what. */
export default function WelfarePage() {
  const { t } = useI18n();
  const toast = useToast();
  const [o, setO] = useState<Opts | null>(null);
  const [year, setYear] = useState('');
  const [list, setList] = useState<Scheme[] | null>(null);
  const [form, setForm] = useState<(Record<string, string> & { levelNames?: string }) | null>(null);
  const [levels, setLevels] = useState<string[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [give, setGive] = useState<Scheme | null>(null);
  const [sectionId, setSectionId] = useState('');
  const [view, setView] = useState<SectionView | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [hand, setHand] = useState({ givenOn: todayIST(), storeId: '', reference: '', remarks: '' });

  useEffect(() => { api<Opts>('/welfare/options').then((x) => { setO(x); setYear(x.years.find((y) => y.isCurrent)?.id ?? x.years[0]?.id ?? ''); }).catch(() => setO(null)); }, []);
  const load = useCallback(() => { if (!year) return; setList(null); api<Scheme[]>(`/welfare/schemes?academicYearId=${year}`).then(setList).catch(() => setList([])); }, [year]);
  useEffect(load, [load]);
  const loadView = useCallback(() => {
    if (!give || !sectionId) { setView(null); return; }
    setView(null);
    api<SectionView>(`/welfare/schemes/${give.id}/sections/${sectionId}`).then((v) => { setView(v); setPicked(new Set(v.students.filter((s) => s.eligible && Number(s.pending) > 0).map((s) => s.studentId))); }).catch(() => setView(null));
  }, [give, sectionId]);
  useEffect(loadView, [loadView]);

  const openNew = () => { setEditId(null); setErrors({}); setError(null); setLevels([]); setForm({ name: '', kind: 'ITEM', inventoryItemId: '', quantityPerStudent: '1', amountPerStudent: '', gender: 'ALL', status: 'ACTIVE' }); };
  const openEdit = (s: Scheme) => { setEditId(s.id); setErrors({}); setError(null); setLevels(s.levelNames); setForm({ name: s.name, kind: s.kind, inventoryItemId: s.inventoryItemId ?? '', quantityPerStudent: s.quantityPerStudent ? String(s.quantityPerStudent) : '', amountPerStudent: s.amountPerStudent ?? '', gender: s.gender, status: s.status }); };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true); setErrors({}); setError(null);
    const item = form.kind === 'ITEM';
    const body = { academicYearId: year, name: form.name, kind: form.kind, inventoryItemId: item && form.inventoryItemId ? form.inventoryItemId : null, quantityPerStudent: item ? form.quantityPerStudent : '', amountPerStudent: item ? '' : form.amountPerStudent, levelNames: levels, gender: form.gender, status: form.status };
    try { await api(editId ? `/welfare/schemes/${editId}` : '/welfare/schemes', { method: editId ? 'PUT' : 'POST', body: JSON.stringify(body) }); toast(t('wf.saved', { name: form.name })); setForm(null); load(); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const handOut = async () => {
    if (!give || !view) return;
    setBusy(true);
    const all = view.students.filter((s) => s.eligible && Number(s.pending) > 0).map((s) => s.studentId);
    const ids = all.length === picked.size ? [] : [...picked];
    try {
      const r = await api<{ given: number; skipped: number; total: string }>(`/welfare/schemes/${give.id}/give`, { method: 'POST', body: JSON.stringify({ sectionId, givenOn: hand.givenOn, storeId: hand.storeId || null, reference: hand.reference, remarks: hand.remarks, studentIds: ids }) });
      toast(r.given ? t('wf.given', { n: r.given }) : t('wf.nothingDue'));
      loadView(); load();
    } catch (x) { toast(apiErrors(x).message ?? t('en.failed'), 'bad'); } finally { setBusy(false); }
  };
  const sec = o?.sections.find((s) => s.id === sectionId);
  const stores = o?.stores.filter((s) => !sec || s.campusId === sec.campusId) ?? [];
  const pending = view?.students.filter((s) => s.eligible && Number(s.pending) > 0) ?? [];
  const forWhom = (s: Scheme) => [s.levelNames.length ? s.levelNames.join(', ') : t('wf.allClasses'), s.gender === 'ALL' ? null : t(`wf.gender.${s.gender}` as MessageKey)].filter(Boolean).join(' · ');
  const what = (s: Scheme) => (s.kind === 'CASH' ? inr(s.amountPerStudent ?? 0) : `${s.quantityPerStudent} ${s.unit ?? ''}${s.item ? ` · ${s.item}` : ''}`);
  const sectionsFor = useMemo(() => (give && o ? o.sections.filter((s) => !give.levelNames.length || give.levelNames.includes(s.levelName)) : []), [give, o]);
  const campusName = (id: string) => (o && o.campuses.length > 1 ? o.campuses.find((c) => c.id === id)?.name : null);

  return (
    <>
      <PageHeader eyebrow={t('nav.students')} title={t('wf.title')} description={t('wf.desc')} actions={o?.canManage && <button type="button" className="btn btn-primary" onClick={openNew} disabled={!year}><Icon name="plus" /> {t('wf.new')}</button>} />
      {o && o.years.length > 1 && (
        <div className="filter-bar card"><label className="inv-f">{t('wf.year')}<select value={year} onChange={(e) => { setYear(e.target.value); setGive(null); }}>{o.years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</select></label></div>
      )}
      {!list ? <SkeletonRows rows={4} /> : !list.length ? <EmptyState icon="star" title={t('wf.none')} text={o?.canManage ? t('wf.noneText') : t('wf.noneTextRead')} /> : (
        <div className="table-wrap card" role="region" aria-label={t('wf.title')} tabIndex={0}>
          <table className="table">
            <thead><tr><th scope="col">{t('wf.scheme')}</th><th scope="col">{t('wf.each')}</th><th scope="col">{t('wf.for')}</th><th scope="col">{t('wf.progress')}</th><th scope="col"><span className="sr-only">{t('wf.actions')}</span></th></tr></thead>
            <tbody>{list.map((s) => (
              <tr key={s.id} className={give?.id === s.id ? 'row-on' : undefined}>
                <td><strong>{s.name}</strong><span className="sub-line muted small">{t(`wf.kind.${s.kind}` as MessageKey)}{s.status !== 'ACTIVE' && <> · <StatusBadge status="CLOSED" label={t('wf.closed')} /></>}</span></td>
                <td>{what(s)}</td>
                <td>{forWhom(s)}</td>
                <td><div className="gov-bar" role="img" aria-label={t('wf.progressOf', { n: s.fullyGiven, m: s.eligible })}><span style={{ width: `${s.eligible ? Math.round((s.fullyGiven * 100) / s.eligible) : 0}%` }} /></div><span className="small muted">{t('wf.progressOf', { n: s.fullyGiven, m: s.eligible })}</span></td>
                <td className="row-actions">
                  {s.status === 'ACTIVE' && <button type="button" className="btn btn-sm btn-primary" onClick={() => { setGive(s); setSectionId(''); setView(null); setHand({ givenOn: todayIST(), storeId: '', reference: '', remarks: '' }); }}>{t('wf.handOut')}</button>}
                  {o?.canManage && <button type="button" className="btn btn-sm btn-ghost" onClick={() => openEdit(s)} aria-label={t('wf.editOf', { name: s.name })}><Icon name="edit" size={14} /></button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {give && (
        <section className="card gov-block" aria-labelledby="wf-hand">
          <div className="panel-head">
            <div><h2 id="wf-hand" className="section-title">{t('wf.handTitle', { name: give.name })}</h2><p className="muted small">{t('wf.handHint')}</p></div>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setGive(null)}><Icon name="x" size={14} /> {t('wf.close')}</button>
          </div>
          <div className="filter-bar">
            <label className="inv-f">{t('wf.class')}<select value={sectionId} onChange={(e) => setSectionId(e.target.value)}><option value="">{t('wf.chooseClass')}</option>{sectionsFor.map((s) => <option key={s.id} value={s.id}>{s.name}{campusName(s.campusId) ? ` — ${campusName(s.campusId)}` : ''}</option>)}</select></label>
            <label className="inv-f">{t('wf.date')}<input type="date" value={hand.givenOn} max={todayIST()} onChange={(e) => setHand({ ...hand, givenOn: e.target.value })} /></label>
            {give.kind === 'ITEM' && give.inventoryItemId && o?.inventory && <label className="inv-f">{t('wf.store')}<select value={hand.storeId} onChange={(e) => setHand({ ...hand, storeId: e.target.value })}><option value="">{t('wf.chooseStore')}</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
            {give.kind === 'CASH' && <label className="inv-f">{t('wf.reference')}<input value={hand.reference} maxLength={60} onChange={(e) => setHand({ ...hand, reference: e.target.value })} placeholder={t('wf.referenceHint')} /></label>}
          </div>
          {sectionId && !view && <SkeletonRows rows={3} />}
          {view && (
            <>
              <div className="table-wrap" role="region" aria-label={view.section.name} tabIndex={0}>
                <table className="table">
                  <thead><tr><th scope="col"><span className="sr-only">{t('wf.pick')}</span></th><th scope="col">{t('gov.student')}</th><th scope="col" className="num">{t('wf.entitled')}</th><th scope="col" className="num">{t('wf.received')}</th><th scope="col" className="num">{t('wf.pending')}</th></tr></thead>
                  <tbody>{view.students.map((s) => {
                    const due = s.eligible && Number(s.pending) > 0;
                    const money = give.kind === 'CASH';
                    return (
                      <tr key={s.studentId} className={!s.eligible ? 'muted' : undefined}>
                        <td>{due && <input type="checkbox" aria-label={t('wf.pickOf', { name: s.name })} checked={picked.has(s.studentId)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(s.studentId); else n.delete(s.studentId); return n; })} />}</td>
                        <td><strong>{s.name}</strong><span className="sub-line muted small">{s.admissionNo}{!s.eligible ? ` · ${t('wf.notEligible')}` : ''}</span></td>
                        <td className="num">{s.eligible ? (money ? inr(s.entitled) : Number(s.entitled)) : '—'}</td>
                        <td className="num">{money ? inr(s.received) : Number(s.received)}</td>
                        <td className="num">{s.eligible ? (Number(s.pending) > 0 ? <strong>{money ? inr(s.pending) : Number(s.pending)}</strong> : <span className="badge ok">{t('wf.done')}</span>) : '—'}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
              <div className="rep-actions">
                {view.canGive ? (
                  <button type="button" className="btn btn-primary" disabled={busy || !picked.size} onClick={() => void handOut()}><Icon name="check" /> {busy ? t('wf.giving') : t('wf.giveTo', { n: picked.size })}</button>
                ) : <p className="muted small">{t('wf.cannotGive')}</p>}
                {!pending.length && <span className="muted small">{t('wf.allDone')}</span>}
              </div>
            </>
          )}
        </section>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title={editId ? t('wf.edit') : t('wf.new')} subtitle={t('wf.formSub')} onSubmit={save} busy={busy} error={error}>
        {form && o && (
          <>
            <Field id="wf-name" label={t('wf.name')} hint={t('wf.nameHint')} error={errors.name}><input id="wf-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
            <fieldset className="gov-radio"><legend>{t('wf.kindQ')}</legend>
              {(['ITEM', 'CASH'] as const).map((k) => <label key={k} className="check"><input type="radio" name="wf-kind" checked={form.kind === k} onChange={() => setForm({ ...form, kind: k })} /> {t(`wf.kind.${k}` as MessageKey)}</label>)}
            </fieldset>
            {form.kind === 'ITEM' ? (
              <div className="grid-2">
                <Field id="wf-item" label={t('wf.item')} hint={o.inventory ? t('wf.itemHint') : t('wf.noInventory')} error={errors.inventoryItemId}>
                  <select id="wf-item" value={form.inventoryItemId} onChange={(e) => setForm({ ...form, inventoryItemId: e.target.value })} disabled={!o.inventory}><option value="">{t('wf.noStock')}</option>{o.items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</select>
                </Field>
                <Field id="wf-qty" label={t('wf.qty')} error={errors.quantityPerStudent}><input id="wf-qty" inputMode="decimal" value={form.quantityPerStudent} onChange={(e) => setForm({ ...form, quantityPerStudent: e.target.value })} /></Field>
              </div>
            ) : (
              <Field id="wf-amt" label={t('wf.amount')} error={errors.amountPerStudent}><input id="wf-amt" inputMode="decimal" value={form.amountPerStudent} onChange={(e) => setForm({ ...form, amountPerStudent: e.target.value })} /></Field>
            )}
            <fieldset className="gov-levels"><legend>{t('wf.classesQ')}</legend>
              <p className="muted small">{t('wf.classesHint')}</p>
              <div className="gov-level-grid">{o.levels.map((lv) => <label key={lv} className="check"><input type="checkbox" checked={levels.includes(lv)} onChange={(e) => setLevels((l) => (e.target.checked ? [...l, lv] : l.filter((x) => x !== lv)))} /> {lv}</label>)}</div>
            </fieldset>
            <div className="grid-2">
              <Field id="wf-gender" label={t('wf.genderQ')} error={errors.gender}><select id="wf-gender" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>{['ALL', 'FEMALE', 'MALE'].map((g) => <option key={g} value={g}>{t(`wf.gender.${g}` as MessageKey)}</option>)}</select></Field>
              {editId && <Field id="wf-status" label={t('wf.status')} error={errors.status}><select id="wf-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="ACTIVE">{t('wf.open')}</option><option value="CLOSED">{t('wf.closed')}</option></select></Field>}
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
