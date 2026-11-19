'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { PERMISSIONS, VENDOR_TYPES } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { rupees } from '@/components/accounts';

interface Vendor { id: string; vendorCode: string; name: string; vendorType: string; gstin: string | null; pan: string | null; stateCode: string; phone: string | null; email: string | null; bankName: string | null; bankAccount: string | null; ifsc: string | null; tdsSectionId: string | null; tdsSection: string | null; status: string; due: string; advance: string }
interface Tds { id: string; sectionCode: string; description: string }
interface Age { vendorId: string; vendor: string; notDue: string; d30: string; d60: string; d90: string; over90: string; total: string }
interface Ledger { vendor: { name: string; vendorCode: string }; lines: { entryNo: string; date: string; narration: string; debit: string; credit: string; balance: string }[] }
const blank = { name: '', vendorType: 'SUPPLIER', gstin: '', pan: '', stateCode: '29', phone: '', email: '', address: '', bankName: '', bankAccountNo: '', ifsc: '', tdsSectionId: '', status: 'ACTIVE' };

/** Accounts → Vendors (M13.2): suppliers and contractors, what is owed to each, ageing, their account. */
export default function VendorsPage() {
  const { can } = useSession();
  const { t, locale } = useI18n();
  const toast = useToast();
  const entry = can(PERMISSIONS.ACC_ENTRY);
  const reveal = can(PERMISSIONS.ACC_REVEAL);
  const [tab, setTab] = useState<'list' | 'ageing'>('list');
  const [rows, setRows] = useState<Vendor[] | null>(null);
  const [ageing, setAgeing] = useState<Age[] | null>(null);
  const [tds, setTds] = useState<Tds[]>([]);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Vendor | 'new' | null>(null);
  const [form, setForm] = useState<Record<string, string>>(blank);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [shown, setShown] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Vendor[]>('/accounts/vendors').then(setRows).catch(() => setRows([])); api<Age[]>('/accounts/ageing').then(setAgeing).catch(() => setAgeing([])); }, []);
  useEffect(load, [load]);
  useEffect(() => { api<{ tdsSections: (Tds & { effectiveTo: string | null })[] }>('/accounts/statutory').then((s) => setTds([...new Map(s.tdsSections.filter((x) => !x.effectiveTo).map((x) => [x.sectionCode, x])).values()])).catch(() => setTds([])); }, []);
  const open = (v: Vendor | 'new') => {
    setEdit(v); setErrors({}); setError(null);
    setForm(v === 'new' ? blank : { name: v.name, vendorType: v.vendorType, gstin: v.gstin ?? '', pan: '', stateCode: v.stateCode, phone: v.phone ?? '', email: v.email ?? '', address: '', bankName: v.bankName ?? '', bankAccountNo: '', ifsc: v.ifsc ?? '', tdsSectionId: v.tdsSectionId ?? '', status: v.status });
  };
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value, ...(k === 'gstin' && /^\d{2}/.test(e.target.value) ? { stateCode: e.target.value.slice(0, 2), ...(e.target.value.length >= 12 && !f.pan ? { pan: e.target.value.slice(2, 12).toUpperCase() } : {}) } : {}) }));
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!edit) return;
    setBusy(true); setErrors({}); setError(null);
    try {
      const body = { ...form, tdsSectionId: form.tdsSectionId || null };
      await api(edit === 'new' ? '/accounts/vendors' : `/accounts/vendors/${edit.id}`, { method: edit === 'new' ? 'POST' : 'PUT', body: JSON.stringify(body) });
      toast(t('ac2.vendor.saved')); setEdit(null); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const show = async (v: Vendor, field: 'pan' | 'bankAccountNo') => {
    try { const r = await api<{ value: string | null }>(`/accounts/vendors/${v.id}/reveal`, { method: 'POST', body: JSON.stringify({ field }) }); setShown((s) => ({ ...s, [`${v.id}:${field}`]: r.value ?? '' })); }
    catch (x) { toast(apiErrors(x).message ?? t('en.failed')); }
  };
  const d = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const list = (rows ?? []).filter((v) => !q.trim() || `${v.name} ${v.vendorCode} ${v.gstin ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const editing = edit && edit !== 'new' ? edit : null;
  return (
    <>
      <PageHeader eyebrow={t('nav.accounts')} title={t('ac2.vendors.title')} description={t('ac2.vendors.desc')} actions={entry && <button type="button" className="btn btn-primary" onClick={() => open('new')}><Icon name="plus" /> {t('ac2.vendor.add')}</button>} />
      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label={t('ac2.vendors.title')}>
          <button role="tab" aria-selected={tab === 'list'} className={tab === 'list' ? 'on' : ''} onClick={() => setTab('list')}>{t('ac2.vendors.tabList')}</button>
          <button role="tab" aria-selected={tab === 'ageing'} className={tab === 'ageing' ? 'on' : ''} onClick={() => setTab('ageing')}>{t('ac2.vendors.tabAgeing')}</button>
        </div>
        {tab === 'list' && <input type="search" className="input" aria-label={t('ac2.vendors.search')} placeholder={t('ac2.vendors.search')} value={q} onChange={(e) => setQ(e.target.value)} />}
      </div>
      {tab === 'list' && (!rows ? <SkeletonRows rows={5} /> : !list.length ? <EmptyState icon="users" title={t('ac2.vendors.none')} text={entry ? t('ac2.vendors.noneHint') : undefined} /> : (
        <div className="table-wrap card p12-table">
          <table className="table">
            <thead><tr><th scope="col">{t('ac2.vendor')}</th><th scope="col">{t('ac2.vendor.gstPan')}</th><th scope="col">{t('ac2.vendor.bank')}</th><th scope="col" className="num">{t('ac2.vendor.due')}</th><th scope="col"><span className="sr-only">{t('common.actions')}</span></th></tr></thead>
            <tbody>
              {list.map((v) => (
                <tr key={v.id} className={v.status === 'BLOCKED' ? 'row-dim' : undefined}>
                  <td><strong>{v.name}</strong><span className="sub-line muted small">{v.vendorCode} · {t(`ac2.vtype.${v.vendorType}` as MessageKey)}{v.tdsSection ? ` · TDS ${v.tdsSection}` : ''}{v.status === 'BLOCKED' ? ` · ${t('ac2.vendor.blocked')}` : ''}</span></td>
                  <td>{v.gstin ?? '—'}<span className="sub-line muted small">PAN {shown[`${v.id}:pan`] ?? v.pan ?? '—'}{reveal && v.pan && !shown[`${v.id}:pan`] && <button type="button" className="link-btn" onClick={() => void show(v, 'pan')}> {t('ac2.show')}</button>}</span></td>
                  <td>{v.bankName ?? '—'}<span className="sub-line muted small">{shown[`${v.id}:bankAccountNo`] ?? v.bankAccount ?? ''}{reveal && v.bankAccount && !shown[`${v.id}:bankAccountNo`] && <button type="button" className="link-btn" onClick={() => void show(v, 'bankAccountNo')}> {t('ac2.show')}</button>}{v.ifsc ? ` · ${v.ifsc}` : ''}</span></td>
                  <td className="num">{rupees(v.due, { paise: true })}{Number(v.advance) > 0 && <span className="sub-line muted small">{t('ac2.vendor.advance', { amt: rupees(v.advance, { paise: true }) })}</span>}</td>
                  <td className="row-actions">
                    <button type="button" className="btn btn-sm" onClick={() => void api<Ledger>(`/accounts/vendors/${v.id}/ledger`).then(setLedger)} aria-label={t('ac2.vendor.ledgerOf', { name: v.name })}><Icon name="book" size={14} /> {t('ac2.vendor.ledger')}</button>
                    {entry && <button type="button" className="btn btn-sm btn-ghost" onClick={() => open(v)} aria-label={t('ac2.vendor.editOf', { name: v.name })}><Icon name="edit" size={14} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {tab === 'ageing' && (!ageing ? <SkeletonRows rows={4} /> : !ageing.length ? <EmptyState icon="check" title={t('ac2.ageing.none')} /> : (
        <div className="table-wrap card p12-table" role="region" aria-label={t('ac2.vendors.tabAgeing')} tabIndex={0}>
          <table className="table">
            <thead><tr><th scope="col">{t('ac2.vendor')}</th><th scope="col" className="num">{t('ac2.ageing.notDue')}</th><th scope="col" className="num">1–30</th><th scope="col" className="num">31–60</th><th scope="col" className="num">61–90</th><th scope="col" className="num">{t('ac2.ageing.over90')}</th><th scope="col" className="num">{t('ac2.ageing.total')}</th></tr></thead>
            <tbody>{ageing.map((a) => <tr key={a.vendorId}><td>{a.vendor}</td>{(['notDue', 'd30', 'd60', 'd90', 'over90'] as const).map((k) => <td key={k} className={`num${k !== 'notDue' && Number(a[k]) > 0 ? ' text-bad' : ''}`}>{Number(a[k]) ? rupees(a[k], { paise: true }) : '—'}</td>)}<td className="num"><strong>{rupees(a.total, { paise: true })}</strong></td></tr>)}</tbody>
          </table>
          <p className="muted small acc-note">{t('ac2.ageing.hint')}</p>
        </div>
      ))}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={editing ? editing.name : t('ac2.vendor.add')} subtitle={t('ac2.vendor.privacy')} onSubmit={save} submitLabel={t('common.save')} busy={busy} error={error} wide>
        <div className="grid-2">
          <Field id="vn-name" label={t('common.name')} error={errors.name}><input id="vn-name" value={form.name} onChange={set('name')} /></Field>
          <Field id="vn-type" label={t('ac2.vendor.type')}><select id="vn-type" value={form.vendorType} onChange={set('vendorType')}>{VENDOR_TYPES.map((x) => <option key={x} value={x}>{t(`ac2.vtype.${x}` as MessageKey)}</option>)}</select></Field>
        </div>
        <div className="grid-3">
          <Field id="vn-gstin" label="GSTIN" hint={t('ac2.vendor.gstinHint')} error={errors.gstin}><input id="vn-gstin" value={form.gstin} maxLength={15} onChange={set('gstin')} autoComplete="off" /></Field>
          <Field id="vn-pan" label="PAN" hint={editing?.pan ? t('ac2.vendor.panKeep', { p: editing.pan }) : t('ac2.vendor.panHint')} error={errors.pan}><input id="vn-pan" value={form.pan} maxLength={10} onChange={set('pan')} autoComplete="off" /></Field>
          <Field id="vn-state" label={t('ac2.vendor.state')} hint={t('ac2.vendor.stateHint')} error={errors.stateCode}><input id="vn-state" value={form.stateCode} maxLength={2} inputMode="numeric" onChange={set('stateCode')} /></Field>
        </div>
        <div className="grid-3">
          <Field id="vn-tds" label={t('ac2.vendor.tds')} hint={t('ac2.vendor.tdsHint')}><select id="vn-tds" value={form.tdsSectionId} onChange={set('tdsSectionId')}><option value="">{t('ac2.vendor.noTds')}</option>{tds.map((x) => <option key={x.id} value={x.id}>{x.sectionCode} · {x.description}</option>)}</select></Field>
          <Field id="vn-phone" label={t('fo.phone')} error={errors.phone}><input id="vn-phone" inputMode="numeric" value={form.phone} onChange={set('phone')} /></Field>
          <Field id="vn-email" label={t('ac2.email')} error={errors.email}><input id="vn-email" type="email" value={form.email} onChange={set('email')} /></Field>
        </div>
        <div className="grid-3">
          <Field id="vn-bank" label={t('ac2.vendor.bankName')}><input id="vn-bank" value={form.bankName} onChange={set('bankName')} /></Field>
          <Field id="vn-acno" label={t('ac2.vendor.accountNo')} hint={editing?.bankAccount ? t('ac2.vendor.panKeep', { p: editing.bankAccount }) : t('ac2.vendor.encrypted')} error={errors.bankAccountNo}><input id="vn-acno" inputMode="numeric" value={form.bankAccountNo} onChange={set('bankAccountNo')} autoComplete="off" /></Field>
          <Field id="vn-ifsc" label="IFSC" error={errors.ifsc}><input id="vn-ifsc" value={form.ifsc} maxLength={11} onChange={set('ifsc')} /></Field>
        </div>
        {editing && <label className="check"><input type="checkbox" checked={form.status === 'BLOCKED'} onChange={(e) => setForm((f) => ({ ...f, status: e.target.checked ? 'BLOCKED' : 'ACTIVE' }))} /> {t('ac2.vendor.block')}</label>}
        {editing && (editing.pan || editing.bankAccount) && <p className="muted small"><Icon name="lock" size={14} /> {t('ac2.vendor.reenter')}</p>}
      </Modal>
      <Modal open={!!ledger} onClose={() => setLedger(null)} title={ledger ? t('ac2.vendor.ledgerTitle', { name: ledger.vendor.name }) : ''} onSubmit={(e) => { e.preventDefault(); setLedger(null); }} submitLabel={t('common.close')} hideCancel wide>
        {ledger && (!ledger.lines.length ? <p className="muted">{t('ac2.vendor.noEntries')}</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">{t('common.date')}</th><th scope="col">{t('ac2.entry')}</th><th scope="col">{t('ac2.narration')}</th><th scope="col" className="num">{t('ac2.vendor.paidCol')}</th><th scope="col" className="num">{t('ac2.vendor.billedCol')}</th><th scope="col" className="num">{t('ac2.vendor.owed')}</th></tr></thead>
              <tbody>{ledger.lines.map((l, i) => <tr key={i}><td>{d(l.date)}</td><td className="code">{l.entryNo}</td><td>{l.narration}</td><td className="num">{Number(l.debit) ? rupees(l.debit, { paise: true }) : ''}</td><td className="num">{Number(l.credit) ? rupees(l.credit, { paise: true }) : ''}</td><td className="num">{rupees(l.balance, { paise: true })}</td></tr>)}</tbody>
            </table>
          </div>
        ))}
      </Modal>
    </>
  );
}
