'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { HOLIDAY_TYPES, HOLIDAY_TYPE_LABELS, PERMISSIONS, createHolidaySchema } from '@eduerp/shared';
import { api, newIdempotencyKey, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { apiErrors, FieldErrors, validate } from '@/lib/form';
import { Icon } from '@/components/Icon';
import { ExportButton } from '@/components/ExportButton';
import { Field, Modal } from '@/components/Modal';
import { CampusPicker } from '@/components/CampusPicker';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';

interface Holiday {
  id: string;
  holidayDate: string;
  name: string;
  holidayType: keyof typeof HOLIDAY_TYPE_LABELS;
  campusId: string | null;
  campus: { name: string } | null;
}

const d = (s: string) => new Date(`${s}T00:00:00`);

export default function HolidaysPage() {
  const { can, campusId } = useSession();
  const toast = useToast();
  const { t, locale } = useI18n();
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);
  const canManage = can(PERMISSIONS.ORG_ACADEMIC_MANAGE);
  const allScope = can(PERMISSIONS.ORG_ACADEMIC_MANAGE, { allCampuses: true });
  const [rows, setRows] = useState<Holiday[] | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ campusId: '', holidayDate: '', name: '', holidayType: 'PUBLIC' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api<Holiday[]>(`/holidays${campusId ? `?campusId=${campusId}` : ''}`).then(setRows).catch(() => setRows([]));
  }, [campusId]);
  useEffect(load, [load]);

  /** Grouped by month, upcoming first-class: the list reads like a calendar. */
  const months = useMemo(() => {
    const groups = new Map<string, Holiday[]>();
    for (const h of rows ?? []) {
      const key = d(h.holidayDate).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
      groups.set(key, [...(groups.get(key) ?? []), h]);
    }
    return [...groups.entries()];
  }, [rows, locale]);
  const today = new Date().toISOString().slice(0, 10);
  const nextUp = rows?.find((h) => h.holidayDate >= today);

  function openCreate() {
    setIdemKey(newIdempotencyKey());
    setForm({ campusId: allScope ? '' : campusId ?? '', holidayDate: '', name: '', holidayType: 'PUBLIC' });
    setErrors({});
    setFormError(null);
    setOpen(true);
  }

  async function save() {
    const v = validate(createHolidaySchema, { ...form, campusId: form.campusId || null });
    if (!v.ok) return setErrors(v.errors);
    setSaving(true);
    try {
      await api('/holidays', { method: 'POST', headers: { 'Idempotency-Key': idemKey }, body: JSON.stringify(v.data) });
      setOpen(false);
      toast(t('hols.added', { name: v.data.name }));
      load();
    } catch (e) {
      const { fields, message } = apiErrors(e);
      setErrors(fields);
      setFormError(message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(h: Holiday) {
    if (!window.confirm(t('hols.confirmRemove', { name: h.name }))) return;
    try {
      await api(`/holidays/${h.id}`, { method: 'DELETE' });
      toast(t('hols.removed', { name: h.name }));
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not remove', 'bad');
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={t('nav.setup')}
        title={t('nav.holidays')}
        description={t('hols.desc')}
        actions={<><ExportButton type="HOLIDAYS" />{canManage && <button className="btn btn-primary" onClick={openCreate}><Icon name="plus" /> {t('hols.add')}</button>}</>}
      />

      {rows === null ? (
        <SkeletonRows />
      ) : rows.length === 0 ? (
        <EmptyState icon="holiday" title={t('hols.emptyTitle')} text={t('hols.emptyText')} action={canManage && <button className="btn btn-primary" onClick={openCreate}><Icon name="plus" /> {t('hols.add')}</button>} />
      ) : (
        <>
          {nextUp && (
            <div className="hero-strip">
              <span className="hero-icon"><Icon name="holiday" size={22} /></span>
              <div>
                <p className="eyebrow">{t('hols.next')}</p>
                <h2 className="hero-title">{nextUp.name}</h2>
                <p className="muted">{d(nextUp.holidayDate).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
              </div>
            </div>
          )}
          {months.map(([month, list]) => (
            <section key={month}>
              <h3 className="section-title">{month}</h3>
              <ul className="holiday-list">
                {list.map((h) => (
                  <li key={h.id} className={`holiday ${h.holidayDate < today ? 'past' : ''}`}>
                    <span className="date-chip">
                      <strong>{d(h.holidayDate).getDate()}</strong>
                      <span>{d(h.holidayDate).toLocaleDateString(locale, { weekday: 'short' })}</span>
                    </span>
                    <span className="holiday-text">
                      <strong>{h.name}</strong>
                      <span className="muted">{t(`holType.${h.holidayType}` as MessageKey)} · {h.campus?.name ?? t('common.allCampuses')}</span>
                    </span>
                    {canManage && (allScope || h.campusId) && (
                      <button className="btn btn-sm btn-ghost" aria-label={t('hols.remove', { name: h.name })} onClick={() => remove(h)}><Icon name="x" size={16} /></button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={t('hols.add')} onSubmit={save} submitLabel={t('hols.add')} busy={saving} error={formError}>
        <Field id="hol-name" label={t('common.name')} error={errors.name}>
          <input id="hol-name" value={form.name} placeholder="Kannada Rajyotsava" onChange={(e) => setForm({ ...form, name: e.target.value })} aria-invalid={!!errors.name} autoFocus />
        </Field>
        <div className="grid-2">
          <Field id="hol-date" label={t('common.date')} error={errors.holidayDate}>
            <input id="hol-date" type="date" value={form.holidayDate} onChange={(e) => setForm({ ...form, holidayDate: e.target.value })} aria-invalid={!!errors.holidayDate} />
          </Field>
          <Field id="hol-type" label={t('common.type')}>
            <select id="hol-type" value={form.holidayType} onChange={(e) => setForm({ ...form, holidayType: e.target.value })}>
              {HOLIDAY_TYPES.map((ht) => <option key={ht} value={ht}>{t(`holType.${ht}` as MessageKey)}</option>)}
            </select>
          </Field>
        </div>
        <Field id="hol-campus" label={t('hols.appliesTo')}>
          <CampusPicker id="hol-campus" value={form.campusId} allowInstitution={allScope} institutionLabel={t('common.allCampuses')} onChange={(v) => setForm((f) => ({ ...f, campusId: v }))} />
        </Field>
      </Modal>
    </>
  );
}
