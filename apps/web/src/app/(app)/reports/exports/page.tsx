'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { downloadFile, api } from '@/lib/api';
import { apiErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { PlcPill } from '@/components/placements';

interface Job { id: string; reportCode: string; format: string; status: string; rowCount: number | null; sizeBytes: number | null; error: string | null; createdAt: string; finishedAt: string | null; expiresAt: string | null; expired: boolean; downloads: number }

/** Reports → My exports (M19.4): background exports, downloadable by their owner for 7 days. */
export default function ExportsPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [rows, setRows] = useState<Job[] | null>(null);
  const load = useCallback(() => { api<Job[]>('/reports/exports').then(setRows).catch(() => setRows([])); }, []);
  useEffect(load, [load]);
  // Refresh while something is still being built.
  useEffect(() => {
    if (!rows?.some((r) => ['QUEUED', 'RUNNING'].includes(r.status))) return;
    const h = window.setTimeout(load, 4000);
    return () => window.clearTimeout(h);
  }, [rows, load]);
  const get = async (j: Job) => {
    try { await downloadFile(`/reports/exports/${j.id}/file`); load(); }
    catch (x) { toast(apiErrors(x).message ?? t('en.failed'), 'bad'); }
  };
  const when = (x: string) => new Date(x).toLocaleString(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const size = (b: number | null) => (b == null ? '' : b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 102.4) / 10} KB` : `${Math.round(b / 104857.6) / 10} MB`);
  return (
    <>
      <PageHeader eyebrow={t('nav.reports')} title={t('rep.ex.title')} description={t('rep.ex.desc')} actions={<Link href="/reports" className="btn"><Icon name="grid" /> {t('rep.mainTitle')}</Link>} />
      {!rows ? <SkeletonRows rows={4} /> : !rows.length ? <EmptyState icon="download" title={t('rep.ex.none')} text={t('rep.ex.noneHint')} /> : (
        <div className="table-wrap card" role="region" aria-label={t('rep.ex.title')} tabIndex={0}>
          <table className="table">
            <thead><tr><th scope="col">{t('rep.ex.report')}</th><th scope="col">{t('rep.ex.asked')}</th><th scope="col" className="num">{t('rep.ex.rows')}</th><th scope="col">{t('act.status')}</th><th scope="col"><span className="sr-only">{t('common.actions')}</span></th></tr></thead>
            <tbody>{rows.map((j) => (
              <tr key={j.id}>
                <td><strong>{t(`rep.code.${j.reportCode}` as MessageKey)}</strong><span className="sub-line muted small">{j.format === 'XLSX' ? t('rep.excelFile') : 'CSV'}{j.sizeBytes ? ` · ${size(j.sizeBytes)}` : ''}{j.downloads ? ` · ${t('rep.ex.downloaded', { n: j.downloads })}` : ''}</span></td>
                <td>{when(j.createdAt)}{j.expiresAt && !j.expired && <span className="sub-line muted small">{t('rep.ex.until', { d: when(j.expiresAt) })}</span>}</td>
                <td className="num">{j.rowCount ?? '—'}</td>
                <td>{j.expired ? <span className="pill pill-muted"><span className="pill-dot" />{t('rep.ex.expired')}</span> : <PlcPill prefix="rep.ex.st" status={j.status} />}{j.error && <span className="sub-line small text-bad">{j.error}</span>}</td>
                <td>{j.status === 'DONE' && !j.expired && <button type="button" className="btn btn-sm btn-primary" onClick={() => void get(j)}><Icon name="download" size={14} /> {t('rep.ex.download')}</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
