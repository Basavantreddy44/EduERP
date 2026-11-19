'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ACCOUNT_TYPES, BANK_ACCOUNT_TYPES, PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { CampusPicker } from '@/components/CampusPicker';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { AccPill, ChartAccount, CostCentre, Line, LinesEditor, emptyLine, fyStart, lineBody, rupees, todayIST, useBanks, useChart } from '@/components/accounts';

type Tab = 'chart' | 'centres' | 'banks' | 'rates' | 'opening' | 'periods';
interface Tax { id: string; code: string; name: string; ratePercent: string; itcClaimable: boolean; effectiveFrom: string; effectiveTo: string | null }
interface Tds { id: string; sectionCode: string; description: string; rateIndividual: string; rateOthers: string; rateNoPan: string; thresholdSingle: string | null; thresholdAnnual: string | null; effectiveFrom: string; effectiveTo: string | null }
interface Statutory { confirmed: { by: string; at: string } | null; taxCodes: Tax[]; tdsSections: Tds[] }
interface Periods { locks: { month: string; status: string; lockedBy: string; lockedAt: string; unlockReason: string | null; unlockRequestedBy: string | null }[]; years: { id: string; name: string; startDate: string; endDate: string; isClosed: boolean }[] }

/** Accounts → Set-up (M13.1). */
export default function AccountsSetupPage() {
  const { can } = useSession();
  const { t } = useI18n();
  const setup = can(PERMISSIONS.ACC_SETUP);
  const close = can(PERMISSIONS.ACC_CLOSE);
  const [tab, setTab] = useState<Tab>('chart');
  const [reload, setReload] = useState(0);
  const chart = useChart(reload);
  const tabs: Tab[] = ['chart', 'centres', 'banks', 'rates', 'opening', 'periods'];
  return (
    <>
      <PageHeader eyebrow={t('nav.accounts')} title={t('ac2.setup.title')} description={t('ac2.setup.desc')} />
      <div className="tabs scroll" role="tablist" aria-label={t('ac2.setup.title')}>
        {tabs.map((x) => <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(`ac2.setup.tab.${x}` as MessageKey)}</button>)}
      </div>
      {!chart ? <SkeletonRows rows={6} /> : (
        <>
          {tab === 'chart' && <Chart chart={chart} canEdit={setup} onSaved={() => setReload((n) => n + 1)} />}
          {tab === 'centres' && <Centres canEdit={setup} />}
          {tab === 'banks' && <Banks canEdit={setup} onSaved={() => setReload((n) => n + 1)} />}
          {tab === 'rates' && <Rates canEdit={setup} />}
          {tab === 'opening' && <Opening chart={chart} canEdit={setup} />}
          {tab === 'periods' && <PeriodsTab canClose={close} />}
        </>
      )}
    </>
  );
}

