'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, StatTile, useToast } from '@/components/ui';
import { useDay } from '@/components/admissions';

type Tab = 'meals' | 'report' | 'scale';
interface Base { campuses: { id: string; name: string }[]; today: string; monthStart: string; yesterday: string; tolerance: number }
interface MealRow { levelName: string; presentInHostel: number | null; breakfast: number | null; lunch: number | null; snacks: number | null; dinner: number | null }
interface Register { campusId: string; date: string; saved: boolean; rollCallTaken: boolean; rows: MealRow[]; canRecord: boolean }
interface Line { itemId: string; item: string; unit: string; childDays: number; due: number; issued: number; difference: number; percent: number | null; flagged: boolean }
interface Report { from: string; to: string; tolerance: number; days: number; meals: { breakfast: number; lunch: number; snacks: number; dinner: number }; lines: Line[]; flagged: number; scaleSet: boolean }
interface Scale { rows: { id: string; inventoryItemId: string; item: string; unit: string; quantityPerChild: number; levelNames: string[]; effectiveFrom: string; effectiveTo: string | null; current: boolean }[]; items: { id: string; name: string; unit: string }[]; levels: string[]; canEdit: boolean }

const MEALS = ['breakfast', 'lunch', 'snacks', 'dinner'] as const;
const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/** Hostel → Diet & meals (G3): the daily meal register, the diet report and the diet scale. */
export default function DietPage() {
  const { t } = useI18n();
  const toast = useToast();
  const day = useDay();
  const [base, setBase] = useState<Base | null>(null);
  const [tab, setTab] = useState<Tab>('meals');
  const [campusId, setCampusId] = useState('');
  // Meal register
  const [date, setDate] = useState('');
  const [reg, setReg] = useState<Register | null>(null);
  const [counts, setCounts] = useState<Record<string, Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  // Report
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [tol, setTol] = useState('10');
  const [rep, setRep] = useState<Report | null>(null);
  // Scale
  const [scale, setScale] = useState<Scale | null>(null);
  const [line, setLine] = useState<{ id?: string; inventoryItemId: string; quantityPerChild: string; effectiveFrom: string; effectiveTo: string } | null>(null);
  const [lineLevels, setLineLevels] = useState<string[]>([]);
  const [removing, setRemoving] = useState<Scale['rows'][number] | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Base>('/diet/campuses').then((b) => { setBase(b); setCampusId(b.campuses[0]?.id ?? ''); setDate(b.today); setFrom(b.monthStart); setTo(b.yesterday < b.monthStart ? b.today : b.yesterday); setTol(String(b.tolerance)); }).catch(() => setBase({ campuses: [], today: '', monthStart: '', yesterday: '', tolerance: 10 }));
  }, []);
  const loadReg = useCallback(() => {
    if (!campusId || !date) return;
    setReg(null);
    api<Register>(`/diet/meals?campusId=${campusId}&date=${date}`).then((r) => {
      setReg(r);
      setCounts(Object.fromEntries(r.rows.map((x) => [x.levelName, Object.fromEntries(MEALS.map((m) => [m, x[m] != null ? String(x[m]) : x.presentInHostel != null ? String(x.presentInHostel) : '']))])));
    }).catch(() => setReg(null));
  }, [campusId, date]);
  const loadRep = useCallback(() => {
    if (!campusId || !from || !to) return;
    setRep(null);
    api<Report>(`/diet/report?campusId=${campusId}&from=${from}&to=${to}&tolerance=${Number(tol) || 0}`).then(setRep).catch(() => setRep(null));
  }, [campusId, from, to, tol]);
  const loadScale = useCallback(() => { api<Scale>('/diet/scale').then(setScale).catch(() => setScale(null)); }, []);
  useEffect(() => { if (tab === 'meals') loadReg(); }, [tab, loadReg]);
  useEffect(() => { if (tab === 'report') loadRep(); }, [tab, loadRep]);
  useEffect(() => { if (tab === 'scale' || tab === 'report') loadScale(); }, [tab, loadScale]);

  const saveMeals = async () => {
    if (!reg) return;
    setSaving(true);
    try {
      await api('/diet/meals', { method: 'POST', body: JSON.stringify({ campusId, mealDate: date, rows: reg.rows.map((r) => ({ levelName: r.levelName, ...Object.fromEntries(MEALS.map((m) => [m, Number(counts[r.levelName]?.[m] || 0)])) })) }) });
      toast(t('diet.mealsSaved', { d: day(date) })); loadReg();
    } catch (x) { toast(apiErrors(x).message ?? t('en.failed'), 'bad'); } finally { setSaving(false); }
  };
  const saveLine = async (e: FormEvent) => {
    e.preventDefault();
    if (!line) return;
    setBusy(true); setErrors({}); setError(null);
    try {
      await api(line.id ? `/diet/scale/${line.id}` : '/diet/scale', { method: line.id ? 'PUT' : 'POST', body: JSON.stringify({ inventoryItemId: line.inventoryItemId, quantityPerChild: line.quantityPerChild, levelNames: lineLevels, effectiveFrom: line.effectiveFrom, effectiveTo: line.effectiveTo }) });
      toast(t('diet.lineSaved')); setLine(null); loadScale();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const removeLine = async () => {
    if (!removing) return;
    setBusy(true);
    try { await api(`/diet/scale/${removing.id}/delete`, { method: 'POST' }); toast(t('diet.lineRemoved')); setRemoving(null); loadScale(); }
    catch (x) { toast(apiErrors(x).message ?? t('en.failed'), 'bad'); } finally { setBusy(false); }
  };
  const blanks = !!reg && reg.rows.some((r) => MEALS.some((m) => (counts[r.levelName]?.[m] ?? '') === ''));
  const total = (m: (typeof MEALS)[number]) => (reg?.rows ?? []).reduce((s, r) => s + Number(counts[r.levelName]?.[m] || 0), 0);
  const unitOf = (id: string) => scale?.items.find((i) => i.id === id)?.unit ?? '';

  if (!base) return <SkeletonRows rows={5} />;
  if (!base.campuses.length) return <><PageHeader eyebrow={t('nav.hostel')} title={t('diet.title')} /><EmptyState icon="building" title={t('diet.noCampus')} /></>;
  const TABS: { key: Tab; label: string }[] = [{ key: 'meals', label: t('diet.tab.meals') }, { key: 'report', label: t('diet.tab.report') }, { key: 'scale', label: t('diet.tab.scale') }];
  return (
    <>
      <PageHeader eyebrow={t('nav.hostel')} title={t('diet.title')} description={t('diet.desc')} />
      <div className="tabs scroll" role="tablist" aria-label={t('diet.title')}>
        {TABS.map((x) => <button key={x.key} id={`tab-${x.key}`} role="tab" type="button" aria-selected={tab === x.key} aria-controls={`panel-${x.key}`} className={`tab ${tab === x.key ? 'on' : ''}`} onClick={() => setTab(x.key)}>{x.label}</button>)}
      </div>
      {tab !== 'scale' && (
        <div className="filter-bar card">
          {base.campuses.length > 1 && <label className="inv-f">{t('act.campus')}<select value={campusId} onChange={(e) => setCampusId(e.target.value)}>{base.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
          {tab === 'meals' && <label className="inv-f">{t('diet.date')}<input type="date" value={date} max={base.today} onChange={(e) => setDate(e.target.value)} /></label>}
          {tab === 'report' && <>
            <label className="inv-f">{t('inv.rep.from')}<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="inv-f">{t('inv.rep.to')}<input type="date" value={to} min={from} max={base.today} onChange={(e) => setTo(e.target.value)} /></label>
            <label className="inv-f">{t('diet.tolerance')}<input inputMode="numeric" value={tol} onChange={(e) => setTol(e.target.value.replace(/[^\d.]/g, ''))} aria-describedby="diet-tol-hint" /></label>
            <span id="diet-tol-hint" className="sr-only">{t('diet.toleranceHint')}</span>
          </>}
        </div>
      )}

      <section className="card" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'meals' && (!reg ? <SkeletonRows rows={4} /> : !reg.rows.length ? <EmptyState icon="clipboard" title={t('diet.noClasses')} /> : (
          <>
            <p className="muted small">{reg.saved ? t('diet.savedNote') : reg.rollCallTaken ? t('diet.suggested') : t('diet.noRollCall')}</p>
            <div className="table-wrap" role="region" aria-label={t('diet.tab.meals')} tabIndex={0}>
              <table className="table diet-table">
                <thead><tr><th scope="col">{t('diet.class')}</th><th scope="col" className="num">{t('diet.inHostel')}</th>{MEALS.map((m) => <th key={m} scope="col" className="num">{t(`diet.meal.${m}` as MessageKey)}</th>)}</tr></thead>
                <tbody>{reg.rows.map((r) => (
                  <tr key={r.levelName}>
                    <th scope="row">{r.levelName}</th>
                    <td className="num muted">{r.presentInHostel ?? '—'}</td>
                    {MEALS.map((m) => (
                      <td key={m} className="num">
                        <input className="diet-n" inputMode="numeric" aria-label={t('diet.countOf', { meal: t(`diet.meal.${m}` as MessageKey), cls: r.levelName })} value={counts[r.levelName]?.[m] ?? ''} disabled={!reg.canRecord}
                          onChange={(e) => setCounts((c) => ({ ...c, [r.levelName]: { ...c[r.levelName], [m]: e.target.value.replace(/\D/g, '').slice(0, 4) } }))} />
                      </td>
                    ))}
                  </tr>
                ))}</tbody>
                <tfoot><tr><th scope="row">{t('inv.total')}</th><td className="num muted">{reg.rows.reduce((s, r) => s + (r.presentInHostel ?? 0), 0) || '—'}</td>{MEALS.map((m) => <td key={m} className="num"><strong>{total(m)}</strong></td>)}</tr></tfoot>
              </table>
            </div>
            {reg.canRecord && <div className="rep-actions"><button type="button" className="btn btn-primary" onClick={() => void saveMeals()} disabled={saving || blanks} aria-describedby={blanks ? 'diet-fill' : undefined}><Icon name="check" /> {saving ? t('diet.saving') : t('diet.saveMeals')}</button>{blanks && <span id="diet-fill" className="muted small">{t('diet.fillAll')}</span>}</div>}
          </>
        ))}

        {tab === 'report' && (!rep ? <SkeletonRows rows={4} /> : (
          <>
            {!rep.scaleSet && <p className="notice"><Icon name="info" /> {t('diet.noScale')}</p>}
            <div className="stats pay-stats">
              <StatTile icon="calendar" label={t('diet.daysRecorded')} value={rep.days} />
              <StatTile icon="users" label={t('diet.mealsServed')} value={(rep.meals.breakfast + rep.meals.lunch + rep.meals.snacks + rep.meals.dinner).toLocaleString('en-IN')} hint={t('diet.mealsSplit', { b: rep.meals.breakfast, l: rep.meals.lunch, s: rep.meals.snacks, d: rep.meals.dinner })} />
              <StatTile icon="alert" label={t('diet.flagged')} value={rep.flagged} hint={t('diet.flaggedHint', { n: rep.tolerance })} />
            </div>
            {!rep.lines.length ? <EmptyState icon="clipboard" title={t('diet.noLines')} text={t('diet.noLinesText')} /> : (
              <div className="table-wrap" role="region" aria-label={t('diet.tab.report')} tabIndex={0}>
                <table className="table">
                  <thead><tr><th scope="col">{t('diet.item')}</th><th scope="col" className="num">{t('diet.childDays')}</th><th scope="col" className="num">{t('diet.due')}</th><th scope="col" className="num">{t('diet.issued')}</th><th scope="col" className="num">{t('diet.difference')}</th><th scope="col">{t('diet.check')}</th></tr></thead>
                  <tbody>{rep.lines.map((l) => (
                    <tr key={l.itemId}>
                      <td><strong>{l.item}</strong></td>
                      <td className="num">{l.childDays.toLocaleString('en-IN')}</td>
                      <td className="num">{qty(l.due)} {l.unit}</td>
                      <td className="num">{qty(l.issued)} {l.unit}</td>
                      <td className="num">{l.difference > 0 ? '+' : ''}{qty(l.difference)} {l.unit}{l.percent != null && <span className="sub-line muted small">{l.percent > 0 ? '+' : ''}{l.percent}%</span>}</td>
                      <td>{l.flagged ? <span className="badge warn"><Icon name="alert" size={12} /> {l.difference > 0 ? t('diet.over') : t('diet.under')}</span> : <span className="badge ok">{t('diet.within')}</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            <p className="muted small">{t('diet.howItWorks')}</p>
          </>
        ))}

        {tab === 'scale' && (!scale ? <SkeletonRows rows={4} /> : (
          <>
            <div className="panel-head">
              <div><h2 className="section-title">{t('diet.scaleTitle')}</h2><p className="muted small">{scale.canEdit ? t('diet.scaleHint') : t('diet.scaleHintRead')}</p></div>
              {scale.canEdit && <button type="button" className="btn btn-primary btn-sm" onClick={() => { setErrors({}); setError(null); setLineLevels([]); setLine({ inventoryItemId: '', quantityPerChild: '', effectiveFrom: base.today, effectiveTo: '' }); }} disabled={!scale.items.length}><Icon name="plus" size={14} /> {t('diet.addLine')}</button>}
            </div>
            {!scale.items.length && <p className="notice"><Icon name="info" /> {t('diet.noItems')}</p>}
            {!scale.rows.length ? <EmptyState icon="clipboard" title={t('diet.noScaleTitle')} text={t('diet.noScaleText')} /> : (
              <div className="table-wrap" role="region" aria-label={t('diet.scaleTitle')} tabIndex={0}>
                <table className="table">
                  <thead><tr><th scope="col">{t('diet.item')}</th><th scope="col" className="num">{t('diet.perChild')}</th><th scope="col">{t('diet.forClasses')}</th><th scope="col">{t('diet.period')}</th>{scale.canEdit && <th scope="col"><span className="sr-only">{t('wf.actions')}</span></th>}</tr></thead>
                  <tbody>{scale.rows.map((r) => (
                    <tr key={r.id} className={r.current ? undefined : 'muted'}>
                      <td><strong>{r.item}</strong>{!r.current && <span className="sub-line small">{t('diet.notCurrent')}</span>}</td>
                      <td className="num">{qty(r.quantityPerChild)} {r.unit}</td>
                      <td>{r.levelNames.length ? r.levelNames.join(', ') : t('wf.allClasses')}</td>
                      <td>{day(r.effectiveFrom)} – {r.effectiveTo ? day(r.effectiveTo) : t('diet.onwards')}</td>
                      {scale.canEdit && <td className="row-actions">
                        <button type="button" className="btn btn-sm btn-ghost" aria-label={t('wf.editOf', { name: r.item })} onClick={() => { setErrors({}); setError(null); setLineLevels(r.levelNames); setLine({ id: r.id, inventoryItemId: r.inventoryItemId, quantityPerChild: String(r.quantityPerChild), effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo ?? '' }); }}><Icon name="edit" size={14} /></button>
                        <button type="button" className="btn btn-sm btn-ghost" aria-label={t('diet.removeOf', { name: r.item })} onClick={() => setRemoving(r)}><Icon name="trash" size={14} /></button>
                      </td>}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </>
        ))}
      </section>

      <Modal open={!!line} onClose={() => setLine(null)} title={line?.id ? t('diet.editLine') : t('diet.addLine')} subtitle={t('diet.lineSub')} onSubmit={saveLine} busy={busy} error={error}>
        {line && scale && (
          <>
            <div className="grid-2">
              <Field id="dl-item" label={t('diet.item')} error={errors.inventoryItemId}><select id="dl-item" value={line.inventoryItemId} onChange={(e) => setLine({ ...line, inventoryItemId: e.target.value })} autoFocus><option value="">{t('diet.chooseItem')}</option>{scale.items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</select></Field>
              <Field id="dl-qty" label={t('diet.perChildQ', { unit: unitOf(line.inventoryItemId) || t('diet.unit') })} hint={t('diet.perChildHint')} error={errors.quantityPerChild}><input id="dl-qty" inputMode="decimal" value={line.quantityPerChild} onChange={(e) => setLine({ ...line, quantityPerChild: e.target.value })} /></Field>
              <Field id="dl-from" label={t('diet.from')} error={errors.effectiveFrom}><input id="dl-from" type="date" value={line.effectiveFrom} onChange={(e) => setLine({ ...line, effectiveFrom: e.target.value })} /></Field>
              <Field id="dl-to" label={t('diet.to')} hint={t('diet.toHint')} error={errors.effectiveTo}><input id="dl-to" type="date" value={line.effectiveTo} min={line.effectiveFrom} onChange={(e) => setLine({ ...line, effectiveTo: e.target.value })} /></Field>
            </div>
            <fieldset className="gov-levels"><legend>{t('diet.forClasses')}</legend>
              <p className="muted small">{t('wf.classesHint')}</p>
              <div className="gov-level-grid">{scale.levels.map((lv) => <label key={lv} className="check"><input type="checkbox" checked={lineLevels.includes(lv)} onChange={(e) => setLineLevels((l) => (e.target.checked ? [...l, lv] : l.filter((x) => x !== lv)))} /> {lv}</label>)}</div>
            </fieldset>
          </>
        )}
      </Modal>
      <Modal open={!!removing} onClose={() => setRemoving(null)} title={t('diet.removeTitle')} subtitle={removing?.item ?? ''} onSubmit={(e) => { e.preventDefault(); void removeLine(); }} busy={busy} submitLabel={t('diet.remove')} danger>
        <p className="muted">{t('diet.removeText')}</p>
      </Modal>
    </>
  );
}
