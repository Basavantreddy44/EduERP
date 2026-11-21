'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { fmtDay } from '@/components/activities';
import { inrFull } from '@/components/placements';

type FilterKey = 'campusId' | 'sectionId' | 'storeId' | 'from' | 'to' | 'status' | 'mode' | 'passingYear' | 'minBalance';
interface Col { key: string; label: string; type: 'text' | 'money' | 'number' | 'date' | 'percent' }
interface Report { code: string; group: string; title: string; filters: FilterKey[]; columns: Col[] }
interface Result { code: string; columns: Col[]; total: number; rows: Record<string, string | number | null>[]; truncated: boolean; totals: Record<string, string> | null }
interface Saved { id: string; reportCode: string; name: string; filters: Record<string, string | number>; isShared: boolean; schedule: string; scheduleFormat: string; mine: boolean; owner: string }
interface Opts { campuses: { id: string; name: string }[]; sections: { id: string; name: string; campusId: string }[]; stores: { id: string; name: string; campusId: string }[] }
const STATUS: Record<string, string[]> = { STUDENT_LIST: ['ACTIVE', 'INACTIVE', 'DROPPED', 'TRANSFERRED', 'PASSED_OUT'], STAFF_LIST: ['ACTIVE', 'ON_LEAVE', 'RESIGNED', 'TERMINATED'], PLACEMENT_OFFERS: ['OFFERED', 'ACCEPTED', 'DECLINED', 'REVOKED'] };
const MODES = ['CASH', 'CHEQUE', 'DD', 'UPI', 'CARD', 'BANK_TRANSFER', 'ONLINE'];

