'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEPT_TYPES, DEPT_TYPE_LABELS, PERMISSIONS, createDepartmentSchema } from '@eduerp/shared';
import { api, newIdempotencyKey, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { apiErrors, FieldErrors, validate } from '@/lib/form';
import { Icon } from '@/components/Icon';
import { ExportButton } from '@/components/ExportButton';
import { Field, Modal } from '@/components/Modal';
import { CampusPicker } from '@/components/CampusPicker';
import { DataTable } from '@/components/DataTable';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';

interface Dept {
  id: string;
  name: string;
  code: string;
  deptType: keyof typeof DEPT_TYPE_LABELS;
  status: string;
  campusId: string | null;
  campus: { code: string; name: string } | null;
}

export default function DepartmentsPage() {
  const { can, campusId } = useSession();
  const toast = useToast();
  const { t, locale } = useI18n();
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);
  const canManage = can(PERMISSIONS.ORG_ACADEMIC_MANAGE);
  const allScope = can(PERMISSIONS.ORG_ACADEMIC_MANAGE, { allCampuses: true });
  const [rows, setRows] = useState<Dept[] | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ campusId: '', name: '', code: '', deptType: 'ACADEMIC' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api<Dept[]>('/departments').then(setRows).catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);

  const shown = useMemo(() => rows?.filter((d) => !campusId || d.campusId === campusId || d.campusId === null) ?? null, [rows, campusId]);

  function openCreate() {
    setIdemKey(newIdempotencyKey());
    setForm({ campusId: allScope ? campusId ?? '' : campusId ?? '', name: '', code: '', deptType: 'ACADEMIC' });
    setErrors({});
    setFormError(null);
    setOpen(true);
  }

  async function save() {
    const v = validate(createDepartmentSchema, { ...form, campusId: form.campusId || null });
    if (!v.ok) return setErrors(v.errors);
    setSaving(true);
    try {
      await api('/departments', { method: 'POST', headers: { 'Idempotency-Key': idemKey }, body: JSON.stringify(v.data) });
      setOpen(false);
      toast(t('depts.added', { name: v.data.name }));
      load();
    } catch (e) {
      const { fields, message } = apiErrors(e);
      setErrors(fields);
      setFormError(message);
    } finally {
      setSaving(false);
    }
  }

  async function toggle(d: Dept) {
    try {
      await api(`/departments/${d.id}`, { method: 'PATCH', body: JSON.stringify({ status: d.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }) });
      toast(`${d.name} ${d.status === 'ACTIVE' ? 'deactivated' : 'reactivated'}`);
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not update', 'bad');
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={t('nav.setup')}
        title={t('nav.departments')}
        description={t('depts.desc')}
        actions={<><ExportButton type="DEPARTMENTS" />{canManage && <button className="btn btn-primary" onClick={openCreate}><Icon name="plus" /> {t('depts.add')}</button>}</>}
      />

      {shown === null ? (
        <SkeletonRows />
      ) : shown.length === 0 ? (
        <EmptyState icon="department" title={t('depts.emptyTitle')} text={t('depts.emptyText')} action={canManage && <button className="btn btn-primary" onClick={openCreate}><Icon name="plus" /> {t('depts.add')}</button>} />
      ) : (
        <DataTable
          rows={shown}
          rowKey={(d) => d.id}
          caption={t('nav.departments')}
          initialSort={{ key: 'name', dir: 'asc' }}
          rowClass={(d) => (d.status !== 'ACTIVE' ? 'row-dim' : undefined)}
          columns={[
            { key: 'code', header: t('common.code'), sort: (d) => d.code, cell: (d) => <span className="code">{d.code}</span> },
            { key: 'name', header: t('depts.department'), sort: (d) => d.name, cell: (d) => <strong>{d.name}</strong> },
            { key: 'type', header: t('common.type'), sort: (d) => d.deptType, cell: (d) => t(`deptType.${d.deptType}` as MessageKey) },
            { key: 'campus', header: t('common.campus'), sort: (d) => d.campus?.name ?? '', cell: (d) => d.campus?.name ?? <span className="muted">{t('common.wholeInstitution')}</span> },
            { key: 'status', header: t('common.status'), sort: (d) => d.status, cell: (d) => <StatusBadge status={d.status} /> },
            ...(canManage
              ? [{ key: 'actions', header: <span className="sr-only">{t('depts.deactivate')}</span>, align: 'right' as const, cell: (d: Dept) => (allScope || d.campusId ? <button className="btn btn-sm btn-ghost" onClick={() => toggle(d)}>{d.status === 'ACTIVE' ? t('depts.deactivate') : t('depts.reactivate')}</button> : null) }]
              : []),
          ]}
        />
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={t('depts.add')} onSubmit={save} submitLabel={t('depts.add')} busy={saving} error={formError}>
        <Field id="dept-name" label={t('common.name')} error={errors.name}>
          <input id="dept-name" value={form.name} placeholder="Science" onChange={(e) => setForm({ ...form, name: e.target.value })} aria-invalid={!!errors.name} autoFocus />
        </Field>
        <div className="grid-2">
          <Field id="dept-code" label={t('common.code')} error={errors.code} hint={t('depts.codeHint')}>
            <input id="dept-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} aria-invalid={!!errors.code} />
          </Field>
          <Field id="dept-type" label={t('common.type')}>
            <select id="dept-type" value={form.deptType} onChange={(e) => setForm({ ...form, deptType: e.target.value })}>
              {DEPT_TYPES.map((dt) => <option key={dt} value={dt}>{t(`deptType.${dt}` as MessageKey)}</option>)}
            </select>
          </Field>
        </div>
        <Field id="dept-campus" label={t('common.campus')} error={errors.campusId} hint={allScope ? t('depts.campusHint') : undefined}>
          <CampusPicker id="dept-campus" value={form.campusId} allowInstitution={allScope} institutionLabel={t('common.wholeInstitution')} onChange={(v) => setForm((f) => ({ ...f, campusId: v }))} />
        </Field>
      </Modal>
    </>
  );
}
