'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { PERMISSIONS, STUDENT_STATUSES } from '@eduerp/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Column, DataTable } from '@/components/DataTable';
import { ExportButton } from '@/components/ExportButton';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge } from '@/components/ui';
import { initials, studentName, useStudentOptions } from '@/components/students';

interface Row {
  id: string; admissionNo: string; firstName: string; lastName: string | null; gender: string; dob: string; status: string; campusCode: string;
  rollNo: string | null; sectionName: string | null; levelName: string | null; programName: string | null; guardianName: string | null; guardianPhone: string | null;
}
interface Page { items: Row[]; total: number; page: number; pageSize: number; summary: { byStatus: Record<string, number> }; tookMs: number }

type Sort = { key: string; dir: 'asc' | 'desc' } | null;
const SORT_KEYS: Record<string, string> = { name: 'name', admissionNo: 'admissionNo', class: 'class' };

function StudentsInner() {
  const { can, campusId } = useSession();
  const { t } = useI18n();
  const path = usePathname();
  const params = useSearchParams();
  const opts = useStudentOptions(params.get('year') ?? undefined);
  const canManage = can(PERMISSIONS.STU_STUDENT_MANAGE);

  // Filters live in the address bar, so "Back" from a profile returns to the same list.
  const f = {
    q: params.get('q') ?? '',
    status: params.get('status') ?? '',
    year: params.get('year') ?? '',
    level: params.get('class') ?? '',
    section: params.get('section') ?? '',
    page: Number(params.get('page') ?? 1) || 1,
    size: Number(params.get('size') ?? 25) || 25,
    sort: (params.get('sort') ? { key: params.get('sort')!, dir: (params.get('dir') === 'desc' ? 'desc' : 'asc') } : null) as Sort,
  };
  // Once a link is clicked (a profile, the menu), a pending search update must not overwrite the page being opened.
  const leaving = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]');
      if (a && !(a as HTMLAnchorElement).href.includes('#')) { leaving.current = true; window.clearTimeout(timer.current); }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
  const setParams = useCallback((next: Record<string, string | number | null>) => {
    if (leaving.current) return;
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === '' || (k === 'page' && v === 1) || (k === 'size' && v === 25)) p.delete(k);
      else p.set(k, String(v));
    }
    const s = p.toString();
    // Shallow update: Next keeps useSearchParams in sync without a server round trip, so typing stays instant.
    window.history.replaceState(null, '', s ? `${path}?${s}` : path);
  }, [params, path]);

  // Search box: typed text is applied after a short pause.
  const [text, setText] = useState(f.q);
  useEffect(() => setText(f.q), [f.q]);
  useEffect(() => {
    if (text === f.q) return;
    timer.current = window.setTimeout(() => setParams({ q: text.trim() || null, page: 1 }), 250);
    return () => window.clearTimeout(timer.current);
  }, [text, f.q, setParams]);

  const [data, setData] = useState<Page | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (f.q) q.set('q', f.q);
    if (campusId) q.set('campusId', campusId);
    if (f.year) q.set('academicYearId', f.year);
    if (f.level) q.set('programLevelId', f.level);
    if (f.section) q.set('sectionId', f.section);
    if (f.status) q.set('status', f.status);
    if (f.sort) { q.set('sort', SORT_KEYS[f.sort.key] ?? 'name'); q.set('dir', f.sort.dir); }
    q.set('page', String(f.page));
    q.set('pageSize', String(f.size));
    return q.toString();
  }, [f.q, campusId, f.year, f.level, f.section, f.status, f.sort?.key, f.sort?.dir, f.page, f.size]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const n = ++seq.current;
    setLoading(true);
    api<Page>(`/students?${query}`)
      .then((d) => n === seq.current && setData(d))
      .catch(() => n === seq.current && setData({ items: [], total: 0, page: 1, pageSize: 25, summary: { byStatus: {} }, tookMs: 0 }))
      .finally(() => n === seq.current && setLoading(false));
  }, [query]);

  const counts = data?.summary.byStatus ?? {};
  const all = Object.values(counts).reduce((a, b) => a + b, 0);
  const tabs = ['', ...STUDENT_STATUSES.filter((s) => s === 'ACTIVE' || counts[s] || f.status === s)];
  const filtered = !!(f.q || f.level || f.section || f.status);
  const sections = (opts?.sections ?? []).filter((s) => s.programLevelId === f.level);
  const programs = (opts?.programs ?? []).filter((p) => !campusId || p.campusId === campusId);
  const multiCampus = new Set(programs.map((p) => p.campusId)).size > 1;
  const campusName = (id: string) => opts?.campuses.find((c) => c.id === id)?.name ?? '';

  const columns: Column<Row>[] = [
    {
      key: 'name', header: t('stu.col.student'), sort: () => null,
      cell: (r) => (
        <Link href={`/students/${r.id}`} className="person-cell">
          <span className="avatar avatar-sm" aria-hidden="true">{initials(r)}</span>
          <span><strong>{studentName(r)}</strong><span className="sub-line muted mono show-sm">{r.admissionNo}</span></span>
        </Link>
      ),
    },
    {
      key: 'class', header: t('stu.col.class'), sort: () => null,
      cell: (r) => r.levelName ? (
        <span><strong>{r.levelName} – {r.sectionName}</strong><span className="sub-line muted">{r.programName}{r.rollNo ? ` · ${t('stu.roll')} ${r.rollNo}` : ''}{multiCampus ? ` · ${r.campusCode}` : ''}</span></span>
      ) : <span className="muted">{t('stu.noClass')}</span>,
    },
    {
      key: 'parent', header: t('stu.col.parent'),
      cell: (r) => r.guardianName ? (
        <span>{r.guardianName}{r.guardianPhone && <span className="sub-line"><a href={`tel:${r.guardianPhone}`} className="muted">{r.guardianPhone.replace(/(\d{5})(\d{5})/, '$1 $2')}</a></span>}</span>
      ) : <span className="muted">—</span>,
    },
    { key: 'admissionNo', header: t('stu.col.admNo'), sort: () => null, className: 'hide-sm', cell: (r) => <span className="mono">{r.admissionNo}</span> },
    { key: 'status', header: t('common.status'), cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'go', header: <span className="sr-only">{t('common.open')}</span>, align: 'right', cell: (r) => <Link className="btn btn-sm btn-ghost" href={`/students/${r.id}`} aria-label={`${t('common.open')} ${studentName(r)}`}><Icon name="chevronRight" size={16} /></Link> },
  ];

  return (
    <>
      <PageHeader
        eyebrow={t('nav.students')}
        title={t('stu.title')}
        description={t('stu.desc')}
        actions={
          <>
            {canManage && <Link className="btn" href="/imports"><Icon name="upload" /> {t('stu.import')}</Link>}
            <ExportButton type="STUDENTS" />
          </>
        }
      />

      <div className="tabs scroll" role="tablist" aria-label={t('common.status')}>
        {tabs.map((s) => (
          <button key={s || 'ALL'} role="tab" type="button" aria-selected={f.status === s} className={`tab ${f.status === s ? 'on' : ''}`} onClick={() => setParams({ status: s || null, page: 1 })}>
            {s ? t(`status.${s}` as MessageKey) : t('stu.all')}
            <span className="tab-count">{(s ? counts[s] ?? 0 : all).toLocaleString('en-IN')}</span>
          </button>
        ))}
      </div>

      <div className="card filter-bar">
        <label className="search-box">
          <Icon name="search" size={18} />
          <span className="sr-only">{t('common.search')}</span>
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('stu.search')} autoComplete="off" />
        </label>
        {opts && opts.years.length > 1 && (
          <label className="filter">
            <span>{t('adm.year')}</span>
            <select value={f.year || opts.year?.id || ''} onChange={(e) => setParams({ year: opts.years.find((y) => y.id === e.target.value)?.isCurrent ? null : e.target.value, class: null, section: null, page: 1 })}>
              {opts.years.map((y) => <option key={y.id} value={y.id}>{y.name}{y.isCurrent ? ` · ${t('stu.current')}` : ''}</option>)}
            </select>
          </label>
        )}
        <label className="filter">
          <span>{t('stu.col.class')}</span>
          <select value={f.level} onChange={(e) => setParams({ class: e.target.value || null, section: null, page: 1 })}>
            <option value="">{t('stu.allClasses')}</option>
            {programs.map((p) => (
              <optgroup key={p.id} label={multiCampus ? `${campusName(p.campusId)} · ${p.name}` : p.name}>
                {p.levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="filter">
          <span>{t('stu.section')}</span>
          <select value={f.section} disabled={!f.level} onChange={(e) => setParams({ section: e.target.value || null, page: 1 })}>
            <option value="">{t('stu.allSections')}</option>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        {filtered && (
          <button type="button" className="btn btn-ghost btn-sm clear-filters" onClick={() => { setText(''); setParams({ q: null, class: null, section: null, status: null, page: 1 }); }}>
            <Icon name="x" size={15} /> {t('stu.clear')}
          </button>
        )}
      </div>

      {data === null ? (
        <SkeletonRows rows={6} />
      ) : data.total === 0 && !filtered && all === 0 ? (
        <EmptyState
          icon="cap"
          title={t('stu.emptyTitle')}
          text={t('stu.emptyText')}
          action={
            <>
              {can(PERMISSIONS.ADM_APPLICATION_MANAGE) && <Link className="btn btn-primary" href="/admissions/applications"><Icon name="clipboard" /> {t('nav.applications')}</Link>}
              {canManage && <Link className="btn" href="/imports"><Icon name="upload" /> {t('stu.import')}</Link>}
            </>
          }
        />
      ) : data.total === 0 ? (
        <EmptyState icon="search" title={t('common.noMatches')} text={t('stu.noMatchHint')} />
      ) : (
        <>
          <p className="list-meta muted" aria-live="polite">
            {t('stu.found', { n: data.total.toLocaleString('en-IN') })}
            {opts?.year && <> · {t('stu.classIn', { year: opts.years.find((y) => y.id === f.year)?.name ?? opts.year.name })}</>}
          </p>
          <DataTable
            rows={data.items}
            columns={columns}
            rowKey={(r) => r.id}
            caption={t('stu.title')}
            remote={{ total: data.total, page: f.page, size: f.size, sort: f.sort, loading, onChange: (n) => setParams({ page: n.page, size: n.size, sort: n.sort?.key ?? null, dir: n.sort?.dir === 'desc' ? 'desc' : null }) }}
          />
        </>
      )}
    </>
  );
}

export default function StudentsPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={6} />}>
      <StudentsInner />
    </Suspense>
  );
}

