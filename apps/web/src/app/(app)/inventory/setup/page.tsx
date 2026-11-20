'use client';

import { FormEvent, useEffect, useState } from 'react';
import { ITEM_TYPES, PERMISSIONS, UNITS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { todayIST } from '@/components/accounts';
import { InvItem, ItemLine, ItemLinesEditor, emptyItemLine, inr, lineItems, qty, unitLabel, useInvOptions } from '@/components/inventory';

interface Store { id: string; name: string; campusId: string; campus: string; storeKeeperId: string | null; storeKeeper: string | null; isActive: boolean; items: number; value: string }
type Tab = 'items' | 'stores' | 'categories';
const blankItem = { itemCode: '', name: '', categoryId: '', unit: 'PCS', itemType: 'CONSUMABLE', hsnCode: '', taxCodeId: '', reorderLevel: '0', expenseAccountId: '', description: '', isActive: true };

/** Inventory → Set-up (M17.1): items, stores with their store keeper, categories and opening stock. */
export default function InventorySetupPage() {
  const { can } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const manage = can(PERMISSIONS.INV_SETUP);
  const [tab, setTab] = useState<Tab>('items');
  const [reload, setReload] = useState(0);
  const opts = useInvOptions(reload);
  const [items, setItems] = useState<InvItem[] | null>(null);
  const [stores, setStores] = useState<Store[] | null>(null);
  const [cats, setCats] = useState<{ id: string; name: string }[]>([]);
  const [q, setQ] = useState('');
  const [accounts, setAccounts] = useState<{ id: string; code: string; name: string }[]>([]);
  // dialogs
  const [item, setItem] = useState<(typeof blankItem & { id?: string }) | null>(null);
  const [store, setStore] = useState<{ id?: string; campusId: string; name: string; storeKeeperId: string; isActive: boolean } | null>(null);
  const [cat, setCat] = useState<{ id?: string; name: string; isActive: boolean } | null>(null);
  const [opening, setOpening] = useState<{ storeId: string; date: string; lines: ItemLine[] } | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<InvItem[]>('/inventory/items').then(setItems).catch(() => setItems([]));
    api<Store[]>('/inventory/stores').then(setStores).catch(() => setStores([]));
  }, [reload]);
  useEffect(() => { if (opts) setCats(opts.categories); }, [opts]);
  useEffect(() => { if (manage) api<{ id: string; code: string; name: string }[]>('/inventory/expense-accounts').then(setAccounts).catch(() => setAccounts([])); }, [manage]);

  const reset = () => { setErrors({}); setError(null); };
  const submit = async (fn: () => Promise<unknown>, done: string, close: () => void) => {
    setBusy(true); reset();
    try { await fn(); toast(done); close(); setReload((n) => n + 1); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const saveItem = (e: FormEvent) => {
    e.preventDefault();
    if (!item) return;
    const { id, ...f } = item;
    const body = { ...f, itemCode: f.itemCode || null, hsnCode: f.hsnCode || null, taxCodeId: f.taxCodeId || null, expenseAccountId: f.expenseAccountId || null, description: f.description || null };
    void submit(() => api(id ? `/inventory/items/${id}` : '/inventory/items', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) }), t('inv.saved'), () => setItem(null));
  };
  const saveStore = (e: FormEvent) => {
    e.preventDefault();
    if (!store) return;
    const { id, ...f } = store;
    void submit(() => api(id ? `/inventory/stores/${id}` : '/inventory/stores', { method: id ? 'PUT' : 'POST', body: JSON.stringify({ ...f, storeKeeperId: f.storeKeeperId || null }) }), t('inv.saved'), () => setStore(null));
  };
  const saveCat = (e: FormEvent) => {
    e.preventDefault();
    if (!cat) return;
    const { id, ...f } = cat;
    void submit(() => api(id ? `/inventory/categories/${id}` : '/inventory/categories', { method: id ? 'PUT' : 'POST', body: JSON.stringify(f) }), t('inv.saved'), () => setCat(null));
  };
  const saveOpening = (e: FormEvent) => {
    e.preventDefault();
    if (!opening) return;
    void submit(() => api('/inventory/opening-stock', { method: 'POST', body: JSON.stringify({ storeId: opening.storeId, date: opening.date, lines: lineItems(opening.lines, 'rate') }) }), t('inv.open.done'), () => setOpening(null));
  };

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (items ?? []).filter((i) => words.every((w) => `${i.name} ${i.itemCode} ${i.category}`.toLowerCase().includes(w)));
  const f = <K extends keyof typeof blankItem>(k: K, v: (typeof blankItem)[K]) => setItem((x) => (x ? { ...x, [k]: v } : x));
  return (
    <>
      <PageHeader eyebrow={t('nav.inventory')} title={t('inv.setup.title')} description={t('inv.setup.desc')}
        actions={manage && <>
          {tab === 'items' && <><button type="button" className="btn" onClick={() => { reset(); setOpening({ storeId: opts?.stores[0]?.id ?? '', date: todayIST(), lines: [emptyItemLine()] }); }}><Icon name="upload" /> {t('inv.open.title')}</button>
            <button type="button" className="btn btn-primary" onClick={() => { reset(); setItem({ ...blankItem, categoryId: cats[0]?.id ?? '' }); }}><Icon name="plus" /> {t('inv.item.new')}</button></>}
          {tab === 'stores' && <button type="button" className="btn btn-primary" onClick={() => { reset(); setStore({ campusId: opts?.campuses[0]?.id ?? '', name: '', storeKeeperId: '', isActive: true }); }}><Icon name="plus" /> {t('inv.store.new')}</button>}
          {tab === 'categories' && <button type="button" className="btn btn-primary" onClick={() => { reset(); setCat({ name: '', isActive: true }); }}><Icon name="plus" /> {t('inv.cat.new')}</button>}
        </>} />
      <div className="tabs" role="tablist" aria-label={t('inv.setup.title')}>
        {(['items', 'stores', 'categories'] as Tab[]).map((x) => <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(`inv.setup.${x}` as MessageKey)}</button>)}
      </div>

      {tab === 'items' && (!items ? <SkeletonRows rows={5} /> : (
        <>
          <div className="filter-bar card"><label className="inv-f">{t('inv.search')}<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('inv.searchHint')} /></label></div>
          {!shown.length ? <EmptyState icon="layers" title={t('inv.item.none')} text={t('inv.item.noneHint')} /> : (
            <div className="table-wrap card" role="region" aria-label={t('inv.setup.items')} tabIndex={0}>
              <table className="table">
                <thead><tr><th scope="col">{t('inv.item')}</th><th scope="col">{t('inv.category')}</th><th scope="col">{t('inv.item.type')}</th><th scope="col" className="num">{t('inv.inHand')}</th><th scope="col" className="num">{t('inv.reorder')}</th><th scope="col" className="num">{t('inv.value')}</th>{manage && <th scope="col"><span className="sr-only">{t('common.actions')}</span></th>}</tr></thead>
                <tbody>{shown.map((i) => (
                  <tr key={i.id} className={i.isActive ? undefined : 'muted'}>
                    <td><strong>{i.name}</strong><span className="sub-line muted small"><span className="mono">{i.itemCode}</span>{i.hsnCode ? ` · HSN ${i.hsnCode}` : ''}{i.isActive ? '' : ` · ${t('inv.inactive')}`}</span></td>
                    <td>{i.category}</td>
                    <td className="small">{t(`inv.type.${i.itemType}` as MessageKey)}</td>
                    <td className="num"><strong>{qty(i.quantity)}</strong> <span className="muted small">{unitLabel(t, i.unit)}</span>{i.low && <span className="sub-line"><span className="pill pill-warn"><span className="pill-dot" />{t('inv.low')}</span></span>}</td>
                    <td className="num muted">{Number(i.reorderLevel) > 0 ? qty(i.reorderLevel) : '—'}</td>
                    <td className="num">{inr(i.value)}</td>
                    {manage && <td><button type="button" className="btn btn-sm btn-ghost" aria-label={t('inv.editNamed', { n: i.name })} onClick={() => { reset(); setItem({ id: i.id, itemCode: i.itemCode, name: i.name, categoryId: i.categoryId, unit: i.unit, itemType: i.itemType, hsnCode: i.hsnCode ?? '', taxCodeId: i.taxCodeId ?? '', reorderLevel: i.reorderLevel, expenseAccountId: i.expenseAccountId ?? '', description: i.description ?? '', isActive: i.isActive }); }}><Icon name="edit" size={14} /></button></td>}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      ))}

      {tab === 'stores' && (!stores ? <SkeletonRows rows={3} /> : !stores.length ? <EmptyState icon="building" title={t('inv.store.none')} text={t('inv.store.noneHint')} /> : (
        <div className="table-wrap card" role="region" aria-label={t('inv.setup.stores')} tabIndex={0}>
          <table className="table">
            <thead><tr><th scope="col">{t('inv.store')}</th><th scope="col">{t('inv.campus')}</th><th scope="col">{t('inv.store.keeper')}</th><th scope="col" className="num">{t('inv.store.items')}</th><th scope="col" className="num">{t('inv.value')}</th>{manage && <th scope="col"><span className="sr-only">{t('common.actions')}</span></th>}</tr></thead>
            <tbody>{stores.map((s) => (
              <tr key={s.id} className={s.isActive ? undefined : 'muted'}>
                <td><strong>{s.name}</strong>{!s.isActive && <span className="sub-line muted small">{t('inv.inactive')}</span>}</td>
                <td>{s.campus}</td>
                <td>{s.storeKeeper ?? <span className="muted">{t('inv.store.noKeeper')}</span>}</td>
                <td className="num">{s.items}</td>
                <td className="num">{inr(s.value)}</td>
                {manage && <td><button type="button" className="btn btn-sm btn-ghost" aria-label={t('inv.editNamed', { n: s.name })} onClick={() => { reset(); setStore({ id: s.id, campusId: s.campusId, name: s.name, storeKeeperId: s.storeKeeperId ?? '', isActive: s.isActive }); }}><Icon name="edit" size={14} /></button></td>}
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}

      {tab === 'categories' && (
        <section className="card p12-block">
          <p className="muted">{t('inv.cat.hint')}</p>
          <ul className="p12-action-list">{cats.map((c) => (
            <li key={c.id}><span>{c.name}</span>{manage && <button type="button" className="btn btn-sm btn-ghost" aria-label={t('inv.editNamed', { n: c.name })} onClick={() => { reset(); setCat({ id: c.id, name: c.name, isActive: true }); }}><Icon name="edit" size={14} /></button>}</li>
          ))}</ul>
        </section>
      )}

      <Modal open={!!item} onClose={() => setItem(null)} title={item?.id ? t('inv.item.edit') : t('inv.item.new')} onSubmit={saveItem} busy={busy} error={error} wide>
        {item && <>
          <div className="grid-2">
            <Field id="it-name" label={t('inv.item.name')} error={errors.name}><input id="it-name" value={item.name} onChange={(e) => f('name', e.target.value)} /></Field>
            <Field id="it-code" label={t('inv.item.code')} hint={t('inv.item.codeHint')} error={errors.itemCode}><input id="it-code" className="mono" value={item.itemCode} onChange={(e) => f('itemCode', e.target.value)} /></Field>
          </div>
          <div className="grid-3">
            <Field id="it-cat" label={t('inv.category')} error={errors.categoryId}><select id="it-cat" value={item.categoryId} onChange={(e) => f('categoryId', e.target.value)}><option value="">{t('inv.choose')}</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field id="it-unit" label={t('inv.unit')} error={errors.unit}><select id="it-unit" value={item.unit} onChange={(e) => f('unit', e.target.value)}>{UNITS.map((u) => <option key={u} value={u}>{unitLabel(t, u)}</option>)}</select></Field>
            <Field id="it-type" label={t('inv.item.type')} error={errors.itemType}><select id="it-type" value={item.itemType} onChange={(e) => f('itemType', e.target.value)}>{ITEM_TYPES.map((x) => <option key={x} value={x}>{t(`inv.type.${x}` as MessageKey)}</option>)}</select></Field>
          </div>
          <div className="grid-3">
            <Field id="it-reorder" label={t('inv.reorder')} hint={t('inv.item.reorderHint')} error={errors.reorderLevel}><input id="it-reorder" inputMode="decimal" value={item.reorderLevel} onChange={(e) => f('reorderLevel', e.target.value)} /></Field>
            <Field id="it-hsn" label={t('inv.item.hsn')} error={errors.hsnCode}><input id="it-hsn" inputMode="numeric" value={item.hsnCode} onChange={(e) => f('hsnCode', e.target.value)} /></Field>
            <Field id="it-gst" label={t('inv.item.gst')} error={errors.taxCodeId}><select id="it-gst" value={item.taxCodeId} onChange={(e) => f('taxCodeId', e.target.value)}><option value="">{t('inv.item.noGst')}</option>{opts?.taxCodes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          </div>
          <Field id="it-acc" label={t('inv.item.account')} hint={t('inv.item.accountHint')} error={errors.expenseAccountId}><select id="it-acc" value={item.expenseAccountId} onChange={(e) => f('expenseAccountId', e.target.value)}><option value="">{t('inv.item.accountDefault')}</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></Field>
          <Field id="it-desc" label={t('inv.item.desc')} error={errors.description}><input id="it-desc" value={item.description} onChange={(e) => f('description', e.target.value)} /></Field>
          <label className="check"><input type="checkbox" checked={item.isActive} onChange={(e) => f('isActive', e.target.checked)} /> {t('inv.active')}</label>
        </>}
      </Modal>

      <Modal open={!!store} onClose={() => setStore(null)} title={store?.id ? t('inv.store.edit') : t('inv.store.new')} subtitle={t('inv.store.sub')} onSubmit={saveStore} busy={busy} error={error}>
        {store && <>
          <Field id="st-name" label={t('inv.store.name')} error={errors.name}><input id="st-name" value={store.name} placeholder={t('inv.store.namePh')} onChange={(e) => setStore({ ...store, name: e.target.value })} /></Field>
          <Field id="st-campus" label={t('inv.campus')} error={errors.campusId}><select id="st-campus" value={store.campusId} onChange={(e) => setStore({ ...store, campusId: e.target.value, storeKeeperId: '' })}>{opts?.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field id="st-keeper" label={t('inv.store.keeper')} hint={t('inv.store.keeperHint')} error={errors.storeKeeperId}><select id="st-keeper" value={store.storeKeeperId} onChange={(e) => setStore({ ...store, storeKeeperId: e.target.value })}><option value="">{t('inv.store.noKeeper')}</option>{opts?.staff.filter((s) => s.campusId === store.campusId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <label className="check"><input type="checkbox" checked={store.isActive} onChange={(e) => setStore({ ...store, isActive: e.target.checked })} /> {t('inv.active')}</label>
        </>}
      </Modal>

      <Modal open={!!cat} onClose={() => setCat(null)} title={cat?.id ? t('inv.cat.edit') : t('inv.cat.new')} onSubmit={saveCat} busy={busy} error={error}>
        {cat && <>
          <Field id="ct-name" label={t('inv.cat.name')} error={errors.name}><input id="ct-name" value={cat.name} onChange={(e) => setCat({ ...cat, name: e.target.value })} /></Field>
          {cat.id && <label className="check"><input type="checkbox" checked={cat.isActive} onChange={(e) => setCat({ ...cat, isActive: e.target.checked })} /> {t('inv.active')}</label>}
        </>}
      </Modal>

      <Modal open={!!opening} onClose={() => setOpening(null)} title={t('inv.open.title')} subtitle={t('inv.open.sub')} onSubmit={saveOpening} submitLabel={t('inv.open.save')} busy={busy} error={error} wide>
        {opening && <>
          <div className="grid-2">
            <Field id="op-store" label={t('inv.store')} error={errors.storeId}><select id="op-store" value={opening.storeId} onChange={(e) => setOpening({ ...opening, storeId: e.target.value })}><option value="">{t('inv.choose')}</option>{opts?.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field id="op-date" label={t('inv.open.date')} error={errors.date}><input id="op-date" type="date" value={opening.date} max={todayIST()} onChange={(e) => setOpening({ ...opening, date: e.target.value })} /></Field>
          </div>
          <ItemLinesEditor items={(items ?? []).filter((i) => i.isActive)} lines={opening.lines} setLines={(l) => setOpening({ ...opening, lines: l })} rateLabel={t('inv.open.rate')} error={errors.lines} />
        </>}
      </Modal>
    </>
  );
}
