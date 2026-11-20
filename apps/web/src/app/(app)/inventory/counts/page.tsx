'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { todayIST } from '@/components/accounts';
import { InvPill, fmtDate, inr, qty, unitLabel, useInvOptions } from '@/components/inventory';

interface Count { id: string; store: string; countDate: string; status: string; remarks: string | null; counted: number; lines: { item: string; unit: string; systemQty: string; countedQty: string; difference: string; value: string }[] }
interface StockRow { itemId: string; item: string; itemCode: string; unit: string; quantity: string }

/** Inventory → Stock counts (M17.4): count what is on the shelf; differences adjust stock after approval. */
export default function StockCountsPage() {
  const { can } = useSession();
  const { t, locale } = useI18n();
  const toast = useToast();
  const opts = useInvOptions();
  const [rows, setRows] = useState<Count[] | null>(null);
  const [form, setForm] = useState<{ storeId: string; countDate: string; remarks: string; stock: StockRow[] | null; counted: Record<string, string> } | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setRows(null); api<Count[]>('/inventory/counts').then(setRows).catch(() => setRows([])); }, []);
  useEffect(load, [load]);
  const storeId = form?.storeId;
  useEffect(() => {
    if (!storeId) return;
    api<{ rows: StockRow[] }>(`/inventory/stock?storeId=${storeId}`).then((r) => setForm((f) => (f && f.storeId === storeId ? { ...f, stock: r.rows, counted: Object.fromEntries(r.rows.map((x) => [x.itemId, x.quantity])) } : f))).catch(() => setForm((f) => (f ? { ...f, stock: [] } : f)));
  }, [storeId]);
  const start = () => { setErrors({}); setError(null); setForm({ storeId: opts?.stores[0]?.id ?? '', countDate: todayIST(), remarks: '', stock: null, counted: {} }); };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form?.stock) return;
    setBusy(true); setErrors({}); setError(null);
    try {
      const r = await api<{ differing: number; status: string }>('/inventory/counts', { method: 'POST', body: JSON.stringify({ storeId: form.storeId, countDate: form.countDate, remarks: form.remarks || null, lines: form.stock.map((s) => ({ itemId: s.itemId, countedQty: form.counted[s.itemId] || '0' })) }) });
      toast(!r.differing ? t('inv.cnt.match') : r.status === 'ADJUSTED' ? t('inv.cnt.adjusted', { n: r.differing }) : t('inv.cnt.waiting', { n: r.differing }));
      setForm(null); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const diffs = form?.stock?.filter((s) => form.counted[s.itemId] !== undefined && Number(form.counted[s.itemId] || 0) !== Number(s.quantity)).length ?? 0;
  return (
    <>
      <PageHeader eyebrow={t('nav.inventory')} title={t('inv.cnt.title')} description={t('inv.cnt.desc')}
        actions={can(PERMISSIONS.INV_COUNT) && <button type="button" className="btn btn-primary" onClick={start} disabled={!opts?.stores.length}><Icon name="clipboard" /> {t('inv.cnt.new')}</button>} />
      {!rows ? <SkeletonRows rows={3} /> : !rows.length ? <EmptyState icon="clipboard" title={t('inv.cnt.none')} text={t('inv.cnt.noneHint')} /> : (
        <div className="inv-counts">
          {rows.map((c) => (
            <section key={c.id} className="card p12-block" aria-label={`${c.store} ${fmtDate(locale, c.countDate)}`}>
              <div className="inv-grn-head">
                <span><strong>{c.store}</strong> · {fmtDate(locale, c.countDate)} · {t('inv.cnt.items', { n: c.counted })}</span>
                <InvPill status={c.status} />
              </div>
              {c.remarks && <p className="muted small">{c.remarks}</p>}
              {!c.lines.length ? <p className="muted small"><Icon name="check" size={14} /> {t('inv.cnt.allMatched')}</p> : (
                <div className="table-wrap" role="region" aria-label={`${c.store} ${fmtDate(locale, c.countDate)}`} tabIndex={0}>
                  <table className="table">
                    <thead><tr><th scope="col">{t('inv.item')}</th><th scope="col" className="num">{t('inv.cnt.system')}</th><th scope="col" className="num">{t('inv.cnt.counted')}</th><th scope="col" className="num">{t('inv.cnt.diff')}</th><th scope="col" className="num">{t('inv.value')}</th></tr></thead>
                    <tbody>{c.lines.map((l) => (
                      <tr key={l.item}>
                        <td>{l.item}</td>
                        <td className="num">{qty(l.systemQty)} <span className="muted small">{unitLabel(t, l.unit)}</span></td>
                        <td className="num">{qty(l.countedQty)}</td>
                        <td className={`num ${Number(l.difference) < 0 ? 'text-bad' : ''}`}><strong>{Number(l.difference) > 0 ? '+' : ''}{qty(l.difference)}</strong></td>
                        <td className="num">{inr(l.value)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title={t('inv.cnt.new')} subtitle={t('inv.cnt.sub')} onSubmit={save} submitLabel={diffs ? t('inv.cnt.saveDiff', { n: diffs }) : t('inv.cnt.save')} busy={busy} error={error} submitDisabled={!form?.stock?.length} wide>
        {form && opts && <>
          <div className="grid-3">
            <Field id="ct-store" label={t('inv.store')} error={errors.storeId}><select id="ct-store" value={form.storeId} onChange={(e) => setForm({ ...form, storeId: e.target.value, stock: null, counted: {} })}>{opts.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field id="ct-date" label={t('inv.date')} error={errors.countDate}><input id="ct-date" type="date" max={todayIST()} value={form.countDate} onChange={(e) => setForm({ ...form, countDate: e.target.value })} /></Field>
            <Field id="ct-rem" label={t('inv.remarks')} error={errors.remarks}><input id="ct-rem" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></Field>
          </div>
          {!form.stock ? <SkeletonRows rows={3} /> : !form.stock.length ? <p className="muted">{t('inv.cnt.nothing')}</p> : (
            <div className="acc-lines">
              <table className="table">
                <thead><tr><th scope="col">{t('inv.item')}</th><th scope="col" className="num">{t('inv.cnt.system')}</th><th scope="col" className="num">{t('inv.cnt.onShelf')}</th></tr></thead>
                <tbody>{form.stock.map((s, n) => {
                  const differs = Number(form.counted[s.itemId] || 0) !== Number(s.quantity);
                  return (
                    <tr key={s.itemId} className={differs ? 'inv-differs' : undefined}>
                      <td>{s.item}<span className="sub-line muted small mono">{s.itemCode}</span></td>
                      <td className="num">{qty(s.quantity)} <span className="muted small">{unitLabel(t, s.unit)}</span></td>
                      <td className="num"><input aria-label={t('inv.cnt.onShelfLine', { n: n + 1 })} inputMode="decimal" value={form.counted[s.itemId] ?? ''} onChange={(e) => setForm({ ...form, counted: { ...form.counted, [s.itemId]: e.target.value } })} /></td>
                    </tr>
                  );
                })}</tbody>
              </table>
              {errors.lines && <span className="field-error">{errors.lines}</span>}
            </div>
          )}
          <p className="muted small"><Icon name="info" size={14} /> {t('inv.cnt.note')}</p>
        </>}
      </Modal>
    </>
  );
}
