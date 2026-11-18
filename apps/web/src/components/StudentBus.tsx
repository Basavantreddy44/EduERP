'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PERMISSIONS, PICKUP_DROP } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from './Icon';
import { Field, Modal } from './Modal';
import { EmptyState, SkeletonRows, StatusBadge, useToast } from './ui';
import { todayIST, useDay } from './admissions';
import { LiveTrackingSoon, fmtVehicleNo } from './transport';

interface Trip { id: string; status: string; pickupDrop: string; startDate: string; endDate: string | null; stopName: string; pickupTime: string | null; dropTime: string | null; routeNo: string; routeName: string; vehicleNo: string | null; driverName: string | null; driverPhone: string | null; yearName: string }
interface Options {
  year: { name: string; startDate: string; endDate: string } | null;
  hasFeeHead: boolean;
  routes: { id: string; routeNo: string; name: string; vehicleNo: string | null; seats: number; seatsUsed: number; stops: { id: string; stopName: string; pickupTime: string | null; feeLabel: string }[] }[];
}

/** Student profile → Bus (M6.3): the student's stop, put on / take off the bus, history. */
export function StudentBus({ studentId, campusId, active }: { studentId: string; campusId: string; active: boolean }) {
  const { can } = useSession();
  const { t } = useI18n();
  const day = useDay();
  const toast = useToast();
  const assign = can(PERMISSIONS.TRANSPORT_ASSIGN);
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [dialog, setDialog] = useState<'on' | 'off' | null>(null);
  const [opts, setOpts] = useState<Options | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Trip[]>(`/transport/students/${studentId}`).then(setTrips).catch(() => setTrips([])); }, [studentId]);
  useEffect(load, [load]);
  const current = trips?.find((x) => x.status === 'ACTIVE') ?? null;

  const openOn = () => {
    setErrors({}); setError(null); setOpts(null);
    api<Options>(`/transport/assign-options?campusId=${campusId}`).then((o) => { setOpts(o); setForm({ routeId: o.routes[0]?.id ?? '', routeStopId: o.routes[0]?.stops[0]?.id ?? '', pickupDrop: 'BOTH', startDate: todayIST(), bill: o.hasFeeHead }); });
    setDialog('on');
  };
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try {
      if (dialog === 'on') {
        const r = await api<{ billed: string | null }>('/transport/assignments', { method: 'POST', body: JSON.stringify({ studentId, routeStopId: form.routeStopId, pickupDrop: form.pickupDrop, startDate: form.startDate, bill: !!form.bill }) });
        toast(r.billed ? t('tr.onBusBilled', { amount: `₹${Number(r.billed).toLocaleString('en-IN')}` }) : t('tr.onBus'));
      } else {
        await api(`/transport/assignments/${current!.id}/stop`, { method: 'POST', body: JSON.stringify({ endDate: form.endDate, reason: form.reason }) });
        toast(t('tr.offBus'));
      }
      setDialog(null); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const route = opts?.routes.find((r) => r.id === form.routeId);

  if (!trips) return <SkeletonRows rows={3} />;
  return (
    <>
      {current ? (
        <div className="card bus-card">
          <div className="bus-card-main">
            <span className="soon-icon bus-icon"><Icon name="bus" size={22} /></span>
            <div>
              <h3 className="card-title">{t('tr.routeEyebrow', { no: current.routeNo })} · {current.routeName}</h3>
              <p className="muted">{t('tr.boardsAt', { stop: current.stopName })}{current.pickupTime ? ` · ${t('tr.pickupAt', { time: current.pickupTime })}` : ''}{current.dropTime ? ` · ${t('tr.dropAt', { time: current.dropTime })}` : ''}</p>
              <p className="muted small">{[current.vehicleNo && fmtVehicleNo(current.vehicleNo), current.driverName && `${t('tr.col.driver')}: ${current.driverName}${current.driverPhone ? ` (${current.driverPhone})` : ''}`, t(`tr.pd.${current.pickupDrop}` as MessageKey), t('tr.since', { date: day(current.startDate) })].filter(Boolean).join(' · ')}</p>
            </div>
          </div>
          {assign && <button type="button" className="btn btn-ghost danger-text" onClick={() => { setForm({ endDate: todayIST(), reason: '' }); setErrors({}); setError(null); setDialog('off'); }}><Icon name="x" size={15} /> {t('tr.takeOff')}</button>}
        </div>
      ) : (
        <EmptyState icon="bus" title={t('tr.noBus')} text={t('tr.noBusHint')} action={assign && active ? <button type="button" className="btn btn-primary" onClick={openOn}><Icon name="plus" /> {t('tr.putOn')}</button> : undefined} />
      )}
      <LiveTrackingSoon />
      {trips.filter((x) => x.status !== 'ACTIVE').length > 0 && (
        <>
          <h3 className="section-title">{t('tr.earlier')}</h3>
          <ul className="pt-list">
            {trips.filter((x) => x.status !== 'ACTIVE').map((x) => (
              <li key={x.id}><span className="pt-list-main"><strong>{x.routeNo} · {x.stopName}</strong><span className="muted small">{x.yearName} · {day(x.startDate)} – {day(x.endDate)}</span></span><StatusBadge status={x.status} label={t('tr.stopped')} /></li>
            ))}
          </ul>
        </>
      )}

      <Modal open={dialog === 'on'} onClose={() => setDialog(null)} title={t('tr.putOn')} subtitle={opts?.year ? t('tr.putOnSub', { year: opts.year.name }) : undefined} onSubmit={save} submitLabel={t('tr.save')} busy={busy || !opts} error={error} submitDisabled={!form.routeStopId}>
        {!opts ? <SkeletonRows rows={3} /> : opts.routes.length === 0 ? <p className="muted">{t('tr.noRoutesYet')} <Link href="/transport/routes">{t('tr.routesTitle')}</Link></p> : (
          <>
            <Field id="b-route" label={t('tr.col.route')}>
              <select id="b-route" value={String(form.routeId)} onChange={(e) => { const r = opts.routes.find((x) => x.id === e.target.value); setForm((f) => ({ ...f, routeId: e.target.value, routeStopId: r?.stops[0]?.id ?? '' })); }}>
                {opts.routes.map((r) => <option key={r.id} value={r.id} disabled={r.seatsUsed >= r.seats}>{r.routeNo} · {r.name} — {r.seatsUsed >= r.seats ? t('tr.full') : t('tr.seatsLeft', { n: r.seats - r.seatsUsed })}</option>)}
              </select>
            </Field>
            <Field id="b-stop" label={t('tr.stopName')} error={errors.routeStopId}>
              <select id="b-stop" value={String(form.routeStopId)} onChange={(e) => setForm((f) => ({ ...f, routeStopId: e.target.value }))}>
                {(route?.stops ?? []).map((s) => <option key={s.id} value={s.id}>{s.stopName}{s.pickupTime ? ` · ${s.pickupTime}` : ''} · {s.feeLabel}/{t('tr.year')}</option>)}
              </select>
            </Field>
            <div className="grid-2">
              <Field id="b-pd" label={t('tr.col.trip')}>
                <select id="b-pd" value={String(form.pickupDrop)} onChange={(e) => setForm((f) => ({ ...f, pickupDrop: e.target.value }))}>{PICKUP_DROP.map((x) => <option key={x} value={x}>{t(`tr.pd.${x}` as MessageKey)}</option>)}</select>
              </Field>
              <Field id="b-start" label={t('tr.from')} error={errors.startDate}><input id="b-start" type="date" value={String(form.startDate)} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} /></Field>
            </div>
            <label className="check"><input type="checkbox" checked={!!form.bill} disabled={!opts.hasFeeHead} onChange={(e) => setForm((f) => ({ ...f, bill: e.target.checked }))} /> {t('tr.billIt')}</label>
            <p className="muted small">{opts.hasFeeHead ? t('tr.billHint') : t('tr.noFeeHead')}</p>
          </>
        )}
      </Modal>
      <Modal open={dialog === 'off'} onClose={() => setDialog(null)} title={t('tr.takeOff')} subtitle={t('tr.takeOffSub')} onSubmit={save} submitLabel={t('tr.takeOff')} busy={busy} error={error} danger>
        <Field id="o-end" label={t('tr.lastDay')} error={errors.endDate}><input id="o-end" type="date" value={String(form.endDate ?? '')} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} /></Field>
        <Field id="o-reason" label={t('tr.reason')} error={errors.reason}><input id="o-reason" value={String(form.reason ?? '')} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} /></Field>
      </Modal>
    </>
  );
}
