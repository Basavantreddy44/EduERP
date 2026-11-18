'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { EMPLOYEE_STATUSES, EMPLOYEE_TYPES, PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { FieldErrors, apiErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Column, DataTable } from '@/components/DataTable';
import { ExportButton } from '@/components/ExportButton';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { useDay } from '@/components/admissions';
import { initials } from '@/components/students';
import { StaffForm, StaffRow, fmtPhone, staffName, useStaffOptions } from '@/components/staff';

interface Page { items: StaffRow[]; total: number; page: number; pageSize: number }
type Sort = { key: string; dir: 'asc' | 'desc' } | null;

/** Staff list (M3.1): search, filters, add, import / export. */
export default function StaffPage() {
  const { can, campusId } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const day = useDay();
  const router = useRouter();
  const opts = useStaffOptions();
  const canManage = can(PERMISSIONS.HR_STAFF_MANAGE);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [type, setType] = useState('');
  const [dept, setDept] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [sort, setSort] = useState<Sort>(null);
  const [data, setData] = useState<Page | null>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const seq = useRef(0);

  useEffect(() => { const h = window.setTimeout(() => { setQ(text.trim()); setPage(1); }, 250); return () => window.clearTimeout(h); }, [text]);
  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (campusId) p.set('campusId', campusId);
    if (status) p.set('status', status);
    if (type) p.set('employeeType', type);
    if (dept) p.set('departmentId', dept);
    if (sort) { p.set('sort', sort.key); p.set('dir', sort.dir); }
    p.set('page', String(page));
    p.set('pageSize', String(size));
    return p.toString();
  }, [q, campusId, status, type, dept, sort, page, size]);
  useEffect(() => {
    const n = ++seq.current;
    setLoading(true);
    api<Page>(`/staff?${query}`)
      .then((d) => n === seq.current && setData(d))
      .catch(() => n === seq.current && setData({ items: [], total: 0, page: 1, pageSize: 25 }))
      .finally(() => n === seq.current && setLoading(false));
  }, [query]);

  async function add(body: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      const e = await api<StaffRow>('/staff', { method: 'POST', body: JSON.stringify(body) });
      toast(t('staff.added', { name: staffName(e), code: e.employeeCode }));
      setAdding(false);
      router.push(`/staff/${e.id}`);
    } catch (e) { const r = apiErrors(e); setErrors(r.fields); setError(r.message); } finally { setBusy(false); }
  }

  const counts = opts?.counts ?? {};
  const all = Object.values(counts).reduce((a, b) => a + b, 0);
  const depts = (opts?.departments ?? []).filter((d) => !campusId || !d.campusId || d.campusId === campusId);
  const multiCampus = (opts?.campuses.length ?? 0) > 1;
  const filtered = !!(q || type || dept);

  const columns: Column<StaffRow>[] = [
    {
      key: 'name', header: t('staff.col.name'), sort: () => null,
      cell: (r) => (
        <Link href={`/staff/${r.id}`} className="person-cell">
          <span className="avatar avatar-sm" aria-hidden="true">{initials(r)}</span>
          <span><strong>{staffName(r)}</strong><span className="sub-line muted">{r.designation ?? t(`staff.type.${r.employeeType}` as MessageKey)}</span></span>
        </Link>
      ),
    },
    { key: 'code', header: t('staff.code'), sort: () => null, cell: (r) => <span className="mono">{r.employeeCode}</span> },
    { key: 'dept', header: t('staff.department'), className: 'hide-sm', cell: (r) => <span>{r.department?.name ?? <span className="muted">—</span>}{multiCampus && <span className="sub-line muted">{r.campus.code}</span>}</span> },
    { key: 'phone', header: t('staff.mobile'), cell: (r) => (r.phone ? <a href={`tel:${r.phone}`}>{fmtPhone(r.phone)}</a> : <span className="muted">—</span>) },
    { key: 'joining', header: t('staff.joining'), sort: () => null, className: 'hide-sm', cell: (r) => day(r.joiningDate) },
    { key: 'login', header: t('staff.login'), className: 'hide-sm', cell: (r) => (r.user ? <span className="pill pill-ok"><Icon name="check" size={12} /> {t('staff.hasLogin')}</span> : <span className="muted small">{t('staff.noLogin')}</span>) },
    { key: 'status', header: t('common.status'), cell: (r) => <StatusBadge status={r.status} label={t(`staff.status.${r.status}` as MessageKey)} /> },
  ];

  return (
    <>
      <PageHeader
        eyebrow={t('nav.people')}
        title={t('staff.title')}
        description={t('staff.desc')}
        actions={
          <>
            {canManage && <Link className="btn" href="/imports"><Icon name="upload" /> {t('staff.import')}</Link>}
            <ExportButton type="STAFF" />
            {canManage && opts && opts.campuses.length > 0 && <button type="button" className="btn btn-primary" onClick={() => { setError(null); setErrors({}); setAdding(true); }}><Icon name="plus" /> {t('staff.add')}</button>}
          </>
        }
      />

      <div className="tabs scroll" role="tablist" aria-label={t('common.status')}>
        {['ACTIVE', ...EMPLOYEE_STATUSES.filter((s) => s !== 'ACTIVE' && (counts[s] || status === s)), ''].map((s) => (
          <button key={s || 'ALL'} role="tab" type="button" aria-selected={status === s} className={`tab ${status === s ? 'on' : ''}`} onClick={() => { setStatus(s); setPage(1); }}>
            {s ? t(`staff.status.${s}` as MessageKey) : t('stu.all')}
            <span className="tab-count">{(s ? counts[s] ?? 0 : all).toLocaleString('en-IN')}</span>
          </button>
        ))}
      </div>

      <div className="card filter-bar">
        <label className="search-box">
          <Icon name="search" size={18} />
          <span className="sr-only">{t('common.search')}</span>
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('staff.search')} autoComplete="off" />
        </label>
        <label className="filter">
          <span>{t('staff.type')}</span>
          <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
            <option value="">{t('staff.allTypes')}</option>
            {EMPLOYEE_TYPES.map((x) => <option key={x} value={x}>{t(`staff.type.${x}` as MessageKey)}</option>)}
          </select>
        </label>
        <label className="filter">
          <span>{t('staff.department')}</span>
          <select value={dept} onChange={(e) => { setDept(e.target.value); setPage(1); }}>
            <option value="">{t('staff.allDepts')}</option>
            {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        {filtered && <button type="button" className="btn btn-ghost btn-sm clear-filters" onClick={() => { setText(''); setType(''); setDept(''); }}><Icon name="x" size={15} /> {t('stu.clear')}</button>}
      </div>

      {data === null || !opts ? <SkeletonRows rows={6} /> : all === 0 ? (
        <EmptyState icon="users" title={t('staff.emptyTitle')} text={t('staff.emptyText')}
          action={canManage ? <><button type="button" className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" /> {t('staff.add')}</button><Link className="btn" href="/imports"><Icon name="upload" /> {t('staff.import')}</Link></> : undefined} />
      ) : data.total === 0 ? (
        <EmptyState icon="search" title={t('common.noMatches')} text={t('staff.noMatch')} />
      ) : (
        <>
          <p className="list-meta muted" aria-live="polite">{t('staff.found', { n: data.total.toLocaleString('en-IN') })}</p>
          <DataTable rows={data.items} columns={columns} rowKey={(r) => r.id} caption={t('staff.title')}
            remote={{ total: data.total, page, size, sort, loading, onChange: (n) => { setPage(n.page); setSize(n.size); setSort(n.sort ? { key: n.sort.key, dir: n.sort.dir } : null); } }} />
        </>
      )}

      {adding && opts && (
        <StaffForm opts={opts} defaultCampusId={campusId || undefined} busy={busy} error={error} errors={errors} setErrors={setErrors} onClose={() => setAdding(false)} onSave={(b) => void add(b)} />
      )}
    </>
  );
}
