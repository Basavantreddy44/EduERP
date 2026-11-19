'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatINR, toPaise } from '@eduerp/shared';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';

/** Phase 13 accounts screens: shared pieces. */
export interface ChartAccount { id: string; code: string; name: string; accountType: string; parentId: string | null; isGroup: boolean; isSystem: boolean; systemKey: string | null; isActive: boolean; balance: string; bankAccountId: string | null }
export interface BankAcct { id: string; accountId: string; ledger: string; code: string; bankName: string; branch: string | null; accountNo: string; ifsc: string; accountType: string; isFeeCollection: boolean; isActive: boolean; campusId: string | null; campus: string | null }
export interface CostCentre { id: string; code: string; name: string; campusId: string | null; campus: string | null; departmentId: string | null; department: string | null; isActive: boolean }

/** "₹12,500" from "12500.00"; blanks stay blank. */
export const rupees = (v: string | number | null | undefined, opts?: { paise?: boolean }) => (v === '' || v == null ? '' : formatINR(toPaise(String(v)), opts));
export const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
export const fyStart = (d = todayIST()) => { const [y, m] = d.split('-').map(Number); return `${m >= 4 ? y : y - 1}-04-01`; };

export function useChart(reload = 0) {
  const [rows, setRows] = useState<ChartAccount[] | null>(null);
  useEffect(() => { api<ChartAccount[]>('/accounts/chart').then(setRows).catch(() => setRows([])); }, [reload]);
  return rows;
}
export function useBanks(reload = 0) {
  const [rows, setRows] = useState<BankAcct[] | null>(null);
  useEffect(() => { api<BankAcct[]>('/accounts/bank-accounts').then(setRows).catch(() => setRows([])); }, [reload]);
  return rows;
}
export function useCostCentres() {
  const [rows, setRows] = useState<CostCentre[]>([]);
  useEffect(() => { api<CostCentre[]>('/accounts/cost-centres').then((r) => setRows(r.filter((c) => c.isActive))).catch(() => setRows([])); }, []);
  return rows;
}

