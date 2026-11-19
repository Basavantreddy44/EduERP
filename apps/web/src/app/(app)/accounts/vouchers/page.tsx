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
import { CampusPicker } from '@/components/CampusPicker';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { AccPill, AccountSelect, Line, LinesEditor, emptyLine, isMoney, lineBody, rupees, todayIST, useChart, useCostCentres } from '@/components/accounts';

interface Voucher { id: string; voucherNo: string; voucherType: string; voucherDate: string; amount: string; paidTo: string | null; referenceNo: string | null; narration: string; status: string; lines: { account: string; debit: string; credit: string }[] }
type Kind = 'EXPENSE' | 'CONTRA' | 'JOURNAL';

/** Accounts → Vouchers (M13.3): expense / petty cash, contra (cash ↔ bank) and journal adjustments. */
export default function VouchersPage() {
  const { can } = useSession();
  const { t, locale } = useI18n();
  const toast = useToast();
  const entry = can(PERMISSIONS.ACC_ENTRY);
  const chart = useChart();
  const ccs = useCostCentres();
  const [filter, setFilter] = useState<'' | Kind | 'BANK'>('');
  const [rows, setRows] = useState<Voucher[] | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine()]);
  const [cancel, setCancel] = useState<Voucher | null>(null);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setRows(null); api<Voucher[]>(`/accounts/vouchers${filter ? `?type=${filter}` : ''}`).then(setRows).catch(() => setRows([])); }, [filter]);
  useEffect(load, [load]);
  const start = (k: Kind) => {
    const cash = chart?.find((a) => a.systemKey === 'CASH')?.id ?? '';
    setForm({ campusId: '', voucherDate: todayIST(), expenseAccountId: '', paidFromAccountId: cash, costCentreId: '', amount: '', paidTo: '', narration: '', fromAccountId: '', toAccountId: cash, referenceNo: '' });
    setLines([emptyLine(), emptyLine()]); setErrors({}); setError(null); setKind(k);
  };
  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!kind) return;
    setBusy(true); setErrors({}); setError(null);
    const f = form;
    const body = kind === 'EXPENSE'
      ? { campusId: f.campusId, voucherDate: f.voucherDate, expenseAccountId: f.expenseAccountId, paidFromAccountId: f.paidFromAccountId, costCentreId: f.costCentreId || null, amount: f.amount, paidTo: f.paidTo, narration: f.narration }
      : kind === 'CONTRA' ? { campusId: f.campusId || null, voucherDate: f.voucherDate, fromAccountId: f.fromAccountId, toAccountId: f.toAccountId, amount: f.amount, referenceNo: f.referenceNo || null, narration: f.narration }
        : { campusId: f.campusId || null, voucherDate: f.voucherDate, narration: f.narration, lines: lineBody(lines) };
    try {
      const r = await api<{ voucherNo: string; status: string }>(`/accounts/vouchers/${kind.toLowerCase()}`, { method: 'POST', body: JSON.stringify(body) });
      toast(r.status === 'PENDING_APPROVAL' ? t('ac2.vch.sentApproval', { no: r.voucherNo }) : t('ac2.vch.saved', { no: r.voucherNo })); setKind(null); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const doCancel = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!cancel) return;
    setBusy(true); setError(null);
    try { await api(`/accounts/vouchers/${cancel.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }); toast(t('ac2.vch.cancelled')); setCancel(null); load(); }
    catch (x) { setError(apiErrors(x).message ?? t('en.failed')); } finally { setBusy(false); }
  };
  const d = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return (
    <>
      <PageHeader eyebrow={t('nav.accounts')} title={t('ac2.vch.title')} description={t('ac2.vch.desc')}
        actions={entry && chart && <><button type="button" className="btn btn-primary" onClick={() => start('EXPENSE')}><Icon name="receipt" /> {t('ac2.vch.EXPENSE')}</button><button type="button" className="btn" onClick={() => start('CONTRA')}><Icon name="swap" /> {t('ac2.vch.CONTRA')}</button><button type="button" className="btn" onClick={() => start('JOURNAL')}><Icon name="book" /> {t('ac2.vch.JOURNAL')}</button></>} />
      <div className="tabs scroll" role="tablist" aria-label={t('ac2.vch.title')}>
        {(['', 'EXPENSE', 'CONTRA', 'JOURNAL', 'BANK'] as const).map((x) => <button key={x || 'all'} role="tab" aria-selected={filter === x} className={filter === x ? 'on' : ''} onClick={() => setFilter(x)}>{x ? t(`ac2.vch.f.${x}` as MessageKey) : t('ac2.vch.f.ALL')}</button>)}
      </div>
      {!rows ? <SkeletonRows rows={5} /> : !rows.length ? <EmptyState icon="receipt" title={t('ac2.vch.none')} /> : (
        <div className="table-wrap card p12-table">
          <table className="table">
            <thead><tr><th scope="col">{t('ac2.vch.no')}</th><th scope="col">{t('ac2.narration')}</th><th scope="col">{t('ac2.vch.accounts')}</th><th scope="col" className="num">{t('ac2.amount')}</th><th scope="col">{t('common.status')}</th><th scope="col"><span className="sr-only">{t('common.actions')}</span></th></tr></thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id} className={['CANCELLED', 'REJECTED'].includes(v.status) ? 'row-dim' : undefined}>
                  <td><span className="code">{v.voucherNo}</span><span className="sub-line muted small">{d(v.voucherDate)} · {t(`ac2.vch.f.${v.voucherType}` as MessageKey)}</span></td>
                  <td>{v.paidTo && <strong>{v.paidTo}: </strong>}{v.narration}{v.referenceNo && <span className="sub-line muted small">{v.referenceNo}</span>}</td>
                  <td className="small">{v.lines.map((l, i) => <span key={i} className="sub-line">{Number(l.debit) ? t('ac2.vch.dr', { a: l.account }) : t('ac2.vch.cr', { a: l.account })}</span>)}</td>
                  <td className="num">{rupees(v.amount, { paise: true })}</td>
                  <td><AccPill status={v.status} /></td>
                  <td className="row-actions">{entry && !['CANCELLED', 'REJECTED'].includes(v.status) && <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setReason(''); setError(null); setCancel(v); }} aria-label={t('ac2.vch.cancelOf', { no: v.voucherNo })}><Icon name="x" size={14} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!kind} onClose={() => setKind(null)} title={kind ? t(`ac2.vch.${kind}` as MessageKey) : ''} subtitle={kind ? t(`ac2.vch.sub.${kind}` as MessageKey) : undefined} onSubmit={save} submitLabel={t('common.save')} busy={busy} error={error} wide={kind === 'JOURNAL'}>
        {chart && kind && (
          <>
            <div className="grid-2">
              <Field id="vc-date" label={t('common.date')} error={errors.voucherDate}><input id="vc-date" type="date" max={todayIST()} value={form.voucherDate} onChange={(e) => set('voucherDate')(e.target.value)} /></Field>
              <Field id="vc-campus" label={t('common.campus')} error={errors.campusId}><CampusPicker id="vc-campus" value={form.campusId} onChange={set('campusId')} allowInstitution={kind !== 'EXPENSE'} institutionLabel={t('common.wholeInstitution')} /></Field>
            </div>
            {kind === 'EXPENSE' && (
              <>
                <div className="grid-2">
                  <Field id="vc-exp" label={t('ac2.vch.expenseAcc')} error={errors.expenseAccountId}><AccountSelect id="vc-exp" chart={chart} value={form.expenseAccountId} onChange={set('expenseAccountId')} types={['EXPENSE']} /></Field>
                  <Field id="vc-from" label={t('ac2.vch.paidFrom')} error={errors.paidFromAccountId}><AccountSelect id="vc-from" chart={chart} value={form.paidFromAccountId} onChange={set('paidFromAccountId')} only={isMoney} /></Field>
                </div>
                <div className="grid-3">
                  <Field id="vc-amt" label={t('ac2.amount')} error={errors.amount}><input id="vc-amt" inputMode="decimal" value={form.amount} onChange={(e) => set('amount')(e.target.value)} /></Field>
                  <Field id="vc-to" label={t('ac2.vch.paidTo')} error={errors.paidTo}><input id="vc-to" value={form.paidTo} onChange={(e) => set('paidTo')(e.target.value)} /></Field>
                  {ccs.length > 0 && <Field id="vc-cc" label={t('ac2.costCentre')}><select id="vc-cc" value={form.costCentreId} onChange={(e) => set('costCentreId')(e.target.value)}><option value="">—</option>{ccs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
                </div>
              </>
            )}
            {kind === 'CONTRA' && (
              <div className="grid-3">
                <Field id="vc-cfrom" label={t('ac2.vch.moveFrom')} error={errors.fromAccountId}><AccountSelect id="vc-cfrom" chart={chart} value={form.fromAccountId} onChange={set('fromAccountId')} only={isMoney} /></Field>
                <Field id="vc-cto" label={t('ac2.vch.moveTo')} error={errors.toAccountId}><AccountSelect id="vc-cto" chart={chart} value={form.toAccountId} onChange={set('toAccountId')} only={isMoney} /></Field>
                <Field id="vc-camt" label={t('ac2.amount')} error={errors.amount}><input id="vc-camt" inputMode="decimal" value={form.amount} onChange={(e) => set('amount')(e.target.value)} /></Field>
              </div>
            )}
            {kind === 'CONTRA' && <Field id="vc-ref" label={t('ac2.vch.ref')}><input id="vc-ref" value={form.referenceNo} onChange={(e) => set('referenceNo')(e.target.value)} /></Field>}
            {kind === 'JOURNAL' && <LinesEditor chart={chart} lines={lines} setLines={setLines} costCentres={ccs.length ? ccs : undefined} errors={errors.lines} />}
            {kind === 'JOURNAL' && <p className="muted small"><Icon name="info" size={14} /> {t('ac2.vch.journalHint')}</p>}
            <Field id="vc-nar" label={t('ac2.narration')} error={errors.narration}><input id="vc-nar" value={form.narration} onChange={(e) => set('narration')(e.target.value)} placeholder={t(`ac2.vch.ph.${kind}` as MessageKey)} /></Field>
          </>
        )}
      </Modal>
      <Modal open={!!cancel} onClose={() => setCancel(null)} title={t('ac2.vch.cancelOf', { no: cancel?.voucherNo ?? '' })} subtitle={cancel?.status === 'POSTED' ? t('ac2.vch.cancelPosted') : undefined} onSubmit={doCancel} submitLabel={t('ac2.vch.cancel')} busy={busy} error={error} danger submitDisabled={reason.trim().length < 5}>
        <Field id="vc-reason" label={t('ac2.reason')} hint={t('ac2.reasonHint')}><input id="vc-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>
    </>
  );
}
