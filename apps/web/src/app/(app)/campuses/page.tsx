'use client';

import { useCallback, useEffect, useState } from 'react';
import { CAMPUS_TYPES, PERMISSIONS, createCampusSchema } from '@eduerp/shared';
import { api, newIdempotencyKey } from '@/lib/api';
import { useSession } from '@/lib/session';
import { apiErrors, clean, FieldErrors, validate } from '@/lib/form';
import { Icon } from '@/components/Icon';
import { ExportButton } from '@/components/ExportButton';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';

interface Campus {
  id: string;
  code: string;
  name: string;
  nameLocal: string | null;
  campusType: string;
  city: string | null;
  status: string;
}

const EMPTY = { code: '', name: '', nameLocal: '', campusType: 'SCHOOL', city: '', pincode: '', phone: '', email: '' };

export default function CampusesPage() {
  const { can, campusId } = useSession();
  const toast = useToast();
  const { t, locale } = useI18n();
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);
  const [rows, setRows] = useState<Campus[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Button shown only to institution-wide creators; the API enforces the same rule.
  const canCreate = can(PERMISSIONS.ORG_CAMPUS_CREATE, { allCampuses: true });

  const load = useCallback(() => {
    api<Campus[]>('/campuses').then(setRows).catch(() => setLoadError('Could not load campuses.'));
  }, []);
  useEffect(load, [load]);

  const shown = rows?.filter((c) => !campusId || c.id === campusId) ?? null;

  function openCreate() {
    setIdemKey(newIdempotencyKey());
    setForm(EMPTY);
    setErrors({});
    setFormError(null);
    setOpen(true);
  }

  async function save() {
    const v = validate(createCampusSchema, clean(form));
    if (!v.ok) return setErrors(v.errors);
    setSaving(true);
    try {
      await api('/campuses', { method: 'POST', headers: { 'Idempotency-Key': idemKey }, body: JSON.stringify(v.data) });
      setOpen(false);
      toast(t('campuses.added', { code: v.data.code }));
      load();
    } catch (err) {
      const { fields, message } = apiErrors(err);
      setErrors(fields);
      setFormError(message);
    } finally {
      setSaving(false);
    }
  }

  const input = (name: keyof typeof EMPTY, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Field id={name} label={label} error={errors[name]}>
      <input id={name} value={form[name]} onChange={(e) => setForm({ ...form, [name]: e.target.value })} aria-invalid={!!errors[name]} {...props} />
    </Field>
  );

  return (
    <>
      <PageHeader
        eyebrow={t('nav.setup')}
        title={t('nav.campuses')}
        description={t('campuses.desc')}
        actions={<><ExportButton type="CAMPUSES" />{canCreate && <button className="btn btn-primary" onClick={openCreate}><Icon name="plus" /> {t('campuses.add')}</button>}</>}
      />

      {loadError && <div className="alert"><Icon name="alert" />{loadError}</div>}
      {shown === null && !loadError ? (
        <SkeletonRows />
      ) : shown && shown.length === 0 ? (
        <EmptyState
          icon="campus"
          title={t('campuses.emptyTitle')}
          text={t('campuses.emptyText')}
          action={canCreate && <button className="btn btn-primary" onClick={openCreate}><Icon name="plus" /> {t('campuses.addFirst')}</button>}
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>{t('common.code')}</th><th>{t('common.name')}</th><th>{t('common.type')}</th><th>{t('common.city')}</th><th>{t('common.status')}</th></tr>
            </thead>
            <tbody>
              {shown?.map((c) => (
                <tr key={c.id}>
                  <td><span className="code">{c.code}</span></td>
                  <td className="strong">{c.name}{c.nameLocal && <div className="muted sub-line" lang="kn">{c.nameLocal}</div>}</td>
                  <td>{t(`campusType.${c.campusType}` as MessageKey)}</td>
                  <td>{c.city ?? <span className="muted">—</span>}</td>
                  <td><StatusBadge status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={t('campuses.add')} subtitle={t('campuses.dialogSub')} onSubmit={save} submitLabel={t('campuses.save')} busy={saving} error={formError}>
        <div className="grid-2">
          {input('code', t('common.code'), { placeholder: 'MAIN', autoFocus: true })}
          <Field id="campusType" label={t('common.type')}>
            <select id="campusType" value={form.campusType} onChange={(e) => setForm({ ...form, campusType: e.target.value })}>
              {CAMPUS_TYPES.map((ct) => <option key={ct} value={ct}>{t(`campusType.${ct}` as MessageKey)}</option>)}
            </select>
          </Field>
        </div>
        {input('name', t('campuses.nameEn'))}
        {input('nameLocal', t('campuses.nameKn'), { lang: 'kn' })}
        <div className="grid-2">
          {input('city', t('common.city'))}
          {input('pincode', t('campuses.pincode'), { inputMode: 'numeric', maxLength: 6 })}
          {input('phone', t('campuses.phone'), { inputMode: 'tel', maxLength: 10 })}
          {input('email', t('campuses.email'), { type: 'email' })}
        </div>
      </Modal>
    </>
  );
}