/** Ledger accounts (not groups) of some types, grouped under their group in a select. */
export function AccountSelect({ id, chart, value, onChange, types, only, placeholder, invalid, label }: { id: string; chart: ChartAccount[]; value: string; onChange: (v: string) => void; types?: string[]; only?: (a: ChartAccount) => boolean; placeholder?: string; invalid?: boolean; /** For selects without a visible <label> (table rows). */ label?: string }) {
  const groups = useMemo(() => {
    const byId = new Map(chart.map((a) => [a.id, a]));
    const leaf = chart.filter((a) => !a.isGroup && a.isActive && (!types || types.includes(a.accountType)) && (!only || only(a)));
    const m = new Map<string, ChartAccount[]>();
    for (const a of leaf) { const g = a.parentId ? byId.get(a.parentId)?.name ?? '' : ''; m.set(g, [...(m.get(g) ?? []), a]); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [chart, types, only]);
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid || undefined} aria-label={label}>
      <option value="">{placeholder ?? '—'}</option>
      {groups.map(([g, list]) => <optgroup key={g} label={g}>{list.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</optgroup>)}
    </select>
  );
}

/** Money accounts: cash, petty cash and bank ledgers. */
export const isMoney = (a: ChartAccount) => ['CASH', 'PETTY_CASH', 'BANK'].includes(a.systemKey ?? '') || !!a.bankAccountId;

export const STATUS_TONE: Record<string, string> = { PENDING_APPROVAL: 'pill-warn', APPROVED: 'pill-info', PARTIAL: 'pill-warn', PAID: 'pill-ok', POSTED: 'pill-ok', REJECTED: 'pill-bad', CANCELLED: 'pill-muted', LOCKED: 'pill-muted', UNLOCKING: 'pill-warn', UNLOCKED: 'pill-info' };
export function AccPill({ status }: { status: string }) {
  const { t } = useI18n();
  return <span className={`pill ${STATUS_TONE[status] ?? 'pill-muted'}`}><span className="pill-dot" />{t(`ac2.status.${status}` as MessageKey)}</span>;
}

/** Report result as an accessible table (money right-aligned), with totals and notes. */
export interface ReportData { title: string; subtitle: string; columns: { key: string; label: string; money?: boolean }[]; rows: Record<string, string | number | null>[]; totals?: Record<string, string | number | null>; notes?: string[] }
export function ReportTable({ r }: { r: ReportData }) {
  return (
    <div className="table-wrap card acc-report" role="region" aria-label={r.title} tabIndex={0}>
      <table className="table">
        <caption className="sr-only">{r.title} — {r.subtitle}</caption>
        <thead><tr>{r.columns.map((c) => <th key={c.key} scope="col" className={c.money ? 'num' : undefined}>{c.label}</th>)}</tr></thead>
        <tbody>
          {r.rows.map((row, i) => {
            const heading = r.columns.slice(1).every((c) => row[c.key] == null || row[c.key] === '') && !!row[r.columns[0].key];
            return (
              <tr key={i} className={heading ? 'acc-heading' : /^Total/.test(String(row.account ?? row.narration ?? '')) ? 'acc-subtotal' : undefined}>
                {r.columns.map((c) => <td key={c.key} className={c.money ? 'num' : undefined}>{c.money ? rupees(row[c.key] as string, { paise: true }) : row[c.key] ?? ''}</td>)}
              </tr>
            );
          })}
        </tbody>
        {r.totals && <tfoot><tr>{r.columns.map((c) => <td key={c.key} className={c.money ? 'num' : undefined}>{c.money ? rupees(r.totals![c.key] as string, { paise: true }) : r.totals![c.key] ?? ''}</td>)}</tr></tfoot>}
      </table>
      {r.notes?.map((n) => <p key={n} className="muted small acc-note"><Icon name="info" size={14} /> {n}</p>)}
    </div>
  );
}

/** Two-sided lines editor (journal vouchers, opening balances) with a running difference. */
export interface Line { accountId: string; costCentreId: string; debit: string; credit: string }
export const emptyLine = (): Line => ({ accountId: '', costCentreId: '', debit: '', credit: '' });
export function LinesEditor({ chart, lines, setLines, costCentres, types, errors }: { chart: ChartAccount[]; lines: Line[]; setLines: (l: Line[]) => void; costCentres?: CostCentre[]; types?: string[]; errors?: string }) {
  const { t } = useI18n();
  const p = (v: string) => { try { return v ? toPaise(v) : 0; } catch { return 0; } };
  const dr = lines.reduce((s, l) => s + p(l.debit), 0);
  const cr = lines.reduce((s, l) => s + p(l.credit), 0);
  const set = useCallback((i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l))), [lines, setLines]);
  return (
    <div className="acc-lines">
      <table className="table">
        <thead><tr><th scope="col">{t('ac2.account')}</th>{costCentres && <th scope="col">{t('ac2.costCentre')}</th>}<th scope="col" className="num">{t('ac2.debit')}</th><th scope="col" className="num">{t('ac2.credit')}</th><th scope="col"><span className="sr-only">{t('common.actions')}</span></th></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td><AccountSelect id={`ln-a-${i}`} chart={chart} value={l.accountId} onChange={(v) => set(i, { accountId: v })} types={types} label={t('ac2.accountLine', { n: i + 1 })} /></td>
              {costCentres && <td><select aria-label={t('ac2.costCentre')} value={l.costCentreId} onChange={(e) => set(i, { costCentreId: e.target.value })}><option value="">—</option>{costCentres.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td>}
              <td className="num"><input aria-label={t('ac2.debitLine', { n: i + 1 })} inputMode="decimal" value={l.debit} onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} /></td>
              <td className="num"><input aria-label={t('ac2.creditLine', { n: i + 1 })} inputMode="decimal" value={l.credit} onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} /></td>
              <td>{lines.length > 2 && <button type="button" className="btn btn-sm btn-ghost" aria-label={t('ac2.removeLine', { n: i + 1 })} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Icon name="trash" size={14} /></button>}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td><button type="button" className="btn btn-sm" onClick={() => setLines([...lines, emptyLine()])}><Icon name="plus" size={14} /> {t('ac2.addLine')}</button></td>{costCentres && <td />}<td className="num">{formatINR(dr, { paise: true })}</td><td className="num">{formatINR(cr, { paise: true })}</td><td /></tr></tfoot>
      </table>
      <p className={dr === cr && dr > 0 ? 'muted small' : 'field-error'} role="status">{dr === cr && dr > 0 ? t('ac2.balanced') : t('ac2.difference', { amt: formatINR(Math.abs(dr - cr), { paise: true }) })}</p>
      {errors && <span className="field-error">{errors}</span>}
    </div>
  );
}

export const lineBody = (lines: Line[]) => lines.filter((l) => l.accountId && (l.debit || l.credit)).map((l) => ({ accountId: l.accountId, costCentreId: l.costCentreId || null, debit: l.debit || '0', credit: l.credit || '0' }));