function Chart({ chart, canEdit, onSaved }: { chart: ChartAccount[]; canEdit: boolean; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [edit, setEdit] = useState<ChartAccount | 'new' | null>(null);
  const [form, setForm] = useState({ code: '', name: '', accountType: 'EXPENSE', parentId: '', isGroup: false, isActive: true });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Depth-first tree; a group shows the total of everything under it.
  const tree = useMemo(() => {
    const kids = new Map<string | null, ChartAccount[]>();
    for (const a of chart) kids.set(a.parentId, [...(kids.get(a.parentId) ?? []), a]);
    const total = (a: ChartAccount): number => (a.isGroup ? (kids.get(a.id) ?? []).reduce((s, c) => s + total(c), 0) : Math.round(Number(a.balance) * 100));
    const out: { a: ChartAccount; depth: number; bal: number }[] = [];
    const walk = (p: string | null, depth: number) => (kids.get(p) ?? []).sort((x, y) => x.code.localeCompare(y.code)).forEach((a) => { out.push({ a, depth, bal: total(a) }); walk(a.id, depth + 1); });
    walk(null, 0);
    return out;
  }, [chart]);
  const groups = chart.filter((a) => a.isGroup && a.isActive);
  const open = (a: ChartAccount | 'new') => {
    setEdit(a); setErrors({}); setError(null);
    setForm(a === 'new' ? { code: '', name: '', accountType: groups[0]?.accountType ?? 'EXPENSE', parentId: groups.find((g) => g.systemKey === 'EXPENSES')?.id ?? '', isGroup: false, isActive: true } : { code: a.code, name: a.name, accountType: a.accountType, parentId: a.parentId ?? '', isGroup: a.isGroup, isActive: a.isActive });
  };
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!edit) return;
    setBusy(true); setErrors({}); setError(null);
    try {
      if (edit === 'new') await api('/accounts/chart', { method: 'POST', body: JSON.stringify({ code: form.code, name: form.name, accountType: form.accountType, parentId: form.parentId, isGroup: form.isGroup }) });
      else await api(`/accounts/chart/${edit.id}`, { method: 'PUT', body: JSON.stringify({ name: form.name, isActive: form.isActive }) });
      toast(t('ac2.chart.saved')); setEdit(null); onSaved();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  // Balance shown the natural way: assets & expenses as debit, the rest as credit.
  const shown = (a: ChartAccount, bal: number) => (['ASSET', 'EXPENSE'].includes(a.accountType) ? bal : -bal);
  return (
    <>
      <div className="panel-head"><p className="muted">{t('ac2.chart.hint')}</p>{canEdit && <button type="button" className="btn btn-primary" onClick={() => open('new')}><Icon name="plus" /> {t('ac2.chart.add')}</button>}</div>
      <div className="table-wrap card p12-table acc-chart">
        <table className="table">
          <thead><tr><th scope="col">{t('common.code')}</th><th scope="col">{t('ac2.account')}</th><th scope="col">{t('common.type')}</th><th scope="col" className="num">{t('ac2.chart.balance')}</th><th scope="col"><span className="sr-only">{t('common.actions')}</span></th></tr></thead>
          <tbody>
            {tree.map(({ a, depth, bal }) => (
              <tr key={a.id} className={`${a.isGroup ? 'acc-heading' : ''}${a.isActive ? '' : ' row-dim'}`}>
                <td className="code">{a.code}</td>
                <td style={{ paddingLeft: `${12 + depth * 18}px` }}>{a.name}{a.isSystem && <span className="muted small"> · {t('ac2.chart.system')}</span>}{!a.isActive && <span className="muted small"> · {t('ac2.chart.off')}</span>}</td>
                <td>{t(`ac2.type.${a.accountType}` as MessageKey)}</td>
                <td className="num">{bal ? rupees((shown(a, bal) / 100).toFixed(2), { paise: true }) : '—'}</td>
                <td>{canEdit && <button type="button" className="btn btn-sm btn-ghost" onClick={() => open(a)} aria-label={t('ac2.chart.editOf', { name: a.name })}><Icon name="edit" size={14} /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? t('ac2.chart.add') : edit ? edit.name : ''} onSubmit={save} submitLabel={t('common.save')} busy={busy} error={error}>
        {edit === 'new' ? (
          <>
            <Field id="ch-parent" label={t('ac2.chart.under')} error={errors.parentId}><select id="ch-parent" value={form.parentId} onChange={(e) => { const g = groups.find((x) => x.id === e.target.value); setForm((f) => ({ ...f, parentId: e.target.value, accountType: g?.accountType ?? f.accountType })); }}>{groups.map((g) => <option key={g.id} value={g.id}>{g.code} · {g.name}</option>)}</select></Field>
            <div className="grid-2">
              <Field id="ch-code" label={t('common.code')} error={errors.code}><input id="ch-code" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="5495" /></Field>
              <Field id="ch-type" label={t('common.type')}><select id="ch-type" value={form.accountType} disabled>{ACCOUNT_TYPES.map((x) => <option key={x} value={x}>{t(`ac2.type.${x}` as MessageKey)}</option>)}</select></Field>
            </div>
            <Field id="ch-name" label={t('common.name')} error={errors.name}><input id="ch-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
            <label className="check"><input type="checkbox" checked={form.isGroup} onChange={(e) => setForm((f) => ({ ...f, isGroup: e.target.checked }))} /> {t('ac2.chart.isGroup')}</label>
          </>
        ) : (
          <>
            <Field id="ch-name2" label={t('common.name')} error={errors.name}><input id="ch-name2" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
            {edit && !edit.isSystem && <label className="check"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} /> {t('ac2.chart.inUse')}</label>}
            {edit && edit.isSystem && <p className="muted small">{t('ac2.chart.systemHint')}</p>}
          </>
        )}
      </Modal>
    </>
  );
}

function Centres({ canEdit }: { canEdit: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const [rows, setRows] = useState<CostCentre[] | null>(null);
  const [depts, setDepts] = useState<{ id: string; name: string }[]>([]);
  const [edit, setEdit] = useState<CostCentre | 'new' | null>(null);
  const [form, setForm] = useState({ code: '', name: '', campusId: '', departmentId: '', isActive: true });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<CostCentre[]>('/accounts/cost-centres').then(setRows).catch(() => setRows([])); }, []);
  useEffect(load, [load]);
  useEffect(() => { api<{ id: string; name: string }[]>('/departments').then(setDepts).catch(() => setDepts([])); }, []);
  const open = (c: CostCentre | 'new') => { setEdit(c); setErrors({}); setError(null); setForm(c === 'new' ? { code: '', name: '', campusId: '', departmentId: '', isActive: true } : { code: c.code, name: c.name, campusId: c.campusId ?? '', departmentId: c.departmentId ?? '', isActive: c.isActive }); };
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!edit) return;
    setBusy(true); setErrors({}); setError(null);
    try { await api(edit === 'new' ? '/accounts/cost-centres' : `/accounts/cost-centres/${edit.id}`, { method: edit === 'new' ? 'POST' : 'PUT', body: JSON.stringify({ ...form, campusId: form.campusId || null, departmentId: form.departmentId || null }) }); toast(t('ac2.cc.saved')); setEdit(null); load(); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="panel-head"><p className="muted">{t('ac2.cc.hint')}</p>{canEdit && <button type="button" className="btn btn-primary" onClick={() => open('new')}><Icon name="plus" /> {t('ac2.cc.add')}</button>}</div>
      {!rows ? <SkeletonRows rows={3} /> : !rows.length ? <EmptyState icon="layers" title={t('ac2.cc.none')} /> : (
        <ul className="p12-committees">{rows.map((c) => <li key={c.id} className={`card${c.isActive ? '' : ' row-dim'}`}><span><strong>{c.name}</strong> <span className="code">{c.code}</span><span className="sub-line muted small">{[c.campus, c.department].filter(Boolean).join(' · ') || t('ac2.cc.whole')}</span></span>{canEdit && <button type="button" className="btn btn-sm" onClick={() => open(c)}><Icon name="edit" size={14} /> {t('common.edit')}</button>}</li>)}</ul>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? t('ac2.cc.add') : edit ? edit.name : ''} onSubmit={save} submitLabel={t('common.save')} busy={busy} error={error}>
        <div className="grid-2">
          <Field id="cc-code" label={t('common.code')} error={errors.code}><input id="cc-code" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} /></Field>
          <Field id="cc-name" label={t('common.name')} error={errors.name}><input id="cc-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
        </div>
        <div className="grid-2">
          <Field id="cc-campus" label={t('common.campus')}><CampusPicker id="cc-campus" value={form.campusId} onChange={(v) => setForm((f) => ({ ...f, campusId: v }))} allowInstitution institutionLabel={t('common.wholeInstitution')} /></Field>
          <Field id="cc-dept" label={t('ac2.cc.dept')}><select id="cc-dept" value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}><option value="">—</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        </div>
        {edit !== 'new' && <label className="check"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} /> {t('ac2.chart.inUse')}</label>}
      </Modal>
    </>
  );
}

