'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PERMISSIONS, REQUEST_PRIORITIES } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { COMPLAINT_TONE, PRIORITY_TONE, Pill, StaffOpt, priorityKey, useDue, useStaffOpts, useWhen } from '@/components/engagement2';

interface Row { id: string; complaintNo: string; subject: string; category: string; sensitive: boolean; priority: string; status: string; raisedByType: string; handler: string | null; dueAt: string; overdue: boolean; escalated: boolean; createdAt: string }
interface Category { id: string; name: string; slaHours: number; isSensitive: boolean; defaultEmployeeId: string | null; defaultHandler: string | null }
type Filter = 'OPEN' | 'ALL' | 'MINE';

/** Complaints & grievances (M12.2): the work list for handlers and managers, staff’s own complaints, categories. */
export default function ComplaintsPage() {
  const { can } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const w = useWhen();
  const due = useDue();
  const manage = can(PERMISSIONS.GRIEVANCE_MANAGE);
  const works = manage || can(PERMISSIONS.GRIEVANCE_HANDLE);
  const raise = can(PERMISSIONS.GRIEVANCE_RAISE);
  const [filter, setFilter] = useState<Filter>(works ? 'OPEN' : 'MINE');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [open, setOpen] = useState(false);
  const [showCats, setShowCats] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setRows(null); api<Row[]>(`/complaints?filter=${filter}`).then(setRows).catch(() => setRows([])); }, [filter]);
  const loadCats = useCallback(() => { api<Category[]>('/complaints/categories').then(setCats).catch(() => setCats([])); }, []);
  useEffect(load, [load]);
  useEffect(loadCats, [loadCats]);
  const start = () => { setForm({ categoryId: cats[0]?.id ?? '', subject: '', description: '', priority: 'MEDIUM' }); setErrors({}); setError(null); setOpen(true); };
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try { const r = await api<{ id: string; complaintNo: string }>('/complaints', { method: 'POST', body: JSON.stringify(form) }); toast(t('cp.raised', { no: r.complaintNo })); setOpen(false); window.location.href = `/complaints/${r.id}`; }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const tabs: Filter[] = works ? ['OPEN', 'ALL', 'MINE'] : ['MINE'];
  return (
    <>
      <PageHeader eyebrow={t('nav.engagement')} title={t('cp.title')} description={t('cp.desc')}
        actions={<>{manage && <button type="button" className="btn" onClick={() => setShowCats(true)}><Icon name="settings" /> {t('cp.categories')}</button>}{raise && <button type="button" className="btn btn-primary" onClick={start} disabled={!cats.length}><Icon name="plus" /> {t('cp.raise')}</button>}</>} />
      {tabs.length > 1 && (
        <div className="tabs" role="tablist" aria-label={t('cp.title')}>
          {tabs.map((x) => <button key={x} role="tab" aria-selected={filter === x} className={filter === x ? 'on' : ''} onClick={() => setFilter(x)}>{t(`cp.filter.${x}` as MessageKey)}</button>)}
        </div>
      )}
      {manage && !cats.length && <p className="notice"><Icon name="info" /> {t('cp.noCats')}</p>}
      {!rows ? <SkeletonRows rows={5} /> : !rows.length ? <EmptyState icon="shield" title={filter === 'OPEN' ? t('cp.noneOpen') : t('cp.none')} text={filter === 'MINE' && raise ? t('cp.noneMine') : undefined} /> : (
        <div className="table-wrap card p12-table">
          <table className="table">
            <thead><tr><th scope="col">{t('cp.number')}</th><th scope="col">{t('cp.subject')}</th><th scope="col">{t('cp.from')}</th><th scope="col">{t('cp.handler')}</th><th scope="col">{t('cp.due')}</th><th scope="col">{t('common.status')}</th></tr></thead>
            <tbody>
              {rows.map((c) => {
                const d = due(c.dueAt, c.status === 'RESOLVED' || c.status === 'CLOSED');
                return (
                  <tr key={c.id} className={c.status === 'CLOSED' ? 'row-dim' : undefined}>
                    <td><Link href={`/complaints/${c.id}`} className="code">{c.complaintNo}</Link></td>
                    <td><Link href={`/complaints/${c.id}`}>{c.subject}</Link><span className="sub-line muted small">{c.category}{c.sensitive && <> · <Icon name="lock" size={12} /> {t('cp.sensitive')}</>} · <Pill tone={PRIORITY_TONE[c.priority]}>{t(priorityKey(c.priority))}</Pill></span></td>
                    <td>{t(`cp.by.${c.raisedByType}` as MessageKey)}<span className="sub-line muted small">{w.dt(c.createdAt)}</span></td>
                    <td>{c.handler ?? <span className="muted">{t('cp.unassigned')}</span>}</td>
                    <td>{d ? <span className={d.late ? 'text-bad' : undefined}>{d.text}</span> : '—'}{c.escalated && <span className="sub-line"><Pill tone="pill-bad">{t('cp.escalated')}</Pill></span>}</td>
                    <td><Pill tone={COMPLAINT_TONE[c.status]}>{t(`cp.status.${c.status}` as MessageKey)}</Pill></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('cp.raise')} subtitle={t('cp.raiseSub')} onSubmit={save} submitLabel={t('cp.send')} busy={busy} error={error}>
        <div className="grid-2">
          <Field id="cp-cat" label={t('cp.category')} error={errors.categoryId}><select id="cp-cat" value={form.categoryId} onChange={set('categoryId')}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field id="cp-pr" label={t('cp.priority')}><select id="cp-pr" value={form.priority} onChange={set('priority')}>{REQUEST_PRIORITIES.map((p) => <option key={p} value={p}>{t(priorityKey(p))}</option>)}</select></Field>
        </div>
        <Field id="cp-sub" label={t('cp.subject')} error={errors.subject}><input id="cp-sub" value={form.subject ?? ''} onChange={set('subject')} placeholder={t('cp.subjectPh')} /></Field>
        <Field id="cp-desc" label={t('cp.details')} error={errors.description}><textarea id="cp-desc" rows={5} value={form.description ?? ''} onChange={set('description')} placeholder={t('cp.detailsPh')} /></Field>
        {cats.find((c) => c.id === form.categoryId)?.isSensitive && <p className="notice"><Icon name="lock" /> {t('cp.sensitiveNote')}</p>}
      </Modal>
      {showCats && <Categories cats={cats} onClose={() => setShowCats(false)} onSaved={loadCats} />}
    </>
  );
}

function Categories({ cats, onClose, onSaved }: { cats: Category[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const staff = useStaffOpts('/complaints/staff');
  const [edit, setEdit] = useState<Category | 'new' | null>(null);
  const [form, setForm] = useState<{ name: string; defaultEmployeeId: string; slaHours: string; isSensitive: boolean }>({ name: '', defaultEmployeeId: '', slaHours: '48', isSensitive: false });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = (c: Category | 'new') => {
    setEdit(c); setErrors({}); setError(null);
    setForm(c === 'new' ? { name: '', defaultEmployeeId: '', slaHours: '48', isSensitive: false } : { name: c.name, defaultEmployeeId: c.defaultEmployeeId ?? '', slaHours: String(c.slaHours), isSensitive: c.isSensitive });
  };
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!edit) return;
    setBusy(true); setErrors({}); setError(null);
    try {
      await api(edit === 'new' ? '/complaints/categories' : `/complaints/categories/${edit.id}`, { method: edit === 'new' ? 'POST' : 'PUT', body: JSON.stringify({ ...form, defaultEmployeeId: form.defaultEmployeeId || null }) });
      toast(t('cp.cat.saved')); setEdit(null); onSaved();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  if (edit) {
    return (
      <Modal open onClose={() => setEdit(null)} title={edit === 'new' ? t('cp.cat.add') : edit.name} onSubmit={save} submitLabel={t('common.save')} busy={busy} error={error}>
        <Field id="cc-name" label={t('common.name')} error={errors.name}><input id="cc-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t('cp.cat.namePh')} /></Field>
        <div className="grid-2">
          <Field id="cc-h" label={t('cp.cat.handler')} hint={t('cp.cat.handlerHint')} error={errors.defaultEmployeeId}>
            <select id="cc-h" value={form.defaultEmployeeId} onChange={(e) => setForm((f) => ({ ...f, defaultEmployeeId: e.target.value }))}><option value="">{t('cp.cat.noHandler')}</option>{(staff ?? []).map((s: StaffOpt) => <option key={s.id} value={s.id}>{s.name}{s.designation ? ` · ${s.designation}` : ''}</option>)}</select>
          </Field>
          <Field id="cc-sla" label={t('cp.cat.sla')} hint={t('cp.cat.slaHint')} error={errors.slaHours}><input id="cc-sla" type="number" min={1} max={720} value={form.slaHours} onChange={(e) => setForm((f) => ({ ...f, slaHours: e.target.value }))} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={form.isSensitive} onChange={(e) => setForm((f) => ({ ...f, isSensitive: e.target.checked }))} /> {t('cp.cat.sensitive')}</label>
        <p className="muted small">{t('cp.cat.sensitiveHint')}</p>
      </Modal>
    );
  }
  return (
    <Modal open onClose={onClose} title={t('cp.categories')} subtitle={t('cp.cat.sub')} onSubmit={(e) => { e.preventDefault(); onClose(); }} submitLabel={t('common.close')} hideCancel wide>
      {!cats.length ? <EmptyState icon="shield" title={t('cp.noCats')} /> : (
        <ul className="p12-committees">
          {cats.map((c) => (
            <li key={c.id} className="card">
              <span><strong>{c.name}</strong>{c.isSensitive && <> · <Icon name="lock" size={12} /> {t('cp.sensitive')}</>}
                <span className="sub-line small muted">{t('cp.cat.line', { h: c.slaHours, who: c.defaultHandler ?? t('cp.cat.noHandler') })}</span>
              </span>
              <button type="button" className="btn btn-sm" onClick={() => open(c)}><Icon name="edit" /> {t('common.edit')}</button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn-primary" onClick={() => open('new')}><Icon name="plus" /> {t('cp.cat.add')}</button>
    </Modal>
  );
}
