'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { PersonPick, PersonSearch } from '@/components/leave';
import { rupees, todayIST } from '@/components/accounts';
import { PayPill, useMonthLabel } from '@/components/payroll';

interface Loan { id: string; loanNo: string; employeeId: string; name: string; code: string; loanType: string; amount: string; emiAmount: string; recovered: string; balance: string; starts: string; reason: string; disbursedOn: string; mode: string; status: string; mine: boolean; startMonth: number; startYear: number }

/** Payroll → Loans & advances (M15.4): paid out once, recovered from salary each month. */
export default function LoansPage() {
  const { can } = useSession();
  const { t, locale } = useI18n();
  const toast = useToast();
  const label = useMonthLabel();
  const manage = can(PERMISSIONS.PAYROLL_LOAN);
  const [rows, setRows] = useState<Loan[] | null>(null);
  const [filter, setFilter] = useState<'ACTIVE' | 'PENDING_APPROVAL' | 'CLOSED' | ''>('ACTIVE');
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<PersonPick | null>(null);
  const now = todayIST();
  const blank = () => ({ loanType: 'ADVANCE', amount: '', emiAmount: '', startMonth: Number(now.slice(5, 7)), startYear: Number(now.slice(0, 4)), reason: '', disbursedOn: now, mode: 'CASH', bankAccountId: '' });
  const [form, setForm] = useState(blank);
  const [banks, setBanks] = useState<{ id: string; label: string }[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setRows(null); api<Loan[]>(`/payroll/loans${filter ? `?status=${filter}` : ''}`).then(setRows).catch(() => setRows([])); }, [filter]);
  useEffect(load, [load]);
  const start = () => {
    setWho(null); setForm(blank()); setErrors({}); setError(null); setOpen(true);
    api<{ id: string; label: string }[]>('/payroll/bank-accounts').then(setBanks).catch(() => setBanks([]));
  };
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try {
      const r = await api<{ status: string; loanNo: string }>('/payroll/loans', { method: 'POST', body: JSON.stringify({ ...form, employeeId: who?.id ?? '', bankAccountId: form.mode === 'CASH' ? null : form.bankAccountId || null }) });
      toast(r.status === 'ACTIVE' ? t('pay.loan.paidOut', { no: r.loanNo }) : t('pay.loan.sent', { no: r.loanNo })); setOpen(false); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const months = Number(form.amount) > 0 && Number(form.emiAmount) > 0 ? Math.ceil(Number(form.amount) / Number(form.emiAmount)) : 0;
  const d = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return (
    <>
      <PageHeader eyebrow={t('nav.payroll')} title={t('pay.loan.title')} description={t('pay.loan.desc')} actions={manage && <button type="button" className="btn btn-primary" onClick={start}><Icon name="plus" /> {t('pay.loan.new')}</button>} />
      <div className="tabs" role="tablist" aria-label={t('pay.loan.title')}>
        {(['ACTIVE', 'PENDING_APPROVAL', 'CLOSED', ''] as const).map((x) => <button key={x || 'all'} role="tab" aria-selected={filter === x} className={filter === x ? 'on' : ''} onClick={() => setFilter(x)}>{x ? t(`pay.st.${x}` as MessageKey) : t('pay.all')}</button>)}
      </div>
      {!rows ? <SkeletonRows rows={4} /> : !rows.length ? <EmptyState icon="rupee" title={t('pay.loan.none')} /> : (
        <div className="table-wrap card" role="region" aria-label={t('pay.loan.title')} tabIndex={0}>
          <table className="table">
            <thead><tr><th scope="col">{t('pay.name')}</th><th scope="col">{t('pay.loan.no')}</th><th scope="col" className="num">{t('pay.amount')}</th><th scope="col" className="num">{t('pay.loan.emi')}</th><th scope="col" className="num">{t('pay.loan.recovered')}</th><th scope="col" className="num">{t('pay.loan.balance')}</th><th scope="col">{t('pay.status')}</th></tr></thead>
            <tbody>{rows.map((l) => (
              <tr key={l.id}>
                <td><strong>{l.name}</strong><span className="sub-line muted small">{l.code} · {t(`pay.loan.type.${l.loanType}` as MessageKey)} · {l.reason}</span></td>
                <td className="mono small">{l.loanNo}<span className="sub-line muted">{t('pay.loan.paidOn', { d: d(l.disbursedOn) })} · {t('pay.loan.starts', { m: label(l.startMonth, l.startYear) })}</span></td>
                <td className="num">{rupees(l.amount)}</td>
                <td className="num">{rupees(l.emiAmount)}</td>
                <td className="num">{rupees(l.recovered)}</td>
                <td className="num"><strong>{rupees(l.balance)}</strong></td>
                <td><PayPill status={l.status} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('pay.loan.new')} subtitle={t('pay.loan.sub')} onSubmit={save} submitLabel={t('pay.loan.give')} busy={busy} error={error} wide>
        <Field id="ln-who" label={t('pay.name')} error={errors.employeeId}><PersonSearch kind="EMPLOYEE" value={who} onPick={setWho} inputId="ln-who" /></Field>
        <div className="grid-3">
          <Field id="ln-type" label={t('pay.loan.kind')}><select id="ln-type" value={form.loanType} onChange={(e) => setForm((f) => ({ ...f, loanType: e.target.value }))}><option value="ADVANCE">{t('pay.loan.type.ADVANCE')}</option><option value="LOAN">{t('pay.loan.type.LOAN')}</option></select></Field>
          <Field id="ln-amt" label={t('pay.amount')} error={errors.amount}><input id="ln-amt" inputMode="decimal" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} /></Field>
          <Field id="ln-emi" label={t('pay.loan.emi')} hint={months ? t('pay.loan.months', { n: months }) : undefined} error={errors.emiAmount}><input id="ln-emi" inputMode="decimal" value={form.emiAmount} onChange={(e) => setForm((f) => ({ ...f, emiAmount: e.target.value }))} /></Field>
        </div>
        <div className="grid-3">
          <Field id="ln-on" label={t('pay.loan.paidOnLabel')} error={errors.disbursedOn}><input id="ln-on" type="date" value={form.disbursedOn} onChange={(e) => setForm((f) => ({ ...f, disbursedOn: e.target.value }))} /></Field>
          <Field id="ln-mode" label={t('pay.loan.mode')}><select id="ln-mode" value={form.mode} onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value, bankAccountId: e.target.value === 'CASH' ? '' : f.bankAccountId || banks[0]?.id || '' }))}>{['CASH', 'CHEQUE', 'NEFT', 'RTGS', 'UPI'].map((m) => <option key={m} value={m}>{t(`ac2.mode.${m}` as MessageKey)}</option>)}</select></Field>
          {form.mode !== 'CASH' && <Field id="ln-bank" label={t('pay.pay.from')} error={errors.bankAccountId}><select id="ln-bank" value={form.bankAccountId} onChange={(e) => setForm((f) => ({ ...f, bankAccountId: e.target.value }))}><option value="">{banks.length ? t('pay.comp.choose') : t('pay.pay.noBanks')}</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></Field>}
        </div>
        <div className="grid-2">
          <Field id="ln-start" label={t('pay.loan.startLabel')} error={errors.startMonth}><select id="ln-start" value={`${form.startYear}-${form.startMonth}`} onChange={(e) => { const [y, m] = e.target.value.split('-').map(Number); setForm((f) => ({ ...f, startYear: y, startMonth: m })); }}>{Array.from({ length: 6 }, (_, i) => { const dt = new Date(Date.UTC(Number(now.slice(0, 4)), Number(now.slice(5, 7)) - 1 + i, 1)); const m = dt.getUTCMonth() + 1; const y = dt.getUTCFullYear(); return <option key={`${y}-${m}`} value={`${y}-${m}`}>{label(m, y)}</option>; })}</select></Field>
          <Field id="ln-reason" label={t('ac2.reason')} error={errors.reason}><input id="ln-reason" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} /></Field>
        </div>
        <p className="muted small"><Icon name="info" size={14} /> {t('pay.loan.howNote')}</p>
      </Modal>
    </>
  );
}
