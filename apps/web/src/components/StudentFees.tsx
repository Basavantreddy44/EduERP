'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CONCESSION_TYPES, concessionSchema, extraChargeSchema, formatINR } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors, validate } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from './Icon';
import { Field, Modal } from './Modal';
import { SkeletonRows, StatusBadge, useToast } from './ui';
import { useDay, todayIST } from './admissions';
import { FeeHead, amountOk, paiseOf, useFeeOptions } from './fees';

interface Item { id: string; feeHeadId: string; amount: string; concession: string; fine: string; netAmount: string; paidAmount: string; feeHead: { name: string; code: string } }
interface Invoice {
  id: string; invoiceNo: string; description: string; instalmentNo: number | null; invoiceDate: string; dueDate: string; status: string;
  grossAmount: string; concessionAmount: string; fineAmount: string; netAmount: string; paidAmount: string; balanceAmount: string; cancelReason: string | null; fineWaived: boolean; fineWaiveReason: string | null;
  items: Item[]; academicYear: { name: string };
}
interface Concession {
  id: string; concessionType: string; valueType: 'PERCENT' | 'AMOUNT'; value: string; reason: string; status: string; decisionRemarks: string | null; createdAt: string;
  feeHead: { name: string } | null; academicYear: { name: string };
}
interface Pay { id: string; receiptNo: string; paymentDate: string; amount: string; paymentMode: string; referenceNo: string | null; status: string; cancelledReason: string | null; payerName: string }
interface Account {
  student: { id: string; firstName: string; lastName: string | null; admissionNo: string };
  year: { id: string; name: string } | null;
  assignment: { structure: { id: string; name: string; feeGroup: string | null; totalAmount: string } } | null;
  structureOptions: { id: string; name: string; feeGroup: string | null; totalAmount: string }[];
  totals: { billed: string; concession: string; fine: string; net: string; paid: string; balance: string; overdue: string };
  invoices: Invoice[];
  concessions: Concession[];
  payments: Pay[];
  canBill: boolean;
  canCollect: boolean;
  canCancelReceipt: boolean;
  canRequestConcession: boolean;
}
interface PayLink { id: string; amount: string; status: string; expiresAt: string; sentTo: string | null; createdAt: string }
interface RefundRow { id: string; amount: string; reason: string; refundMode: string; status: string; failureReason: string | null; createdAt: string; payment: { receiptNo: string; paymentMode: string } }
type Dialog = null | 'plan' | 'charge' | 'concession' | 'link' | { waive: Invoice } | { bill: Invoice } | { cancel: Invoice } | { stop: Concession } | { undo: Pay; kind: 'cancel' | 'bounce' } | { refund: Pay };

const inr = (v: string) => formatINR(paiseOf(v));

