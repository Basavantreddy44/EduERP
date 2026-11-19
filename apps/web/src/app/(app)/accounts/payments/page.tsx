'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PERMISSIONS, VENDOR_PAYMENT_MODES, formatINR, toPaise } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { CampusPicker } from '@/components/CampusPicker';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { AccPill, rupees, todayIST, useBanks } from '@/components/accounts';

interface Payment { id: string; paymentNo: string; vendorId: string; vendor: string; paymentDate: string; amount: string; mode: string; bank: string | null; referenceNo: string | null; status: string; advance: string; advanceLeft: string; bills: { internalNo: string; billNo: string; amount: string; isAdjustment: boolean }[] }
interface Vendor { id: string; name: string; status: string; due: string; advance: string }
interface OpenBill { id: string; internalNo: string; billNo: string; billDate: string; balance: string; dueDate: string | null; overdue: boolean }
const p = (v: string) => { try { return v ? toPaise(v) : 0; } catch { return 0; } };

/** Accounts → Payments (M13.3): pay vendors against bills or in advance, adjust advances, cancel. */
export default function PaymentsPage() {
  const { can } = useSession();
  const { t, locale } = useI18n();
  const toast = useToast();
  const entry = can(PERMISSIONS.ACC_ENTRY);
  const banks = useBanks();
  const [rows, setRows] = useState<Payment[] | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ campusId: '', vendorId: '', paymentDate: todayIST(), mode: 'NEFT', bankAccountId: '', referenceNo: '', advanceAmount: '', narration: '' });
  const [bills, setBills] = useState<OpenBill[]>([]);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [adjust, setAdjust] = useState<Payment | null>(null);
  const [adj, setAdj] = useState({ billId: '', amount: '' });
  const [cancel, setCancel] = useState<Payment | null>(null);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Payment[]>('/accounts/payments').then(setRows).catch(() => setRows([])); }, []);
  useEffect(load, [load]);
  useEffect(() => { api<Vendor[]>('/accounts/vendors').then((v) => setVendors(v.filter((x) => x.status === 'ACTIVE'))).catch(() => setVendors([])); }, []);
  const loadBills = useCallback((vendorId: string) => {
    setBills([]); setAlloc({});
    if (vendorId) api<OpenBill[]>(`/accounts/bills?vendorId=${vendorId}&status=OPEN`).then(setBills).catch(() => setBills([]));
  }, []);
  const start = useCallback((vendorId?: string) => {
    const v = vendorId ?? vendors.find((x) => Number(x.due) > 0)?.id ?? vendors[0]?.id ?? '';
    setForm({ campusId: '', vendorId: v, paymentDate: todayIST(), mode: 'NEFT', bankAccountId: banks?.find((b) => b.isActive)?.id ?? '', referenceNo: '', advanceAmount: '', narration: '' });
    loadBills(v); setErrors({}); setError(null); setOpen(true);
  }, [vendors, banks, loadBills]);
  // "Pay" from a bill page opens the form for that vendor.
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get('vendor');
    if (v && vendors.length && banks && !open) { start(v); window.history.replaceState(null, '', '/accounts/payments'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendors, banks]);
  const total = Object.values(alloc).reduce((s, v) => s + p(v), 0) + p(form.advanceAmount);
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try {
      const body = { ...form, bankAccountId: form.mode === 'CASH' ? null : form.bankAccountId || null, referenceNo: form.referenceNo || null, narration: form.narration || null, advanceAmount: form.advanceAmount || '0', allocations: Object.entries(alloc).filter(([, v]) => p(v) > 0).map(([billId, amount]) => ({ billId, amount })) };
      const r = await api<{ paymentNo: string; status: string }>('/accounts/payments', { method: 'POST', body: JSON.stringify(body) });
      toast(r.status === 'PENDING_APPROVAL' ? t('ac2.pay.sentApproval', { no: r.paymentNo }) : t('ac2.pay.saved', { no: r.paymentNo })); setOpen(false); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const doAdjust = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!adjust) return;
    setBusy(true); setError(null);
    try { await api(`/accounts/payments/${adjust.id}/adjust`, { method: 'POST', body: JSON.stringify(adj) }); toast(t('ac2.pay.adjustedToast')); setAdjust(null); load(); }
    catch (x) { setError(apiErrors(x).message ?? t('en.failed')); } finally { setBusy(false); }
  };
  const doCancel = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!cancel) return;
    setBusy(true); setError(null);
    try { await api(`/accounts/payments/${cancel.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }); toast(t('ac2.pay.cancelled')); setCancel(null); load(); }
    catch (x) { setError(apiErrors(x).message ?? t('en.failed')); } finally { setBusy(false); }
  };
  const d = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
  const vendor = vendors.find((v) => v.id === form.vendorId);
  return (
    <>
      <PageHeader eyebrow={t('nav.accounts')} title={t('ac2.pay.title')} description={t('ac2.pay.desc')} actions={entry && <button type="button" className="btn btn-primary" onClick={() => start()} disabled={!vendors.length || !banks}><Icon name="rupee" /> {t('ac2.pay.new')}</button>} />
      {!rows ? <SkeletonRows rows={5} /> : !rows.length ? <EmptyState icon="rupee" title={t('ac2.pay.none')} /> : (
        <div className="table-wrap card p12-table">
          <table className="table">
            <thead><tr><th scope="col">{t('ac2.pay.no')}</th><th scope="col">{t('ac2.vendor')}</th><th scope="col">{t('ac2.pay.how')}</th><th scope="col">{t('ac2.pay.for')}</th><th scope="col" className="num">{t('ac2.amount')}</th><th scope="col">{t('common.status')}</th><th scope="col"><span className="sr-only">{t('common.actions')}</span></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={['CANCELLED', 'REJECTED'].includes(r.status) ? 'row-dim' : undefined}>
                  <td><span className="code">{r.paymentNo}</span><span className="sub-line muted small">{d(r.paymentDate)}</span></td>
                  <td>{r.vendor}</td>
                  <td>{t(`ac2.mode.${r.mode}` as MessageKey)}<span className="sub-line muted small">{[r.bank, r.referenceNo].filter(Boolean).join(' · ')}</span></td>
                  <td>{r.bills.filter((b) => !b.isAdjustment).map((b) => b.internalNo).join(', ') || '—'}{Number(r.advance) > 0 && <span className="sub-line muted small">{t('ac2.pay.advanceLine', { amt: rupees(r.advance, { paise: true }), left: rupees(r.advanceLeft, { paise: true }) })}</span>}</td>
                  <td className="num">{rupees(r.amount, { paise: true })}</td>
                  <td><AccPill status={r.status} /></td>
                  <td className="row-actions">
                    {entry && r.status === 'PAID' && Number(r.advanceLeft) > 0 && <button type="button" className="btn btn-sm" onClick={() => { setAdj({ billId: '', amount: r.advanceLeft }); loadBills(r.vendorId); setError(null); setAdjust(r); }}>{t('ac2.pay.adjust')}</button>}
                    {entry && !['CANCELLED', 'REJECTED'].includes(r.status) && <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setReason(''); setError(null); setCancel(r); }} aria-label={t('ac2.pay.cancelOf', { no: r.paymentNo })}><Icon name="x" size={14} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('ac2.pay.new')} subtitle={vendor ? t('ac2.pay.owed', { amt: rupees(vendor.due, { paise: true }), adv: rupees(vendor.advance, { paise: true }) }) : undefined} onSubmit={save} submitLabel={total ? t('ac2.pay.payAmt', { amt: formatINR(total, { paise: true }) }) : t('ac2.pay.pay')} busy={busy} error={error} wide>
        <div className="grid-3">
          <Field id="py-vendor" label={t('ac2.vendor')} error={errors.vendorId}><select id="py-vendor" value={form.vendorId} onChange={(e) => { setForm((f) => ({ ...f, vendorId: e.target.value })); loadBills(e.target.value); }}>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}{Number(v.due) > 0 ? ` · ${rupees(v.due)}` : ''}</option>)}</select></Field>
          <Field id="py-date" label={t('common.date')} error={errors.paymentDate}><input id="py-date" type="date" max={todayIST()} value={form.paymentDate} onChange={(e) => setForm((f) => ({ ...f, paymentDate: e.target.value }))} /></Field>
          <Field id="py-campus" label={t('common.campus')} error={errors.campusId}><CampusPicker id="py-campus" value={form.campusId} onChange={(v) => setForm((f) => ({ ...f, campusId: v }))} allowInstitution={false} /></Field>
        </div>
        <fieldset className="check-group acc-bills"><legend>{t('ac2.pay.whichBills')}</legend>
          {!bills.length ? <p className="muted small">{t('ac2.pay.noOpenBills')}</p> : bills.map((b) => (
            <div key={b.id} className="acc-bill-row">
              <label className="check"><input type="checkbox" checked={b.id in alloc} onChange={(e) => setAlloc((a) => { const n = { ...a }; if (e.target.checked) n[b.id] = b.balance; else delete n[b.id]; return n; })} /> <span><strong>{b.internalNo}</strong> <span className="muted small">· {t('ac2.bill.theirNo', { no: b.billNo })} · {d(b.billDate)}{b.overdue ? ` · ${t('ac2.overdue')}` : ''}</span></span></label>
              <span className="muted small">{t('ac2.pay.dueAmt', { amt: rupees(b.balance, { paise: true }) })}</span>
              {b.id in alloc && <input aria-label={t('ac2.pay.amountFor', { no: b.internalNo })} inputMode="decimal" value={alloc[b.id]} onChange={(e) => setAlloc((a) => ({ ...a, [b.id]: e.target.value }))} />}
            </div>
          ))}
          {errors.allocations && <span className="field-error">{errors.allocations}</span>}
        </fieldset>
        <Field id="py-adv" label={t('ac2.pay.advance')} hint={t('ac2.pay.advanceHint')} error={errors.advanceAmount}><input id="py-adv" inputMode="decimal" value={form.advanceAmount} onChange={(e) => setForm((f) => ({ ...f, advanceAmount: e.target.value }))} /></Field>
        <div className="grid-3">
          <Field id="py-mode" label={t('ac2.pay.how')}><select id="py-mode" value={form.mode} onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value }))}>{VENDOR_PAYMENT_MODES.map((m) => <option key={m} value={m}>{t(`ac2.mode.${m}` as MessageKey)}</option>)}</select></Field>
          {form.mode !== 'CASH' && <Field id="py-bank" label={t('ac2.pay.fromBank')} error={errors.bankAccountId}><select id="py-bank" value={form.bankAccountId} onChange={(e) => setForm((f) => ({ ...f, bankAccountId: e.target.value }))}><option value="">—</option>{banks?.filter((b) => b.isActive).map((b) => <option key={b.id} value={b.id}>{b.ledger}</option>)}</select></Field>}
          {form.mode !== 'CASH' && <Field id="py-ref" label={form.mode === 'CHEQUE' ? t('ac2.pay.chequeNo') : t('ac2.pay.utr')} error={errors.referenceNo}><input id="py-ref" value={form.referenceNo} onChange={(e) => setForm((f) => ({ ...f, referenceNo: e.target.value }))} /></Field>}
        </div>
        {banks && !banks.length && form.mode !== 'CASH' && <p className="notice"><Icon name="info" /> {t('ac2.pay.addBankFirst')} <Link href="/accounts/setup">{t('ac2.setup.title')}</Link></p>}
        <Field id="py-note" label={t('ac2.narration')} error={errors.narration}><input id="py-note" value={form.narration} onChange={(e) => setForm((f) => ({ ...f, narration: e.target.value }))} /></Field>
      </Modal>
      <Modal open={!!adjust} onClose={() => setAdjust(null)} title={t('ac2.pay.adjustTitle', { no: adjust?.paymentNo ?? '' })} subtitle={adjust ? t('ac2.pay.adjustSub', { amt: rupees(adjust.advanceLeft, { paise: true }) }) : undefined} onSubmit={doAdjust} submitLabel={t('ac2.pay.adjust')} busy={busy} error={error} submitDisabled={!adj.billId}>
        {!bills.length ? <p className="muted">{t('ac2.pay.noOpenBills')}</p> : (
          <div className="grid-2">
            <Field id="aj-bill" label={t('ac2.pay.againstBill')}><select id="aj-bill" value={adj.billId} onChange={(e) => setAdj((a) => ({ ...a, billId: e.target.value }))}><option value="">—</option>{bills.map((b) => <option key={b.id} value={b.id}>{b.internalNo} · {rupees(b.balance)}</option>)}</select></Field>
            <Field id="aj-amt" label={t('ac2.amount')}><input id="aj-amt" inputMode="decimal" value={adj.amount} onChange={(e) => setAdj((a) => ({ ...a, amount: e.target.value }))} /></Field>
          </div>
        )}
      </Modal>
      <Modal open={!!cancel} onClose={() => setCancel(null)} title={t('ac2.pay.cancelOf', { no: cancel?.paymentNo ?? '' })} subtitle={cancel?.status === 'PAID' ? t('ac2.pay.cancelPaid') : undefined} onSubmit={doCancel} submitLabel={t('ac2.pay.cancel')} busy={busy} error={error} danger submitDisabled={reason.trim().length < 5}>
        <Field id="py-reason" label={t('ac2.reason')} hint={t('ac2.reasonHint')}><input id="py-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>
    </>
  );
}
