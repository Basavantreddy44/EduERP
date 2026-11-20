'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, StatTile } from '@/components/ui';
import { fmtDate, inr, qty, unitLabel, useInvOptions } from '@/components/inventory';

interface Row { storeId: string; store: string; itemId: string; itemCode: string; item: string; category: string; unit: string; quantity: string; avgCost: string; value: string; reorderLevel: string; low: boolean }
interface Ledger {
  item: { id: string; itemCode: string; name: string; unit: string; reorderLevel: string };
  balances: { store: string; quantity: string; avgCost: string; value: string }[];
  rows: { id: string; date: string; store: string; txnType: string; quantity: string; rate: string; value: string; balanceAfter: string; remarks: string | null }[];
}

/** Inventory → Stock (M17.1, M17.4): what is in each store, its value, and what is running low. */
export default function StockPage() {
  const { can } = useSession();
  const { t, locale } = useI18n();
  const opts = useInvOptions();
  const [storeId, setStoreId] = useState('');
  const [low, setLow] = useState(false);
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ rows: Row[]; totalValue: string } | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const load = useCallback(() => {
    setData(null);
    const p = new URLSearchParams();
    if (storeId) p.set('storeId', storeId);
    if (low) p.set('low', 'true');
    api<{ rows: Row[]; totalValue: string }>(`/inventory/stock?${p}`).then(setData).catch(() => setData({ rows: [], totalValue: '0.00' }));
  }, [storeId, low]);
  useEffect(load, [load]);
  const openLedger = (r: Row) => { api<Ledger>(`/inventory/items/${r.itemId}/ledger${storeId ? `?storeId=${storeId}` : ''}`).then(setLedger).catch(() => setLedger(null)); };
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = (data?.rows ?? []).filter((r) => words.every((w) => `${r.item} ${r.itemCode} ${r.category}`.toLowerCase().includes(w)));
  const lowCount = (data?.rows ?? []).filter((r) => r.low).length;
  return (
    <>
      <PageHeader eyebrow={t('nav.inventory')} title={t('inv.stock.title')} description={t('inv.stock.desc')}
        actions={<>
          {can(PERMISSIONS.INV_ISSUE) && <Link href="/inventory/issues?new=1" className="btn"><Icon name="swap" /> {t('inv.iss.new')}</Link>}
          {can(PERMISSIONS.INV_REQUEST) && <Link href="/inventory/requests?new=1" className="btn btn-primary"><Icon name="plus" /> {t('inv.pr.new')}</Link>}
        </>} />
      <div className="stats pay-stats">
        <StatTile icon="rupee" label={t('inv.stock.value')} value={data ? inr(data.totalValue) : '…'} hint={t('inv.stock.valueHint')} />
        <StatTile icon="layers" label={t('inv.stock.lines')} value={data ? data.rows.filter((r) => Number(r.quantity) > 0).length : '…'} />
        <StatTile icon="alert" label={t('inv.stock.lowCount')} value={data ? lowCount : '…'} />
        <StatTile icon="building" label={t('inv.stock.stores')} value={opts ? opts.stores.length : '…'} href="/inventory/setup" />
      </div>
      <div className="filter-bar card">
        <label className="inv-f">{t('inv.store')}
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)}><option value="">{t('inv.allStores')}</option>{opts?.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </label>
        <label className="inv-f">{t('inv.search')}<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('inv.searchHint')} /></label>
        <label className="check"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> {t('inv.stock.onlyLow')}</label>
      </div>
      {!data ? <SkeletonRows rows={5} /> : !rows.length ? (
        <EmptyState icon="layers" title={low ? t('inv.stock.noneLow') : t('inv.stock.none')} text={low ? undefined : t('inv.stock.noneHint')}
          action={!low && can(PERMISSIONS.INV_SETUP) ? <Link href="/inventory/setup" className="btn btn-primary">{t('inv.setup.title')}</Link> : undefined} />
      ) : (
        <div className="table-wrap card" role="region" aria-label={t('inv.stock.title')} tabIndex={0}>
          <table className="table">
            <thead><tr><th scope="col">{t('inv.item')}</th><th scope="col">{t('inv.store')}</th><th scope="col" className="num">{t('inv.inHand')}</th><th scope="col" className="num">{t('inv.reorder')}</th><th scope="col" className="num">{t('inv.avgRate')}</th><th scope="col" className="num">{t('inv.value')}</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={`${r.storeId}-${r.itemId}`} className={r.low ? 'row-warn' : undefined}>
                <td><button type="button" className="btn-link" onClick={() => openLedger(r)}><strong>{r.item}</strong></button><span className="sub-line muted small"><span className="mono">{r.itemCode}</span> · {r.category}</span></td>
                <td>{r.store}</td>
                <td className="num"><strong>{qty(r.quantity)}</strong> <span className="muted small">{unitLabel(t, r.unit)}</span>{r.low && <span className="sub-line"><span className="pill pill-warn"><span className="pill-dot" />{t('inv.low')}</span></span>}</td>
                <td className="num muted">{Number(r.reorderLevel) > 0 ? qty(r.reorderLevel) : '—'}</td>
                <td className="num">{inr(r.avgCost)}</td>
                <td className="num">{inr(r.value)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Modal open={!!ledger} onClose={() => setLedger(null)} title={ledger ? t('inv.ledger.title', { item: ledger.item.name }) : ''} subtitle={ledger ? `${ledger.item.itemCode} · ${t('inv.ledger.sub')}` : undefined} onSubmit={() => setLedger(null)} submitLabel={t('common.close')} hideCancel wide>
        {ledger && (
          <>
            {ledger.balances.length > 0 && <ul className="lib-mini">{ledger.balances.map((b) => <li key={b.store}><span>{b.store}</span><span><strong>{qty(b.quantity)}</strong> {unitLabel(t, ledger.item.unit)} · {inr(b.value)}</span></li>)}</ul>}
            {!ledger.rows.length ? <p className="muted">{t('inv.ledger.none')}</p> : (
              <div className="table-wrap" role="region" aria-label={t('inv.ledger.title', { item: ledger.item.name })} tabIndex={0}>
                <table className="table">
                  <thead><tr><th scope="col">{t('inv.date')}</th><th scope="col">{t('inv.ledger.what')}</th><th scope="col" className="num">{t('inv.ledger.in')}</th><th scope="col" className="num">{t('inv.ledger.out')}</th><th scope="col" className="num">{t('inv.rate')}</th><th scope="col" className="num">{t('inv.ledger.balance')}</th></tr></thead>
                  <tbody>{ledger.rows.map((r) => {
                    const out = ['ISSUE_OUT', 'TRANSFER_OUT', 'ADJUST_OUT'].includes(r.txnType);
                    return (
                      <tr key={r.id}>
                        <td className="small">{fmtDate(locale, r.date)}</td>
                        <td>{t(`inv.txn.${r.txnType}` as MessageKey)}<span className="sub-line muted small">{r.store}{r.remarks ? ` · ${r.remarks}` : ''}</span></td>
                        <td className="num">{out ? '' : qty(r.quantity)}</td>
                        <td className="num">{out ? qty(r.quantity) : ''}</td>
                        <td className="num small">{inr(r.rate)}</td>
                        <td className="num"><strong>{qty(r.balanceAfter)}</strong></td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