function Banks({ canEdit, onSaved }: { canEdit: boolean; onSaved: () => void }) {
  const { t } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const [reload, setReload] = useState(0);
  const banks = useBanks(reload);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ campusId: '', bankName: '', branch: '', accountNo: '', ifsc: '', accountType: 'CURRENT', isFeeCollection: false });
  const [shown, setShown] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try { await api('/accounts/bank-accounts', { method: 'POST', body: JSON.stringify({ ...form, campusId: form.campusId || null, branch: form.branch || null }) }); toast(t('ac2.bk.saved')); setOpen(false); setReload((n) => n + 1); onSaved(); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const reveal = async (id: string) => { try { const r = await api<{ accountNo: string }>(`/accounts/bank-accounts/${id}/reveal`, { method: 'POST', body: '{}' }); setShown((s) => ({ ...s, [id]: r.accountNo })); } catch (x) { toast(apiErrors(x).message ?? t('en.failed')); } };
  return (
    <>
      <div className="panel-head"><p className="muted">{t('ac2.bk.hint')}</p>{canEdit && <button type="button" className="btn btn-primary" onClick={() => { setForm({ campusId: '', bankName: '', branch: '', accountNo: '', ifsc: '', accountType: 'CURRENT', isFeeCollection: false }); setErrors({}); setError(null); setOpen(true); }}><Icon name="plus" /> {t('ac2.bk.add')}</button>}</div>
      {!banks ? <SkeletonRows rows={2} /> : !banks.length ? <EmptyState icon="building" title={t('ac2.bk.none')} /> : (
        <ul className="p12-committees">{banks.map((b) => (
          <li key={b.id} className={`card${b.isActive ? '' : ' row-dim'}`}>
            <span><strong>{b.bankName}</strong>{b.branch && <span className="muted"> · {b.branch}</span>}<span className="sub-line small">{shown[b.id] ?? b.accountNo} · {b.ifsc} · {t(`ac2.bk.type.${b.accountType}` as MessageKey)}{b.isFeeCollection ? ` · ${t('ac2.bk.fees')}` : ''}</span><span className="sub-line muted small">{t('ac2.bk.ledger', { code: b.code })}{b.campus ? ` · ${b.campus}` : ''}</span></span>
            {can(PERMISSIONS.ACC_REVEAL) && !shown[b.id] && <button type="button" className="btn btn-sm btn-ghost" onClick={() => void reveal(b.id)}><Icon name="eye" size={14} /> {t('ac2.show')}</button>}
          </li>
        ))}</ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('ac2.bk.add')} subtitle={t('ac2.bk.privacy')} onSubmit={save} submitLabel={t('common.save')} busy={busy} error={error}>
        <div className="grid-2">
          <Field id="bk-name" label={t('ac2.vendor.bankName')} error={errors.bankName}><input id="bk-name" value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} /></Field>
          <Field id="bk-branch" label={t('ac2.bk.branch')}><input id="bk-branch" value={form.branch} onChange={(e) => setForm((f) => ({ ...f, branch: e.target.value }))} /></Field>
        </div>
        <div className="grid-2">
          <Field id="bk-no" label={t('ac2.vendor.accountNo')} hint={t('ac2.vendor.encrypted')} error={errors.accountNo}><input id="bk-no" inputMode="numeric" value={form.accountNo} onChange={(e) => setForm((f) => ({ ...f, accountNo: e.target.value }))} autoComplete="off" /></Field>
          <Field id="bk-ifsc" label="IFSC" error={errors.ifsc}><input id="bk-ifsc" maxLength={11} value={form.ifsc} onChange={(e) => setForm((f) => ({ ...f, ifsc: e.target.value }))} /></Field>
        </div>
        <div className="grid-2">
          <Field id="bk-type" label={t('common.type')}><select id="bk-type" value={form.accountType} onChange={(e) => setForm((f) => ({ ...f, accountType: e.target.value }))}>{BANK_ACCOUNT_TYPES.map((x) => <option key={x} value={x}>{t(`ac2.bk.type.${x}` as MessageKey)}</option>)}</select></Field>
          <Field id="bk-campus" label={t('common.campus')}><CampusPicker id="bk-campus" value={form.campusId} onChange={(v) => setForm((f) => ({ ...f, campusId: v }))} allowInstitution institutionLabel={t('common.wholeInstitution')} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={form.isFeeCollection} onChange={(e) => setForm((f) => ({ ...f, isFeeCollection: e.target.checked }))} /> {t('ac2.bk.feesCheck')}</label>
      </Modal>
    </>
  );
}

