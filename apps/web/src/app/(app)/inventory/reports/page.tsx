'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { EmptyState, PageHeader, SkeletonRows, StatTile } from '@/components/ui';
import { todayIST } from '@/components/accounts';
import { saveText, toCsv } from '@/components/payroll';
import { InvPill, fmtDate, inr, qty, unitLabel, useInvOptions } from '@/components/inventory';

interface Consumption { from: string; to: string; rows: { department: string; item: string; unit: string; quantity: string; value: string }[]; totalValue: string }
interface Register { from: string; to: string; rows: { poNo: string; poDate: string; vendor: string; status: string; ordered: string; billed: string }[]; totalOrdered: string; totalBilled: string }
type Tab = 'consumption' | 'purchases';

/** Inventory → Reports (M17.4): what each department used, and what was ordered and billed. */
export default function InventoryReportsPage() {
  const { t, locale } = useI18n();
  const opts = useInvOptions();
  const [tab, setTab] = useState<Tab>('consumption');
  const [from, setFrom] = useState(`${todayIST().slice(0, 7)}-01`);
  const [to, setTo] = useState(todayIST());
  const [campusId, setCampusId] = useState('');
  const [cons, setCons] = useState<Consumption | null>(null);
  const [reg, setReg] = useState<Register | null>(null);
  useEffect(() => {
    const p = new URLSearchParams({ from, to });
    if (campusId) p.set('campusId', campusId);
    if (tab === 'consumption') { setCons(null); api<Consumption>(`/inventory/reports/consumption?${p}`).then(setCons).catch(() => setCons({ from, to, rows: [], totalValue: '0.00' })); }
    else { setReg(null); api<Register>(`/inventory/reports/purchases?${p}`).then(setReg).catch(() => setReg({ from, to, rows: [], totalOrdered: '0.00', totalBilled: '0.00' })); }
  }, [tab, from, to, campusId]);
  const download = () => {
    if (tab === 'consumption' && cons) {
      saveText(`consumption-${from}-to-${to}.csv`, toCsv([{ key: 'department', label: t('inv.department') }, { key: 'item', label: t('inv.item') }, { key: 'quantity', label: t('inv.quantity') }, { key: 'unit', label: t('inv.unit') }, { key: 'value', label: t('inv.value') }], cons.rows, { department: t('inv.total'), item: '', quantity: '', unit: '', value: cons.totalValue }));
    } else if (reg) {
      saveText(`purchase-register-${from}-to-${to}.csv`, toCsv([{ key: 'poNo', label: t('inv.po.no') }, { key: 'poDate', label: t('inv.date') }, { key: 'vendor', label: t('inv.vendor') }, { key: 'status', label: t('inv.status') }, { key: 'ordered', label: t('inv.rep.ordered') }, { key: 'billed', label: t('inv.rep.billed') }], reg.rows, { poNo: t('inv.total'), poDate: '', vendor: '', status: '', ordered: reg.totalOrdered, billed: reg.totalBilled }));
    }
  };
  // Department subtotals for the consumption table.
  const byDept = new Map<string, number>();
  for (const r of cons?.rows ?? []) byDept.set(r.department, (byDept.get(r.department) ?? 0) + Number(r.value));
  const ready = tab === 'consumption' ? cons : reg;
  return (
    <>
      <PageHeader eyebrow={t('nav.inventory')} title={t('inv.rep.title')} description={t('inv.rep.desc')}
        actions={<button type="button" className="btn" onClick={download} disabled={!ready || !ready.rows.length}><Icon name="download" /> {t('inv.rep.csv')}</button>} />
      <div className="tabs" role="tablist" aria-label={t('inv.rep.title')}>
        {(['consumption', 'purchases'] as Tab[]).map((x) => <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(`inv.rep.${x}` as MessageKey)}</button>)}
      </div>
      <div className="filter-bar card">
        <label className="inv-f">{t('inv.rep.from')}<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inv-f">{t('inv.rep.to')}<input type="date" value={to} min={from} max={todayIST()} onChange={(e) => setTo(e.target.value)} /></label>
        {opts && opts.campuses.length > 1 && <label className="inv-f">{t('inv.campus')}<select value={campusId} onChange={(e) => setCampusId(e.target.value)}><option value="">{t('inv.allCampuses')}</option>{opts.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      </div>

      {tab === 'consumption' && (!cons ? <SkeletonRows rows={5} /> : (
        <>
          <div className="stats pay-stats">
            <StatTile icon="rupee" label={t('inv.rep.used')} value={inr(cons.totalValue)} hint={t('inv.rep.usedHint')} />
            <StatTile icon="department" label={t('inv.rep.depts')} value={byDept.size} />
          </div>
          {!cons.rows.length ? <EmptyState icon="layers" title={t('inv.rep.noUse')} /> : (
            <div className="table-wrap card" role="region" aria-label={t('inv.rep.consumption')} tabIndex={0}>
              <table className="table">
                <thead><tr><th scope="col">{t('inv.department')}</th><th scope="col">{t('inv.item')}</th><th scope="col" className="num">{t('inv.quantity')}</th><th scope="col" className="num">{t('inv.value')}</th></tr></thead>
                <tbody>{cons.rows.map((r, i) => {
                  const first = i === 0 || cons.rows[i - 1].department !== r.department;
                  return (
                    <tr key={`${r.department}-${r.item}`}>
                      <td>{first ? <><strong>{r.department === '—' ? t('inv.rep.noDept') : r.department}</strong><span className="sub-line muted small">{inr((byDept.get(r.department) ?? 0).toFixed(2))}</span></> : null}</td>
                      <td>{r.item}</td>
                      <td className="num">{qty(r.quantity)} <span className="muted small">{unitLabel(t, r.unit)}</span></td>
                      <td className="num">{inr(r.value)}</td>
                    </tr>
                  );
                })}</tbody>
                <tfoot><tr><th scope="row" colSpan={3}>{t('inv.total')}</th><td className="num"><strong>{inr(cons.totalValue)}</strong></td></tr></tfoot>
              </table>
            </div>
          )}
        </>
      ))}

      {tab === 'purchases' && (!reg ? <SkeletonRows rows={5} /> : (
        <>
          <div className="stats pay-stats">
            <StatTile icon="file" label={t('inv.rep.ordered')} value={inr(reg.totalOrdered)} />
            <StatTile icon="receipt" label={t('inv.rep.billed')} value={inr(reg.totalBilled)} hint={t('inv.rep.billedHint')} />
          </div>
          {!reg.rows.length ? <EmptyState icon="file" title={t('inv.rep.noOrders')} /> : (
            <div className="table-wrap card" role="region" aria-label={t('inv.rep.purchases')} tabIndex={0}>
              <table className="table">
                <thead><tr><th scope="col">{t('inv.po.no')}</th><th scope="col">{t('inv.vendor')}</th><th scope="col">{t('inv.status')}</th><th scope="col" className="num">{t('inv.rep.ordered')}</th><th scope="col" className="num">{t('inv.rep.billed')}</th></tr></thead>
                <tbody>{reg.rows.map((r) => (
                  <tr key={r.poNo}>
                    <td className="mono"><strong>{r.poNo}</strong><span className="sub-line muted small">{fmtDate(locale, r.poDate)}</span></td>
                    <td>{r.vendor}</td>
                    <td><InvPill status={r.status} /></td>
                    <td className="num">{inr(r.ordered)}</td>
                    <td className="num">{inr(r.billed)}</td>
                  </tr>
                ))}</tbody>
                <tfoot><tr><th scope="row" colSpan={3}>{t('inv.total')}</th><td className="num"><strong>{inr(reg.totalOrdered)}</strong></td><td className="num"><strong>{inr(reg.totalBilled)}</strong></td></tr></tfoot>
              </table>
            </div>
          )}
        </>
      ))}
    </>
  );
}