/** The Fees tab of a student profile: fee plan, bills, concessions and the balance. */
export function StudentFees({ studentId }: { studentId: string }) {
  const { t } = useI18n();
  const { opts } = useFeeOptions();
  const heads = opts?.heads ?? [];
  const toast = useToast();
  const day = useDay();
  const [acc, setAcc] = useState<Account | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  const [gateway, setGateway] = useState<string>('off');
  const [links, setLinks] = useState<PayLink[]>([]);
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const load = useCallback(() => {
    api<Account>('/fees/students/' + studentId).then(setAcc).catch(() => setAcc(null));
    api<PayLink[]>('/fees/students/' + studentId + '/pay-links').then(setLinks).catch(() => setLinks([]));
    api<RefundRow[]>('/fees/students/' + studentId + '/refunds').then(setRefunds).catch(() => setRefunds([]));
  }, [studentId]);
  useEffect(() => { api<{ gateway: string }>('/fees/online/status').then((r) => setGateway(r.gateway)).catch(() => setGateway('off')); }, []);
  useEffect(load, [load]);
  const open = (d: Dialog) => { setError(null); setErrors({}); setDialog(d); };
  async function run(work: () => Promise<unknown>, done: string) {
    setBusy(true); setError(null);
    try { await work(); toast(done); setDialog(null); load(); } catch (e) { const r = apiErrors(e); setErrors(r.fields); setError(r.message); } finally { setBusy(false); }
  }

  if (!acc) return <SkeletonRows rows={4} />;
  const today = todayIST();
  const overdue = paiseOf(acc.totals.overdue) > 0;
  const activeHeads = heads.filter((h) => h.status === 'ACTIVE');
  const concText = (c: Concession) => `${c.valueType === 'PERCENT' ? `${Number(c.value)}%` : inr(c.value)} · ${c.feeHead?.name ?? t('fee.conc.allHeads')}`;

  return (
    <div className="fees-tab">
      <div className="fee-tiles">
        <div className="fee-tile"><span>{t('fee.acct.billed')}</span><strong>{inr(acc.totals.billed)}</strong></div>
        <div className="fee-tile"><span>{t('fee.acct.concession')}</span><strong>{inr(acc.totals.concession)}</strong></div>
        <div className="fee-tile"><span>{t('fee.acct.paid')}</span><strong>{inr(acc.totals.paid)}</strong></div>
        <div className={`fee-tile due ${paiseOf(acc.totals.balance) > 0 ? 'has' : ''}`}>
          <span>{t('fee.acct.balance')}</span><strong>{inr(acc.totals.balance)}</strong>
          {overdue && <em><Icon name="alert" size={13} /> {t('fee.acct.overdue', { v: inr(acc.totals.overdue) })}</em>}
          {!paiseOf(acc.totals.balance) && acc.invoices.some((i) => i.status !== 'CANCELLED') && <em className="no-dues"><Icon name="check" size={13} /> {t('fee.due.clear')}</em>}
        </div>
      </div>

      <div className="fee-plan">
        <span className="muted small">{t('fee.acct.plan', { year: acc.year?.name ?? '' })}</span>
        {acc.assignment ? (
          <strong>{acc.assignment.structure.name}{acc.assignment.structure.feeGroup && <span className="chip chip-sm chip-gold">{acc.assignment.structure.feeGroup}</span>}<span className="muted"> · {inr(acc.assignment.structure.totalAmount)} {t('fee.acct.perYear')}</span></strong>
        ) : <strong className="muted">{t('fee.acct.noPlan')}</strong>}
        <span className="fee-plan-actions">
          {acc.canBill && acc.structureOptions.length > 0 && <button type="button" className="btn btn-sm" onClick={() => open('plan')}><Icon name="swap" size={15} /> {t('fee.acct.changePlan')}</button>}
          {acc.canBill && <button type="button" className="btn btn-sm" onClick={() => open('charge')}><Icon name="plus" size={15} /> {t('fee.acct.extra')}</button>}
          {acc.canRequestConcession && acc.year && <button type="button" className="btn btn-sm" onClick={() => open('concession')}><Icon name="star" size={15} /> {t('fee.conc.request')}</button>}
          {acc.canCollect && paiseOf(acc.totals.balance) > 0 && gateway !== 'off' && <button type="button" className="btn btn-sm" onClick={() => open('link')}><Icon name="mail" size={15} /> {t('fee.link.create')}</button>}
          {acc.canCollect && paiseOf(acc.totals.balance) > 0 && <a className="btn btn-sm btn-primary" href={'/fees/collect?student=' + studentId}><Icon name="receipt" size={15} /> {t('fee.col.collectHere')}</a>}
        </span>
      </div>

      <h3 className="module-group-name">{t('fee.acct.bills')} · {acc.invoices.length}</h3>
      {acc.invoices.length === 0 ? <p className="muted small">{t('fee.acct.noBills')}</p> : (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">{t('fee.acct.bills')}</caption>
            <thead>
              <tr><th scope="col">{t('fee.acct.bill')}</th><th scope="col">{t('fee.acct.due')}</th><th scope="col" className="num">{t('fee.acct.amount')}</th><th scope="col" className="num hide-sm">{t('fee.acct.concession')}</th><th scope="col" className="num">{t('fee.acct.balance')}</th><th scope="col">{t('common.status')}</th><th scope="col"><span className="sr-only">{t('common.open')}</span></th></tr>
            </thead>
            <tbody>
              {acc.invoices.map((i) => {
                const late = i.status !== 'CANCELLED' && paiseOf(i.balanceAmount) > 0 && i.dueDate.slice(0, 10) < today;
                return (
                  <tr key={i.id} className={i.status === 'CANCELLED' ? 'row-muted' : undefined}>
                    <td><strong>{i.description}</strong><span className="sub-line muted mono">{i.invoiceNo}</span></td>
                    <td className={late ? 'overdue-text' : ''}>{day(i.dueDate)}{late && <span className="sub-line">{t('fee.acct.overdueShort')}</span>}</td>
                    <td className="num">{inr(i.grossAmount)}</td>
                    <td className="num hide-sm">{paiseOf(i.concessionAmount) ? `−${inr(i.concessionAmount)}` : <span className="muted">—</span>}</td>
                    <td className="num strong">{i.status === 'CANCELLED' ? <span className="muted">—</span> : inr(i.balanceAmount)}</td>
                    <td><StatusBadge status={i.status === 'PAID' && paiseOf(i.paidAmount) === 0 ? 'WAIVED' : i.status} /></td>
                    <td className="num"><button type="button" className="btn btn-sm btn-ghost" onClick={() => open({ bill: i })} aria-label={`${t('common.open')} ${i.invoiceNo}`}><Icon name="chevronRight" size={16} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="module-group-name">{t('fee.rc.list')} · {acc.payments.length}</h3>
      {acc.payments.length === 0 ? <p className="muted small">{t('fee.rc.none')}</p> : (
        <ul className="conc-list">
          {acc.payments.map((pm) => (
            <li key={pm.id}>
              <span className="conc-main">
                <strong>{inr(pm.amount)} · {t(('fee.mode.' + pm.paymentMode) as MessageKey)}{pm.referenceNo ? ' ' + pm.referenceNo : ''}</strong>
                <span className="sub-line muted"><span className="mono">{pm.receiptNo}</span> · {day(pm.paymentDate)} · {pm.payerName}{pm.cancelledReason ? ' · ' + pm.cancelledReason : ''}</span>
              </span>
              <StatusBadge status={pm.status === 'SUCCESS' ? 'PAID' : pm.status} label={pm.status === 'SUCCESS' ? t('fee.col.received') : undefined} />
              <a className="btn btn-sm btn-ghost" href={'/fees/receipts/' + pm.id} target="_blank" rel="noreferrer" aria-label={t('fee.col.print') + ' ' + pm.receiptNo}><Icon name="receipt" size={15} /></a>
              {acc.canCollect && pm.status === 'SUCCESS' && <button type="button" className="btn btn-sm btn-ghost" onClick={() => open({ refund: pm })}>{t('fee.ref.request')}</button>}
              {acc.canCancelReceipt && pm.status === 'SUCCESS' && pm.paymentMode !== 'ONLINE' && (
                <span className="row-actions">
                  {['CHEQUE', 'DD'].includes(pm.paymentMode) && <button type="button" className="btn btn-sm btn-ghost" onClick={() => open({ undo: pm, kind: 'bounce' })}>{t('fee.rc.bounce')}</button>}
                  <button type="button" className="btn btn-sm btn-ghost danger-text" onClick={() => open({ undo: pm, kind: 'cancel' })}>{t('fee.rc.cancel')}</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {refunds.length > 0 && (
        <>
          <h3 className="module-group-name">{t('fee.ref.title')} · {refunds.length}</h3>
          <ul className="conc-list">
            {refunds.map((r) => (
              <li key={r.id}>
                <span className="conc-main">
                  <strong>{inr(r.amount)} · {t(('fee.ref.mode.' + r.refundMode) as MessageKey)}</strong>
                  <span className="sub-line muted"><span className="mono">{r.payment.receiptNo}</span> · {day(r.createdAt)} · {r.reason}{r.failureReason ? ' · ' + r.failureReason : ''}</span>
                </span>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        </>
      )}

      {links.length > 0 && (
        <>
          <h3 className="module-group-name">{t('fee.link.title')} · {links.length}</h3>
          <ul className="conc-list">
            {links.slice(0, 5).map((l) => (
              <li key={l.id}>
                <span className="conc-main">
                  <strong>{inr(l.amount)}</strong>
                  <span className="sub-line muted">{day(l.createdAt)} · {t('fee.link.until', { date: day(l.expiresAt) })}{l.sentTo ? ' · ' + t('fee.link.emailedTo', { to: l.sentTo }) : ''}</span>
                </span>
                <StatusBadge status={l.status} />
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="module-group-name">{t('fee.conc.title')} · {acc.concessions.length}</h3>
      {acc.concessions.length === 0 ? <p className="muted small">{t('fee.conc.none')}</p> : (
        <ul className="conc-list">
          {acc.concessions.map((c) => (
            <li key={c.id}>
              <span className="conc-main">
                <strong>{concText(c)}</strong>
                <span className="sub-line muted">{t(`fee.conc.type.${c.concessionType}` as MessageKey)} · {c.academicYear.name} · {c.reason}</span>
                {c.decisionRemarks && <span className="sub-line small">“{c.decisionRemarks}”</span>}
              </span>
              <StatusBadge status={c.status} />
              {acc.canBill && c.status === 'APPROVED' && <button type="button" className="btn btn-sm btn-ghost" onClick={() => open({ stop: c })}>{t('fee.conc.stop')}</button>}
            </li>
          ))}
        </ul>
      )}

      {dialog === 'plan' && <PlanDialog acc={acc} busy={busy} error={error} onClose={() => setDialog(null)} onSave={(id) => run(() => api(`/fees/students/${studentId}/assignment`, { method: 'POST', body: JSON.stringify({ feeStructureId: id }) }), t('fee.acct.planSaved'))} />}
      {dialog === 'charge' && <ChargeDialog heads={activeHeads} busy={busy} error={error} errors={errors} setErrors={setErrors} onClose={() => setDialog(null)} onSave={(b) => run(() => api(`/fees/students/${studentId}/charges`, { method: 'POST', body: JSON.stringify(b) }), t('fee.acct.chargeSaved'))} />}
      {dialog === 'concession' && acc.year && <ConcessionDialog yearId={acc.year.id} yearName={acc.year.name} heads={activeHeads} busy={busy} error={error} errors={errors} setErrors={setErrors} onClose={() => setDialog(null)} onSave={(b) => run(() => api(`/fees/students/${studentId}/concessions`, { method: 'POST', body: JSON.stringify(b) }), t('fee.conc.sent'))} />}
      {dialog && typeof dialog === 'object' && 'bill' in dialog && (
        <Modal open hideCancel wide onClose={() => setDialog(null)} title={dialog.bill.description} subtitle={`${dialog.bill.invoiceNo} · ${t('fee.acct.billedOn', { date: day(dialog.bill.invoiceDate) })} · ${t('fee.acct.dueOn', { date: day(dialog.bill.dueDate) })}`}
          submitLabel={t('common.close')} onSubmit={(e) => { e.preventDefault(); setDialog(null); }}>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">{dialog.bill.invoiceNo}</caption>
              <thead><tr><th scope="col">{t('fee.tab.heads')}</th><th scope="col" className="num">{t('fee.acct.amount')}</th><th scope="col" className="num">{t('fee.acct.concession')}</th><th scope="col" className="num">{t('fee.due.lateFee')}</th><th scope="col" className="num">{t('fee.acct.payable')}</th></tr></thead>
              <tbody>
                {dialog.bill.items.map((it) => (
                  <tr key={it.id}><td>{it.feeHead.name}</td><td className="num">{inr(it.amount)}</td><td className="num">{paiseOf(it.concession) ? `−${inr(it.concession)}` : '—'}</td><td className="num">{paiseOf(it.fine) ? `+${inr(it.fine)}` : '—'}</td><td className="num strong">{inr(it.netAmount)}</td></tr>
                ))}
              </tbody>
              <tfoot>
                <tr><th scope="row">{t('fee.struct.total')}</th><td className="num">{inr(dialog.bill.grossAmount)}</td><td className="num">{paiseOf(dialog.bill.concessionAmount) ? `−${inr(dialog.bill.concessionAmount)}` : '—'}</td><td className="num">{paiseOf(dialog.bill.fineAmount) ? `+${inr(dialog.bill.fineAmount)}` : '—'}</td><td className="num strong">{inr(dialog.bill.netAmount)}</td></tr>
              </tfoot>
            </table>
          </div>
          {dialog.bill.fineWaived && <p className="note-info"><Icon name="info" size={15} /> {t('fee.due.waivedBecause', { reason: dialog.bill.fineWaiveReason ?? '' })}</p>}
          {acc.canBill && paiseOf(dialog.bill.fineAmount) > 0 && !dialog.bill.fineWaived && dialog.bill.status !== 'CANCELLED' && (
            <div className="action-row"><button type="button" className="btn" onClick={() => open({ waive: (dialog as { bill: Invoice }).bill })}><Icon name="x" size={16} /> {t('fee.due.waive', { v: inr(dialog.bill.fineAmount) })}</button></div>
          )}
          {dialog.bill.status === 'CANCELLED' && <p className="note-warn"><Icon name="info" size={15} /> {t('fee.acct.cancelledBecause', { reason: dialog.bill.cancelReason ?? '' })}</p>}
          {acc.canBill && dialog.bill.status === 'UNPAID' && paiseOf(dialog.bill.paidAmount) === 0 && (
            <div className="action-row"><button type="button" className="btn btn-danger" onClick={() => open({ cancel: (dialog as { bill: Invoice }).bill })}><Icon name="x" size={16} /> {t('fee.acct.cancelBill')}</button></div>
          )}
        </Modal>
      )}
      {dialog && typeof dialog === 'object' && 'cancel' in dialog && (
        <CancelDialog inv={dialog.cancel} busy={busy} error={error} errors={errors} setErrors={setErrors} onClose={() => setDialog(null)} onSave={(reason) => run(() => api(`/fees/invoices/${(dialog as { cancel: Invoice }).cancel.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }), t('fee.acct.billCancelled'))} />
      )}
      {dialog && typeof dialog === 'object' && 'undo' in dialog && (
        <UndoDialog p={dialog.undo} kind={dialog.kind} heads={activeHeads} busy={busy} error={error} errors={errors} setErrors={setErrors} onClose={() => setDialog(null)}
          onSave={(b) => { const d = dialog as { undo: Pay; kind: 'cancel' | 'bounce' }; return run(() => api('/fees/payments/' + d.undo.id + '/' + d.kind, { method: 'POST', body: JSON.stringify(b) }), d.kind === 'bounce' ? t('fee.rc.bounced') : t('fee.rc.cancelled')); }} />
      )}
      {dialog === 'link' && <LinkDialog studentId={studentId} due={acc.totals.balance} onClose={() => { setDialog(null); load(); }} />}
      {dialog && typeof dialog === 'object' && 'refund' in dialog && (
        <RefundDialog p={dialog.refund} busy={busy} error={error} errors={errors} setErrors={setErrors} onClose={() => setDialog(null)}
          onSave={(b) => run(() => api('/fees/payments/' + (dialog as { refund: Pay }).refund.id + '/refunds', { method: 'POST', body: JSON.stringify(b) }), t('fee.ref.sent'))} />
      )}
      {dialog && typeof dialog === 'object' && 'waive' in dialog && (
        <WaiveDialog inv={dialog.waive} busy={busy} error={error} errors={errors} setErrors={setErrors} onClose={() => setDialog(null)}
          onSave={(reason) => run(() => api('/fees/invoices/' + (dialog as { waive: Invoice }).waive.id + '/waive-fine', { method: 'POST', body: JSON.stringify({ reason }) }), t('fee.due.waived'))} />
      )}
      {dialog && typeof dialog === 'object' && 'stop' in dialog && (
        <Modal open danger onClose={() => setDialog(null)} title={t('fee.conc.stopTitle')} subtitle={concText(dialog.stop)} submitLabel={t('fee.conc.stop')} busy={busy} error={error}
          onSubmit={(e) => { e.preventDefault(); void run(() => api(`/fees/concessions/${(dialog as { stop: Concession }).stop.id}/cancel`, { method: 'POST', body: '{}' }), t('fee.conc.stopped')); }}>
          <p>{t('fee.conc.stopText')}</p>
        </Modal>
      )}
    </div>
  );
}

interface DlgProps { busy: boolean; error: string | null; onClose: () => void }

function PlanDialog({ acc, busy, error, onClose, onSave }: DlgProps & { acc: Account; onSave: (id: string) => void }) {
  const { t } = useI18n();
  const [v, setV] = useState(acc.assignment?.structure.id ?? '');
  return (
    <Modal open onClose={onClose} title={t('fee.acct.changePlan')} subtitle={`${acc.student.firstName} ${acc.student.lastName ?? ''} · ${acc.year?.name ?? ''}`} submitLabel={t('common.save')} busy={busy} error={error}
      onSubmit={(e) => { e.preventDefault(); if (v) onSave(v); }}>
      <p className="muted small">{t('fee.acct.planHint')}</p>
      <div className="choice-list">
        {acc.structureOptions.map((o) => (
          <label key={o.id} className={`choice ${v === o.id ? 'on' : ''}`}>
            <input type="radio" name="plan" checked={v === o.id} onChange={() => setV(o.id)} />
            <span><strong>{o.name}</strong><span className="sub-line muted">{o.feeGroup ?? t('fee.acct.defaultPlan')} · {inr(o.totalAmount)} {t('fee.acct.perYear')}</span></span>
          </label>
        ))}
      </div>
    </Modal>
  );
}

function ChargeDialog({ heads, busy, error, errors, setErrors, onClose, onSave }: DlgProps & { heads: FeeHead[]; errors: FieldErrors; setErrors: (e: FieldErrors) => void; onSave: (b: object) => void }) {
  const { t } = useI18n();
  const [v, setV] = useState({ feeHeadId: heads[0]?.id ?? '', amount: '', dueDate: todayIST(), description: '' });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!amountOk(v.amount) || !v.amount) return setErrors({ amount: t('fee.amountInvalid') });
    const b = { ...v, amount: v.amount.replace(/,/g, ''), description: v.description.trim() };
    const r = validate(extraChargeSchema, b);
    if (!r.ok) return setErrors(r.errors);
    onSave(b);
  }
  return (
    <Modal open onClose={onClose} title={t('fee.acct.extra')} subtitle={t('fee.acct.extraSub')} onSubmit={submit} submitLabel={t('fee.acct.extraSave')} busy={busy} error={error}>
      <div className="grid-2">
        <Field id="x-head" label={t('fee.late.feeHead')} error={errors.feeHeadId}>
          <select id="x-head" value={v.feeHeadId} onChange={(e) => setV({ ...v, feeHeadId: e.target.value })}>{heads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
        </Field>
        <Field id="x-amount" label={t('fee.late.amount')} error={errors.amount}>
          <div className="input-affix"><span aria-hidden>₹</span><input id="x-amount" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></div>
        </Field>
      </div>
      <Field id="x-desc" label={t('fee.acct.forWhat')} error={errors.description}><input id="x-desc" value={v.description} placeholder={t('fee.acct.forWhatPh')} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
      <Field id="x-due" label={t('fee.acct.dueDate')} error={errors.dueDate}><input id="x-due" type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} /></Field>
    </Modal>
  );
}

function ConcessionDialog({ yearId, yearName, heads, busy, error, errors, setErrors, onClose, onSave }: DlgProps & { yearId: string; yearName: string; heads: FeeHead[]; errors: FieldErrors; setErrors: (e: FieldErrors) => void; onSave: (b: object) => void }) {
  const { t } = useI18n();
  const [v, setV] = useState({ concessionType: 'SIBLING', valueType: 'PERCENT' as 'PERCENT' | 'AMOUNT', value: '', feeHeadId: '', reason: '' });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!amountOk(v.value) || !v.value) return setErrors({ value: t('fee.amountInvalid') });
    const b = { academicYearId: yearId, feeHeadId: v.feeHeadId || null, concessionType: v.concessionType, valueType: v.valueType, value: v.value.replace(/,/g, ''), reason: v.reason.trim() };
    const r = validate(concessionSchema, b);
    if (!r.ok) return setErrors({ ...r.errors, ...(r.errors.reason ? { reason: t('app.reasonMin') } : {}) });
    onSave(b);
  }
  return (
    <Modal open onClose={onClose} title={t('fee.conc.request')} subtitle={yearName} onSubmit={submit} submitLabel={t('fee.conc.send')} busy={busy} error={error}>
      <p className="note-info"><Icon name="info" size={15} /> {t('fee.conc.hint')}</p>
      <Field id="c-type" label={t('common.type')}>
        <select id="c-type" value={v.concessionType} onChange={(e) => setV({ ...v, concessionType: e.target.value })}>{CONCESSION_TYPES.map((x) => <option key={x} value={x}>{t(`fee.conc.type.${x}` as MessageKey)}</option>)}</select>
      </Field>
      <div className="field">
        <span className="label">{t('fee.conc.how')}</span>
        <div className="segmented" role="radiogroup" aria-label={t('fee.conc.how')}>
          {(['PERCENT', 'AMOUNT'] as const).map((x) => <button key={x} type="button" role="radio" aria-checked={v.valueType === x} className={v.valueType === x ? 'on' : ''} onClick={() => setV({ ...v, valueType: x })}>{t(`fee.conc.vt.${x}` as MessageKey)}</button>)}
        </div>
      </div>
      <div className="grid-2">
        <Field id="c-value" label={v.valueType === 'PERCENT' ? t('fee.late.percent') : t('fee.late.amount')} error={errors.value}>
          <div className={`input-affix ${v.valueType === 'PERCENT' ? 'suffix' : ''}`}><span aria-hidden>{v.valueType === 'PERCENT' ? '%' : '₹'}</span><input id="c-value" inputMode="decimal" value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} /></div>
        </Field>
        <Field id="c-head" label={t('fee.conc.on')} error={errors.feeHeadId}>
          <select id="c-head" value={v.feeHeadId} onChange={(e) => setV({ ...v, feeHeadId: e.target.value })}>
            <option value="">{t('fee.conc.allHeads')}</option>
            {heads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </Field>
      </div>
      <Field id="c-reason" label={t('app.reasonRequired')} error={errors.reason}><textarea id="c-reason" rows={2} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder={t('fee.conc.reasonPh')} /></Field>
    </Modal>
  );
}

function CancelDialog({ inv, busy, error, errors, setErrors, onClose, onSave }: DlgProps & { inv: Invoice; errors: FieldErrors; setErrors: (e: FieldErrors) => void; onSave: (reason: string) => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  return (
    <Modal open danger onClose={onClose} title={t('fee.acct.cancelTitle')} subtitle={`${inv.invoiceNo} · ${inr(inv.netAmount)}`} submitLabel={t('fee.acct.cancelBill')} busy={busy} error={error}
      onSubmit={(e) => { e.preventDefault(); if (reason.trim().length < 5) return setErrors({ reason: t('app.reasonMin') }); onSave(reason.trim()); }}>
      <p>{t('fee.acct.cancelText')}</p>
      <Field id="cb-reason" label={t('app.reasonRequired')} error={errors.reason}><textarea id="cb-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Modal>
  );
}

function UndoDialog({ p, kind, heads, busy, error, errors, setErrors, onClose, onSave }: DlgProps & { p: Pay; kind: 'cancel' | 'bounce'; heads: FeeHead[]; errors: FieldErrors; setErrors: (e: FieldErrors) => void; onSave: (b: object) => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [charge, setCharge] = useState('');
  const [headId, setHeadId] = useState(heads.find((h) => h.feeType === 'FINE')?.id ?? heads[0]?.id ?? '');
  return (
    <Modal open danger onClose={onClose} title={kind === 'bounce' ? t('fee.rc.bounceTitle') : t('fee.rc.cancelTitle')} subtitle={p.receiptNo + ' · ' + inr(p.amount)} submitLabel={kind === 'bounce' ? t('fee.rc.bounce') : t('fee.rc.cancel')} busy={busy} error={error}
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim().length < (kind === 'bounce' ? 3 : 5)) return setErrors({ reason: t('app.reasonMin') });
        if (charge && !amountOk(charge)) return setErrors({ charge: t('fee.amountInvalid') });
        onSave(kind === 'bounce' ? { reason: reason.trim(), chargeAmount: charge ? charge.replace(/,/g, '') : null, chargeFeeHeadId: charge ? headId : null } : { reason: reason.trim() });
      }}>
      <p>{kind === 'bounce' ? t('fee.rc.bounceText') : t('fee.rc.cancelText')}</p>
      <Field id="u-reason" label={t('app.reasonRequired')} error={errors.reason}><textarea id="u-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'bounce' ? t('fee.rc.bouncePh') : ''} /></Field>
      {kind === 'bounce' && (
        <div className="grid-2">
          <Field id="u-charge" label={t('fee.rc.charge')} error={errors.charge} hint={t('fee.rc.chargeHint')}>
            <div className="input-affix"><span aria-hidden>₹</span><input id="u-charge" inputMode="decimal" value={charge} onChange={(e) => setCharge(e.target.value)} /></div>
          </Field>
          <Field id="u-head" label={t('fee.late.feeHead')}>
            <select id="u-head" value={headId} onChange={(e) => setHeadId(e.target.value)} disabled={!charge}>{heads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
          </Field>
        </div>
      )}
    </Modal>
  );
}

function LinkDialog({ studentId, due, onClose }: { studentId: string; due: string; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [days, setDays] = useState(7);
  const [email, setEmail] = useState(false); // many families have no email on record
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ url: string; sentTo: string | null } | null>(null);
  async function create(e: FormEvent) {
    e.preventDefault();
    if (made) return onClose();
    setBusy(true); setError(null);
    try {
      const r = await api<{ url: string; sentTo: string | null }>('/fees/pay-links', { method: 'POST', body: JSON.stringify({ studentId, expiresInDays: days, sendEmail: email }) });
      setMade(r);
    } catch (err) { setError(apiErrors(err).message); } finally { setBusy(false); }
  }
  const share = made ? 'https://wa.me/?text=' + encodeURIComponent(t('fee.link.shareText', { v: inr(due), url: made.url })) : '';
  return (
    <Modal open onClose={onClose} title={t('fee.link.create')} subtitle={t('fee.link.sub', { v: inr(due) })} submitLabel={made ? t('common.close') : t('fee.link.make')} busy={busy} error={error} hideCancel={!!made} onSubmit={create}>
      {!made ? (
        <>
          <p className="muted small">{t('fee.link.hint')}</p>
          <Field id="l-days" label={t('fee.link.validFor')}>
            <select id="l-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[3, 7, 14, 30].map((d) => <option key={d} value={d}>{t('fee.link.days', { n: d })}</option>)}</select>
          </Field>
          <label className="check"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> {t('fee.link.emailParent')}</label>
        </>
      ) : (
        <>
          <p className="note-info"><Icon name="check" size={15} /> {made.sentTo ? t('fee.link.emailed', { to: made.sentTo }) : t('fee.link.ready')}</p>
          <div className="link-box">
            <input className="input mono" readOnly value={made.url} aria-label={t('fee.link.url')} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn btn-sm" onClick={() => { void navigator.clipboard?.writeText(made.url); toast(t('fee.link.copied')); }}><Icon name="copy" size={15} /> {t('fee.link.copy')}</button>
          </div>
          <div className="paid-actions">
            <a className="btn btn-sm" href={share} target="_blank" rel="noreferrer">{t('fee.link.whatsapp')}</a>
            <a className="btn btn-sm btn-ghost" href={made.url} target="_blank" rel="noreferrer">{t('fee.link.open')}</a>
          </div>
        </>
      )}
    </Modal>
  );
}

function RefundDialog({ p, busy, error, errors, setErrors, onClose, onSave }: DlgProps & { p: Pay; errors: FieldErrors; setErrors: (e: FieldErrors) => void; onSave: (b: object) => void }) {
  const { t } = useI18n();
  const [amount, setAmount] = useState(String(paiseOf(p.amount) / 100));
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState('BANK_TRANSFER');
  const online = p.paymentMode === 'ONLINE';
  return (
    <Modal open onClose={onClose} title={t('fee.ref.request')} subtitle={p.receiptNo + ' · ' + inr(p.amount)} submitLabel={t('fee.conc.send')} busy={busy} error={error}
      onSubmit={(e) => {
        e.preventDefault();
        if (!amountOk(amount) || !amount) return setErrors({ amount: t('fee.amountInvalid') });
        if (reason.trim().length < 5) return setErrors({ reason: t('app.reasonMin') });
        onSave({ amount: amount.replace(/,/g, ''), reason: reason.trim(), refundMode: online ? null : mode });
      }}>
      <p className="note-info"><Icon name="info" size={15} /> {online ? t('fee.ref.onlineHint') : t('fee.ref.manualHint')}</p>
      <div className="grid-2">
        <Field id="r-amount" label={t('fee.late.amount')} error={errors.amount}>
          <div className="input-affix"><span aria-hidden>₹</span><input id="r-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        </Field>
        {!online && (
          <Field id="r-mode" label={t('fee.ref.how')}>
            <select id="r-mode" value={mode} onChange={(e) => setMode(e.target.value)}>{['BANK_TRANSFER', 'CASH', 'CHEQUE'].map((m) => <option key={m} value={m}>{t(('fee.ref.mode.' + m) as MessageKey)}</option>)}</select>
          </Field>
        )}
      </div>
      <Field id="r-reason" label={t('app.reasonRequired')} error={errors.reason}><textarea id="r-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('fee.ref.reasonPh')} /></Field>
    </Modal>
  );
}

function WaiveDialog({ inv, busy, error, errors, setErrors, onClose, onSave }: DlgProps & { inv: Invoice; errors: FieldErrors; setErrors: (e: FieldErrors) => void; onSave: (reason: string) => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  return (
    <Modal open onClose={onClose} title={t('fee.due.waiveTitle')} subtitle={inv.invoiceNo + ' · ' + inr(inv.fineAmount)} submitLabel={t('fee.due.waiveGo')} busy={busy} error={error}
      onSubmit={(e) => { e.preventDefault(); if (reason.trim().length < 5) return setErrors({ reason: t('app.reasonMin') }); onSave(reason.trim()); }}>
      <p>{t('fee.due.waiveText')}</p>
      <Field id="w-reason" label={t('app.reasonRequired')} error={errors.reason}><textarea id="w-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Modal>
  );
}
