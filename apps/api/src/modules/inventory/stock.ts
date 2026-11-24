import { fromPaise, toPaise } from '@eduerp/shared';
import { Tx } from '../../common/prisma.service';
import { Conflict } from '../../common/problem';

/**
 * Stock movements (Phase 17). Quantities are kept to 2 decimals (handled as hundredths), values in
 * paise; the balance row is locked for every movement and the ledger row records the balance after.
 * Weighted average: a receipt adds its value; an issue takes value at the current average (all of it
 * when the store empties), so value never drifts from quantity.
 */
export const qh = (v: { toString(): string } | string | number | null | undefined) => (v == null ? 0 : toPaise(String(v)));
export const fromQh = fromPaise;
const rate4 = (valuePaise: number, quantityH: number) => (quantityH > 0 ? (valuePaise / quantityH).toFixed(4) : '0.0000');

export type TxnType = 'OPENING' | 'GRN_IN' | 'ISSUE_OUT' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'ADJUST_IN' | 'ADJUST_OUT';
export type RefType = 'OPENING' | 'GRN' | 'ISSUE' | 'TRANSFER' | 'COUNT' | 'WELFARE';
const OUT: TxnType[] = ['ISSUE_OUT', 'TRANSFER_OUT', 'ADJUST_OUT'];

export interface Move { tenantId: string; storeId: string; itemId: string; quantityH: number; date: string; txnType: TxnType; refType: RefType; refId: string | null; userId: string | null; remarks?: string | null; /** Receipts: rate per unit (paise); issues use the average. */ ratePaise?: number; /** Transfers in: the exact value that left the other store. */ valuePaise?: number }

/** Locks (creating if needed) the balance row of an item in a store. */
export async function lockBalance(tx: Tx, tenantId: string, storeId: string, itemId: string) {
  await tx.$executeRaw`INSERT INTO stock_balances (id, tenant_id, store_id, item_id, updated_at) VALUES (gen_random_uuid(), ${tenantId}::uuid, ${storeId}::uuid, ${itemId}::uuid, now()) ON CONFLICT (store_id, item_id) DO NOTHING`;
  const rows = await tx.$queryRaw<{ id: string; quantity: string; value: string }[]>`SELECT id, quantity::text, value::text FROM stock_balances WHERE store_id = ${storeId}::uuid AND item_id = ${itemId}::uuid FOR UPDATE`;
  return { id: rows[0].id, quantityH: qh(rows[0].quantity), valuePaise: toPaise(rows[0].value) };
}

/** Applies one movement; returns the value moved (paise) and the rate used. */
export async function move(tx: Tx, m: Move, itemName = 'This item') {
  if (m.quantityH <= 0) throw new Error('quantity must be positive');
  const b = await lockBalance(tx, m.tenantId, m.storeId, m.itemId);
  const out = OUT.includes(m.txnType);
  let valuePaise: number;
  let q = b.quantityH;
  let v = b.valuePaise;
  if (out) {
    if (m.quantityH > q) throw Conflict('insufficient-stock', `${itemName}: only ${fromQh(q)} in this store`);
    valuePaise = m.quantityH === q ? v : Math.round((v * m.quantityH) / q);
    q -= m.quantityH;
    v -= valuePaise;
  } else {
    valuePaise = m.valuePaise ?? Math.round((m.quantityH * (m.ratePaise ?? 0)) / 100);
    q += m.quantityH;
    v += valuePaise;
  }
  await tx.stockBalance.update({ where: { id: b.id }, data: { quantity: fromQh(q), value: fromPaise(v), avgCost: rate4(v, q) } });
  await tx.stockTransaction.create({
    data: {
      tenantId: m.tenantId, storeId: m.storeId, itemId: m.itemId, txnDate: new Date(`${m.date}T00:00:00Z`), txnType: m.txnType, quantity: fromQh(m.quantityH),
      rate: rate4(valuePaise, m.quantityH), value: fromPaise(valuePaise), referenceType: m.refType, referenceId: m.refId, balanceAfter: fromQh(q), valueAfter: fromPaise(v),
      remarks: m.remarks ?? null, createdBy: m.userId,
    },
  });
  return { valuePaise, rate: rate4(valuePaise, m.quantityH) };
}