function Rates({ canEdit }: { canEdit: boolean }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [s, setS] = useState<Statutory | null>(null);
  const [taxEdit, setTaxEdit] = useState<Tax | 'new' | null>(null);
  const [tdsEdit, setTdsEdit] = useState<Tds | 'new' | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Statutory>('/accounts/statutory').then(setS).catch(() => setS(null)); }, []);
  useEffect(load, [load]);
  const confirm = async () => { try { await api('/accounts/statutory/confirm', { method: 'POST', body: '{}' }); toast(t('ac2.rates.confirmedToast')); load(); } catch (x) { toast(apiErrors(x).message ?? t('en.failed')); } };
  const saveTax = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!taxEdit) return;
    setBusy(true); setErrors({}); setError(null);
    try { await api(taxEdit === 'new' ? '/accounts/tax-codes' : `/accounts/tax-codes/${taxEdit.id}`, { method: taxEdit === 'new' ? 'POST' : 'PUT', body: JSON.stringify({ ...form, effectiveTo: form.effectiveTo || null }) }); toast(t('ac2.rates.saved')); setTaxEdit(null); load(); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const saveTds = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!tdsEdit) return;
    setBusy(true); setErrors({}); setError(null);
    try { await api(tdsEdit === 'new' ? '/accounts/tds-sections' : `/accounts/tds-sections/${tdsEdit.id}`, { method: tdsEdit === 'new' ? 'POST' : 'PUT', body: JSON.stringify({ ...form, thresholdSingle: form.thresholdSingle || null, thresholdAnnual: form.thresholdAnnual || null, effectiveTo: form.effectiveTo || null }) }); toast(t('ac2.rates.saved')); setTdsEdit(null); load(); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const d = (v: string | null) => (v ? new Date(`${v}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
  const f = (k: string) => ({ value: String(form[k] ?? ''), onChange: (e: { target: { value: string } }) => setForm((x) => ({ ...x, [k]: e.target.value })) });
  if (!s) return <SkeletonRows rows={5} />;
  return (
    <>
      {s.confirmed ? <p className="muted small"><Icon name="check" size={14} /> {t('ac2.rates.confirmedBy', { name: s.confirmed.by, d: new Date(s.confirmed.at).toLocaleDateString(locale) })}</p> : (
        <div className="notice acc-check"><Icon name="alert" /> <span>{t('ac2.rates.check')}</span>{canEdit && <button type="button" className="btn btn-sm btn-primary" onClick={() => void confirm()}><Icon name="check" size={14} /> {t('ac2.rates.confirm')}</button>}</div>
      )}
      <section aria-labelledby="rt-gst">
        <div className="panel-head"><h2 id="rt-gst" className="section-title">{t('ac2.rates.gst')}</h2>{canEdit && <button type="button" className="btn btn-sm" onClick={() => { setForm({ code: '', name: '', ratePercent: '', itcClaimable: false, effectiveFrom: todayIST(), effectiveTo: '' }); setErrors({}); setError(null); setTaxEdit('new'); }}><Icon name="plus" size={14} /> {t('ac2.rates.addGst')}</button>}</div>
        <div className="table-wrap card p12-table"><table className="table">
          <thead><tr><th scope="col">{t('common.code')}</th><th scope="col">{t('common.name')}</th><th scope="col" className="num">{t('ac2.rates.rate')}</th><th scope="col">{t('ac2.rates.itc')}</th><th scope="col">{t('ac2.rates.period')}</th><th scope="col"><span className="sr-only">{t('common.actions')}</span></th></tr></thead>
          <tbody>{s.taxCodes.map((x) => <tr key={x.id} className={x.effectiveTo && x.effectiveTo < todayIST() ? 'row-dim' : undefined}><td className="code">{x.code}</td><td>{x.name}</td><td className="num">{Number(x.ratePercent)}%</td><td>{x.itcClaimable ? t('ac2.bill.claimable') : t('ac2.bill.inCost')}</td><td>{d(x.effectiveFrom)} – {x.effectiveTo ? d(x.effectiveTo) : t('ac2.rates.now')}</td><td>{canEdit && <button type="button" className="btn btn-sm btn-ghost" aria-label={t('ac2.chart.editOf', { name: x.name })} onClick={() => { setForm({ ...x, effectiveTo: x.effectiveTo ?? '' }); setErrors({}); setError(null); setTaxEdit(x); }}><Icon name="edit" size={14} /></button>}</td></tr>)}</tbody>
        </table></div>
        <p className="muted small">{t('ac2.rates.itcHint')}</p>
      </section>
      <section aria-labelledby="rt-tds">
        <div className="panel-head"><h2 id="rt-tds" className="section-title">{t('ac2.rates.tds')}</h2>{canEdit && <button type="button" className="btn btn-sm" onClick={() => { setForm({ sectionCode: '', description: '', rateIndividual: '', rateOthers: '', rateNoPan: '20', thresholdSingle: '', thresholdAnnual: '', effectiveFrom: todayIST(), effectiveTo: '' }); setErrors({}); setError(null); setTdsEdit('new'); }}><Icon name="plus" size={14} /> {t('ac2.rates.addTds')}</button>}</div>
        <div className="table-wrap card p12-table"><table className="table">
          <thead><tr><th scope="col">{t('ac2.rates.section')}</th><th scope="col">{t('ac2.rates.for')}</th><th scope="col" className="num">{t('ac2.rates.indiv')}</th><th scope="col" className="num">{t('ac2.rates.others')}</th><th scope="col" className="num">{t('ac2.rates.noPan')}</th><th scope="col">{t('ac2.rates.limits')}</th><th scope="col"><span className="sr-only">{t('common.actions')}</span></th></tr></thead>
          <tbody>{s.tdsSections.map((x) => <tr key={x.id} className={x.effectiveTo && x.effectiveTo < todayIST() ? 'row-dim' : undefined}><td className="code">{x.sectionCode}</td><td>{x.description}<span className="sub-line muted small">{t('ac2.rates.from', { d: d(x.effectiveFrom) })}</span></td><td className="num">{Number(x.rateIndividual)}%</td><td className="num">{Number(x.rateOthers)}%</td><td className="num">{Number(x.rateNoPan)}%</td><td className="small">{[x.thresholdSingle && t('ac2.rates.single', { amt: rupees(x.thresholdSingle) }), x.thresholdAnnual && t('ac2.rates.annual', { amt: rupees(x.thresholdAnnual) })].filter(Boolean).join(' · ') || t('ac2.rates.always')}</td><td>{canEdit && <button type="button" className="btn btn-sm btn-ghost" aria-label={t('ac2.chart.editOf', { name: x.sectionCode })} onClick={() => { setForm({ ...x, thresholdSingle: x.thresholdSingle ?? '', thresholdAnnual: x.thresholdAnnual ?? '', effectiveTo: x.effectiveTo ?? '' }); setErrors({}); setError(null); setTdsEdit(x); }}><Icon name="edit" size={14} /></button>}</td></tr>)}</tbody>
        </table></div>
        <p className="muted small">{t('ac2.rates.tdsHint')}</p>
      </section>
      <Modal open={!!taxEdit} onClose={() => setTaxEdit(null)} title={taxEdit === 'new' ? t('ac2.rates.addGst') : t('ac2.rates.editGst')} onSubmit={saveTax} submitLabel={t('common.save')} busy={busy} error={error}>
        <div className="grid-2"><Field id="tx-code" label={t('common.code')} error={errors.code}><input id="tx-code" {...f('code')} /></Field><Field id="tx-name" label={t('common.name')} error={errors.name}><input id="tx-name" {...f('name')} /></Field></div>
        <div className="grid-3"><Field id="tx-rate" label={t('ac2.rates.rate')} error={errors.ratePercent}><input id="tx-rate" inputMode="decimal" {...f('ratePercent')} /></Field><Field id="tx-from" label={t('ac2.rates.fromLabel')} error={errors.effectiveFrom}><input id="tx-from" type="date" {...f('effectiveFrom')} /></Field><Field id="tx-to" label={t('ac2.rates.toLabel')} error={errors.effectiveTo}><input id="tx-to" type="date" {...f('effectiveTo')} /></Field></div>
        <label className="check"><input type="checkbox" checked={!!form.itcClaimable} onChange={(e) => setForm((x) => ({ ...x, itcClaimable: e.target.checked }))} /> {t('ac2.rates.itcCheck')}</label>
      </Modal>
      <Modal open={!!tdsEdit} onClose={() => setTdsEdit(null)} title={tdsEdit === 'new' ? t('ac2.rates.addTds') : t('ac2.rates.editTds')} onSubmit={saveTds} submitLabel={t('common.save')} busy={busy} error={error} wide>
        <div className="grid-2"><Field id="td-code" label={t('ac2.rates.section')} error={errors.sectionCode}><input id="td-code" {...f('sectionCode')} /></Field><Field id="td-desc" label={t('ac2.rates.for')} error={errors.description}><input id="td-desc" {...f('description')} /></Field></div>
        <div className="grid-3"><Field id="td-ind" label={t('ac2.rates.indiv')} error={errors.rateIndividual}><input id="td-ind" inputMode="decimal" {...f('rateIndividual')} /></Field><Field id="td-oth" label={t('ac2.rates.others')} error={errors.rateOthers}><input id="td-oth" inputMode="decimal" {...f('rateOthers')} /></Field><Field id="td-np" label={t('ac2.rates.noPan')} error={errors.rateNoPan}><input id="td-np" inputMode="decimal" {...f('rateNoPan')} /></Field></div>
        <div className="grid-2"><Field id="td-s" label={t('ac2.rates.singleLabel')} hint={t('ac2.rates.limitHint')} error={errors.thresholdSingle}><input id="td-s" inputMode="decimal" {...f('thresholdSingle')} /></Field><Field id="td-a" label={t('ac2.rates.annualLabel')} hint={t('ac2.rates.limitHint')} error={errors.thresholdAnnual}><input id="td-a" inputMode="decimal" {...f('thresholdAnnual')} /></Field></div>
        <div className="grid-2"><Field id="td-from" label={t('ac2.rates.fromLabel')} error={errors.effectiveFrom}><input id="td-from" type="date" {...f('effectiveFrom')} /></Field><Field id="td-to" label={t('ac2.rates.toLabel')} error={errors.effectiveTo}><input id="td-to" type="date" {...f('effectiveTo')} /></Field></div>
      </Modal>
    </>
  );
}

function Opening({ chart, canEdit }: { chart: ChartAccount[]; canEdit: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const [asOn, setAsOn] = useState(fyStart());
  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setError(null);
    try { const r = await api<{ entryNo: string }>('/accounts/opening-balances', { method: 'POST', body: JSON.stringify({ asOn, lines: lineBody(lines) }) }); toast(t('ac2.ob.saved', { no: r.entryNo })); setLines([emptyLine(), emptyLine()]); }
    catch (x) { setError(apiErrors(x).message ?? t('en.failed')); } finally { setBusy(false); }
  };
  if (!canEdit) return <EmptyState icon="lock" title={t('ac2.ob.noRight')} />;
  return (
    <section className="card p12-block">
      <h2 className="section-title">{t('ac2.ob.title')}</h2>
      <p className="muted small">{t('ac2.ob.hint')}</p>
      <label className="p12-inline">{t('ac2.ob.asOn')} <input type="date" value={asOn} onChange={(e) => setAsOn(e.target.value || fyStart())} /></label>
      <LinesEditor chart={chart} lines={lines} setLines={setLines} types={['ASSET', 'LIABILITY', 'EQUITY']} />
      {error && <p className="field-error" role="alert">{error}</p>}
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}><Icon name="check" /> {t('ac2.ob.save')}</button>
    </section>
  );
}

function PeriodsTab({ canClose }: { canClose: boolean }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [p, setP] = useState<Periods | null>(null);
  const [month, setMonth] = useState(todayIST().slice(0, 7));
  const [unlock, setUnlock] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [closeYear, setCloseYear] = useState<Periods['years'][number] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { api<Periods>('/accounts/periods').then(setP).catch(() => setP(null)); }, []);
  useEffect(load, [load]);
  const call = async (path: string, body: unknown, done: string) => {
    setBusy(true); setError(null);
    try { const r = await api<Record<string, string>>(path, { method: 'POST', body: JSON.stringify(body) }); toast(done.replace('{x}', r.surplus ?? '')); load(); return true; }
    catch (x) { const m = apiErrors(x).message ?? t('en.failed'); setError(m); toast(m); return false; } finally { setBusy(false); }
  };
  const mLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  if (!p) return <SkeletonRows rows={4} />;
  return (
    <>
      <section className="card p12-block">
        <h2 className="section-title">{t('ac2.per.lockTitle')}</h2>
        <p className="muted small">{t('ac2.per.lockHint')}</p>
        {canClose && <div className="row-actions"><label className="p12-inline">{t('ac2.per.month')} <input type="month" value={month} max={todayIST().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} /></label><button type="button" className="btn btn-primary" disabled={busy || !month} onClick={() => void call('/accounts/periods/lock', { month }, t('ac2.per.locked'))}><Icon name="lock" /> {t('ac2.per.lock')}</button></div>}
        {!p.locks.length ? <p className="muted">{t('ac2.per.none')}</p> : (
          <ul className="p12-action-list">{p.locks.map((l) => (
            <li key={l.month}>
              <span><strong>{mLabel(l.month)}</strong><span className="sub-line muted small">{l.status === 'UNLOCKING' ? t('ac2.per.unlockAsked', { name: l.unlockRequestedBy ?? '', r: l.unlockReason ?? '' }) : l.status === 'UNLOCKED' ? t('ac2.per.unlockedFor', { r: l.unlockReason ?? '' }) : t('ac2.per.lockedBy', { name: l.lockedBy })}</span></span>
              <span className="row-actions"><AccPill status={l.status} />{canClose && l.status === 'LOCKED' && <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setReason(''); setError(null); setUnlock(l.month); }}>{t('ac2.per.unlock')}</button>}{canClose && l.status === 'UNLOCKED' && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void call('/accounts/periods/lock', { month: l.month }, t('ac2.per.locked'))}>{t('ac2.per.relock')}</button>}</span>
            </li>
          ))}</ul>
        )}
      </section>
      <section className="card p12-block">
        <h2 className="section-title">{t('ac2.per.yearsTitle')}</h2>
        <p className="muted small">{t('ac2.per.yearsHint')}</p>
        <ul className="p12-action-list">{p.years.map((y) => (
          <li key={y.id}><span><strong>{y.name}</strong></span><span className="row-actions">{y.isClosed ? <span className="pill pill-muted"><Icon name="lock" size={12} /> {t('ac2.per.closed')}</span> : canClose && <button type="button" className="btn btn-sm" onClick={() => { setError(null); setCloseYear(y); }}>{t('ac2.per.close')}</button>}</span></li>
        ))}</ul>
      </section>
      <Modal open={!!unlock} onClose={() => setUnlock(null)} title={t('ac2.per.unlockTitle', { m: unlock ? mLabel(unlock) : '' })} subtitle={t('ac2.per.unlockSub')} onSubmit={(e) => { e.preventDefault(); void call('/accounts/periods/unlock', { month: unlock, reason }, t('ac2.per.unlockDone')).then((ok) => ok && setUnlock(null)); }} submitLabel={t('ac2.per.unlock')} busy={busy} error={error} submitDisabled={reason.trim().length < 5}>
        <Field id="pl-reason" label={t('ac2.reason')} hint={t('ac2.reasonHint')}><input id="pl-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>
      <Modal open={!!closeYear} onClose={() => setCloseYear(null)} title={t('ac2.per.closeTitle', { y: closeYear?.name ?? '' })} subtitle={t('ac2.per.closeSub')} onSubmit={(e) => { e.preventDefault(); void call('/accounts/years/close', { financialYearId: closeYear!.id }, t('ac2.per.closedToast')).then((ok) => ok && setCloseYear(null)); }} submitLabel={t('ac2.per.close')} busy={busy} error={error} danger>
        <p>{t('ac2.per.closeExplain')}</p>
      </Modal>
    </>
  );
}
