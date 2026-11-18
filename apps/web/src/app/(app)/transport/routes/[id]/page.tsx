'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PERMISSIONS, ROUTE_SHIFTS, formatINR, toPaise } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { CrewRow, LiveTrackingSoon, SeatBar, VehicleRow, fmtVehicleNo } from '@/components/transport';

interface Stop { id: string; stopName: string; sequence: number; pickupTime: string | null; dropTime: string | null; distanceKm: number | null; feeAmount: string; students: number }
interface Route {
  id: string; campusId: string; routeNo: string; name: string; shift: string; status: string; vehicleId: string | null; driverId: string | null; attendantId: string | null;
  vehicle: { id: string; vehicleNo: string; seatingCapacity: number; vehicleType: string } | null;
  driver: { name: string; phone: string | null } | null; attendant: { name: string; phone: string | null } | null;
  seatsUsed: number; stops: Stop[];
}
interface Rider { id: string; studentId: string; name: string; admissionNo: string; className: string | null; stopName: string; sequence: number; pickupTime: string | null; dropTime: string | null; pickupDrop: string; guardianName: string | null; guardianPhone: string | null }
type Draft = { id?: string; stopName: string; pickupTime: string; dropTime: string; distanceKm: string; feeAmount: string; students: number };

/** One route (M6.2–M6.3): stops in pickup order, vehicle and crew, and the driver's list. */
export default function RoutePage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const manage = can(PERMISSIONS.TRANSPORT_MANAGE);
  const [r, setR] = useState<Route | null>(null);
  const [riders, setRiders] = useState<Rider[] | null>(null);
  const [draft, setDraft] = useState<Draft[] | null>(null);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [crew, setCrew] = useState<CrewRow[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<Route>(`/transport/routes/${id}`).then(setR).catch(() => setR(null));
    api<{ riders: Rider[] }>(`/transport/routes/${id}/riders`).then((x) => setRiders(x.riders)).catch(() => setRiders([]));
  }, [id]);
  useEffect(load, [load]);
  if (!r) return <SkeletonRows rows={6} />;

  const startStops = () => setDraft((r.stops.length ? r.stops : []).map((s): Draft => ({ id: s.id, stopName: s.stopName, pickupTime: s.pickupTime ?? '', dropTime: s.dropTime ?? '', distanceKm: s.distanceKm === null ? '' : String(s.distanceKm), feeAmount: String(Number(s.feeAmount)), students: s.students })).concat(r.stops.length ? [] : [{ stopName: '', pickupTime: '', dropTime: '', distanceKm: '', feeAmount: '', students: 0 }]));
  const upd = (i: number, k: keyof Draft, v: string) => setDraft((d) => d!.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const move = (i: number, by: number) => setDraft((d) => { const a = [...d!]; const [x] = a.splice(i, 1); a.splice(i + by, 0, x); return a; });
  const saveStops = async () => {
    setBusy(true); setError(null); setErrors({});
    try {
      await api(`/transport/routes/${id}/stops`, { method: 'PUT', body: JSON.stringify({ stops: draft!.map((s) => ({ id: s.id, stopName: s.stopName, pickupTime: s.pickupTime || null, dropTime: s.dropTime || null, distanceKm: s.distanceKm === '' ? null : Number(s.distanceKm), feeAmount: s.feeAmount || '0' })) }) });
      toast(t('tr.stopsSaved'));
      setDraft(null); load();
    } catch (x) { const a = apiErrors(x); setError(a.message ?? Object.values(a.fields)[0] ?? null); } finally { setBusy(false); }
  };
  const openEdit = () => {
    setForm({ vehicleId: r.vehicleId ?? '', driverId: r.driverId ?? '', attendantId: r.attendantId ?? '', shift: r.shift, name: r.name, status: r.status });
    setErrors({}); setError(null);
    api<VehicleRow[]>(`/transport/vehicles?campusId=${r.campusId}`).then(setVehicles).catch(() => setVehicles([]));
    api<CrewRow[]>(`/transport/crew?campusId=${r.campusId}`).then(setCrew).catch(() => setCrew([]));
    setEdit(true);
  };
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const saveRoute = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try {
      await api(`/transport/routes/${id}`, { method: 'PATCH', body: JSON.stringify({ ...form, vehicleId: form.vehicleId || null, driverId: form.driverId || null, attendantId: form.attendantId || null }) });
      toast(t('tr.routeSaved')); setEdit(false); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const byStop = (riders ?? []).reduce<Record<string, Rider[]>>((m, x) => ({ ...m, [x.stopName]: [...(m[x.stopName] ?? []), x] }), {});

  return (
    <>
      <Link href="/transport/routes" className="back-link no-print"><Icon name="chevronRight" size={16} className="flip" /> {t('tr.routesTitle')}</Link>
      <PageHeader
        eyebrow={t('tr.routeEyebrow', { no: r.routeNo })}
        title={r.name}
        description={[t(`tr.shift.${r.shift}` as MessageKey), r.vehicle ? fmtVehicleNo(r.vehicle.vehicleNo) : t('tr.noVehicle'), r.driver ? `${t('tr.col.driver')}: ${r.driver.name}${r.driver.phone ? ` (${r.driver.phone})` : ''}` : null, r.attendant ? `${t('tr.attendant')}: ${r.attendant.name}` : null].filter(Boolean).join(' · ')}
        actions={<>
          <button type="button" className="btn no-print" onClick={() => window.print()}><Icon name="file" /> {t('tr.printList')}</button>
          {manage && <button type="button" className="btn no-print" onClick={openEdit}><Icon name="edit" /> {t('tr.editRoute')}</button>}
        </>}
      />
      <div className="tr-facts no-print">
        <div className="card"><span className="muted small">{t('tr.col.seats')}</span>{r.vehicle ? <SeatBar used={r.seatsUsed} seats={r.vehicle.seatingCapacity} /> : <span className="muted">{t('tr.noVehicle')}</span>}</div>
        <div className="card"><span className="muted small">{t('common.status')}</span><StatusBadge status={r.status} /></div>
        <div className="card"><LiveTrackingSoon /></div>
      </div>

      <div className="panel-head no-print">
        <h2 className="section-title">{t('tr.stops')}</h2>
        {manage && !draft && <button type="button" className="btn btn-sm" onClick={startStops}><Icon name="edit" size={14} /> {t('tr.editStops')}</button>}
      </div>
      {draft ? (
        <div className="card no-print">
          <div className="table-wrap">
            <table className="table stop-edit">
              <thead><tr><th>#</th><th>{t('tr.stopName')}</th><th>{t('tr.pickup')}</th><th>{t('tr.drop')}</th><th>{t('tr.km')}</th><th>{t('tr.yearFee')}</th><th aria-label={t('tr.order')} /></tr></thead>
              <tbody>
                {draft.map((s, i) => (
                  <tr key={s.id ?? `new-${i}`}>
                    <td>{i + 1}</td>
                    <td><input aria-label={t('tr.stopName')} value={s.stopName} onChange={(e) => upd(i, 'stopName', e.target.value)} /></td>
                    <td><input aria-label={t('tr.pickup')} type="time" value={s.pickupTime} onChange={(e) => upd(i, 'pickupTime', e.target.value)} /></td>
                    <td><input aria-label={t('tr.drop')} type="time" value={s.dropTime} onChange={(e) => upd(i, 'dropTime', e.target.value)} /></td>
                    <td><input aria-label={t('tr.km')} type="number" min={0} step="0.1" value={s.distanceKm} onChange={(e) => upd(i, 'distanceKm', e.target.value)} /></td>
                    <td><input aria-label={t('tr.yearFee')} type="number" min={0} step="1" value={s.feeAmount} onChange={(e) => upd(i, 'feeAmount', e.target.value)} /></td>
                    <td className="row-actions">
                      <button type="button" className="btn btn-ghost icon-btn" aria-label={t('tr.up')} disabled={i === 0} onClick={() => move(i, -1)}><Icon name="chevronRight" size={16} className="rot-up" /></button>
                      <button type="button" className="btn btn-ghost icon-btn" aria-label={t('tr.down')} disabled={i === draft.length - 1} onClick={() => move(i, 1)}><Icon name="chevronRight" size={16} className="rot-down" /></button>
                      <button type="button" className="btn btn-ghost icon-btn danger-text" aria-label={t('tr.removeStop')} disabled={s.students > 0} title={s.students ? t('tr.stopUsed', { n: s.students }) : undefined} onClick={() => setDraft((d) => d!.filter((_, j) => j !== i))}><Icon name="trash" size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && <div className="alert" role="alert"><Icon name="alert" />{error}</div>}
          <div className="stop-edit-foot">
            <button type="button" className="btn btn-sm" onClick={() => setDraft((d) => [...d!, { stopName: '', pickupTime: '', dropTime: '', distanceKm: '', feeAmount: '', students: 0 }])}><Icon name="plus" size={14} /> {t('tr.addStop')}</button>
            <span className="spacer" />
            <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>{t('common.cancel')}</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={saveStops}>{t('tr.saveStops')}</button>
          </div>
        </div>
      ) : r.stops.length === 0 ? <EmptyState icon="route" title={t('tr.noStops')} text={t('tr.noStopsHint')} /> : (
        <ol className="stop-line no-print">
          {r.stops.map((s) => (
            <li key={s.id}>
              <span className="stop-dot" aria-hidden="true" />
              <span className="stop-main"><strong>{s.stopName}</strong><span className="muted small">{[s.pickupTime && t('tr.pickupAt', { time: s.pickupTime }), s.dropTime && t('tr.dropAt', { time: s.dropTime }), s.distanceKm !== null && `${s.distanceKm} km`].filter(Boolean).join(' · ')}</span></span>
              <span className="stop-side"><strong>{formatINR(toPaise(s.feeAmount))}</strong><span className="muted small">{t(s.students === 1 ? 'tr.oneStudent' : 'tr.nStudents', { n: s.students })}</span></span>
            </li>
          ))}
        </ol>
      )}

      <h2 className="section-title">{t('tr.riders', { n: riders?.length ?? 0 })}</h2>
      <div className="print-only print-title"><strong>{t('tr.routeEyebrow', { no: r.routeNo })} · {r.name}</strong> — {r.vehicle ? fmtVehicleNo(r.vehicle.vehicleNo) : ''}{r.driver ? ` · ${r.driver.name}` : ''}</div>
      {!riders ? <SkeletonRows rows={3} /> : riders.length === 0 ? <p className="muted">{t('tr.noRiders')}</p> : (
        <div className="table-wrap card">
          <table className="table rider-table">
            <thead><tr><th>{t('tr.stopName')}</th><th>{t('tr.col.student')}</th><th>{t('tr.col.class')}</th><th>{t('tr.col.parent')}</th><th>{t('tr.col.trip')}</th></tr></thead>
            <tbody>
              {Object.entries(byStop).map(([stop, rows]) => rows.map((x, i) => (
                <tr key={x.id}>
                  {i === 0 && <td rowSpan={rows.length}><strong>{stop}</strong><span className="sub-line muted">{[x.pickupTime, x.dropTime].filter(Boolean).join(' / ')}</span></td>}
                  <td><Link href={`/students/${x.studentId}`}>{x.name}</Link><span className="sub-line muted mono">{x.admissionNo}</span></td>
                  <td>{x.className ?? <span className="muted">—</span>}</td>
                  <td>{x.guardianName ?? '—'}{x.guardianPhone && <span className="sub-line"><a href={`tel:${x.guardianPhone}`}>{x.guardianPhone}</a></span>}</td>
                  <td>{t(`tr.pd.${x.pickupDrop}` as MessageKey)}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={edit} onClose={() => setEdit(false)} title={t('tr.editRoute')} onSubmit={saveRoute} submitLabel={t('tr.save')} busy={busy} error={error}>
        <Field id="er-name" label={t('tr.routeName')} error={errors.name}><input id="er-name" value={form.name ?? ''} onChange={set('name')} /></Field>
        <div className="grid-2">
          <Field id="er-veh" label={t('tr.col.vehicle')} error={errors.vehicleId}>
            <select id="er-veh" value={form.vehicleId} onChange={set('vehicleId')}><option value="">{t('tr.none')}</option>{vehicles.filter((v) => v.status !== 'INACTIVE').map((v) => <option key={v.id} value={v.id}>{fmtVehicleNo(v.vehicleNo)} · {t('tr.nSeats', { n: v.seatingCapacity })}</option>)}</select>
          </Field>
          <Field id="er-shift" label={t('tr.shiftLabel')} error={errors.shift}>
            <select id="er-shift" value={form.shift} onChange={set('shift')}>{ROUTE_SHIFTS.map((x) => <option key={x} value={x}>{t(`tr.shift.${x}` as MessageKey)}</option>)}</select>
          </Field>
          <Field id="er-drv" label={t('tr.col.driver')} error={errors.driverId}>
            <select id="er-drv" value={form.driverId} onChange={set('driverId')}><option value="">{t('tr.none')}</option>{crew.filter((c) => c.role === 'DRIVER' && c.status === 'ACTIVE').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </Field>
          <Field id="er-att" label={t('tr.attendant')} error={errors.attendantId}>
            <select id="er-att" value={form.attendantId} onChange={set('attendantId')}><option value="">{t('tr.none')}</option>{crew.filter((c) => c.role !== 'DRIVER' && c.status === 'ACTIVE').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </Field>
          <Field id="er-status" label={t('common.status')} error={errors.status}>
            <select id="er-status" value={form.status} onChange={set('status')}><option value="ACTIVE">{t('status.ACTIVE')}</option><option value="INACTIVE">{t('status.INACTIVE')}</option></select>
          </Field>
        </div>
      </Modal>
    </>
  );
}
