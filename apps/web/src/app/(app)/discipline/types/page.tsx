'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { SEVERITIES } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { ClPill } from '@/components/campuslife';

interface Type { id: string; name: string; severity: string; notifyParent: boolean; isActive: boolean }

/** Discipline → Incident types: name, severity and whether parents are told. */
export default function IncidentTypesPage() {
  const { t } = useI18n();
  const toast = useToast();
  const [rows, setRows] = useState<Type[] | null>(null);
  const [edit, setEdit] = useState<Type | 'new' | null>(null);
  const [f, setF] = useState({ name: '', severity: 'LOW', notifyParent: false, isActive: true });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Type[]>('/discipline/types').then(setRows).catch(() => setRows([])); }, []);
  useEffect(load, [load]);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try { await api(edit === 'new' ? '/discipline/types' : `/discipline/types/${(edit as Type).id}`, { method: edit === 'new' ? 'POST' : 'PUT', body: JSON.stringify(f) }); toast(t('dc.ty.saved')); setEdit(null); load(); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  return (
    <>
      <Link href="/discipline" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('dc.title')}</Link>
      <PageHeader eyebrow={t('nav.discipline')} title={t('dc.types')} description={t('dc.ty.desc')} actions={<button type="button" className="btn btn-primary" onClick={() => { setF({ name: '', severity: 'LOW', notifyParent: false, isActive: true }); setErrors({}); setError(null); setEdit('new'); }}><Icon name="plus" /> {t('dc.ty.add')}</button>} />
      {!rows ? <SkeletonRows rows={5} /> : (
        <ul className="p12-action-list card p12-block">{rows.map((r) => (
          <li key={r.id} className={r.isActive ? undefined : 'muted'}><span><strong>{r.name}</strong><span className="sub-line muted small">{r.notifyParent ? t('dc.ty.tells') : t('dc.ty.noTell')}{r.isActive ? '' : ` · ${t('dc.ty.inactive')}`}</span></span>
            <span className="row-actions"><ClPill prefix="dc.sev" status={r.severity} /><button type="button" className="btn btn-sm btn-ghost" aria-label={t('dc.ty.editNamed', { name: r.name })} onClick={() => { setF({ name: r.name, severity: r.severity, notifyParent: r.notifyParent, isActive: r.isActive }); setErrors({}); setError(null); setEdit(r); }}><Icon name="edit" size={16} /></button></span></li>
        ))}</ul>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? t('dc.ty.add') : t('dc.ty.edit')} onSubmit={save} submitLabel={t('dc.ty.save')} busy={busy} error={error}>
        <Field id="ty-name" label={t('dc.ty.name')} error={errors.name}><input id="ty-name" value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} /></Field>
        <Field id="ty-sev" label={t('dc.ty.severity')}><select id="ty-sev" value={f.severity} onChange={(e) => setF((x) => ({ ...x, severity: e.target.value }))}>{SEVERITIES.map((s) => <option key={s} value={s}>{t(`dc.sev.${s}` as MessageKey)}</option>)}</select></Field>
        <label className="check"><input type="checkbox" checked={f.notifyParent} onChange={(e) => setF((x) => ({ ...x, notifyParent: e.target.checked }))} /> {t('dc.ty.tellLabel')}</label>
        <label className="check"><input type="checkbox" checked={f.isActive} onChange={(e) => setF((x) => ({ ...x, isActive: e.target.checked }))} /> {t('dc.ty.active')}</label>
      </Modal>
    </>
  );
}
