'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PERMISSIONS, ROUTE_SHIFTS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { useStaffOptions } from '@/components/staff';
import { CrewRow, RouteRow, SeatBar, VehicleRow, fmtVehicleNo } from '@/components/transport';

/** Transport → Routes (M6.2). */
export default function RoutesPage() {
  const { can, campusId } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const opts = useStaffOptions();
  const manage = can(PERMISSIONS.TRANSPORT_MANAGE);
  const [routes, setRoutes] = useState<RouteRow[] | null>(null);
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [crew, setCrew] = useState<CrewRow[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const q = campusId ? `?campusId=${campusId}` : '';
  const load = useCallback(() => { api<RouteRow[]>(`/transport/routes${q}`).then(setRoutes).catch(() => setRoutes([])); }, [q]);
  useEffect(load, [load]);

  const campuses = opts?.campuses ?? [];
  const start = () => {
    const c = campusId ?? campuses[0]?.id ?? '';
    setForm({ campusId: c, routeNo: '', name: '', vehicleId: '', driverId: '', attendantId: '', shift: 'BOTH' });
    setErrors({}); setError(null);
    api<VehicleRow[]>('/transport/vehicles').then(setVehicles).catch(() => setVehicles([]));
    api<CrewRow[]>('/transport/crew').then(setCrew).catch(() => setCrew([]));
    setOpen(true);
  };
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try {
      const r = await api<{ id: string }>('/transport/routes', { method: 'POST', body: JSON.stringify({ ...form, vehicleId: form.vehicleId || null, driverId: form.driverId || null, attendantId: form.attendantId || null }) });
      toast(t('tr.routeAdded', { no: form.routeNo }));
      setOpen(false);
      router.push(`/transport/routes/${r.id}`);
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const inCampus = <T extends { campusId: string; status: string }>(rows: T[]) => rows.filter((r) => r.campusId === form.campusId && r.status === 'ACTIVE');

  return (
    <>
      <PageHeader eyebrow={t('nav.transport')} title={t('tr.routesTitle')} description={t('tr.routesDesc')}
        actions={manage ? <button type="button" className="btn btn-primary" onClick={start} disabled={!campuses.length}><Icon name="plus" /> {t('tr.addRoute')}</button> : undefined} />
      {!routes ? <SkeletonRows rows={4} /> : routes.length === 0 ? <EmptyState icon="route" title={t('tr.noRoutes')} text={t('tr.noRoutesHint')} /> : (
        <div className="table-wrap card">
          <table className="table">
            <thead><tr><th>{t('tr.col.route')}</th><th className="hide-sm">{t('tr.col.stops')}</th><th>{t('tr.col.vehicle')}</th><th className="hide-sm">{t('tr.col.driver')}</th><th>{t('tr.col.seats')}</th><th>{t('common.status')}</th></tr></thead>
            <tbody>
              {routes.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/transport/routes/${r.id}`} className="strong-link">{r.routeNo} · {r.name}</Link><span className="sub-line muted">{t(`tr.shift.${r.shift}` as MessageKey)}{r.startsAt ? ` · ${t('tr.startsAt', { time: r.startsAt })}` : ''}</span></td>
                  <td className="hide-sm">{r.stopCount ? <>{t('tr.nStops', { n: r.stopCount })}<span className="sub-line muted">{r.firstStop} → {r.lastStop}</span></> : <span className="muted">{t('tr.noStops')}</span>}</td>
                  <td>{r.vehicle ? fmtVehicleNo(r.vehicle.vehicleNo) : <span className="muted">—</span>}</td>
                  <td className="hide-sm">{r.driver ? <>{r.driver.name}{r.driver.phone && <span className="sub-line muted">{r.driver.phone}</span>}</> : <span className="muted">—</span>}</td>
                  <td>{r.vehicle ? <SeatBar used={r.seatsUsed} seats={r.vehicle.seatingCapacity} /> : <span className="muted">—</span>}</td>
                  <td><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={t('tr.addRoute')} subtitle={t('tr.addRouteSub')} onSubmit={save} submitLabel={t('tr.save')} busy={busy} error={error}>
        {campuses.length > 1 && (
          <Field id="r-campus" label={t('common.campus')} error={errors.campusId}>
            <select id="r-campus" value={form.campusId} onChange={(e) => setForm((f) => ({ ...f, campusId: e.target.value, vehicleId: '', driverId: '', attendantId: '' }))}>{campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </Field>
        )}
        <div className="grid-2">
          <Field id="r-no" label={t('tr.routeNo')} error={errors.routeNo}><input id="r-no" value={form.routeNo ?? ''} onChange={set('routeNo')} placeholder="R1" /></Field>
          <Field id="r-name" label={t('tr.routeName')} error={errors.name}><input id="r-name" value={form.name ?? ''} onChange={set('name')} placeholder="Rajajinagar" /></Field>
          <Field id="r-veh" label={t('tr.col.vehicle')} error={errors.vehicleId}>
            <select id="r-veh" value={form.vehicleId} onChange={set('vehicleId')}><option value="">{t('tr.later')}</option>{inCampus(vehicles).map((v) => <option key={v.id} value={v.id}>{fmtVehicleNo(v.vehicleNo)} · {t('tr.nSeats', { n: v.seatingCapacity })}</option>)}</select>
          </Field>
          <Field id="r-shift" label={t('tr.shiftLabel')} error={errors.shift}>
            <select id="r-shift" value={form.shift} onChange={set('shift')}>{ROUTE_SHIFTS.map((x) => <option key={x} value={x}>{t(`tr.shift.${x}` as MessageKey)}</option>)}</select>
          </Field>
          <Field id="r-drv" label={t('tr.col.driver')} error={errors.driverId}>
            <select id="r-drv" value={form.driverId} onChange={set('driverId')}><option value="">{t('tr.later')}</option>{inCampus(crew).filter((c) => c.role === 'DRIVER').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </Field>
          <Field id="r-att" label={t('tr.attendant')} error={errors.attendantId}>
            <select id="r-att" value={form.attendantId} onChange={set('attendantId')}><option value="">{t('tr.none')}</option>{inCampus(crew).filter((c) => c.role !== 'DRIVER').map((c) => <option key={c.id} value={c.id}>{c.name} · {t(`tr.role.${c.role}` as MessageKey)}</option>)}</select>
          </Field>
        </div>
      </Modal>
    </>
  );
}
