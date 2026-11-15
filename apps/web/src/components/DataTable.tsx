'use client';

import { ReactNode, useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { Icon } from './Icon';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Value used for sorting; omit to make the column not sortable. */
  sort?: (row: T) => string | number | null;
  align?: 'left' | 'right';
  className?: string;
}

/** Server-side paging and sorting: the parent fetches one page; the table only draws it. */
export interface RemoteState {
  total: number;
  page: number;
  size: number;
  sort: { key: string; dir: 'asc' | 'desc' } | null;
  onChange: (next: { page: number; size: number; sort: { key: string; dir: 'asc' | 'desc' } | null }) => void;
  loading?: boolean;
}

/**
 * Accessible table with click-to-sort headers (aria-sort), paging and an optional row class.
 * Client-side by default; with `remote` (large lists such as students) the server sorts and pages.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  rowClass,
  pageSizes = [25, 50, 100],
  initialSort,
  caption,
  remote,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  rowClass?: (row: T) => string | undefined;
  pageSizes?: number[];
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  caption?: string;
  remote?: RemoteState;
}) {
  const { t, locale } = useI18n();
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSizes[0]);

  const sorted = useMemo(() => {
    if (!sort || remote) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    return [...rows].sort((a, b) => {
      const x = col.sort!(a);
      const y = col.sort!(b);
      const r = x === null ? 1 : y === null ? -1 : typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y));
      return sort.dir === 'asc' ? r : -r;
    });
  }, [rows, columns, sort, locale, remote]);

  const total = remote ? remote.total : sorted.length;
  const curPage = remote ? remote.page : page;
  const curSize = remote ? remote.size : size;
  const curSort = remote ? remote.sort : sort;
  const pages = Math.max(1, Math.ceil(total / curSize));
  useEffect(() => { if (!remote) setPage((p) => Math.min(p, pages)); }, [pages, remote]);
  const shown = remote ? rows : sorted.slice((page - 1) * size, page * size);

  const nextSort = (key: string) => (curSort?.key === key ? { key, dir: curSort.dir === 'asc' ? ('desc' as const) : ('asc' as const) } : { key, dir: 'asc' as const });
  const toggle = (key: string) => (remote ? remote.onChange({ page: 1, size: remote.size, sort: nextSort(key) }) : setSort(nextSort(key)));
  const goPage = (p: number) => (remote ? remote.onChange({ page: p, size: remote.size, sort: remote.sort }) : setPage(p));
  const goSize = (n: number) => (remote ? remote.onChange({ page: 1, size: n, sort: remote.sort }) : (setSize(n), setPage(1)));

  return (
    <div className={`table-wrap ${remote?.loading ? 'is-loading' : ''}`} aria-busy={remote?.loading || undefined}>
      <table>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => {
              const active = curSort?.key === c.key;
              return (
                <th key={c.key} className={`${c.align === 'right' ? 'num' : ''} ${c.className ?? ''}`} aria-sort={c.sort ? (active ? (curSort!.dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined} scope="col">
                  {c.sort ? (
                    <button type="button" className={`th-sort ${active ? 'on' : ''}`} onClick={() => toggle(c.key)}>
                      {c.header}
                      <Icon name="chevronDown" size={14} className={`sort-icon ${active && curSort!.dir === 'asc' ? 'up' : ''}`} />
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={rowKey(r)} className={rowClass?.(r)}>
              {columns.map((c) => <td key={c.key} className={`${c.align === 'right' ? 'num' : ''} ${c.className ?? ''}`}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {total > pageSizes[0] && (
        <div className="pager">
          <label className="pager-size">
            {t('common.rowsPerPage')}
            <select value={curSize} onChange={(e) => goSize(Number(e.target.value))}>
              {pageSizes.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <span className="muted" aria-live="polite">{t('common.showing', { from: (curPage - 1) * curSize + 1, to: Math.min(curPage * curSize, total), total })}</span>
          <div className="pager-buttons">
            <button type="button" className="btn btn-sm" disabled={curPage <= 1} onClick={() => goPage(curPage - 1)} aria-label={t('common.previous')}><Icon name="chevronRight" size={16} className="flip" /></button>
            <span className="pager-page">{curPage} / {pages}</span>
            <button type="button" className="btn btn-sm" disabled={curPage >= pages} onClick={() => goPage(curPage + 1)} aria-label={t('common.next')}><Icon name="chevronRight" size={16} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
