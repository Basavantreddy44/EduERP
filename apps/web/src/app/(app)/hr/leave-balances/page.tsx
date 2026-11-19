'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { LEAVE_ADJUSTMENTS, PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';

interface Bal { leaveTypeId: string; code: string; name: string; isPaid: boolean; allowance: number | null; adjustments: number; approved: number; pending: number; left: number | null }
interface Data { year: { id: string; name: string }; types: { id: string; code: string; name: string; daysPerYear: number | null; carryForwardMax: number | null; isPaid: boolean }[]; rows: { employeeId: string; name: string; code: string; balances: Bal[] }[] }
interface Year { id: string; name: string; isCurrent: boolean; startDate: string }

/** HR → Leave balances (M14.3): allowance, adjustments, taken and waiting, what is left — per person. */
export default function LeaveBalancesPage() {
  const { can } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const setup = can(PERMISSIONS.HR_SETUP);
  const [years, setYears] = useState<Year[]>([]);
  const [yearId, setYearId] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [q, setQ] = useState('');
  const [adj, setAdj] = useState<{ employeeId: string; name: string } | null>(null);
  const [form, setForm] = useState({ leaveTypeId: '', kind: 'OPENING', days: '', reason: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<Year[]>('/academic-years').then((y) => { setYears(y); setYearId(y.find((x) => x.isCurrent)?.id ?? y[0]?.id ?? ''); }).catch(() => setYears([])); }, []);
  const load = useCallback(() => { if (yearId) { setData(null); api<Data>(`/hr/leave-balances?yearId=${yearId}`).then(setData).catch(() => setData({ year: { id: yearId, name: '' }, types: [], rows: [] })); } }, [yearId]);
  useEffect(load, [load]);
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!adj) return;
    setBusy(true); setErrors({}); setError(null);
    try { await api('/hr/leave-balances/adjust', { method: 'POST', body: JSON.stringify({ ...form, employeeId: adj.employeeId, academicYearId: yearId }) }); toast(t('hr.lb.saved')); setAdj(null); load(); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const paidTypes = (data?.types ?? []).filter((x) => x.daysPerYear != null);
  const rows = (data?.rows ?? []).filter((r) => !q.trim() || `${r.name} ${r.code}`.toLowerCase().includes(q.trim().toLowerCase()));
  const fmt = (n: number | null) => (n == null ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(1));
  return (
    <>
      <PageHeader eyebrow={t('nav.hr')} title={t('hr.lb.title')} description={t('hr.lb.desc')} />
      <div className="toolbar">
        <label className="p12-inline">{t('hr.lb.year')} <select value={yearId} onChange={(e) => setYearId(e.target.value)}>{years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</select></label>
        <input type="search" className="input" aria-label={t('hr.lb.search')} placeholder={t('hr.lb.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!data ? <SkeletonRows rows={6} /> : !paidTypes.length ? <EmptyState icon="calendar" title={t('hr.lb.noTypes')} text={t('hr.lb.noTypesHint')} /> : !rows.length ? <EmptyState icon="users" title={t('hr.lb.noStaff')} /> : (
        <div className="table-wrap card p12-table" role="region" aria-label={t('hr.lb.title')} tabIndex={0}>
          <table className="table hr-balances">
            <thead><tr><th scope="col">{t('hr.lb.staff')}</th>{paidTypes.map((x) => <th key={x.id} scope="col" className="num">{x.name}<span className="sub-line muted small">{t('hr.lb.perYear', { n: fmt(x.daysPerYear) })}</span></th>)}{setup && <th scope="col"><span className="sr-only">{t('common.actions')}</span></th>}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employeeId}>
                  <td><strong>{r.name}</strong><span className="sub-line muted small">{r.code}</span></td>
                  {paidTypes.map((x) => {
                    const b = r.balances.find((v) => v.leaveTypeId === x.id)!;
                    return <td key={x.id} className="num"><strong className={b.left != null && b.left <= 0 ? 'text-bad' : undefined}>{fmt(b.left)}</strong><span className="sub-line muted small" title={t('hr.lb.cellTitle')}>{t('hr.lb.cell', { taken: fmt(b.approved), wait: fmt(b.pending), adj: b.adjustments ? `${b.adjustments > 0 ? '+' : ''}${fmt(b.adjustments)}` : '0' })}</span></td>;
                  })}
                  {setup && <td><button type="button" className="btn btn-sm" onClick={() => { setForm({ leaveTypeId: paidTypes[0]?.id ?? '', kind: 'OPENING', days: '', reason: '' }); setErrors({}); setError(null); setAdj({ employeeId: r.employeeId, name: r.name }); }} aria-label={t('hr.lb.adjustOf', { name: r.name })}>{t('hr.lb.adjust')}</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small acc-note">{t('hr.lb.legend')}</p>
        </div>
      )}
      <Modal open={!!adj} onClose={() => setAdj(null)} title={t('hr.lb.adjustOf', { name: adj?.name ?? '' })} subtitle={data?.year.name} onSubmit={save} submitLabel={t('common.save')} busy={busy} error={error}>
        <div className="grid-2">
          <Field id="lb-type" label={t('hr.lb.type')} error={errors.leaveTypeId}><select id="lb-type" value={form.leaveTypeId} onChange={(e) => setForm((f) => ({ ...f, leaveTypeId: e.target.value }))}>{paidTypes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          <Field id="lb-kind" label={t('hr.lb.kind')}><select id="lb-kind" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>{LEAVE_ADJUSTMENTS.map((k) => <option key={k} value={k}>{t(`hr.lb.k.${k}` as MessageKey)}</option>)}</select></Field>
        </div>
        <Field id="lb-days" label={t('hr.lb.days')} hint={form.kind === 'ENCASHMENT' ? t('hr.lb.minusHint') : form.kind === 'ADJUSTMENT' ? t('hr.lb.signHint') : t('hr.lb.plusHint')} error={errors.days}><input id="lb-days" inputMode="decimal" value={form.days} onChange={(e) => setForm((f) => ({ ...f, days: e.target.value }))} /></Field>
        <Field id="lb-reason" label={t('ac2.reason')} error={errors.reason}><input id="lb-reason" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} /></Field>
      </Modal>
    </>
  );
}
