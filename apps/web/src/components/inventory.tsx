'use client';

import { useEffect, useState } from 'react';
import { formatINR, toPaise } from '@eduerp/shared';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';

/** Phase 17 inventory & purchase: shared bits for the stock, purchase and store screens. */

export interface InvOptions {
  categories: { id: string; name: string }[];
  stores: { id: string; name: string; campusId: string }[];
  departments: { id: string; name: string; campusId: string | null }[];
  campuses: { id: string; name: string }[];
  vendors: { id: string; name: string; vendorCode: string }[];
  staff: { id: string; name: string; campusId: string }[];
  taxCodes: { id: string; code: string; name: string; rate: string }[];
}
export interface InvItem { id: string; itemCode: string; name: string; categoryId: string; category: string; unit: string; itemType: string; hsnCode: string | null; taxCodeId: string | null; reorderLevel: string; expenseAccountId: string | null; description: string | null; isActive: boolean; quantity: string; value: string; low: boolean }

export function useInvOptions(reload = 0) {
  const [o, setO] = useState<InvOptions | null>(null);
  useEffect(() => { api<InvOptions>('/inventory/options').then(setO).catch(() => setO({ categories: [], stores: [], departments: [], campuses: [], vendors: [], staff: [], taxCodes: [] })); }, [reload]);
  return o;
}
export function useInvItems(reload = 0) {
  const [items, setItems] = useState<InvItem[]>([]);
  useEffect(() => { api<InvItem[]>('/inventory/items').then((r) => setItems(r.filter((i) => i.isActive))).catch(() => setItems([])); }, [reload]);
  return items;
}

const TONE: Record<string, string> = {
  SUBMITTED: 'pill-warn', APPROVED: 'pill-info', REJECTED: 'pill-bad', ORDERED: 'pill-ok', CANCELLED: 'pill-muted',
  PENDING_APPROVAL: 'pill-warn', PARTIAL: 'pill-warn', RECEIVED: 'pill-ok', CLOSED: 'pill-muted', ADJUSTED: 'pill-ok', ISSUED: 'pill-ok',
};
export function InvPill({ status }: { status: string }) {
  const { t } = useI18n();
  return <span className={`pill ${TONE[status] ?? 'pill-muted'}`}><span className="pill-dot" />{t(`inv.st.${status}` as MessageKey)}</span>;
}

export const inr = (v: string | number | null | undefined) => (v === '' || v == null ? '' : formatINR(toPaise(String(v)), { paise: true }));
/** Quantities: up to two decimals, no trailing zeros. */
export const qty = (v: string | number) => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(v); };
export const unitLabel = (t: (k: MessageKey) => string, u: string) => t(`inv.unit.${u}` as MessageKey);
const paise = (v: string) => { try { return v ? toPaise(v) : 0; } catch { return 0; } };

export interface ItemLine { itemId: string; quantity: string; rate: string }
export const emptyItemLine = (): ItemLine => ({ itemId: '', quantity: '', rate: '' });

/**
 * Item lines (item + quantity, with an optional rate column and line total). Used by purchase requests,
 * direct orders, opening stock, issues and transfers.
 */
export function ItemLinesEditor({ items, lines, setLines, rateLabel, showRate = true, stockOf, error }: {
  items: InvItem[]; lines: ItemLine[]; setLines: (l: ItemLine[]) => void; rateLabel?: string; showRate?: boolean;
  /** Stock on hand for an item (issues/transfers show it beside the quantity). */
  stockOf?: (itemId: string) => string | null; error?: string;
}) {
  const { t } = useI18n();
  const set = (i: number, patch: Partial<ItemLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + Math.round((Number(l.quantity) || 0) * paise(l.rate)), 0);
  const byId = new Map(items.map((i) => [i.id, i]));
  return (
    <div className="acc-lines inv-lines">
      <table className="table">
        <thead><tr>
          <th scope="col">{t('inv.item')}</th><th scope="col" className="num">{t('inv.quantity')}</th>
          {showRate && <><th scope="col" className="num">{rateLabel ?? t('inv.rate')}</th><th scope="col" className="num">{t('inv.amount')}</th></>}
          <th scope="col"><span className="sr-only">{t('common.actions')}</span></th>
        </tr></thead>
        <tbody>
          {lines.map((l, i) => {
            const it = byId.get(l.itemId);
            const have = l.itemId && stockOf ? stockOf(l.itemId) : null;
            return (
              <tr key={i}>
                <td>
                  <select aria-label={t('inv.itemLine', { n: i + 1 })} value={l.itemId} onChange={(e) => set(i, { itemId: e.target.value })}>
                    <option value="">{t('inv.chooseItem')}</option>
                    {items.map((x) => <option key={x.id} value={x.id} disabled={lines.some((o, j) => j !== i && o.itemId === x.id)}>{x.name} · {x.itemCode}</option>)}
                  </select>
                  {have !== null && <span className="sub-line muted small">{t('inv.inStock', { q: qty(have), u: it ? unitLabel(t, it.unit) : '' })}</span>}
                </td>
                <td className="num"><input aria-label={t('inv.qtyLine', { n: i + 1 })} inputMode="decimal" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} />{it && <span className="sub-line muted small">{unitLabel(t, it.unit)}</span>}</td>
                {showRate && <>
                  <td className="num"><input aria-label={t('inv.rateLine', { n: i + 1 })} inputMode="decimal" value={l.rate} onChange={(e) => set(i, { rate: e.target.value })} /></td>
                  <td className="num">{formatINR(Math.round((Number(l.quantity) || 0) * paise(l.rate)), { paise: true })}</td>
                </>}
                <td>{lines.length > 1 && <button type="button" className="btn btn-sm btn-ghost" aria-label={t('inv.removeLine', { n: i + 1 })} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Icon name="trash" size={14} /></button>}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot><tr>
          <td><button type="button" className="btn btn-sm" onClick={() => setLines([...lines, emptyItemLine()])}><Icon name="plus" size={14} /> {t('inv.addLine')}</button></td>
          <td />
          {showRate && <><td className="num">{t('inv.total')}</td><td className="num">{formatINR(total, { paise: true })}</td></>}
          <td />
        </tr></tfoot>
      </table>
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

/** Lines ready for the API (blank rows dropped). */
export const lineItems = (lines: ItemLine[], rateKey: 'rate' | 'estimatedRate' | null) =>
  lines.filter((l) => l.itemId && l.quantity).map((l) => (rateKey ? { itemId: l.itemId, quantity: l.quantity, [rateKey]: l.rate || '0' } : { itemId: l.itemId, quantity: l.quantity }));

export const fmtDate = (locale: string, x: string | null | undefined) => (x ? new Date(`${x.slice(0, 10)}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
