'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { apiErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Column, DataTable } from '@/components/DataTable';
import { Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { useDay } from '@/components/admissions';
import { ApplyLeaveDialog, Balance, useLeaveTypes } from '@/components/leave';

interface Req {
  id: string; applicantType: 'STUDENT' | 'EMPLOYEE'; fromDate: string; toDate: string; halfDay: boolean; days: number; reason: string; status: string; createdAt: string;
  decisionRemarks: string | null; appliedByName: string | null; decidedByName: string | null; canCancel: boolean;
  leaveType: { name: string; code: string }; student: { firstName: string; lastName: string | null; admissionNo: string } | null;
  employee: { firstName: string; lastName: string | null; employeeCode: string; designation: string | null } | null;
}
interface Page { items: Req[]; total: number; page: number; pageSize: number }
type Dialog = null | { kind: 'STUDENT' | 'EMPLOYEE'; self: boolean };

/** Leave (M3.4): my leave and balance (staff), and every request for the office. */
export default function LeavePage() {
  const { can } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const day = useDay();
  const types = useLeaveTypes();
  const [me, setMe] = useState<{ employee: { id: string; name: string; code: string } | null; canApply: boolean } | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const office = can(PERMISSIONS.LEAVE_READ);
  const [tab, setTab] = useState<'mine' | 'all'>('mine');
  const [status, setStatus] = useState('');
  const [who, setWho] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [data, setData] = useState<Page | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [cancelling, setCancelling] = useState<Req | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api<{ employee: { id: string; name: string; code: string } | null; canApply: boolean }>('/leave/me').then((m) => { setMe(m); if (!m.employee && office) setTab('all'); }).catch(() => setMe({ employee: null, canApply: false }));
  }, [office]);
  useEffect(() => { if (me?.employee) api<Balance>('/leave/balance?applicantType=EMPLOYEE').then(setBalance).catch(() => setBalance(null)); }, [me, reload]);
  const load = useCallback(() => {
    setData(null);
    const q = new URLSearchParams({ page: String(page), pageSize: String(size), ...(tab === 'mine' ? { mine: 'true' } : {}), ...(status ? { status } : {}), ...(tab === 'all' && who ? { applicantType: who } : {}) });
    api<Page>(`/leave/requests?${q.toString()}`).then(setData).catch(() => setData({ items: [], total: 0, page: 1, pageSize: 25 }));
  }, [tab, status, who, page, size]);
  useEffect(load, [load, reload]);

  async function cancel() {
    if (!cancelling) return;
    setBusy(true); setError(null);
    try { await api(`/leave/requests/${cancelling.id}/cancel`, { method: 'POST' }); toast(t('leave.withdrawn')); setCancelling(null); setReload((n) => n + 1); }
    catch (e) { setError(apiErrors(e).message); } finally { setBusy(false); }
  }

  const name = (r: Req) => (r.student ? `${r.student.firstName} ${r.student.lastName ?? ''}`.trim() : r.employee ? `${r.employee.firstName} ${r.employee.lastName ?? ''}`.trim() : '—');
  const span = (r: Req) => (r.fromDate === r.toDate ? day(r.fromDate) : `${day(r.fromDate)} – ${day(r.toDate)}`);
  const columns: Column<Req>[] = [
    ...(tab === 'all' ? [{ key: 'who', header: t('leave.who'), cell: (r: Req) => <span><strong>{name(r)}</strong><span className="sub-line muted small">{r.student ? `${t('leave.student')} · ${r.student.admissionNo}` : `${r.employee?.designation ?? t('staff.title')} · ${r.employee?.employeeCode}`}</span></span> }] as Column<Req>[] : []),
    { key: 'type', header: t('leave.type'), cell: (r) => <span>{r.leaveType.name}<span className="sub-line muted small">{r.reason}</span></span> },
    { key: 'dates', header: t('leave.dates'), cell: (r) => <span>{span(r)}<span className="sub-line muted small">{r.halfDay ? t('leave.halfDay') : t('leave.nDays', { n: r.days })}</span></span> },
    { key: 'status', header: t('common.status'), cell: (r) => <span><StatusBadge status={r.status} label={t(`leave.st.${r.status}` as MessageKey)} />{r.decidedByName && r.status !== 'PENDING' && <span className="sub-line muted small">{r.decidedByName}{r.decisionRemarks ? ` · ${r.decisionRemarks}` : ''}</span>}</span> },
    { key: 'act', header: <span className="sr-only">{t('leave.withdraw')}</span>, align: 'right', cell: (r) => (r.canCancel ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setError(null); setCancelling(r); }}>{t('leave.withdraw')}</button> : null) },
  ];

  if (!me || !types) return <SkeletonRows rows={6} />;
  const canSelf = me.canApply;
  return (
    <>
      <PageHeader eyebrow={t('nav.attendance')} title={t('leave.title')} description={t('leave.desc')}
        actions={
          <>
            {can(PERMISSIONS.LEAVE_STAFF) && <Link className="btn" href="/leave/types"><Icon name="settings" /> {t('nav.leaveTypes')}</Link>}
            {can(PERMISSIONS.LEAVE_STUDENT) && <button type="button" className="btn" onClick={() => setDialog({ kind: 'STUDENT', self: false })}><Icon name="cap" /> {t('leave.forStudent')}</button>}
            {can(PERMISSIONS.LEAVE_STAFF) && <button type="button" className="btn" onClick={() => setDialog({ kind: 'EMPLOYEE', self: false })}><Icon name="users" /> {t('leave.forStaff')}</button>}
            {canSelf && <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: 'EMPLOYEE', self: true })}><Icon name="plus" /> {t('leave.applyMine')}</button>}
          </>
        } />

      {me.employee && balance && (
        <section className="leave-balances" aria-label={t('leave.myBalance')}>
          {balance.types.length === 0 ? <p className="muted small">{t('leave.noTypes')}</p> : balance.types.map((b) => (
            <div key={b.id} className="fee-tile leave-tile">
              <span>{b.name}</span>
              <strong>{b.left === null ? '∞' : b.left}</strong>
              <em className="muted">{b.allowed === null ? t('leave.takenNoLimit', { n: b.taken }) : t('leave.tileText', { taken: b.taken, of: b.allowed })}{b.waiting ? ` · ${t('leave.waitingN', { n: b.waiting })}` : ''}</em>
              {b.allowed !== null && <span className="leave-meter" aria-hidden><span style={{ width: `${Math.min(100, ((b.taken + b.waiting) / b.allowed) * 100)}%` }} /></span>}
            </div>
          ))}
        </section>
      )}

      {(office || me.employee) && (
        <div className="tabs" role="tablist" aria-label={t('leave.title')}>
          {me.employee && <button role="tab" type="button" aria-selected={tab === 'mine'} className={`tab ${tab === 'mine' ? 'on' : ''}`} onClick={() => { setTab('mine'); setPage(1); }}>{t('leave.mine')}</button>}
          {office && <button role="tab" type="button" aria-selected={tab === 'all'} className={`tab ${tab === 'all' ? 'on' : ''}`} onClick={() => { setTab('all'); setPage(1); }}>{t('leave.all')}</button>}
        </div>
      )}
      <div className="card filter-bar">
        <label className="filter"><span>{t('common.status')}</span>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">{t('stu.all')}</option>
            {['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].map((s) => <option key={s} value={s}>{t(`leave.st.${s}` as MessageKey)}</option>)}
          </select>
        </label>
        {tab === 'all' && (
          <label className="filter"><span>{t('leave.who')}</span>
            <select value={who} onChange={(e) => { setWho(e.target.value); setPage(1); }}>
              <option value="">{t('leave.everyone')}</option>
              <option value="STUDENT">{t('leave.students')}</option>
              <option value="EMPLOYEE">{t('staff.title')}</option>
            </select>
          </label>
        )}
      </div>

      {!me.employee && !office ? <EmptyState icon="users" title={t('leave.notLinked')} text={t('leave.notLinkedText')} />
        : data === null ? <SkeletonRows rows={4} />
          : data.total === 0 ? <EmptyState icon="calendar" title={t('leave.none')} />
            : <DataTable rows={data.items} columns={columns} rowKey={(r) => r.id} caption={t('leave.title')} remote={{ total: data.total, page, size, sort: null, loading: false, onChange: (n) => { setPage(n.page); setSize(n.size); } }} />}

      {dialog && <ApplyLeaveDialog kind={dialog.kind} self={dialog.self} types={types} onClose={() => setDialog(null)}
        onDone={(st) => { setDialog(null); toast(st === 'APPROVED' ? t('leave.approvedNow') : t('leave.sentForApproval')); setReload((n) => n + 1); }} />}
      {cancelling && (
        <Modal open onClose={() => setCancelling(null)} title={t('leave.withdrawTitle')} subtitle={`${cancelling.leaveType.name} · ${span(cancelling)}`} submitLabel={t('leave.withdraw')} danger busy={busy} error={error}
          onSubmit={(e) => { e.preventDefault(); void cancel(); }}>
          <p>{t('leave.withdrawText')}</p>
        </Modal>
      )}
    </>
  );
}
