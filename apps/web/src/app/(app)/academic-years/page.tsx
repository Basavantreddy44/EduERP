'use client';

import { useCallback, useEffect, useState } from 'react';
import { PERMISSIONS, createAcademicYearSchema } from '@eduerp/shared';
import { api, newIdempotencyKey, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { apiErrors, FieldErrors, validate } from '@/lib/form';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';

interface Year {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  status: 'PLANNING' | 'ACTIVE' | 'CLOSED';
}

const fmt = (d: string, locale: string) => new Date(`${d}T00:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });

/** Suggests the next year after the latest one (June → March, the common Karnataka calendar). */
function suggestion(years: Year[]) {
  const latest = years.map((y) => Number(y.name.slice(0, 4))).sort((a, b) => b - a)[0];
  const start = latest ? latest + 1 : new Date().getMonth() >= 5 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  return { name: `${start}-${String((start + 1) % 100).padStart(2, '0')}`, startDate: `${start}-06-01`, endDate: `${start + 1}-03-31`, makeCurrent: years.length === 0 };
}

export default function AcademicYearsPage() {
  const { can } = useSession();
  const toast = useToast();
  const { t, locale } = useI18n();
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);
  const canManage = can(PERMISSIONS.ORG_ACADEMIC_MANAGE, { allCampuses: true });
  const [years, setYears] = useState<Year[] | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', startDate: '', endDate: '', makeCurrent: false });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Year[]>('/academic-years').then(setYears).catch(() => setYears([]));
  }, []);
  useEffect(load, [load]);

  function openCreate() {
    setIdemKey(newIdempotencyKey());
    setForm(suggestion(years ?? []));
    setErrors({});
    setFormError(null);
    setOpen(true);
  }

  async function save() {
    const v = validate(createAcademicYearSchema, form);
    if (!v.ok) return setErrors(v.errors);
    setBusy('create');
    try {
      await api('/academic-years', { method: 'POST', headers: { 'Idempotency-Key': idemKey }, body: JSON.stringify(v.data) });
      setOpen(false);
      toast(t('years.added', { name: v.data.name }));
      load();
    } catch (e) {
      const { fields, message } = apiErrors(e);
      setErrors(fields);
      setFormError(message);
    } finally {
      setBusy(null);
    }
  }

  async function act(y: Year, action: 'make-current' | 'close') {
    setBusy(y.id);
    try {
      await api(`/academic-years/${y.id}/${action}`, { method: 'POST' });
      toast(action === 'close' ? t('years.closed', { name: y.name }) : t('years.nowCurrent', { name: y.name }));
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not update', 'bad');
    } finally {
      setBusy(null);
    }
  }

  const current = years?.find((y) => y.isCurrent);

  return (
    <>
      <PageHeader
        eyebrow={t('nav.setup')}
        title={t('nav.academicYears')}
        description={t('years.desc')}
        actions={canManage && <button className="btn btn-primary" onClick={openCreate}><Icon name="plus" /> {t('years.add')}</button>}
      />

      {years === null ? (
        <SkeletonRows />
      ) : years.length === 0 ? (
        <EmptyState icon="calendar" title={t('years.emptyTitle')} text={t('years.emptyText')} action={canManage && <button className="btn btn-primary" onClick={openCreate}><Icon name="plus" /> {t('years.add')}</button>} />
      ) : (
        <>
          {current && (
            <div className="hero-strip">
              <span className="hero-icon"><Icon name="calendar" size={22} /></span>
              <div>
                <p className="eyebrow">{t('years.current')}</p>
                <h2 className="hero-title">{current.name}</h2>
                <p className="muted">{fmt(current.startDate, locale)} – {fmt(current.endDate, locale)}</p>
              </div>
            </div>
          )}
          <div className="year-grid">
            {years.map((y) => (
              <article key={y.id} className={`card year-card ${y.isCurrent ? 'is-current' : ''}`}>
                <div className="year-top">
                  <h3 className="year-name">{y.name}</h3>
                  {y.isCurrent ? <StatusBadge status="CURRENT" /> : <StatusBadge status={y.status} />}
                </div>
                <p className="muted">{fmt(y.startDate, locale)} – {fmt(y.endDate, locale)}</p>
                {canManage && !y.isCurrent && y.status !== 'CLOSED' && (
                  <div className="year-actions">
                    <button className="btn btn-sm" disabled={busy === y.id} onClick={() => act(y, 'make-current')}>{t('years.makeCurrent')}</button>
                    {y.status === 'ACTIVE' && <button className="btn btn-sm btn-ghost" disabled={busy === y.id} onClick={() => act(y, 'close')}>{t('years.close')}</button>}
                  </div>
                )}
              </article>
            ))}
          </div>
        </>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={t('years.add')} subtitle={t('years.dialogSub')} onSubmit={save} submitLabel={t('years.addBtn')} busy={busy === 'create'} error={formError}>
        <Field id="name" label={t('common.name')} error={errors.name} hint={t('years.hint')}>
          <input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-invalid={!!errors.name} autoFocus />
        </Field>
        <div className="grid-2">
          <Field id="startDate" label={t('years.starts')} error={errors.startDate}>
            <input id="startDate" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          </Field>
          <Field id="endDate" label={t('years.ends')} error={errors.endDate}>
            <input id="endDate" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          </Field>
        </div>
        <label className="check"><input type="checkbox" checked={form.makeCurrent} onChange={(e) => setForm({ ...form, makeCurrent: e.target.checked })} /> {t('years.makeCurrentCheck')}</label>
      </Modal>
    </>
  );
}
