'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { rupees, todayIST } from '@/components/accounts';
import { PayPill, useMonthLabel } from '@/components/payroll';

interface Run { id: string; runNo: string; campusId: string; campus: string; month: number; year: number; status: string; staff: number; totalGross: string; totalNet: string; paidOn: string | null }

/** Payroll → Runs (M15.3): one run per campus and month. */
export default function PayrollRunsPage() {
  const { can } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const label = useMonthLabel();
  const [rows, setRows] = useState<Run[] | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const [campuses, setCampuses] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const now = todayIST();
  const prev = new Date(Date.UTC(Number(now.slice(0, 4)), Number(now.slice(5, 7)) - 2, 1));
  const [form, setForm] = useState({ campusId: '', month: prev.getUTCMonth() + 1, year: prev.getUTCFullYear() });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const prepare = can(PERMISSIONS.PAYROLL_RUN);
  const load = useCallback(() => { api<Run[]>('/payroll/runs').then(setRows).catch(() => setRows([])); }, []);
  useEffect(load, [load]);
  useEffect(() => { if (prepare) api<{ id: string; name: string }[]>('/campuses').then((c) => { setCampuses(c); setForm((f) => ({ ...f, campusId: f.campusId || c[0]?.id || '' })); }).catch(() => setCampuses([])); }, [prepare]);
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try {
      const r = await api<{ id: string; staff: number; missing: string[] }>('/payroll/runs', { method: 'POST', body: JSON.stringify(form) });
      toast(t('pay.run.made', { n: r.staff }));
      router.push(`/payroll/runs/${r.id}`);
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const list = (rows ?? []).filter((r) => showCancelled || r.status !== 'CANCELLED');
  const years = [prev.getUTCFullYear() - 1, prev.getUTCFullYear(), prev.getUTCFullYear() + 1];
  return (
    <>
      <PageHeader eyebrow={t('nav.payroll')} title={t('pay.run.title')} description={t('pay.run.desc')} actions={prepare && <button type="button" className="btn btn-primary" onClick={() => { setErrors({}); setError(null); setOpen(true); }}><Icon name="plus" /> {t('pay.run.new')}</button>} />
      {!rows ? <SkeletonRows rows={4} /> : !list.length ? <EmptyState icon="rupee" title={t('pay.run.none')} text={prepare ? t('pay.run.noneHint') : undefined} /> : (
        <div className="table-wrap card" role="region" aria-label={t('pay.run.title')} tabIndex={0}>
          <table className="table">
            <thead><tr><th scope="col">{t('pay.month')}</th><th scope="col">{t('pay.campus')}</th><th scope="col">{t('pay.run.no')}</th><th scope="col" className="num">{t('pay.staff')}</th><th scope="col" className="num">{t('pay.gross')}</th><th scope="col" className="num">{t('pay.net')}</th><th scope="col">{t('pay.status')}</th></tr></thead>
            <tbody>{list.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/payroll/runs/${r.id}`}><strong>{label(r.month, r.year)}</strong></Link></td>
                <td>{r.campus}</td>
                <td className="mono small">{r.runNo}</td>
                <td className="num">{r.staff}</td>
                <td className="num">{rupees(r.totalGross)}</td>
                <td className="num"><strong>{rupees(r.totalNet)}</strong></td>
                <td><PayPill status={r.status} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {(rows ?? []).some((r) => r.status === 'CANCELLED') && <label className="check pay-toggle"><input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> {t('pay.run.showCancelled')}</label>}
      <Modal open={open} onClose={() => setOpen(false)} title={t('pay.run.new')} subtitle={t('pay.run.newSub')} onSubmit={save} submitLabel={t('pay.run.make')} busy={busy} error={error}>
        <Field id="pr-campus" label={t('pay.campus')} error={errors.campusId}><select id="pr-campus" value={form.campusId} onChange={(e) => setForm((f) => ({ ...f, campusId: e.target.value }))}>{campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <div className="grid-2">
          <Field id="pr-month" label={t('pay.month')} error={errors.month}><select id="pr-month" value={form.month} onChange={(e) => setForm((f) => ({ ...f, month: Number(e.target.value) }))}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{label(i + 1, form.year).replace(/\s*\d{4}$/, '')}</option>)}</select></Field>
          <Field id="pr-year" label={t('pay.year')} error={errors.year}><select id="pr-year" value={form.year} onChange={(e) => setForm((f) => ({ ...f, year: Number(e.target.value) }))}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></Field>
        </div>
        <p className="muted small"><Icon name="info" size={14} /> {t('pay.run.howDays')}</p>
      </Modal>
    </>
  );
}
