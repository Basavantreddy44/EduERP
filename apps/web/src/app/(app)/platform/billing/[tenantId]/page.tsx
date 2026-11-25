'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { BillingCycle, billingReasonSchema, tenantBillingSchema } from '@eduerp/shared';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { apiErrors, FieldErrors, validate } from '@/lib/form';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { BillingOverview, InvoiceStatus, SaasPayment, inr, useDayText } from '@/components/billing';

interface TenantBilling extends BillingOverview {
  tenant: { id: string; name: string; status: string; billingHold: boolean; graceDays: number | null; gstin: string | null; billingState: string | null; state: string | null; edition: string };
}
const KIND: Record<string, string> = { INVOICE: 'Bill', CANCELLED: 'Bill cancelled', PAYMENT: 'Payment', REVERSAL: 'Payment reversed' };
const MODE: Record<string, string> = { BANK_TRANSFER: 'Bank transfer', UPI: 'UPI', CHEQUE: 'Cheque', CASH: 'Cash', OTHER: 'Other' };

/** One institution's billing in the platform console: its own terms, plan cycle, students and statement. */
export default function TenantBillingPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const { session } = useSession();
  const toast = useToast();
  const day = useDayText();
  const isSuper = session?.user.platformRole === 'SUPER_ADMIN';
  const [d, setD] = useState<TenantBilling | null>(null);
  const [missing, setMissing] = useState(false);
  const [form, setForm] = useState({ graceDays: '', gstin: '', billingState: '' });
  const [errs, setErrs] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [reversing, setReversing] = useState<SaasPayment | null>(null);
  const [reason, setReason] = useState('');
  const [reasonErr, setReasonErr] = useState<string | null>(null);

  const apply = (x: TenantBilling) => {
    setD(x);
    setForm({ graceDays: x.tenant.graceDays == null ? '' : String(x.tenant.graceDays), gstin: x.tenant.gstin ?? '', billingState: x.tenant.billingState ?? '' });
  };
  const load = useCallback(() => { api<TenantBilling>(`/platform/billing/tenants/${tenantId}`).then(apply).catch(() => setMissing(true)); }, [tenantId]);
  useEffect(load, [load]);

  if (!session?.user.platformRole) return <div className="alert">Platform staff only.</div>;
  if (missing) return <EmptyState icon="building" title="Institution not found" />;
  if (!d) return <SkeletonRows rows={8} />;
  const sub = d.subscription;
  const diff = sub ? d.activeStudents - sub.studentCount : 0;

  async function saveTerms() {
    const v = validate(tenantBillingSchema, { graceDays: form.graceDays === '' ? null : Number(form.graceDays), gstin: form.gstin, billingState: form.billingState });
    if (!v.ok) return setErrs(v.errors);
    setBusy(true);
    try {
      const x = await api<TenantBilling>(`/platform/billing/tenants/${tenantId}`, { method: 'PATCH', body: JSON.stringify(v.data) });
      apply(x);
      setErrs({});
      toast(`Saved — grace period ${x.account.graceDays} days${x.tenant.graceDays == null ? ' (platform default)' : ''}`);
    } catch (e) {
      const { fields, message } = apiErrors(e);
      setErrs({ ...fields, ...(message ? { form: message } : {}) });
    } finally {
      setBusy(false);
    }
  }

  async function changeCycle(c: BillingCycle) {
    setBusy(true);
    try {
      await api(`/platform/billing/tenants/${tenantId}/cycle`, { method: 'PATCH', body: JSON.stringify({ billingCycle: c }) });
      toast(`From the next renewal: ${c === 'YEARLY' ? 'yearly' : 'monthly'}`);
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not change', 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function reverse() {
    if (!reversing) return;
    const v = validate(billingReasonSchema, { reason });
    if (!v.ok) return setReasonErr(v.errors.reason ?? 'Give a reason');
    setBusy(true);
    try {
      const r = await api<{ accountChange: string | null }>(`/platform/billing/payments/${reversing.id}/reverse`, { method: 'POST', body: JSON.stringify(v.data) });
      toast(`Payment of ${inr(reversing.amount)} reversed${r.accountChange ? ` — the institution is now ${r.accountChange === 'READ_ONLY' ? 'read-only' : r.accountChange.toLowerCase()}` : ''}`);
      setReversing(null);
      load();
    } catch (e) {
      setReasonErr(e instanceof ApiError ? e.message : 'Could not reverse');
    } finally {
      setBusy(false);
    }
  }

  const o = d.account.overdue;
  return (
    <>
      <Link href="/platform/billing" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> Billing</Link>
      <PageHeader eyebrow="Platform console · Billing" title={d.tenant.name} description={<span className="manage-sub"><StatusBadge status={d.tenant.status} /> {d.tenant.status === 'SUSPENDED' && (d.tenant.billingHold ? 'read-only for an unpaid bill' : 'suspended by hand')}</span>} />

      {o && (
        <div className={`notice ${d.tenant.status === 'SUSPENDED' ? 'notice-bad' : 'notice-warn'}`} role="status">
          <Icon name="alert" />
          <span>{o.kind === 'TRIAL' ? `Trial ended; read-only after ${day(o.lastDay)}.` : `${inr(o.amount)} overdue since ${day(o.dueDate)} (${o.invoiceNo}). ${d.tenant.status === 'SUSPENDED' ? 'Read-only until paid.' : `Read-only after ${day(o.lastDay)}.`}`}</span>
        </div>
      )}

      <div className="stats bill-stats">
        <div className="stat"><span className="stat-label">Plan</span><span className="stat-value">{sub?.plan.name ?? '—'}</span><span className="stat-hint">{sub ? `${sub.billingCycle === 'YEARLY' ? 'Yearly' : 'Monthly'} · ${inr(sub.rate)} per student${sub.nextCycle ? ` · ${sub.nextCycle === 'YEARLY' ? 'yearly' : 'monthly'} from the next renewal` : ''}` : 'No plan assigned'}</span></div>
        <div className="stat"><span className="stat-label">{sub?.status === 'TRIAL' ? 'Trial until' : 'Paid until'}</span><span className="stat-value">{sub ? day(sub.endDate) : '—'}</span><span className="stat-hint">{sub ? `since ${day(sub.startDate)}` : ''}</span></div>
        <div className={`stat ${diff > 0 ? 'stat-warn' : ''}`}><span className="stat-label">Students</span><span className="stat-value">{d.activeStudents} <span className="muted small">active</span></span><span className="stat-hint">{sub ? (diff > 0 ? `${diff} more than the ${sub.studentCount} billed — counted at the next renewal` : `${sub.studentCount} billed`) : ''}</span></div>
        <div className={`stat ${d.balance > 0 ? 'stat-warn' : ''}`}><span className="stat-label">Balance due</span><span className="stat-value">{inr(d.balance)}</span><span className="stat-hint">{d.account.upcoming ? `next due ${day(d.account.upcoming.dueDate)}` : ''}</span></div>
      </div>

      <div className="grid-2 bill-grid">
        <section className="card" aria-labelledby="tb-terms">
          <h2 className="card-title" id="tb-terms">Billing terms for this institution</h2>
          <div className="grid-2">
            <Field id="tb-grace" label="Own grace period (days)" error={errs.graceDays} hint="Empty = the platform default">
              <input id="tb-grace" type="number" min={1} max={90} value={form.graceDays} onChange={(e) => setForm({ ...form, graceDays: e.target.value })} disabled={!isSuper} />
            </Field>
            <Field id="tb-state" label="Billing state" error={errs.billingState} hint={`Empty = ${d.tenant.state ?? 'seller state'}`}>
              <input id="tb-state" value={form.billingState} onChange={(e) => setForm({ ...form, billingState: e.target.value })} disabled={!isSuper} />
            </Field>
          </div>
          <Field id="tb-gstin" label="Institution GSTIN (if registered)" error={errs.gstin}>
            <input id="tb-gstin" value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} disabled={!isSuper} />
          </Field>
          {errs.form && <p className="err" role="alert">{errs.form}</p>}
          {isSuper && <button type="button" className="btn btn-primary" onClick={saveTerms} disabled={busy}>Save terms</button>}
        </section>

        <section className="card" aria-labelledby="tb-cycle">
          <h2 className="card-title" id="tb-cycle">Monthly or yearly</h2>
          {!sub ? <p className="muted">Assign a plan under Institutions first.</p> : (
            <>
              <p className="muted small">The institution can choose this itself under Settings → Subscription & bills. A change applies from the next renewal ({day(sub.endDate)}).</p>
              <div className="chip-row">
                {(['MONTHLY', 'YEARLY'] as const).map((c) => {
                  const price = c === 'MONTHLY' ? sub.plan.monthly : sub.plan.yearly;
                  const chosen = (sub.nextCycle ?? sub.billingCycle) === c;
                  return (
                    <button key={c} type="button" className={`btn ${chosen ? 'btn-primary' : ''}`} disabled={!isSuper || busy || price == null || chosen} onClick={() => changeCycle(c)}>
                      {c === 'YEARLY' ? 'Yearly' : 'Monthly'} · {price == null ? 'not offered' : `${inr(price, false)}/student`}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>

      <section className="card" aria-labelledby="tb-inv">
        <h2 className="card-title" id="tb-inv">Bills</h2>
        {d.invoices.length === 0 ? <p className="muted">No bills yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Bill</th><th>Period</th><th className="num">Total</th><th>Due</th><th>Status</th><th className="num">Balance</th></tr></thead>
              <tbody>{d.invoices.map((i) => (
                <tr key={i.id}>
                  <td><Link className="mono" href={`/platform/billing/invoices/${i.id}`}>{i.invoiceNo}</Link></td>
                  <td>{day(i.periodStart)} – {day(i.periodEnd)}<span className="sub-line muted small">{i.studentCount} × {inr(i.rate)}</span></td>
                  <td className="num">{inr(i.total)}</td><td>{day(i.dueDate)}</td><td><InvoiceStatus inv={i} /></td><td className="num">{i.balance > 0 ? inr(i.balance) : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="tb-pay">
        <h2 className="card-title" id="tb-pay">Payments</h2>
        {d.payments.length === 0 ? <p className="muted">No payments yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Received</th><th>Bill</th><th>How</th><th>Reference</th><th className="num">Amount</th><th>Status</th><th /></tr></thead>
              <tbody>{d.payments.map((p) => (
                <tr key={p.id} className={p.status === 'REVERSED' ? 'row-dim' : ''}>
                  <td>{day(p.paidOn)}</td><td className="mono">{p.invoiceNo}</td><td>{MODE[p.mode] ?? p.mode}</td><td className="mono">{p.reference ?? '—'}</td><td className="num">{inr(p.amount)}</td>
                  <td><StatusBadge status={p.status} label={p.status === 'REVERSED' ? 'Reversed' : 'Received'} />{p.reverseReason && <span className="sub-line muted small">{p.reverseReason}</span>}</td>
                  <td className="num">{isSuper && p.status === 'RECORDED' && <button className="btn btn-sm" onClick={() => { setReversing(p); setReason(''); setReasonErr(null); }} aria-label={`Reverse payment ${p.reference ?? inr(p.amount)}`}>Reverse</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="tb-st">
        <h2 className="card-title" id="tb-st">Statement</h2>
        {d.statement.length === 0 ? <p className="muted">Nothing yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Entry</th><th>Reference</th><th className="num">Billed</th><th className="num">Paid</th><th className="num">Balance</th></tr></thead>
              <tbody>{d.statement.map((l, n) => (
                <tr key={n}><td>{day(l.date)}</td><td>{KIND[l.kind]}</td><td className="mono">{l.ref}</td><td className="num">{l.debit ? inr(l.debit) : ''}</td><td className="num">{l.credit ? inr(l.credit) : ''}</td><td className="num"><strong>{inr(l.balance)}</strong></td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <Modal open={!!reversing} onClose={() => setReversing(null)} title="Reverse payment" subtitle={reversing ? `${inr(reversing.amount)} on ${reversing.invoiceNo} — for example a bounced cheque. The bill becomes due again.` : ''} onSubmit={reverse} submitLabel="Reverse payment" busy={busy} danger>
        <Field id="rv-reason" label="Reason (kept in the institution's audit log)" error={reasonErr ?? undefined}><input id="rv-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
      </Modal>
    </>
  );
}
