'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Column, DataTable } from '@/components/DataTable';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge } from '@/components/ui';
import { useDay } from '@/components/admissions';
import { studentName } from '@/components/students';

interface Row {
  id: string; status: string; oldStatus: string; newStatus: string; reason: string; attendanceDate: string; className: string; periodName: string | null; sessionId: string;
  createdAt: string; decidedAt: string | null; decisionRemarks: string | null; requestedByName: string | null; decidedByName: string | null; approvalRequestId: string | null;
  student: { firstName: string; lastName: string | null; admissionNo: string };
}
interface Page { items: Row[]; total: number; page: number; pageSize: number }

/** Attendance corrections (M3.3): every change to a submitted mark, with who asked, why and who decided. */
export default function CorrectionsPage() {
  const { t } = useI18n();
  const day = useDay();
  const [status, setStatus] = useState('PENDING');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [data, setData] = useState<Page | null>(null);
  useEffect(() => {
    setData(null);
    api<Page>(`/attendance/corrections?page=${page}&pageSize=${size}${status ? `&status=${status}` : ''}`).then(setData).catch(() => setData({ items: [], total: 0, page: 1, pageSize: 25 }));
  }, [status, page, size]);

  const mark = (s: string) => <span className={`att-mini att-c-${s}`}>{t(`att.s.${s}` as MessageKey)}</span>;
  const columns: Column<Row>[] = [
    { key: 'student', header: t('stu.col.student'), cell: (r) => <span><strong>{studentName(r.student)}</strong><span className="sub-line muted small">{r.className}{r.periodName ? ` · ${r.periodName}` : ''}</span></span> },
    { key: 'date', header: t('common.date'), cell: (r) => day(r.attendanceDate) },
    { key: 'change', header: t('att.change'), cell: (r) => <span className="att-change">{mark(r.oldStatus)} <Icon name="arrowRight" size={14} /> {mark(r.newStatus)}</span> },
    { key: 'reason', header: t('att.reason'), className: 'hide-sm', cell: (r) => <span>{r.reason}<span className="sub-line muted small">{t('att.askedBy', { name: r.requestedByName ?? '—', date: day(r.createdAt) })}</span></span> },
    {
      key: 'status', header: t('common.status'),
      cell: (r) => <span><StatusBadge status={r.status} label={t(`att.corr.${r.status}` as MessageKey)} />{r.decidedByName && r.status !== 'PENDING' && <span className="sub-line muted small">{r.decidedByName}{r.decisionRemarks ? ` · ${r.decisionRemarks}` : ''}</span>}</span>,
    },
  ];

  return (
    <>
      <PageHeader eyebrow={t('nav.attendance')} title={t('att.corrTitle')} description={t('att.corrDesc')}
        actions={<Link className="btn" href="/approvals"><Icon name="approvals" /> {t('nav.approvals')}</Link>} />
      <div className="tabs scroll" role="tablist" aria-label={t('common.status')}>
        {['PENDING', 'APPROVED', 'REJECTED', ''].map((s) => (
          <button key={s || 'ALL'} role="tab" type="button" aria-selected={status === s} className={`tab ${status === s ? 'on' : ''}`} onClick={() => { setStatus(s); setPage(1); }}>
            {s ? t(`att.corr.${s}` as MessageKey) : t('stu.all')}
          </button>
        ))}
      </div>
      {data === null ? <SkeletonRows rows={5} /> : data.total === 0 ? (
        <EmptyState icon="check" title={status === 'PENDING' ? t('att.corrNonePending') : t('att.corrNone')} text={t('att.corrHow')} />
      ) : (
        <DataTable rows={data.items} columns={columns} rowKey={(r) => r.id} caption={t('att.corrTitle')}
          remote={{ total: data.total, page, size, sort: null, loading: false, onChange: (n) => { setPage(n.page); setSize(n.size); } }} />
      )}
    </>
  );
}
