'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { PERMISSIONS, RULE_TYPES } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { rupees } from '@/components/accounts';

interface Comp { id: string; code: string; name: string; componentType: string; calcType: string; statutoryKind: string | null; formula: string | null; isTaxable: boolean; affectedByLop: boolean; isPfWage: boolean; sortOrder: number; accountId: string | null; account: string | null; liabilityAccount: string | null; isSystem: boolean; isActive: boolean }
interface Struct { id: string; name: string; designationId: string | null; designation: string | null; isActive: boolean; staff: number; items: { componentId: string; code: string; name: string; componentType: string; calcType: string; value: number | null }[] }
interface Rule { id: string; ruleType: string; stateCode: string | null; slabFrom: string | null; slabTo: string | null; employeeRate: number | null; employerRate: number | null; fixedAmount: string | null; wageCeiling: string | null; onlyMonth: number | null; effectiveFrom: string; effectiveTo: string | null; notes: string | null; inForce: boolean }
type Tab = 'components' | 'structures' | 'rules';
const VALUED = ['FIXED', 'PERCENT_OF_BASIC', 'PERCENT_OF_GROSS'];

/** Payroll → Set-up (M15.1, M15.2): components, salary structures and statutory rules. */
export default function PayrollSetupPage() {
  const { can } = useSession();
  const { t, locale } = useI18n();
  const toast = useToast();
  const manage = can(PERMISSIONS.PAYROLL_SETUP);
  const [tab, setTab] = useState<Tab>('structures');
  const [comps, setComps] = useState<Comp[] | null>(null);
  const [structs, setStructs] = useState<Struct[] | null>(null);
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [accounts, setAccounts] = useState<{ id: string; code: string; name: string; accountType: string; isGroup: boolean }[]>([]);
  const [desigs, setDesigs] = useState<{ id: string; name: string }[]>([]);
  const [cEdit, setCEdit] = useState<Comp | 'new' | null>(null);
  const [cf, setCf] = useState({ code: '', name: '', componentType: 'EARNING', calcType: 'FIXED', formula: '', isTaxable: true, affectedByLop: true, isPfWage: false, accountId: '', sortOrder: '50', isActive: true });
  const [sEdit, setSEdit] = useState<Struct | 'new' | null>(null);
  const [sf, setSf] = useState({ name: '', designationId: '', isActive: true });
  const [sItems, setSItems] = useState<Record<string, { on: boolean; value: string }>>({});
  const [rEdit, setREdit] = useState<Rule | 'new' | null>(null);
  const [rf, setRf] = useState({ ruleType: 'PT', slabFrom: '', slabTo: '', employeeRate: '', employerRate: '', fixedAmount: '', wageCeiling: '', onlyMonth: '', effectiveFrom: '', effectiveTo: '', notes: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api<Comp[]>('/payroll/components').then(setComps).catch(() => setComps([]));
    api<Struct[]>('/payroll/structures').then(setStructs).catch(() => setStructs([]));
    api<Rule[]>('/payroll/statutory-rules').then(setRules).catch(() => setRules([]));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    if (!manage) return;
    api<typeof accounts>('/payroll/accounts').then((a) => setAccounts(a.filter((x) => !x.isGroup))).catch(() => setAccounts([]));
    api<{ id: string; name: string }[]>('/hr/designations').then(setDesigs).catch(() => setDesigs([]));
  }, [manage]);
  const submit = async (path: string, method: string, body: unknown, done: string, close: () => void) => {
    setBusy(true); setErrors({}); setError(null);
    try { await api(path, { method, body: JSON.stringify(body) }); toast(done); close(); load(); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const how = (c: { calcType: string; statutoryKind: string | null; formula: string | null }) => (c.calcType === 'STATUTORY' ? t(`pay.kind.${c.statutoryKind}` as MessageKey) : c.calcType === 'FORMULA' ? `= ${c.formula}` : t(`pay.calc.${c.calcType}` as MessageKey));
  const val = (i: { calcType: string; value: number | null }) => (i.value == null ? '' : i.calcType === 'FIXED' ? rupees(i.value) : `${i.value}%`);
  const d = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const ruleValue = (r: Rule) => {
    const parts: string[] = [];
    if (r.slabFrom != null) parts.push(r.slabTo ? `${rupees(r.slabFrom)} – ${rupees(r.slabTo)}` : t('pay.rule.andAbove', { amt: rupees(r.slabFrom) }));
    if (r.employeeRate != null) parts.push(r.ruleType === 'PF' || r.ruleType === 'ESI' ? t('pay.rule.ee', { r: r.employeeRate }) : `${r.employeeRate}%`);
    if (r.employerRate != null) parts.push(t('pay.rule.er', { r: r.employerRate }));
    if (r.fixedAmount != null) parts.push(rupees(r.fixedAmount));
    if (r.wageCeiling != null) parts.push(t(r.ruleType === 'TDS_REBATE' ? 'pay.rule.upto' : 'pay.rule.ceiling', { amt: rupees(r.wageCeiling) }));
    if (r.onlyMonth) parts.push(t('pay.rule.onlyMonth', { m: new Date(Date.UTC(2000, r.onlyMonth - 1, 1)).toLocaleDateString(locale, { month: 'long', timeZone: 'UTC' }) }));
    return parts.join(' · ');
  };
  const openComp = (c: Comp | 'new') => {
    setCf(c === 'new' ? { code: '', name: '', componentType: 'EARNING', calcType: 'FIXED', formula: '', isTaxable: true, affectedByLop: true, isPfWage: false, accountId: '', sortOrder: '50', isActive: true }
      : { code: c.code, name: c.name, componentType: c.componentType, calcType: c.calcType, formula: c.formula ?? '', isTaxable: c.isTaxable, affectedByLop: c.affectedByLop, isPfWage: c.isPfWage, accountId: c.accountId ?? '', sortOrder: String(c.sortOrder), isActive: c.isActive });
    setErrors({}); setError(null); setCEdit(c);
  };
  const openStruct = (s: Struct | 'new') => {
    setSf(s === 'new' ? { name: '', designationId: '', isActive: true } : { name: s.name, designationId: s.designationId ?? '', isActive: s.isActive });
    const on: Record<string, { on: boolean; value: string }> = {};
    for (const c of comps ?? []) if (c.statutoryKind !== 'LOAN' && c.isActive) { const it = s === 'new' ? null : s.items.find((i) => i.componentId === c.id); on[c.id] = { on: s === 'new' ? c.isSystem : !!it, value: it?.value != null ? String(it.value) : '' }; }
    setSItems(on); setErrors({}); setError(null); setSEdit(s);
  };
  const openRule = (r: Rule | 'new') => {
    setRf(r === 'new' ? { ruleType: 'PT', slabFrom: '', slabTo: '', employeeRate: '', employerRate: '', fixedAmount: '', wageCeiling: '', onlyMonth: '', effectiveFrom: '', effectiveTo: '', notes: '' }
      : { ruleType: r.ruleType, slabFrom: r.slabFrom ?? '', slabTo: r.slabTo ?? '', employeeRate: r.employeeRate == null ? '' : String(r.employeeRate), employerRate: r.employerRate == null ? '' : String(r.employerRate), fixedAmount: r.fixedAmount ?? '', wageCeiling: r.wageCeiling ?? '', onlyMonth: r.onlyMonth ? String(r.onlyMonth) : '', effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo ?? '', notes: r.notes ?? '' });
    setErrors({}); setError(null); setREdit(r);
  };
  const nul = (s: string) => (s === '' ? null : s);
  const sys = cEdit !== 'new' && cEdit?.isSystem;
  const acctChoices = accounts.filter((a) => (cf.componentType === 'EARNING' ? a.accountType === 'EXPENSE' : ['LIABILITY', 'ASSET', 'INCOME'].includes(a.accountType)));
  return (
    <>
      <PageHeader eyebrow={t('nav.payroll')} title={t('pay.set.title')} description={t('pay.set.desc')} />
      <div className="tabs" role="tablist" aria-label={t('pay.set.title')}>
        {(['structures', 'components', 'rules'] as Tab[]).map((x) => <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(`pay.set.tab.${x}` as MessageKey)}</button>)}
      </div>

      {tab === 'structures' && (!structs || !comps ? <SkeletonRows rows={3} /> : (
        <>
          {manage && <div className="section-head"><span className="muted small">{t('pay.str.hint')}</span><button type="button" className="btn btn-sm btn-primary" onClick={() => openStruct('new')}><Icon name="plus" /> {t('pay.str.add')}</button></div>}
          {!structs.length ? <EmptyState icon="layers" title={t('pay.str.none')} /> : (
            <div className="pay-structs">{structs.map((s) => (
              <section key={s.id} className="card p12-block" aria-labelledby={`st-${s.id}`}>
                <div className="section-head"><h2 id={`st-${s.id}`} className="section-title">{s.name} {!s.isActive && <span className="pill pill-muted">{t('pay.inactive')}</span>}</h2>{manage && <button type="button" className="btn btn-sm" onClick={() => openStruct(s)} aria-label={t('pay.editNamed', { name: s.name })}><Icon name="edit" size={16} /> {t('pay.edit')}</button>}</div>
                <p className="muted small">{t('pay.str.staff', { n: s.staff })}{s.designation ? ` · ${s.designation}` : ''}</p>
                <dl className="pay-lines">{s.items.map((i) => <div key={i.componentId}><dt>{i.name} <span className="muted small">· {how({ calcType: i.calcType, statutoryKind: comps.find((c) => c.id === i.componentId)?.statutoryKind ?? null, formula: comps.find((c) => c.id === i.componentId)?.formula ?? null })}</span></dt><dd className="num">{val(i)}</dd></div>)}</dl>
              </section>
            ))}</div>
          )}
        </>
      ))}

      {tab === 'components' && (!comps ? <SkeletonRows rows={5} /> : (
        <>
          {manage && <div className="section-head"><span className="muted small">{t('pay.comp.hint')}</span><button type="button" className="btn btn-sm btn-primary" onClick={() => openComp('new')}><Icon name="plus" /> {t('pay.comp.add')}</button></div>}
          <div className="table-wrap card" role="region" aria-label={t('pay.set.tab.components')} tabIndex={0}>
            <table className="table">
              <thead><tr><th scope="col">{t('pay.comp.code')}</th><th scope="col">{t('pay.comp.name')}</th><th scope="col">{t('pay.comp.type')}</th><th scope="col">{t('pay.comp.how')}</th><th scope="col">{t('pay.comp.account')}</th><th scope="col">{t('pay.comp.flags')}</th>{manage && <th scope="col"><span className="sr-only">{t('pay.edit')}</span></th>}</tr></thead>
              <tbody>{comps.map((c) => (
                <tr key={c.id} className={c.isActive ? undefined : 'muted'}>
                  <td className="mono">{c.code}</td>
                  <td>{c.name}{c.isSystem && <span className="sub-line muted small">{t('pay.comp.builtIn')}</span>}</td>
                  <td>{t(`pay.ctype.${c.componentType}` as MessageKey)}</td>
                  <td className="small">{how(c)}</td>
                  <td className="small">{c.account ?? '—'}{c.liabilityAccount && <span className="sub-line muted">→ {c.liabilityAccount}</span>}</td>
                  <td className="small">{[c.componentType === 'EARNING' && c.isTaxable && t('pay.comp.taxable'), c.componentType === 'EARNING' && c.affectedByLop && t('pay.comp.lop'), c.isPfWage && t('pay.comp.pfWage'), !c.isActive && t('pay.inactive')].filter(Boolean).join(' · ') || '—'}</td>
                  {manage && <td><button type="button" className="btn btn-sm btn-ghost" onClick={() => openComp(c)} aria-label={t('pay.editNamed', { name: c.name })}><Icon name="edit" size={16} /></button></td>}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      ))}

      {tab === 'rules' && (!rules ? <SkeletonRows rows={5} /> : (
        <>
          <div className="notice notice-warn" role="note"><Icon name="alert" size={16} /> <span>{t('pay.rule.check')}</span></div>
          {manage && <div className="section-head"><span className="muted small">{t('pay.rule.hint')}</span><button type="button" className="btn btn-sm btn-primary" onClick={() => openRule('new')}><Icon name="plus" /> {t('pay.rule.add')}</button></div>}
          {RULE_TYPES.map((rt) => {
            const of = rules.filter((r) => r.ruleType === rt);
            if (!of.length) return null;
            return (
              <section key={rt} className="card p12-block" aria-labelledby={`ru-${rt}`}>
                <h2 id={`ru-${rt}`} className="section-title">{t(`pay.rt.${rt}` as MessageKey)}</h2>
                <ul className="p12-action-list">{of.map((r) => (
                  <li key={r.id}>
                    <span><strong>{ruleValue(r)}</strong><span className="sub-line muted small">{t('pay.rule.from', { d: d(r.effectiveFrom) })}{r.effectiveTo ? ` – ${d(r.effectiveTo)}` : ''}{r.notes ? ` · ${r.notes}` : ''}</span></span>
                    <span className="row-actions">{r.inForce ? <span className="pill pill-ok"><span className="pill-dot" />{t('pay.rule.inForce')}</span> : <span className="pill pill-muted">{t('pay.rule.notInForce')}</span>}{manage && <button type="button" className="btn btn-sm btn-ghost" onClick={() => openRule(r)} aria-label={t('pay.editNamed', { name: `${t(`pay.rt.${rt}` as MessageKey)} ${ruleValue(r)}` })}><Icon name="edit" size={16} /></button>}</span>
                  </li>
                ))}</ul>
              </section>
            );
          })}
        </>
      ))}

      <Modal open={!!cEdit} onClose={() => setCEdit(null)} title={cEdit === 'new' ? t('pay.comp.add') : t('pay.comp.edit')} subtitle={sys ? t('pay.comp.sysSub') : t('pay.comp.sub')} busy={busy} error={error} submitLabel={t('pay.save')}
        onSubmit={(e: FormEvent) => { e.preventDefault(); const body = { ...cf, formula: nul(cf.formula), accountId: nul(cf.accountId), sortOrder: Number(cf.sortOrder || 0), statutoryKind: cEdit !== 'new' && cEdit ? cEdit.statutoryKind : null }; void submit(cEdit === 'new' ? '/payroll/components' : `/payroll/components/${(cEdit as Comp).id}`, cEdit === 'new' ? 'POST' : 'PUT', body, t('pay.saved'), () => setCEdit(null)); }}>
        <div className="grid-2">
          <Field id="cp-code" label={t('pay.comp.code')} hint={t('pay.comp.codeHint')} error={errors.code}><input id="cp-code" value={cf.code} disabled={!!sys} onChange={(e) => setCf((f) => ({ ...f, code: e.target.value.toUpperCase() }))} /></Field>
          <Field id="cp-name" label={t('pay.comp.name')} error={errors.name}><input id="cp-name" value={cf.name} onChange={(e) => setCf((f) => ({ ...f, name: e.target.value }))} /></Field>
        </div>
        <div className="grid-2">
          <Field id="cp-type" label={t('pay.comp.type')}><select id="cp-type" value={cf.componentType} disabled={!!sys} onChange={(e) => setCf((f) => ({ ...f, componentType: e.target.value, calcType: e.target.value === 'DEDUCTION' && f.calcType === 'BALANCE' ? 'FIXED' : f.calcType, accountId: '' }))}>{(sys ? ['EARNING', 'DEDUCTION', 'EMPLOYER'] : ['EARNING', 'DEDUCTION']).map((x) => <option key={x} value={x}>{t(`pay.ctype.${x}` as MessageKey)}</option>)}</select></Field>
          <Field id="cp-calc" label={t('pay.comp.how')} error={errors.calcType}><select id="cp-calc" value={cf.calcType} disabled={!!sys} onChange={(e) => setCf((f) => ({ ...f, calcType: e.target.value }))}>{(sys && cf.calcType === 'STATUTORY' ? ['STATUTORY'] : ['FIXED', 'PERCENT_OF_BASIC', 'PERCENT_OF_GROSS', ...(cf.componentType === 'EARNING' ? ['BALANCE'] : []), 'FORMULA']).map((x) => <option key={x} value={x}>{x === 'STATUTORY' ? t('pay.calc.STATUTORY') : t(`pay.calc.${x}` as MessageKey)}</option>)}</select></Field>
        </div>
        {cf.calcType === 'FORMULA' && <Field id="cp-formula" label={t('pay.comp.formula')} hint={t('pay.comp.formulaHint')} error={errors.formula}><input id="cp-formula" className="mono" value={cf.formula} onChange={(e) => setCf((f) => ({ ...f, formula: e.target.value }))} /></Field>}
        <div className="grid-2">
          <Field id="cp-acct" label={t('pay.comp.account')} hint={cf.componentType === 'EARNING' ? t('pay.comp.accountHintE') : t('pay.comp.accountHintD')} error={errors.accountId}>
            <select id="cp-acct" value={cf.accountId} onChange={(e) => setCf((f) => ({ ...f, accountId: e.target.value }))}><option value="">{cf.componentType === 'EARNING' ? t('pay.comp.defaultSalary') : t('pay.comp.choose')}</option>{acctChoices.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select>
          </Field>
          <Field id="cp-order" label={t('pay.comp.order')} hint={t('pay.comp.orderHint')}><input id="cp-order" inputMode="numeric" value={cf.sortOrder} onChange={(e) => setCf((f) => ({ ...f, sortOrder: e.target.value }))} /></Field>
        </div>
        <fieldset className="check-group"><legend>{t('pay.comp.flags')}</legend>
          {cf.componentType === 'EARNING' && <label className="check"><input type="checkbox" checked={cf.isTaxable} onChange={(e) => setCf((f) => ({ ...f, isTaxable: e.target.checked }))} /> {t('pay.comp.taxableLong')}</label>}
          {cf.componentType === 'EARNING' && <label className="check"><input type="checkbox" checked={cf.affectedByLop} onChange={(e) => setCf((f) => ({ ...f, affectedByLop: e.target.checked }))} /> {t('pay.comp.lopLong')}</label>}
          {cf.componentType === 'EARNING' && <label className="check"><input type="checkbox" checked={cf.isPfWage} onChange={(e) => setCf((f) => ({ ...f, isPfWage: e.target.checked }))} /> {t('pay.comp.pfWageLong')}</label>}
          <label className="check"><input type="checkbox" checked={cf.isActive} onChange={(e) => setCf((f) => ({ ...f, isActive: e.target.checked }))} /> {t('pay.active')}</label>
        </fieldset>
      </Modal>

      <Modal open={!!sEdit} onClose={() => setSEdit(null)} title={sEdit === 'new' ? t('pay.str.add') : t('pay.str.edit')} subtitle={t('pay.str.sub')} busy={busy} error={error} submitLabel={t('pay.save')} wide
        onSubmit={(e: FormEvent) => { e.preventDefault(); const items = (comps ?? []).filter((c) => sItems[c.id]?.on).map((c) => ({ componentId: c.id, value: VALUED.includes(c.calcType) ? (sItems[c.id].value === '' ? null : Number(sItems[c.id].value)) : null })); void submit(sEdit === 'new' ? '/payroll/structures' : `/payroll/structures/${(sEdit as Struct).id}`, sEdit === 'new' ? 'POST' : 'PUT', { ...sf, designationId: nul(sf.designationId), items }, t('pay.saved'), () => setSEdit(null)); }}>
        <div className="grid-2">
          <Field id="sx-name" label={t('pay.str.name')} error={errors.name}><input id="sx-name" value={sf.name} onChange={(e) => setSf((f) => ({ ...f, name: e.target.value }))} /></Field>
          <Field id="sx-desig" label={t('pay.str.designation')} hint={t('pay.str.designationHint')}><select id="sx-desig" value={sf.designationId} onChange={(e) => setSf((f) => ({ ...f, designationId: e.target.value }))}><option value="">{t('pay.str.anyDesignation')}</option>{desigs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        </div>
        <fieldset className="check-group pay-struct-items"><legend>{t('pay.str.components')}</legend>
          {errors.items && <span className="field-error">{errors.items}</span>}
          {(comps ?? []).filter((c) => sItems[c.id]).map((c) => (
            <div key={c.id} className="pay-struct-row">
              <label className="check"><input type="checkbox" checked={sItems[c.id].on} onChange={(e) => setSItems((s) => ({ ...s, [c.id]: { ...s[c.id], on: e.target.checked } }))} /> {c.name} <span className="muted small">· {how(c)}</span></label>
              {VALUED.includes(c.calcType) && sItems[c.id].on && <span className="pay-struct-val"><label className="sr-only" htmlFor={`sv-${c.id}`}>{t('pay.str.valueFor', { name: c.name })}</label><input id={`sv-${c.id}`} inputMode="decimal" value={sItems[c.id].value} onChange={(e) => setSItems((s) => ({ ...s, [c.id]: { ...s[c.id], value: e.target.value } }))} /><span className="muted small">{c.calcType === 'FIXED' ? '₹' : '%'}</span></span>}
            </div>
          ))}
        </fieldset>
        <label className="check"><input type="checkbox" checked={sf.isActive} onChange={(e) => setSf((f) => ({ ...f, isActive: e.target.checked }))} /> {t('pay.active')}</label>
      </Modal>

      <Modal open={!!rEdit} onClose={() => setREdit(null)} title={rEdit === 'new' ? t('pay.rule.add') : t('pay.rule.edit')} subtitle={t('pay.rule.sub')} busy={busy} error={error} submitLabel={t('pay.save')}
        onSubmit={(e: FormEvent) => { e.preventDefault(); const body = { ruleType: rf.ruleType, slabFrom: nul(rf.slabFrom), slabTo: nul(rf.slabTo), employeeRate: nul(rf.employeeRate), employerRate: nul(rf.employerRate), fixedAmount: nul(rf.fixedAmount), wageCeiling: nul(rf.wageCeiling), onlyMonth: nul(rf.onlyMonth), effectiveFrom: rf.effectiveFrom, effectiveTo: nul(rf.effectiveTo), notes: nul(rf.notes), stateCode: rf.ruleType === 'PT' ? '29' : null }; void submit(rEdit === 'new' ? '/payroll/statutory-rules' : `/payroll/statutory-rules/${(rEdit as Rule).id}`, rEdit === 'new' ? 'POST' : 'PUT', body, t('pay.saved'), () => setREdit(null)); }}>
        <Field id="ru-type" label={t('pay.rule.type')}><select id="ru-type" value={rf.ruleType} disabled={rEdit !== 'new'} onChange={(e) => setRf((f) => ({ ...f, ruleType: e.target.value }))}>{RULE_TYPES.map((x) => <option key={x} value={x}>{t(`pay.rt.${x}` as MessageKey)}</option>)}</select></Field>
        <div className="grid-2">
          {['PT', 'TDS'].includes(rf.ruleType) && <Field id="ru-from" label={t('pay.rule.slabFrom')} error={errors.slabFrom}><input id="ru-from" inputMode="decimal" value={rf.slabFrom} onChange={(e) => setRf((f) => ({ ...f, slabFrom: e.target.value }))} /></Field>}
          {['PT', 'TDS'].includes(rf.ruleType) && <Field id="ru-to" label={t('pay.rule.slabTo')} hint={t('pay.rule.blankNoLimit')} error={errors.slabTo}><input id="ru-to" inputMode="decimal" value={rf.slabTo} onChange={(e) => setRf((f) => ({ ...f, slabTo: e.target.value }))} /></Field>}
          {['PF', 'ESI', 'TDS', 'TDS_CESS'].includes(rf.ruleType) && <Field id="ru-ee" label={rf.ruleType === 'TDS' || rf.ruleType === 'TDS_CESS' ? t('pay.rule.rate') : t('pay.rule.eeRate')} error={errors.employeeRate}><input id="ru-ee" inputMode="decimal" value={rf.employeeRate} onChange={(e) => setRf((f) => ({ ...f, employeeRate: e.target.value }))} /></Field>}
          {['PF', 'ESI'].includes(rf.ruleType) && <Field id="ru-er" label={t('pay.rule.erRate')} error={errors.employerRate}><input id="ru-er" inputMode="decimal" value={rf.employerRate} onChange={(e) => setRf((f) => ({ ...f, employerRate: e.target.value }))} /></Field>}
          {['PT', 'TDS_STD_DEDUCTION'].includes(rf.ruleType) && <Field id="ru-amt" label={t('pay.amount')} error={errors.fixedAmount}><input id="ru-amt" inputMode="decimal" value={rf.fixedAmount} onChange={(e) => setRf((f) => ({ ...f, fixedAmount: e.target.value }))} /></Field>}
          {['PF', 'ESI', 'TDS_REBATE'].includes(rf.ruleType) && <Field id="ru-ceil" label={rf.ruleType === 'TDS_REBATE' ? t('pay.rule.rebateLimit') : t('pay.rule.wageCeiling')} error={errors.wageCeiling}><input id="ru-ceil" inputMode="decimal" value={rf.wageCeiling} onChange={(e) => setRf((f) => ({ ...f, wageCeiling: e.target.value }))} /></Field>}
          {rf.ruleType === 'PT' && <Field id="ru-month" label={t('pay.rule.onlyMonthLabel')} hint={t('pay.rule.onlyMonthHint')}><select id="ru-month" value={rf.onlyMonth} onChange={(e) => setRf((f) => ({ ...f, onlyMonth: e.target.value }))}><option value="">{t('pay.rule.everyMonth')}</option>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{new Date(Date.UTC(2000, i, 1)).toLocaleDateString(locale, { month: 'long', timeZone: 'UTC' })}</option>)}</select></Field>}
        </div>
        <div className="grid-2">
          <Field id="ru-eff" label={t('pay.rule.effFrom')} error={errors.effectiveFrom}><input id="ru-eff" type="date" value={rf.effectiveFrom} onChange={(e) => setRf((f) => ({ ...f, effectiveFrom: e.target.value }))} /></Field>
          <Field id="ru-end" label={t('pay.rule.effTo')} hint={t('pay.rule.blankOpen')} error={errors.effectiveTo}><input id="ru-end" type="date" value={rf.effectiveTo} onChange={(e) => setRf((f) => ({ ...f, effectiveTo: e.target.value }))} /></Field>
        </div>
        <Field id="ru-notes" label={t('ac2.notes')}><input id="ru-notes" value={rf.notes} onChange={(e) => setRf((f) => ({ ...f, notes: e.target.value }))} /></Field>
      </Modal>
    </>
  );
}
