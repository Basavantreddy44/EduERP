'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CREW_ROLES, PERMISSIONS, VEHICLE_OWNERSHIP, VEHICLE_TYPES } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { useDay } from '@/components/admissions';
import { useStaffOptions } from '@/components/staff';
import { CrewRow, ExpiryPill, SeatBar, VehicleRow, fmtVehicleNo } from '@/components/transport';

type Tab = 'buses' | 'crew';
interface Expiring { kind: 'DOCUMENT' | 'LICENCE'; id: string; vehicleId: string | null; what: string; whose: string; validTo: string; daysLeft: number }
interface StaffPick { id: string; firstName: string; lastName: string | null; employeeCode: string; designation: string | null; campusId: string }

/** Transport → Buses & crew (M6.1). */
export default function TransportPage() {
  const { can, campusId } = useSession();
  const { t } = useI18n();
  const day = useDay();
  const toast = useToast();
  const opts = useStaffOptions();
  const manage = can(PERMISSIONS.TRANSPORT_MANAGE);
  const [tab, setTab] = useState<Tab>('buses');
  const [vehicles, setVehicles] = useState<VehicleRow[] | null>(null);
  const [crew, setCrew] = useState<CrewRow[] | null>(null);
  const [expiring, setExpiring] = useState<Expiring[]>([]);
  const [dialog, setDialog] = useState<'bus' | 'crew' | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [staff, setStaff] = useState<StaffPick[]>([]);

  const q = campusId ? `?campusId=${campusId}` : '';
  const load = useCallback(() => {
    api<VehicleRow[]>(`/transport/vehicles${q}`).then(setVehicles).catch(() => setVehicles([]));
    api<CrewRow[]>(`/transport/crew${q}`).then(setCrew).catch(() => setCrew([]));
    api<Expiring[]>('/transport/expiring').then(setExpiring).catch(() => setExpiring([]));
  }, [q]);
  useEffect(load, [load]);

  const campuses = opts?.campuses ?? [];
  const open = (d: 'bus' | 'crew') => {
    setErrors({}); setError(null);
    const c = campusId ?? campuses[0]?.id ?? '';
    setForm(d === 'bus' ? { campusId: c, vehicleNo: '', vehicleType: 'BUS', seatingCapacity: '40', ownership: 'OWN', makeModel: '', ownerName: '' } : { employeeId: '', role: 'DRIVER', licenseNo: '', licenseExpiry: '', badgeNo: '' });
    if (d === 'crew') api<{ items: StaffPick[] }>(`/staff?status=ACTIVE&pageSize=100${campusId ? `&campusId=${campusId}` : ''}`).then((r) => setStaff(r.items)).catch(() => setStaff([]));
    setDialog(d);
  };
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    const empty = (v: string) => (v.trim() === '' ? null : v.trim());
    try {
      if (dialog === 'bus') {
        await api('/transport/vehicles', { method: 'POST', body: JSON.stringify({ ...form, seatingCapacity: Number(form.seatingCapacity), makeModel: empty(form.makeModel), ownerName: empty(form.ownerName) }) });
        toast(t('tr.busAdded', { no: form.vehicleNo.toUpperCase() }));
      } else {
        await api('/transport/crew', { method: 'POST', body: JSON.stringify({ employeeId: form.employeeId, role: form.role, licenseNo: empty(form.licenseNo), licenseExpiry: empty(form.licenseExpiry), badgeNo: empty(form.badgeNo) }) });
        toast(t('tr.crewAdded'));
      }
      setDialog(null); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const crewIds = new Set((crew ?? []).map((c) => c.employeeId));

  return (
    <>
      <PageHeader
        eyebrow={t('nav.transport')}
        title={t('tr.title')}
        description={t('tr.desc')}
        actions={manage ? (
          tab === 'buses'
            ? <button type="button" className="btn btn-primary" onClick={() => open('bus')} disabled={!campuses.length}><Icon name="plus" /> {t('tr.addBus')}</button>
            : <button type="button" className="btn btn-primary" onClick={() => open('crew')}><Icon name="plus" /> {t('tr.addCrew')}</button>
        ) : undefined}
      />

      {expiring.length > 0 && (
        <section className="card tr-expiring" aria-labelledby="tr-exp-h">
          <h2 id="tr-exp-h" className="card-title"><Icon name="alert" /> {t('tr.expiringTitle', { n: expiring.length })}</h2>
          <ul>
            {expiring.map((x) => (
              <li key={`${x.kind}-${x.id}`}>
                {x.vehicleId ? <Link href={`/transport/vehicles/${x.vehicleId}`}>{x.what} · {fmtVehicleNo(x.whose)}</Link> : <span>{x.what} · {x.whose}</span>}
                <ExpiryPill state={x.daysLeft < 0 ? 'EXPIRED' : 'DUE_SOON'} daysLeft={x.daysLeft} />
                <span className="muted small">{day(x.validTo)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="tabs" role="tablist" aria-label={t('tr.title')}>
        {(['buses', 'crew'] as Tab[]).map((x) => (
          <button key={x} role="tab" type="button" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>
            {t(`tr.tab.${x}` as MessageKey)} <span className="tab-count">{(x === 'buses' ? vehicles : crew)?.length ?? '–'}</span>
          </button>
        ))}
      </div>

      <div className="tr-panel">
        {tab === 'buses' && (!vehicles ? <SkeletonRows rows={4} /> : vehicles.length === 0 ? <EmptyState icon="bus" title={t('tr.noBuses')} text={t('tr.noBusesHint')} /> : (
          <div className="table-wrap card">
            <table className="table">
              <thead><tr><th>{t('tr.col.vehicle')}</th><th>{t('tr.col.seats')}</th><th className="hide-sm">{t('tr.col.routes')}</th><th>{t('tr.col.documents')}</th><th>{t('common.status')}</th></tr></thead>
              <tbody>
                {vehicles.map((v) => (
                  <tr key={v.id}>
                    <td><Link href={`/transport/vehicles/${v.id}`} className="strong-link">{fmtVehicleNo(v.vehicleNo)}</Link><span className="sub-line muted">{t(`tr.type.${v.vehicleType}` as MessageKey)}{v.makeModel ? ` · ${v.makeModel}` : ''}{v.ownership === 'HIRED' ? ` · ${t('tr.hired')}` : ''}</span></td>
                    <td><SeatBar used={v.seatsUsed} seats={v.seatingCapacity} /></td>
                    <td className="hide-sm">{v.routes.length ? v.routes.map((r) => r.routeNo).join(', ') : <span className="muted">—</span>}</td>
                    <td>{v.attention ? <span className="pill pill-warn"><span className="pill-dot" />{t('tr.docsAttention', { n: v.attention })}</span> : v.documents.some((d) => d.state === 'MISSING') ? <span className="pill pill-muted"><span className="pill-dot" />{t('tr.docsMissing', { n: v.documents.filter((d) => d.state === 'MISSING').length })}</span> : <span className="pill pill-ok"><span className="pill-dot" />{t('tr.docsOk')}</span>}</td>
                    <td><StatusBadge status={v.status} label={t(`tr.vstatus.${v.status}` as MessageKey)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {tab === 'crew' && (!crew ? <SkeletonRows rows={4} /> : crew.length === 0 ? <EmptyState icon="users" title={t('tr.noCrew')} text={t('tr.noCrewHint')} /> : (
          <div className="table-wrap card">
            <table className="table">
              <thead><tr><th>{t('tr.col.name')}</th><th>{t('tr.col.role')}</th><th>{t('tr.col.licence')}</th><th className="hide-sm">{t('tr.col.routes')}</th><th>{t('common.status')}</th></tr></thead>
              <tbody>
                {crew.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.name}</strong><span className="sub-line muted">{c.employeeCode}{c.phone ? ` · ${c.phone}` : ''}</span></td>
                    <td>{t(`tr.role.${c.role}` as MessageKey)}{c.badgeNo ? <span className="sub-line muted">{t('tr.badge', { no: c.badgeNo })}</span> : null}</td>
                    <td>{c.role === 'DRIVER' ? <><span className="mono small">{c.licenseNo}</span><span className="sub-line">{c.licenseState && <ExpiryPill state={c.licenseState} />} <span className="muted small">{day(c.licenseExpiry)}</span></span></> : <span className="muted">—</span>}</td>
                    <td className="hide-sm">{c.routes.length ? c.routes.join(', ') : <span className="muted">—</span>}</td>
                    <td><StatusBadge status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <Modal open={dialog === 'bus'} onClose={() => setDialog(null)} title={t('tr.addBus')} subtitle={t('tr.addBusSub')} onSubmit={save} submitLabel={t('tr.save')} busy={busy} error={error}>
        {campuses.length > 1 && (
          <Field id="v-campus" label={t('common.campus')} error={errors.campusId}>
            <select id="v-campus" value={form.campusId} onChange={set('campusId')}>{campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </Field>
        )}
        <div className="grid-2">
          <Field id="v-no" label={t('tr.vehicleNo')} error={errors.vehicleNo} hint={t('tr.vehicleNoHint')}><input id="v-no" value={form.vehicleNo ?? ''} onChange={set('vehicleNo')} autoCapitalize="characters" /></Field>
          <Field id="v-type" label={t('tr.vehicleType')} error={errors.vehicleType}>
            <select id="v-type" value={form.vehicleType} onChange={set('vehicleType')}>{VEHICLE_TYPES.map((x) => <option key={x} value={x}>{t(`tr.type.${x}` as MessageKey)}</option>)}</select>
          </Field>
          <Field id="v-seats" label={t('tr.seats')} error={errors.seatingCapacity}><input id="v-seats" type="number" min={1} max={120} value={form.seatingCapacity ?? ''} onChange={set('seatingCapacity')} /></Field>
          <Field id="v-model" label={t('tr.makeModel')} error={errors.makeModel}><input id="v-model" value={form.makeModel ?? ''} onChange={set('makeModel')} placeholder="Tata Starbus 40" /></Field>
          <Field id="v-own" label={t('tr.ownership')} error={errors.ownership}>
            <select id="v-own" value={form.ownership} onChange={set('ownership')}>{VEHICLE_OWNERSHIP.map((x) => <option key={x} value={x}>{t(`tr.own.${x}` as MessageKey)}</option>)}</select>
          </Field>
          {form.ownership === 'HIRED' && <Field id="v-owner" label={t('tr.ownerName')} error={errors.ownerName}><input id="v-owner" value={form.ownerName ?? ''} onChange={set('ownerName')} /></Field>}
        </div>
      </Modal>

      <Modal open={dialog === 'crew'} onClose={() => setDialog(null)} title={t('tr.addCrew')} subtitle={t('tr.addCrewSub')} onSubmit={save} submitLabel={t('tr.save')} busy={busy} error={error}>
        <Field id="c-emp" label={t('tr.staffMember')} error={errors.employeeId}>
          <select id="c-emp" value={form.employeeId} onChange={set('employeeId')}>
            <option value="">{t('tr.chooseStaff')}</option>
            {staff.filter((s) => !crewIds.has(s.id)).map((s) => <option key={s.id} value={s.id}>{`${s.firstName} ${s.lastName ?? ''}`.trim()} · {s.employeeCode}{s.designation ? ` · ${s.designation}` : ''}</option>)}
          </select>
        </Field>
        <Field id="c-role" label={t('tr.col.role')} error={errors.role}>
          <select id="c-role" value={form.role} onChange={set('role')}>{CREW_ROLES.map((x) => <option key={x} value={x}>{t(`tr.role.${x}` as MessageKey)}</option>)}</select>
        </Field>
        <div className="grid-2">
          <Field id="c-lic" label={t('tr.licenceNo')} error={errors.licenseNo}><input id="c-lic" value={form.licenseNo ?? ''} onChange={set('licenseNo')} autoCapitalize="characters" /></Field>
          <Field id="c-exp" label={t('tr.licenceExpiry')} error={errors.licenseExpiry}><input id="c-exp" type="date" value={form.licenseExpiry ?? ''} onChange={set('licenseExpiry')} /></Field>
          <Field id="c-badge" label={t('tr.badgeNo')} error={errors.badgeNo}><input id="c-badge" value={form.badgeNo ?? ''} onChange={set('badgeNo')} /></Field>
        </div>
      </Modal>
    </>
  );
}
