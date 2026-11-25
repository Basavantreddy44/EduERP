'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PLATFORM_PAYMENT_MODES, billingReasonSchema, billingSettingsSchema, recordPlatformPaymentSchema } from '@eduerp/shared';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { apiErrors, FieldErrors, validate } from '@/lib/form';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { InvoiceStatus, SaasInvoice, inr, useDayText } from '@/components/billing';

interface Summary { financialYear: string; billed: number; invoices: number; received: number; outstanding: number; overdue: number; inGrace: number; readOnly: number }
interface Settings {
  graceDays: number; renewLeadDays: number; gstRate: number; invoicePrefix: string; sellerName: string; sellerAddress: string; sellerState: string; sellerGstin: string | null;
  sacCode: string | null; bankName: string | null; bankAccountName: string | null; bankAccountNo: string | null; bankIfsc: string | null; upiId: string | null; updatedAt: string;
}
type RunResult = { institutions: number; invoices: number; reminders: number; grace: number; readOnly: number; reactivated: number; failed: number };

const MODE_LABEL: Record<string, string> = { BANK_TRANSFER: 'Bank transfer (NEFT / RTGS / IMPS)', UPI: 'UPI', CHEQUE: 'Cheque', CASH: 'Cash', OTHER: 'Other' };
const STATUS_FILTERS = [['', 'All bills'], ['OVERDUE', 'Overdue'], ['UNPAID', 'Unpaid'], ['PART_PAID', 'Part paid'], ['PAID', 'Paid'], ['CANCELLED', 'Cancelled']] as const;
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/** Platform console → Billing (Phase 22): what institutions owe and pay, the billing check, and settings. */
export default function PlatformBillingPage() {
  const { session } = useSession();
  const toast = useToast();
  const day = useDayText();
  const isSuper = session?.user.platformRole === 'SUPER_ADMIN';
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<SaasInvoice[] | null>(null);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  // record payment
  const [paying, setPaying] = useState<SaasInvoice | null>(null);
  const [pay, setPay] = useState({ paidOn: today(), amount: '', mode: 'BANK_TRANSFER', reference: '', note: '' });
  const [payErr, setPayErr] = useState<FieldErrors>({});
  const [payMsg, setPayMsg] = useState<string | null>(null);
  // cancel
  const [cancelling, setCancelling] = useState<SaasInvoice | null>(null);
  const [reason, setReason] = useState('');
  const [reasonErr, setReasonErr] = useState<string | null>(null);
  // settings
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sOpen, setSOpen] = useState(false);
  const [sForm, setSForm] = useState<Record<string, string>>({});
  const [sErr, setSErr] = useState<FieldErrors>({});
  const [sMsg, setSMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Summary>('/platform/billing/summary').then(setSummary).catch(() => setSummary(null));
    api<SaasInvoice[]>(`/platform/billing/invoices${status ? `?status=${status}` : ''}`).then(setRows).catch(() => setRows([]));
    api<Settings>('/platform/billing/settings').then(setSettings).catch(() => setSettings(null));
  }, [status]);
  useEffect(load, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((r) => !q || r.invoiceNo.toLowerCase().includes(q) || (r.tenantName ?? '').toLowerCase().includes(q));
  }, [rows, query]);

  if (!session?.user.platformRole) return <div className="alert">Platform staff only.</div>;

  function openPay(i: SaasInvoice) {
    setPaying(i);
    setPay({ paidOn: today(), amount: String(i.balance), mode: 'BANK_TRANSFER', reference: '', note: '' });
    setPayErr({});
    setPayMsg(null);
  }
  async function savePay() {
    if (!paying) return;
    const v = validate(recordPlatformPaymentSchema, { ...pay, amount: pay.amount === '' ? NaN : Number(pay.amount) });
    if (!v.ok) return setPayErr(v.errors);
    setBusy(true);
    try {
      const r = await api<{ status: string; accountChange: string | null }>(`/platform/billing/invoices/${paying.id}/payments`, { method: 'POST', body: JSON.stringify(v.data) });
      setPaying(null);
      toast(`${inr(v.data.amount)} recorded on ${paying.invoiceNo}${r.status === 'PAID' ? ' — paid in full' : ''}${r.accountChange === 'ACTIVE' ? '. The institution is active again.' : ''}`);
      load();
    } catch (e) {
      const { fields, message } = apiErrors(e);
      setPayErr(fields);
      setPayMsg(message);
    } finally {
      setBusy(false);
    }
  }

  async function saveCancel() {
    if (!cancelling) return;
    const v = validate(billingReasonSchema, { reason });
    if (!v.ok) return setReasonErr(v.errors.reason ?? 'Give a reason');
    setBusy(true);
    try {
      await api(`/platform/billing/invoices/${cancelling.id}/cancel`, { method: 'POST', body: JSON.stringify(v.data) });
      toast(`${cancelling.invoiceNo} cancelled`);
      setCancelling(null);
      load();
    } catch (e) {
      setReasonErr(e instanceof ApiError ? e.message : 'Could not cancel');
    } finally {
      setBusy(false);
    }
  }

  async function runCheck() {
    setBusy(true);
    try {
      const r = await api<RunResult>('/platform/billing/run', { method: 'POST' });
      const parts = [r.invoices && `${r.invoices} renewal bill(s) raised`, r.reminders && `${r.reminders} reminder(s) sent`, r.grace && `${r.grace} moved to grace`, r.readOnly && `${r.readOnly} made read-only`, r.reactivated && `${r.reactivated} active again`].filter(Boolean);
      toast(parts.length ? `Billing check: ${parts.join(', ')}` : `Billing check done — nothing to do for ${r.institutions} institution(s)`);
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Billing check failed', 'bad');
    } finally {
      setBusy(false);
    }
  }

  function openSettings() {
    if (!settings) return;
    const s = settings;
    setSForm({
      graceDays: String(s.graceDays), renewLeadDays: String(s.renewLeadDays), gstRate: String(s.gstRate), invoicePrefix: s.invoicePrefix, sellerName: s.sellerName, sellerAddress: s.sellerAddress,
      sellerState: s.sellerState, sellerGstin: s.sellerGstin ?? '', sacCode: s.sacCode ?? '', bankName: s.bankName ?? '', bankAccountName: s.bankAccountName ?? '', bankAccountNo: s.bankAccountNo ?? '',
      bankIfsc: s.bankIfsc ?? '', upiId: s.upiId ?? '',
    });
    setSErr({});
    setSMsg(null);
    setSOpen(true);
  }
  async function saveSettings() {
    const v = validate(billingSettingsSchema, { ...sForm, graceDays: Number(sForm.graceDays), renewLeadDays: Number(sForm.renewLeadDays), gstRate: Number(sForm.gstRate) });
    if (!v.ok) return setSErr(v.errors);
    setBusy(true);
    try {
      setSettings(await api<Settings>('/platform/billing/settings', { method: 'PUT', body: JSON.stringify(v.data) }));
      setSOpen(false);
      toast('Billing settings saved');
    } catch (e) {
      const { fields, message } = apiErrors(e);
      setSErr(fields);
      setSMsg(message);
    } finally {
      setBusy(false);
    }
  }
  const sf = (k: string) => ({ id: `bs-${k}`, value: sForm[k] ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => setSForm({ ...sForm, [k]: e.target.value }) });

  return (
    <>
      <PageHeader
        eyebrow="Platform console"
        title="Billing"
        description="Bills to institutions, payments received, and who is in grace or read-only."
        actions={isSuper && (
          <>
            <button className="btn" onClick={openSettings} disabled={!settings}><Icon name="settings" /> Billing settings</button>
            <button className="btn btn-primary" onClick={runCheck} disabled={busy}><Icon name="clock" /> Run billing check now</button>
          </>
        )}
      />

      {summary && (
        <div className="stats bill-stats-5">
          <div className="stat"><span className="stat-label">Billed {summary.financialYear}</span><span className="stat-value">{inr(summary.billed, false)}</span><span className="stat-hint">{summary.invoices} bill{summary.invoices === 1 ? '' : 's'}</span></div>
          <div className="stat"><span className="stat-label">Received</span><span className="stat-value">{inr(summary.received, false)}</span><span className="stat-hint">since 1 April</span></div>
          <div className={`stat ${summary.overdue > 0 ? 'stat-warn' : ''}`}><span className="stat-label">Outstanding</span><span className="stat-value">{inr(summary.outstanding, false)}</span><span className="stat-hint">{inr(summary.overdue, false)} overdue</span></div>
          <div className={`stat ${summary.inGrace ? 'stat-warn' : ''}`}><span className="stat-label">In grace</span><span className="stat-value">{summary.inGrace}</span><span className="stat-hint">working, bill overdue</span></div>
          <div className="stat"><span className="stat-label">Read-only</span><span className="stat-value">{summary.readOnly}</span><span className="stat-hint">unpaid after grace</span></div>
        </div>
      )}

      {settings && (
        <p className="muted small bill-terms">
          <Icon name="info" size={14} /> Grace period <strong>{settings.graceDays} days</strong> after the due date (an institution can have its own) · renewal bill and first reminder <strong>{settings.renewLeadDays} days</strong> before the term ends · GST <strong>{settings.gstRate}%</strong>
          {!settings.bankAccountNo && !settings.upiId && <> · <span className="warn-text">add your bank or UPI details so they print on bills</span></>}
        </p>
      )}

      <div className="toolbar">
        <label className="search">
          <Icon name="search" size={16} />
          <input placeholder="Search by bill number or institution" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search bills" />
        </label>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Bill status">
          {STATUS_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {rows && <span className="muted">{shown.length} of {rows.length}</span>}
      </div>

      {rows === null ? <SkeletonRows /> : rows.length === 0 ? (
        <EmptyState icon="receipt" title={status ? 'No bills with this status' : 'No bills yet'} text="Bills are raised when a paid plan is assigned with “Raise the invoice”, and by the billing check before each term ends." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Bill</th><th>Institution</th><th>Period</th><th className="num">Total</th><th>Due</th><th>Status</th><th className="num">Balance</th><th /></tr></thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.id}>
                  <td><Link href={`/platform/billing/invoices/${i.id}`} className="mono">{i.invoiceNo}</Link><span className="sub-line muted small">{i.kind === 'RENEWAL' ? 'Renewal' : 'First term'} · {i.planName}</span></td>
                  <td><Link href={`/platform/billing/${i.tenantId}`}>{i.tenantName}</Link></td>
                  <td>{day(i.periodStart)} – {day(i.periodEnd)}<span className="sub-line muted small">{i.billingCycle === 'YEARLY' ? 'Yearly' : 'Monthly'} · {i.studentCount} students × {inr(i.rate)}</span></td>
                  <td className="num">{inr(i.total)}</td>
                  <td>{day(i.dueDate)}</td>
                  <td><InvoiceStatus inv={i} /></td>
                  <td className="num">{i.balance > 0 ? inr(i.balance) : '—'}</td>
                  <td className="num row-actions">
                    {isSuper && i.balance > 0 && <button className="btn btn-sm btn-primary" onClick={() => openPay(i)} aria-label={`Record payment for ${i.invoiceNo}`}>Record payment</button>}
                    {isSuper && i.status === 'UNPAID' && <button className="btn btn-sm" onClick={() => { setCancelling(i); setReason(''); setReasonErr(null); }} aria-label={`Cancel ${i.invoiceNo}`}>Cancel</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!paying} onClose={() => setPaying(null)} title={`Record payment · ${paying?.invoiceNo ?? ''}`} subtitle={paying ? `${paying.tenantName} · balance ${inr(paying.balance)}` : ''} onSubmit={savePay} submitLabel="Record payment" busy={busy} error={payMsg}>
        <div className="grid-2">
          <Field id="pp-date" label="Received on" error={payErr.paidOn}><input id="pp-date" type="date" max={today()} value={pay.paidOn} onChange={(e) => setPay({ ...pay, paidOn: e.target.value })} /></Field>
          <Field id="pp-amt" label="Amount (₹)" error={payErr.amount}><input id="pp-amt" type="number" min={0} step="0.01" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field>
        </div>
        <div className="grid-2">
          <Field id="pp-mode" label="How it was paid"><select id="pp-mode" value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}>{PLATFORM_PAYMENT_MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}</select></Field>
          <Field id="pp-ref" label={pay.mode === 'CHEQUE' ? 'Cheque number' : pay.mode === 'UPI' ? 'UPI reference' : 'UTR / reference'} error={payErr.reference} hint={pay.mode === 'CASH' || pay.mode === 'OTHER' ? 'Optional' : undefined}>
            <input id="pp-ref" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
          </Field>
        </div>
        <Field id="pp-note" label="Note (optional)" error={payErr.note}><input id="pp-note" value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></Field>
        <p className="muted small">A payment that clears the overdue bills makes a grace or read-only institution active again at once.</p>
      </Modal>

      <Modal open={!!cancelling} onClose={() => setCancelling(null)} title={`Cancel ${cancelling?.invoiceNo ?? ''}`} subtitle="The number is kept; the bill no longer counts as due." onSubmit={saveCancel} submitLabel="Cancel bill" busy={busy} danger>
        <Field id="pc-reason" label="Reason (kept in the institution's audit log)" error={reasonErr ?? undefined}><input id="pc-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
      </Modal>

      <Modal open={sOpen} onClose={() => setSOpen(false)} wide title="Billing settings" subtitle={settings ? `For all institutions. Last changed ${new Date(settings.updatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}.` : ''} onSubmit={saveSettings} submitLabel="Save settings" busy={busy} error={sMsg}>
        <h3 className="section-title first">Grace and renewal</h3>
        <div className="grid-3">
          <Field id="bs-graceDays" label="Grace period (days)" error={sErr.graceDays} hint="After the due date, before read-only. 1–90"><input {...sf('graceDays')} type="number" min={1} max={90} /></Field>
          <Field id="bs-renewLeadDays" label="Renewal bill (days before)" error={sErr.renewLeadDays} hint="Also the first reminder"><input {...sf('renewLeadDays')} type="number" min={1} max={60} /></Field>
          <Field id="bs-gstRate" label="GST rate (%)" error={sErr.gstRate}><input {...sf('gstRate')} type="number" min={0} max={28} step="0.01" /></Field>
        </div>
        <h3 className="section-title">Printed on every bill</h3>
        <div className="grid-2">
          <Field id="bs-sellerName" label="Your business name" error={sErr.sellerName}><input {...sf('sellerName')} /></Field>
          <Field id="bs-invoicePrefix" label="Bill number prefix" error={sErr.invoicePrefix} hint="EDU → EDU/2026-27/00001"><input {...sf('invoicePrefix')} /></Field>
        </div>
        <Field id="bs-sellerAddress" label="Address" error={sErr.sellerAddress}><input {...sf('sellerAddress')} /></Field>
        <div className="grid-3">
          <Field id="bs-sellerState" label="State" error={sErr.sellerState} hint="Same state → CGST + SGST; else IGST"><input {...sf('sellerState')} /></Field>
          <Field id="bs-sellerGstin" label="GSTIN" error={sErr.sellerGstin}><input {...sf('sellerGstin')} /></Field>
          <Field id="bs-sacCode" label="SAC code" error={sErr.sacCode} hint="Ask your accountant"><input {...sf('sacCode')} /></Field>
        </div>
        <h3 className="section-title">Where institutions pay</h3>
        <div className="grid-2">
          <Field id="bs-bankAccountName" label="Account name" error={sErr.bankAccountName}><input {...sf('bankAccountName')} /></Field>
          <Field id="bs-bankName" label="Bank and branch" error={sErr.bankName}><input {...sf('bankName')} /></Field>
        </div>
        <div className="grid-3">
          <Field id="bs-bankAccountNo" label="Account number" error={sErr.bankAccountNo}><input {...sf('bankAccountNo')} inputMode="numeric" /></Field>
          <Field id="bs-bankIfsc" label="IFSC" error={sErr.bankIfsc}><input {...sf('bankIfsc')} /></Field>
          <Field id="bs-upiId" label="UPI ID" error={sErr.upiId}><input {...sf('upiId')} /></Field>
        </div>
      </Modal>
    </>
  );
}
