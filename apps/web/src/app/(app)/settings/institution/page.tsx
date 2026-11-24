'use client';

import { useEffect, useRef, useState } from 'react';
import { EDITIONS, LOGO_MAX_BYTES, PERMISSIONS, institutionProfileSchema } from '@eduerp/shared';
import { api, ApiError, uploadFile } from '@/lib/api';
import { apiErrors, FieldErrors, validate } from '@/lib/form';
import { logoUrl, useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { Field } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';

interface Profile {
  name: string; nameLocal: string | null; slug: string; email: string | null; phone: string | null; website: string | null;
  address: string | null; city: string | null; district: string | null; state: string | null; pincode: string | null;
  logoFileId: string | null; edition: keyof typeof EDITIONS;
}
const FIELDS = ['name', 'nameLocal', 'email', 'phone', 'website', 'address', 'city', 'district', 'state', 'pincode'] as const;
type Form = Record<(typeof FIELDS)[number], string>;
const toForm = (p: Profile): Form => Object.fromEntries(FIELDS.map((k) => [k, p[k] ?? ''])) as Form;

/** Settings → Institution profile (Phase 20 E4): name, contact, address and the logo used on screens and printed documents. */
export default function InstitutionProfilePage() {
  const { t } = useI18n();
  const toast = useToast();
  const { can, refreshInstitution } = useSession();
  const canEdit = can(PERMISSIONS.ORG_SETTINGS_UPDATE);
  const canRead = can(PERMISSIONS.ORG_SETTINGS_READ);
  const [p, setP] = useState<Profile | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!canRead) return;
    api<Profile>('/institution/profile').then((r) => { setP(r); setForm(toForm(r)); }).catch(() => setLoadError(true));
  }, [canRead]);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => (f ? { ...f, [k]: e.target.value } : f));

  async function save() {
    if (!form) return;
    const v = validate(institutionProfileSchema, form);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    setSaving(true);
    try {
      const r = await api<Profile>('/institution/profile', { method: 'PUT', body: JSON.stringify(v.data) });
      setP(r);
      setForm(toForm(r));
      await refreshInstitution();
      toast(t('inst.saved'));
    } catch (e) {
      const { fields, message } = apiErrors(e);
      setErrors({ ...fields, ...(message && !Object.keys(fields).length ? { form: message } : {}) });
    } finally {
      setSaving(false);
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setLogoError(null);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return setLogoError(t('inst.logoType'));
    if (file.size > LOGO_MAX_BYTES) return setLogoError(t('inst.logoSize'));
    setLogoBusy(true);
    try {
      setP(await uploadFile<Profile>('/institution/logo', file));
      await refreshInstitution();
      toast(t('inst.logoSaved'));
    } catch (e) {
      setLogoError(e instanceof ApiError ? e.message : t('inst.logoFailed'));
    } finally {
      setLogoBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeLogo() {
    if (!window.confirm(t('inst.logoRemoveAsk'))) return;
    setLogoBusy(true);
    try {
      setP(await api<Profile>('/institution/logo', { method: 'DELETE' }));
      await refreshInstitution();
      toast(t('inst.logoRemoved'));
    } catch (e) {
      setLogoError(e instanceof ApiError ? e.message : t('inst.logoFailed'));
    } finally {
      setLogoBusy(false);
    }
  }

  if (!canRead) return <EmptyState icon="lock" title={t('inst.noAccess')} />;

  const logo = p ? logoUrl({ slug: p.slug, logoVersion: p.logoFileId ? p.logoFileId.slice(0, 8) : null }) : null;
  const signIn = p && typeof window !== 'undefined' ? `${window.location.origin}/login?i=${p.slug}` : '';

  return (
    <>
      <PageHeader eyebrow={t('nav.setup')} title={t('inst.title')} description={t('inst.desc')} />
      {loadError ? (
        <div className="alert">{t('inst.loadFailed')}</div>
      ) : !p || !form ? (
        <SkeletonRows />
      ) : (
        <div className="inst-layout">
          <section className="card inst-brand" aria-labelledby="inst-logo-h">
            <h2 id="inst-logo-h" className="card-title">{t('inst.logo')}</h2>
            <div className="inst-logo-box">
              {logo ? <img src={logo} alt={t('inst.logoAlt', { name: p.name })} /> : <span className="inst-logo-empty"><Icon name="building" size={36} /><span>{t('inst.noLogo')}</span></span>}
            </div>
            <p className="muted small">{t('inst.logoHint')}</p>
            {logoError && <p className="err" role="alert">{logoError}</p>}
            {canEdit && (
              <div className="inst-logo-actions">
                <input ref={fileRef} id="inst-logo-file" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} />
                <label htmlFor="inst-logo-file" className={`btn ${logoBusy ? 'disabled' : ''}`} aria-disabled={logoBusy}><Icon name="upload" /> {logo ? t('inst.logoChange') : t('inst.logoUpload')}</label>
                {logo && <button type="button" className="btn btn-ghost" onClick={removeLogo} disabled={logoBusy}>{t('inst.logoRemove')}</button>}
              </div>
            )}
            <div className="inst-meta">
              <div><span className="muted small">{t('inst.edition')}</span><strong>{EDITIONS[p.edition]?.name ?? p.edition}</strong></div>
              <div><span className="muted small">{t('inst.signInLink')}</span><code className="inst-link">{signIn}</code></div>
              <p className="muted small">{t('inst.signInHint')}</p>
            </div>
          </section>

          <form className="card inst-form" onSubmit={(e) => { e.preventDefault(); save(); }} aria-labelledby="inst-form-h" noValidate>
            <h2 id="inst-form-h" className="card-title">{t('inst.details')}</h2>
            <fieldset disabled={!canEdit} className="plain-fieldset">
              <div className="grid-2">
                <Field id="i-name" label={t('inst.name')} error={errors.name}><input id="i-name" value={form.name} onChange={set('name')} /></Field>
                <Field id="i-nameLocal" label={t('inst.nameLocal')} error={errors.nameLocal}><input id="i-nameLocal" lang="kn" value={form.nameLocal} onChange={set('nameLocal')} /></Field>
              </div>
              <div className="grid-3">
                <Field id="i-phone" label={t('inst.phone')} error={errors.phone}><input id="i-phone" inputMode="numeric" value={form.phone} onChange={set('phone')} /></Field>
                <Field id="i-email" label={t('inst.email')} error={errors.email}><input id="i-email" type="email" value={form.email} onChange={set('email')} /></Field>
                <Field id="i-website" label={t('inst.website')} error={errors.website}><input id="i-website" value={form.website} onChange={set('website')} /></Field>
              </div>
              <Field id="i-address" label={t('inst.address')} error={errors.address}><textarea id="i-address" rows={2} value={form.address} onChange={set('address')} /></Field>
              <div className="grid-4">
                <Field id="i-city" label={t('inst.city')} error={errors.city}><input id="i-city" value={form.city} onChange={set('city')} /></Field>
                <Field id="i-district" label={t('inst.district')} error={errors.district}><input id="i-district" value={form.district} onChange={set('district')} /></Field>
                <Field id="i-state" label={t('inst.state')} error={errors.state}><input id="i-state" value={form.state} onChange={set('state')} /></Field>
                <Field id="i-pincode" label={t('inst.pincode')} error={errors.pincode}><input id="i-pincode" inputMode="numeric" value={form.pincode} onChange={set('pincode')} /></Field>
              </div>
            </fieldset>
            {errors.form && <p className="err" role="alert">{errors.form}</p>}
            <p className="muted small">{t('inst.printHint')}</p>
            {canEdit && <div className="form-actions"><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? t('common.saving') : t('common.save')}</button></div>}
          </form>
        </div>
      )}
    </>
  );
}