/** Reports (M19.4): run a standard report, save its filters, export to Excel or CSV in the background. */
export default function ReportsPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [cat, setCat] = useState<Report[] | null>(null);
  const [opts, setOpts] = useState<Opts | null>(null);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [code, setCode] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [running, setRunning] = useState(false);
  const [save, setSave] = useState<{ id?: string; name: string; isShared: boolean; schedule: string; scheduleFormat: string } | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loadSaved = useCallback(() => { api<Saved[]>('/reports/saved').then(setSaved).catch(() => setSaved([])); }, []);
  useEffect(() => { api<Report[]>('/reports/catalogue').then((c) => { setCat(c); setCode((x) => x || c[0]?.code || ''); }).catch(() => setCat([])); api<Opts>('/reports/options').then(setOpts).catch(() => setOpts(null)); loadSaved(); }, [loadSaved]);
  const rep = cat?.find((r) => r.code === code);
  const title = (c: string) => t(`rep.code.${c}` as MessageKey);
  const body = useMemo(() => Object.fromEntries(Object.entries(filters).filter(([k, v]) => v !== '' && rep?.filters.includes(k as FilterKey)).map(([k, v]) => [k, ['passingYear', 'minBalance'].includes(k) ? Number(v) : v])), [filters, rep]);
  const runIt = async () => {
    if (!rep) return;
    setRunning(true); setResult(null); setErrors({});
    try { setResult(await api<Result>(`/reports/run/${rep.code}`, { method: 'POST', body: JSON.stringify(body) })); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); toast(a.message ?? t('en.failed'), 'bad'); } finally { setRunning(false); }
  };
  const exportIt = async (format: 'XLSX' | 'CSV') => {
    if (!rep) return;
    try { await api('/reports/exports', { method: 'POST', body: JSON.stringify({ reportCode: rep.code, filters: body, format }) }); toast(t('rep.exportQueued')); }
    catch (x) { toast(apiErrors(x).message ?? t('en.failed'), 'bad'); }
  };
  const doSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!save || !rep) return;
    setBusy(true); setErrors({}); setError(null);
    try {
      await api(save.id ? `/reports/saved/${save.id}` : '/reports/saved', { method: save.id ? 'PUT' : 'POST', body: JSON.stringify({ reportCode: rep.code, name: save.name, filters: body, isShared: save.isShared, schedule: save.schedule, scheduleFormat: save.scheduleFormat }) });
      toast(t('act.saved')); setSave(null); loadSaved();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const remove = async (s: Saved) => {
    try { await api(`/reports/saved/${s.id}/delete`, { method: 'POST' }); toast(t('rep.saved.removed')); loadSaved(); }
    catch (x) { toast(apiErrors(x).message ?? t('en.failed'), 'bad'); }
  };
  const open = (s: Saved) => { setCode(s.reportCode); setFilters(Object.fromEntries(Object.entries(s.filters).map(([k, v]) => [k, String(v)]))); setResult(null); };
  const fmt = (c: Col, v: string | number | null) => (v == null || v === '' ? '' : c.type === 'money' ? inrFull(v) : c.type === 'date' ? fmtDay(locale, String(v)) : c.type === 'percent' ? `${v}%` : c.type === 'number' ? Number(v).toLocaleString('en-IN') : String(v));
  const set = (k: string, v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const campusOf = filters.campusId;
  const groups = [...new Set((cat ?? []).map((r) => r.group))];
  return (
    <>
      <PageHeader eyebrow={t('nav.reports')} title={t('rep.mainTitle')} description={t('rep.mainDesc')} actions={<Link href="/reports/exports" className="btn"><Icon name="download" /> {t('nav.repExports')}</Link>} />
      {!cat ? <SkeletonRows rows={4} /> : !cat.length ? <EmptyState icon="grid" title={t('rep.none')} /> : (
        <div className="rep-layout">
          <aside className="card rep-side" aria-label={t('rep.catalogue')}>
            {groups.map((g) => (
              <div key={g}>
                <h2 className="rep-group">{t(`rep.group.${g}` as MessageKey)}</h2>
                <ul>{cat.filter((r) => r.group === g).map((r) => <li key={r.code}><button type="button" className={`rep-item ${r.code === code ? 'on' : ''}`} aria-current={r.code === code ? 'true' : undefined} onClick={() => { setCode(r.code); setFilters({}); setResult(null); }}>{title(r.code)}</button></li>)}</ul>
              </div>
            ))}
            {saved.length > 0 && (
              <div>
                <h2 className="rep-group">{t('rep.saved.title')}</h2>
                <ul>{saved.map((s) => (
                  <li key={s.id} className="rep-saved">
                    <button type="button" className="rep-item" onClick={() => open(s)}>{s.name}<span className="sub-line muted small">{title(s.reportCode)}{s.isShared ? ` · ${s.mine ? t('rep.saved.shared') : t('rep.saved.by', { n: s.owner })}` : ''}{s.schedule !== 'NONE' ? ` · ${t(`rep.sched.${s.schedule}` as MessageKey)}` : ''}</span></button>
                    {s.mine && <>
                      <button type="button" className="btn btn-sm btn-ghost icon-btn" aria-label={t('act.editNamed', { n: s.name })} onClick={() => { open(s); setErrors({}); setError(null); setSave({ id: s.id, name: s.name, isShared: s.isShared, schedule: s.schedule, scheduleFormat: s.scheduleFormat }); }}><Icon name="edit" size={14} /></button>
                      <button type="button" className="btn btn-sm btn-ghost icon-btn" aria-label={t('act.removeNamed', { n: s.name })} onClick={() => void remove(s)}><Icon name="trash" size={14} /></button>
                    </>}
                  </li>
                ))}</ul>
              </div>
            )}
          </aside>
          <div className="rep-main">
            {rep && (
              <section className="card p12-block" aria-labelledby="rep-h">
                <h2 id="rep-h" className="section-title">{title(rep.code)}</h2>
                <div className="rep-filters">
                  {rep.filters.includes('campusId') && opts && opts.campuses.length > 1 && <label className="inv-f">{t('act.campus')}<select value={filters.campusId ?? ''} onChange={(e) => setFilters((f) => ({ ...f, campusId: e.target.value, sectionId: '', storeId: '' }))}><option value="">{t('inv.allCampuses')}</option>{opts.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
                  {rep.filters.includes('sectionId') && <label className="inv-f">{t('rep.f.class')}<select value={filters.sectionId ?? ''} onChange={(e) => set('sectionId', e.target.value)}><option value="">{t('rep.f.allClasses')}</option>{opts?.sections.filter((s) => !campusOf || s.campusId === campusOf).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
                  {rep.filters.includes('storeId') && <label className="inv-f">{t('inv.store')}<select value={filters.storeId ?? ''} onChange={(e) => set('storeId', e.target.value)}><option value="">{t('inv.allStores')}</option>{opts?.stores.filter((s) => !campusOf || s.campusId === campusOf).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
                  {rep.filters.includes('from') && <label className="inv-f">{t('inv.rep.from')}<input type="date" value={filters.from ?? ''} onChange={(e) => set('from', e.target.value)} /></label>}
                  {rep.filters.includes('to') && <label className="inv-f">{rep.code === 'FEE_DUES' ? t('rep.f.dueBy') : t('inv.rep.to')}<input type="date" value={filters.to ?? ''} onChange={(e) => set('to', e.target.value)} /></label>}
                  {rep.filters.includes('status') && STATUS[rep.code] && <label className="inv-f">{t('act.status')}<select value={filters.status ?? ''} onChange={(e) => set('status', e.target.value)}><option value="">{rep.code === 'STUDENT_LIST' ? t('rep.f.current') : t('act.all')}</option>{STATUS[rep.code].map((s) => <option key={s} value={s}>{t(`rep.st.${s}` as MessageKey)}</option>)}</select></label>}
                  {rep.filters.includes('mode') && <label className="inv-f">{t('rep.f.mode')}<select value={filters.mode ?? ''} onChange={(e) => set('mode', e.target.value)}><option value="">{t('act.all')}</option>{MODES.map((m) => <option key={m} value={m}>{t(`rep.mode.${m}` as MessageKey)}</option>)}</select></label>}
                  {rep.filters.includes('passingYear') && <label className="inv-f">{t('plc.passingYear')}<input inputMode="numeric" value={filters.passingYear ?? ''} onChange={(e) => set('passingYear', e.target.value)} /></label>}
                  {rep.filters.includes('minBalance') && <label className="inv-f">{t('rep.f.minBalance')}<input inputMode="decimal" value={filters.minBalance ?? ''} onChange={(e) => set('minBalance', e.target.value)} /></label>}
                </div>
                {errors.to && <p className="field-error">{errors.to}</p>}
                <div className="rep-actions">
                  <button type="button" className="btn btn-primary" onClick={() => void runIt()} disabled={running}><Icon name="search" /> {running ? t('rep.running') : t('rep.run')}</button>
                  <button type="button" className="btn" onClick={() => void exportIt('XLSX')}><Icon name="download" /> {t('rep.excelFile')}</button>
                  <button type="button" className="btn" onClick={() => void exportIt('CSV')}><Icon name="download" /> CSV</button>
                  <button type="button" className="btn btn-ghost" onClick={() => { setErrors({}); setError(null); setSave({ name: title(rep.code), isShared: false, schedule: 'NONE', scheduleFormat: 'XLSX' }); }}><Icon name="star" /> {t('rep.saveAs')}</button>
                  {result && <button type="button" className="btn btn-ghost" onClick={() => window.print()}><Icon name="receipt" /> {t('rep.print')}</button>}
                </div>
              </section>
            )}
            {running && <SkeletonRows rows={5} />}
            {result && !running && (!result.total ? <EmptyState icon="grid" title={t('rep.noRows')} /> : (
              <section className="card rep-result" aria-labelledby="rep-res">
                <div className="rep-result-head">
                  <h2 id="rep-res" className="section-title">{t('rep.rows', { n: result.total.toLocaleString('en-IN') })}</h2>
                  {result.truncated && <span className="muted small">{t('rep.truncated', { n: result.rows.length })}</span>}
                </div>
                <div className="table-wrap" role="region" aria-label={title(result.code)} tabIndex={0}>
                  <table className="table">
                    <thead><tr>{result.columns.map((c) => <th key={c.key} scope="col" className={['money', 'number', 'percent'].includes(c.type) ? 'num' : undefined}>{t(`rep.col.${c.key}` as MessageKey)}</th>)}</tr></thead>
                    <tbody>{result.rows.map((r, i) => <tr key={i}>{result.columns.map((c) => <td key={c.key} className={['money', 'number', 'percent'].includes(c.type) ? 'num' : undefined}>{fmt(c, r[c.key])}</td>)}</tr>)}</tbody>
                    {result.totals && <tfoot><tr>{result.columns.map((c, i) => <td key={c.key} className={c.type === 'money' ? 'num' : undefined}>{i === 0 ? <strong>{t('inv.total')}</strong> : result.totals![c.key] != null ? <strong>{inrFull(result.totals![c.key])}</strong> : ''}</td>)}</tr></tfoot>}
                  </table>
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
      <Modal open={!!save} onClose={() => setSave(null)} title={save?.id ? t('rep.saved.edit') : t('rep.saveAs')} subtitle={t('rep.saved.sub')} onSubmit={doSave} busy={busy} error={error}>
        {save && <>
          <Field id="sv-name" label={t('rep.saved.name')} error={errors.name}><input id="sv-name" value={save.name} onChange={(e) => setSave({ ...save, name: e.target.value })} /></Field>
          <label className="check"><input type="checkbox" checked={save.isShared} onChange={(e) => setSave({ ...save, isShared: e.target.checked })} /> {t('rep.saved.share')}</label>
          <div className="grid-2">
            <Field id="sv-sch" label={t('rep.saved.schedule')} hint={t('rep.saved.scheduleHint')} error={errors.schedule}><select id="sv-sch" value={save.schedule} onChange={(e) => setSave({ ...save, schedule: e.target.value })}>{['NONE', 'WEEKLY', 'MONTHLY'].map((s) => <option key={s} value={s}>{t(`rep.sched.${s}` as MessageKey)}</option>)}</select></Field>
            {save.schedule !== 'NONE' && <Field id="sv-fmt" label={t('rep.saved.format')} error={errors.scheduleFormat}><select id="sv-fmt" value={save.scheduleFormat} onChange={(e) => setSave({ ...save, scheduleFormat: e.target.value })}><option value="XLSX">{t('rep.excelFile')}</option><option value="CSV">CSV</option></select></Field>}
          </div>
        </>}
      </Modal>
    </>
  );
}
