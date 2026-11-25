'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PERMISSIONS, healthCampSchema } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors, validate } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { todayIST, useDay } from '@/components/admissions';

interface Camp { id: string; campusId: string; campus: string; campDate: string; title: string; conductedBy: string | null; status: string; screened: number; referred: number }

/** Health → Check-up camps (Phase 21 R5): camps by school; open one to enter the class sheets. */
export default function HealthCampsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const day = useDay();
  const { can } = useSession();
  const router = useRouter();
  const canManage = can(PERMISSIONS.HEALTH_MANAGE);
  const [rows, setRows] = useState<Camp[] | null>(null);
  const [campuses, setCampuses] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ campusId: '', campDate: todayIST(), title: '', conductedBy: '', notes: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { api<Camp[]>('/health/camps').then(setRows).catch(() => setRows([])); }, []);
  useEffect(load, [load]);
  useEffect(() => { if (canManage) api<{ id: string; name: string }[]>('/campuses').then(setCampuses).catch(() => setCampuses([])); }, [canManage]);

  function start() {
    setF({ campusId: campuses.length === 1 ? campuses[0].id : '', campDate: todayIST(), title: '', conductedBy: '', notes: '' });
    setErrors({});
    setOpen(true);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = validate(healthCampSchema, f);
    if (!v.ok) return setErrors(v.errors);
    setBusy(true);
    try {
      const r = await api<{ id: string }>('/health/camps', { method: 'POST', body: JSON.stringify(v.data) });
      toast(t('hc.created'));
      setOpen(false);
      router.push(`/health/camps/${r.id}`);
    } catch (err) {
      const { fields, message } = apiErrors(err);
      setErrors({ ...fields, ...(message && !Object.keys(fields).length ? { form: message } : {}) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow={t('nav.campusCare')} title={t('hc.title')} description={t('hc.desc')}
        actions={canManage && <button type="button" className="btn btn-primary" onClick={start}><Icon name="plus" /> {t('hc.add')}</button>} />
      {!rows ? <SkeletonRows /> : !rows.length ? (
        <EmptyState icon="shield" title={t('hc.empty')} text={t('hc.emptyText')} action={canManage && <button type="button" className="btn btn-primary" onClick={start}><Icon name="plus" /> {t('hc.add')}</button>} />
      ) : (
        <div className="table-wrap" role="region" aria-label={t('hc.title')} tabIndex={0}>
          <table>
            <thead><tr><th scope="col">{t('hc.camp')}</th><th scope="col">{t('common.campus')}</th><th scope="col">{t('hc.date')}</th><th scope="col" className="num">{t('hc.screened')}</th><th scope="col" className="num">{t('hc.referred')}</th><th scope="col">{t('common.status')}</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/health/camps/${c.id}`}><strong>{c.title}</strong></Link>{c.conductedBy && <span className="sub-line muted small">{c.conductedBy}</span>}</td>
                  <td>{c.campus}</td>
                  <td>{day(c.campDate)}</td>
                  <td className="num">{c.screened}</td>
                  <td className="num">{c.referred}</td>
                  <td><StatusBadge status={c.status === 'OPEN' ? 'ACTIVE' : 'CLOSED'} label={c.status === 'OPEN' ? t('hc.open') : t('hc.closed')} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('hc.add')} onSubmit={submit} submitLabel={t('hc.create')} busy={busy} error={errors.form}>
        <div className="grid-2">
          <Field id="hc-school" label={t('common.campus')} error={errors.campusId}>
            <select id="hc-school" value={f.campusId} onChange={(e) => setF({ ...f, campusId: e.target.value })}>
              <option value="">{t('mv.choose')}</option>
              {campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field id="hc-date" label={t('hc.date')} error={errors.campDate}><input id="hc-date" type="date" value={f.campDate} onChange={(e) => setF({ ...f, campDate: e.target.value })} /></Field>
        </div>
        <Field id="hc-title" label={t('hc.titleField')} error={errors.title} hint={t('hc.titleHint')}><input id="hc-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field id="hc-by" label={t('hc.by')} error={errors.conductedBy}><input id="hc-by" value={f.conductedBy} onChange={(e) => setF({ ...f, conductedBy: e.target.value })} /></Field>
        <Field id="hc-notes" label={t('hc.notes')} error={errors.notes}><textarea id="hc-notes" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </Modal>
    </>
  );
}
