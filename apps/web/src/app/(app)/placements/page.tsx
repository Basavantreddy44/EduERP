'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DRIVE_STATUSES } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, StatTile, useToast } from '@/components/ui';
import { DriveFields, PlcPill, blankDrive, ctcRange, driveBody, lakh, usePlcOptions } from '@/components/placements';
import { fmtDay } from '@/components/activities';

interface Drive { id: string; title: string; company: string; campusId: string; jobType: string; ctcMin: string | null; ctcMax: string | null; passingYear: number; lastDateToApply: string; driveDate: string | null; status: string; applications: number; selected: number }
interface Stats { optedIn: number; placed: number; placedPercent: number; offers: number; highestCtc: string | null; averageCtc: string | null; medianCtc: string | null }

/** Placements → Drives (M19.2): drives by status, with this year's placement figures. */
export default function DrivesPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const opts = usePlcOptions();
  const [filter, setFilter] = useState<'' | (typeof DRIVE_STATUSES)[number]>('');
  const [year, setYear] = useState(String(new Date().getFullYear() + 1));
  const [rows, setRows] = useState<Drive[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [form, setForm] = useState<ReturnType<typeof blankDrive> | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setRows(null); api<Drive[]>(`/placements/drives${filter ? `?status=${filter}` : ''}`).then(setRows).catch(() => setRows([])); }, [filter]);
  useEffect(load, [load]);
  useEffect(() => { setStats(null); api<Stats>(`/placements/stats?passingYear=${year}`).then(setStats).catch(() => setStats(null)); }, [year]);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true); setErrors({}); setError(null);
    try {
      const r = await api<{ id: string }>('/placements/drives', { method: 'POST', body: JSON.stringify(driveBody(form)) });
      toast(t('plc.d.saved')); router.push(`/placements/drives/${r.id}`);
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader eyebrow={t('nav.placements')} title={t('plc.d.title')} description={t('plc.d.desc')}
        actions={opts?.can.manage && <button type="button" className="btn btn-primary" onClick={() => { setErrors({}); setError(null); setForm({ ...blankDrive(), campusId: opts.campuses[0]?.id ?? '', passingYear: year }); }} disabled={!opts.companies.length}><Icon name="plus" /> {t('plc.d.new')}</button>} />
      <div className="filter-bar card">
        <label className="inv-f">{t('plc.batch')}<select value={year} onChange={(e) => setYear(e.target.value)}>{(opts?.years ?? []).map((y) => <option key={y} value={y}>{t('plc.batchOf', { y })}</option>)}</select></label>
      </div>
      <div className="stats pay-stats">
        <StatTile icon="users" label={t('plc.st.opted')} value={stats ? stats.optedIn : '…'} href="/placements/students" />
        <StatTile icon="check" label={t('plc.st.placed')} value={stats ? `${stats.placed} (${stats.placedPercent}%)` : '…'} href="/placements/stats" />
        <StatTile icon="star" label={t('plc.st.highest')} value={stats ? lakh(stats.highestCtc) : '…'} hint={stats?.medianCtc ? t('plc.st.median', { v: lakh(stats.medianCtc) }) : undefined} />
        <StatTile icon="file" label={t('plc.st.offers')} value={stats ? stats.offers : '…'} />
      </div>
      {opts && !opts.companies.length && opts.can.manage && <p className="notice"><Icon name="info" size={16} /> {t('plc.d.noCompanies')} <Link href="/placements/companies">{t('nav.plcCompanies')}</Link></p>}
      <div className="tabs" role="tablist" aria-label={t('plc.d.title')}>
        {(['', ...DRIVE_STATUSES] as const).map((x) => <button key={x || 'all'} role="tab" aria-selected={filter === x} className={filter === x ? 'on' : ''} onClick={() => setFilter(x)}>{x ? t(`plc.ds.${x}` as MessageKey) : t('act.all')}</button>)}
      </div>
      {!rows ? <SkeletonRows rows={4} /> : !rows.length ? <EmptyState icon="file" title={t('plc.d.none')} text={t('plc.d.noneHint')} /> : (
        <div className="table-wrap card" role="region" aria-label={t('plc.d.title')} tabIndex={0}>
          <table className="table">
            <thead><tr><th scope="col">{t('plc.d.role')}</th><th scope="col">{t('plc.ctc')}</th><th scope="col">{t('plc.d.lastDate')}</th><th scope="col" className="num">{t('plc.d.applied')}</th><th scope="col" className="num">{t('plc.d.selected')}</th><th scope="col">{t('act.status')}</th></tr></thead>
            <tbody>{rows.map((d) => (
              <tr key={d.id}>
                <td><Link href={`/placements/drives/${d.id}`}><strong>{d.title}</strong></Link><span className="sub-line muted small">{d.company} · {t(`plc.job.${d.jobType}` as MessageKey)} · {t('plc.batchOf', { y: d.passingYear })}</span></td>
                <td>{ctcRange(d.ctcMin, d.ctcMax)}</td>
                <td>{fmtDay(locale, d.lastDateToApply)}{d.driveDate && <span className="sub-line muted small">{t('plc.d.driveOn', { d: fmtDay(locale, d.driveDate) })}</span>}</td>
                <td className="num">{d.applications}</td>
                <td className="num">{d.selected}</td>
                <td><PlcPill prefix="plc.ds" status={d.status} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title={t('plc.d.new')} subtitle={t('plc.d.sub')} onSubmit={save} busy={busy} error={error} wide>
        {form && opts && <DriveFields form={form} setForm={setForm} errors={errors} />}
      </Modal>
    </>
  );
}
