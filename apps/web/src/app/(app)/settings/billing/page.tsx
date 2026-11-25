'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BillingCycle, PERMISSIONS } from '@eduerp/shared';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { BillingOverview, InvoiceStatus, inr, useDayText } from '@/components/billing';

/** Settings → Subscription & bills (Phase 22): plan, monthly or yearly, bills, payments and how to pay. */
export default function MyBillingPage() {
  const { can } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const day = useDayText();
  const [o, setO] = useState<BillingOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [cycle, setCycle] = useState<BillingCycle | ''>('');
  const [saving, setSaving] = useState(false);
  const allowed = can(PERMISSIONS.ORG_BILLING);

  const load = useCallback(() => {
    api<BillingOverview>('/billing').then((x) => { setO(x); setCycle(x.subscription ? (x.subscription.nextCycle ?? x.subscription.billingCycle) : ''); }).catch(() => setFailed(true));
  }, []);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  if (!allowed) return <EmptyState icon="lock" title={t('bill.noAccess')} text={t('bill.noAccessText')} />;
  if (failed) return <EmptyState icon="alert" title={t('bill.loadFailed')} />;
  if (!o) return <SkeletonRows rows={6} />;

  const sub = o.subscription;
  const acc = o.account;
  const pending = sub?.nextCycle ?? sub?.billingCycle;
  const readOnly = acc.status === 'SUSPENDED';

  async function saveCycle() {
    if (!cycle) return;
    setSaving(true);
    try {
      const x = await api<BillingOverview>('/billing/cycle', { method: 'PUT', body: JSON.stringify({ billingCycle: cycle }) });
      setO(x);
      toast(t('bill.cycleSaved', { cycle: t(cycle === 'YEARLY' ? 'bill.yearly' : 'bill.monthly') }));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('bill.saveFailed'), 'bad');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow={t('nav.settings')} title={t('bill.title')} description={t('bill.subtitle')} />

      {acc.overdue && (
        <div className={`notice ${readOnly ? 'notice-bad' : 'notice-warn'}`} role="status">
          <Icon name={readOnly ? 'lock' : 'alert'} />
          <span>
            {acc.overdue.kind === 'TRIAL'
              ? t('bill.trialEnded', { last: day(acc.overdue.lastDay) })
              : readOnly
                ? t('bill.readOnlyNow', { amount: inr(acc.overdue.amount) })
                : t('bill.overdueNow', { amount: inr(acc.overdue.amount), due: day(acc.overdue.dueDate), last: day(acc.overdue.lastDay) })}
          </span>
        </div>
      )}

      <div className="stats bill-stats">
        <div className="stat">
          <span className="stat-label">{t('bill.plan')}</span>
          <span className="stat-value">{sub ? sub.plan.name : '—'}</span>
          <span className="stat-hint">{sub ? `${t(sub.billingCycle === 'YEARLY' ? 'bill.yearly' : 'bill.monthly')} · ${inr(sub.rate, false)} ${t(sub.billingCycle === 'YEARLY' ? 'bill.perStudentYear' : 'bill.perStudentMonth')}` : t('bill.noPlan')}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{sub?.status === 'TRIAL' ? t('bill.trialUntil') : t('bill.paidUntil')}</span>
          <span className="stat-value">{sub ? day(sub.endDate) : '—'}</span>
          <span className="stat-hint">{sub ? t('bill.studentsBilled', { n: sub.studentCount, active: o.activeStudents }) : ''}</span>
        </div>
        <div className={`stat ${o.balance > 0 ? 'stat-warn' : ''}`}>
          <span className="stat-label">{t('bill.balanceDue')}</span>
          <span className="stat-value">{inr(o.balance)}</span>
          <span className="stat-hint">{acc.upcoming ? t('bill.nextDue', { no: acc.upcoming.invoiceNo, due: day(acc.upcoming.dueDate) }) : o.balance > 0 ? t('bill.payNow') : t('bill.allPaid')}</span>
        </div>
      </div>

      <div className="grid-2 bill-grid">
        <section className="card" aria-labelledby="bill-cycle-h">
          <h2 className="card-title" id="bill-cycle-h">{t('bill.cycleTitle')}</h2>
          {!sub ? <p className="muted">{t('bill.noPlanText')}</p> : (
            <>
              <p className="muted small">{t('bill.cycleHelp', { date: day(sub.endDate) })}</p>
              <fieldset className="bill-cycles">
                <legend className="sr-only">{t('bill.cycleTitle')}</legend>
                {(['MONTHLY', 'YEARLY'] as const).map((c) => {
                  const price = c === 'MONTHLY' ? sub.plan.monthly : sub.plan.yearly;
                  return (
                    <label key={c} className={`bill-cycle ${cycle === c ? 'on' : ''} ${price == null ? 'off' : ''}`}>
                      <input type="radio" name="bill-cycle" value={c} checked={cycle === c} disabled={price == null || readOnly} onChange={() => setCycle(c)} />
                      <span className="bill-cycle-name">{t(c === 'YEARLY' ? 'bill.yearly' : 'bill.monthly')}{sub.billingCycle === c && <span className="tag">{t('bill.now')}</span>}</span>
                      <span className="bill-cycle-price">{price == null ? t('bill.notOffered') : `${inr(price, false)} ${t(c === 'YEARLY' ? 'bill.perStudentYear' : 'bill.perStudentMonth')}`}</span>
                    </label>
                  );
                })}
              </fieldset>
              {sub.nextCycle && <p className="small"><Icon name="info" size={14} /> {t('bill.cyclePending', { cycle: t(sub.nextCycle === 'YEARLY' ? 'bill.yearly' : 'bill.monthly') })}</p>}
              <button type="button" className="btn btn-primary" onClick={saveCycle} disabled={saving || readOnly || !cycle || cycle === pending}>{t('bill.saveCycle')}</button>
            </>
          )}
        </section>

        <section className="card" aria-labelledby="bill-pay-h">
          <h2 className="card-title" id="bill-pay-h">{t('bill.howToPay')}</h2>
          {o.payTo.bankAccountNo || o.payTo.upiId ? (
            <dl className="saas-bank">
              {o.payTo.bankAccountNo && <>
                <div><dt>{t('bill.accountName')}</dt><dd>{o.payTo.bankAccountName ?? o.payTo.name}</dd></div>
                <div><dt>{t('bill.accountNo')}</dt><dd className="mono">{o.payTo.bankAccountNo}</dd></div>
                <div><dt>IFSC</dt><dd className="mono">{o.payTo.bankIfsc ?? '—'}</dd></div>
                <div><dt>{t('bill.bank')}</dt><dd>{o.payTo.bankName ?? '—'}</dd></div>
              </>}
              {o.payTo.upiId && <div><dt>UPI</dt><dd className="mono">{o.payTo.upiId}</dd></div>}
            </dl>
          ) : <p className="muted small">{t('bill.noBankYet')}</p>}
          <p className="muted small">{t('bill.payNote')}</p>
          <p className="soon-line small"><Icon name="rupee" size={14} /> {t('bill.payOnline')} <span className="soon-badge">{t('common.comingSoon')}</span></p>
        </section>
      </div>

      <section className="card" aria-labelledby="bill-inv-h">
        <h2 className="card-title" id="bill-inv-h">{t('bill.invoices')}</h2>
        {o.invoices.length === 0 ? <p className="muted">{t('bill.noInvoices')}</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t('bill.invoiceNo')}</th><th>{t('bill.period')}</th><th className="num">{t('bill.students')}</th><th className="num">{t('bill.total')}</th><th>{t('bill.dueOn')}</th><th>{t('common.status')}</th><th className="num">{t('bill.balanceDue')}</th><th /></tr></thead>
              <tbody>
                {o.invoices.map((i) => (
                  <tr key={i.id}>
                    <td className="mono">{i.invoiceNo}</td>
                    <td>{day(i.periodStart)} – {day(i.periodEnd)}<span className="sub-line muted small">{t(i.billingCycle === 'YEARLY' ? 'bill.yearly' : 'bill.monthly')} · {i.planName}</span></td>
                    <td className="num">{i.studentCount}</td>
                    <td className="num">{inr(i.total)}</td>
                    <td>{day(i.dueDate)}</td>
                    <td><InvoiceStatus inv={i} /></td>
                    <td className="num">{i.balance > 0 ? inr(i.balance) : '—'}</td>
                    <td className="num"><Link className="btn btn-sm" href={`/settings/billing/invoices/${i.id}`} aria-label={`${t('bill.view')} ${i.invoiceNo}`}>{t('bill.view')}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="bill-pmt-h">
        <h2 className="card-title" id="bill-pmt-h">{t('bill.payments')}</h2>
        {o.payments.length === 0 ? <p className="muted">{t('bill.noPayments')}</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t('bill.paidOn')}</th><th>{t('bill.invoiceNo')}</th><th>{t('bill.mode')}</th><th>{t('bill.reference')}</th><th className="num">{t('fee.acct.amount')}</th><th>{t('common.status')}</th></tr></thead>
              <tbody>
                {o.payments.map((p) => (
                  <tr key={p.id} className={p.status === 'REVERSED' ? 'row-dim' : ''}>
                    <td>{day(p.paidOn)}</td>
                    <td className="mono">{p.invoiceNo}</td>
                    <td>{t(`bill.mode.${p.mode}` as MessageKey)}</td>
                    <td className="mono">{p.reference ?? '—'}</td>
                    <td className="num">{inr(p.amount)}</td>
                    <td><StatusBadge status={p.status} label={t(`bill.pst.${p.status}` as MessageKey)} />{p.reverseReason && <span className="sub-line muted small">{p.reverseReason}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
