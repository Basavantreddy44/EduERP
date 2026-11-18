'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { HOSTEL_TYPES, PERMISSIONS, formatINR, toPaise } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { useStaffOptions } from '@/components/staff';
import { HostelRow, OccupancyBar } from '@/components/hostel';

interface StaffPick { id: string; firstName: string; lastName: string | null; employeeCode: string; designation: string | null }

/** Hostel → Hostels (M7.1): each hostel with its occupancy; add a hostel. */
export default function HostelsPage() {
  const { can, campusId } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const opts = useStaffOptions();
  const manage = can(PERMISSIONS.HOSTEL_MANAGE);
  const [rows, setRows] = useState<HostelRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [staff, setStaff] = useState<StaffPick[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<HostelRow[]>(`/hostel/hostels${campusId ? `?campusId=${campusId}` : ''}`).then(setRows).catch(() => setRows([])); }, [campusId]);
  useEffect(load, [load]);
  const campuses = opts?.campuses ?? [];

  const start = () => {
    const c = campusId ?? campuses[0]?.id ?? '';
    setForm({ campusId: c, name: '', hostelType: 'GIRLS', wardenEmployeeId: '', depositAmount: '0' });
    setErrors({}); setError(null);
    api<{ items: StaffPick[] }>(`/staff?status=ACTIVE&pageSize=100&campusId=${c}`).then((r) => setStaff(r.items)).catch(() => setStaff([]));
    setOpen(true);
  };
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try {
      const h = await api<{ id: string }>('/hostel/hostels', { method: 'POST', body: JSON.stringify({ ...form, wardenEmployeeId: form.wardenEmployeeId || null, depositAmount: form.depositAmount || '0' }) });
      toast(t('hs.added', { name: form.name }));
      setOpen(false); router.push(`/hostel/${h.id}`);
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader eyebrow={t('nav.hostel')} title={t('hs.title')} description={t('hs.desc')}
        actions={<>
          <Link href="/hostel/mess" className="btn"><Icon name="clipboard" /> {t('nav.mess')}</Link>
          {manage && <button type="button" className="btn btn-primary" onClick={start} disabled={!campuses.length}><Icon name="plus" /> {t('hs.add')}</button>}
        </>} />
      {!rows ? <SkeletonRows rows={4} /> : rows.length === 0 ? <EmptyState icon="building" title={t('hs.none')} text={t('hs.noneHint')} /> : (
        <ul className="hostel-cards">
          {rows.map((h) => (
            <li key={h.id}>
              <Link href={`/hostel/${h.id}`} className="card hostel-card">
                <div className="hostel-card-head">
                  <span><strong className="card-title">{h.name}</strong><span className="muted small">{t(`hs.type.${h.hostelType}` as MessageKey)}{h.warden ? ` · ${t('hs.warden')}: ${h.warden.name}` : ''}</span></span>
                  <StatusBadge status={h.status} />
                </div>
                <p className="hostel-card-nums"><strong>{h.occupied + h.reserved}</strong> / {h.beds} {t('hs.bedsTaken')} · {t('hs.nRooms', { n: h.rooms })}{toPaise(h.depositAmount) > 0 ? ` · ${t('hs.deposit')} ${formatINR(toPaise(h.depositAmount))}` : ''}</p>
                <OccupancyBar h={h} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={t('hs.add')} subtitle={t('hs.addSub')} onSubmit={save} submitLabel={t('tr.save')} busy={busy} error={error}>
        {campuses.length > 1 && (
          <Field id="h-campus" label={t('common.campus')} error={errors.campusId}>
            <select id="h-campus" value={form.campusId} onChange={set('campusId')}>{campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </Field>
        )}
        <Field id="h-name" label={t('hs.name')} error={errors.name}><input id="h-name" value={form.name ?? ''} onChange={set('name')} placeholder="Kaveri Girls Hostel" /></Field>
        <div className="grid-2">
          <Field id="h-type" label={t('hs.for')} error={errors.hostelType}>
            <select id="h-type" value={form.hostelType} onChange={set('hostelType')}>{HOSTEL_TYPES.map((x) => <option key={x} value={x}>{t(`hs.type.${x}` as MessageKey)}</option>)}</select>
          </Field>
          <Field id="h-dep" label={t('hs.depositLabel')} error={errors.depositAmount} hint={t('hs.depositHint')}><input id="h-dep" type="number" min={0} value={form.depositAmount ?? ''} onChange={set('depositAmount')} /></Field>
        </div>
        <Field id="h-warden" label={t('hs.warden')} error={errors.wardenEmployeeId}>
          <select id="h-warden" value={form.wardenEmployeeId} onChange={set('wardenEmployeeId')}>
            <option value="">{t('tr.later')}</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{`${s.firstName} ${s.lastName ?? ''}`.trim()} · {s.employeeCode}{s.designation ? ` · ${s.designation}` : ''}</option>)}
          </select>
        </Field>
      </Modal>
    </>
  );
}
