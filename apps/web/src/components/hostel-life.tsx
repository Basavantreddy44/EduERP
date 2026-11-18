'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { MAINTENANCE_CATEGORIES, MAINTENANCE_STATUSES, PRIORITIES } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from './Icon';
import { Field, Modal } from './Modal';
import { EmptyState, SkeletonRows, StatusBadge, useToast } from './ui';
import { todayIST, useDay } from './admissions';
import { PersonPick, PersonSearch } from './leave';
import { Resident, Room, isoToLocal, localToIso, when } from './hostel';

interface Outpass { id: string; studentId: string; student: { name: string; admissionNo: string } | null; destination: string; reason: string; outTime: string; expectedReturn: string; actualOut: string | null; actualReturn: string | null; parentApproval: string; wardenApproval: string; status: string; remarks: string | null }

/** Outpasses (M7.3): the parent approves in the app (or by phone, recorded), then the warden; gate out / back. */
export function OutpassTab({ hostelId, residents, warden }: { hostelId: string; residents: Resident[] | null; warden: boolean }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [rows, setRows] = useState<Outpass[] | null>(null);
  const [dialog, setDialog] = useState<{ kind: 'new' } | { kind: 'phone'; o: Outpass } | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Outpass[]>(`/hostel/hostels/${hostelId}/outpasses`).then(setRows).catch(() => setRows([])); }, [hostelId]);
  useEffect(load, [load]);
  const act = async (o: Outpass, path: string, body: object = {}) => {
    try { await api(`/hostel/outpasses/${o.id}/${path}`, { method: 'POST', body: JSON.stringify(body) }); load(); }
    catch (x) { toast(apiErrors(x).message ?? '', 'bad'); }
  };
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try {
      if (dialog?.kind === 'new') {
        const r = await api<{ parentHasLogin: boolean }>('/hostel/outpasses', { method: 'POST', body: JSON.stringify({ studentId: form.studentId, outTime: localToIso(form.outTime), expectedReturn: localToIso(form.expectedReturn), destination: form.destination, reason: form.reason }) });
        toast(r.parentHasLogin ? t('hs.op.sentParent') : t('hs.op.noLogin'));
      } else if (dialog?.kind === 'phone') {
        await api(`/hostel/outpasses/${dialog.o.id}/decide`, { method: 'POST', body: JSON.stringify({ approve: form.answer === 'yes', parentByPhone: true, remarks: form.remarks }) });
        toast(t('hs.op.phoneSaved'));
      }
      setDialog(null); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const approvalPill = (who: string, v: string) => <StatusBadge status={v === 'PENDING' ? 'PENDING' : v} label={`${who}: ${t(`hs.appr.${v}` as MessageKey)}`} />;
  if (!rows) return <SkeletonRows rows={4} />;
  const now = new Date();
  return (
    <>
      {warden && (
        <div className="panel-head">
          <p className="muted small">{t('hs.op.hint')}</p>
          <button type="button" className="btn btn-primary btn-sm" disabled={!residents?.some((r) => r.status === 'CHECKED_IN')} onClick={() => { setForm({ studentId: residents?.find((r) => r.status === 'CHECKED_IN')?.studentId ?? '', outTime: isoToLocal(new Date(Date.now() + 30 * 60_000)), expectedReturn: isoToLocal(new Date(Date.now() + 4 * 3_600_000)), destination: '', reason: '' }); setErrors({}); setError(null); setDialog({ kind: 'new' }); }}><Icon name="plus" size={14} /> {t('hs.op.new')}</button>
        </div>
      )}
      {rows.length === 0 ? <EmptyState icon="clipboard" title={t('hs.op.none')} /> : (
        <ul className="pt-list">
          {rows.map((o) => (
            <li key={o.id}>
              <span className="pt-list-main">
                <strong>{o.student?.name} → {o.destination}</strong>
                <span className="muted small">{when(o.outTime, locale)} – {when(o.expectedReturn, locale)} · {o.reason}{o.remarks ? ` · ${o.remarks}` : ''}</span>
                <span className="op-pills">{approvalPill(t('hs.op.parent'), o.parentApproval)}{approvalPill(t('hs.warden'), o.wardenApproval)}{o.status === 'OUT' && now > new Date(o.expectedReturn) && <StatusBadge status="OVERDUE" label={t('hs.op.overdue')} />}</span>
              </span>
              <span className="pt-list-amt">
                <StatusBadge status={o.status} label={t(`hs.op.s.${o.status}` as MessageKey)} />
                {warden && o.status === 'REQUESTED' && o.wardenApproval === 'PENDING' && <><button type="button" className="btn btn-sm" onClick={() => act(o, 'decide', { approve: true })}>{t('hs.approve')}</button><button type="button" className="btn btn-sm btn-ghost danger-text" onClick={() => act(o, 'decide', { approve: false })}>{t('hs.refuse')}</button></>}
                {warden && o.status === 'REQUESTED' && o.parentApproval === 'PENDING' && <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setForm({ answer: 'yes', remarks: '' }); setErrors({}); setError(null); setDialog({ kind: 'phone', o }); }}><Icon name="phone" size={14} /> {t('hs.op.byPhone')}</button>}
                {warden && o.status === 'APPROVED' && <button type="button" className="btn btn-sm btn-primary" onClick={() => act(o, 'out')}>{t('hs.op.markOut')}</button>}
                {warden && o.status === 'OUT' && <button type="button" className="btn btn-sm btn-primary" onClick={() => act(o, 'back')}>{t('hs.op.markBack')}</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Modal open={dialog?.kind === 'new'} onClose={() => setDialog(null)} title={t('hs.op.new')} subtitle={t('hs.op.newSub')} onSubmit={save} submitLabel={t('hs.op.send')} busy={busy} error={error}>
        <Field id="op-st" label={t('tr.col.student')} error={errors.studentId}>
          <select id="op-st" value={form.studentId} onChange={(e) => setForm((f) => ({ ...f, studentId: e.target.value }))}>{(residents ?? []).filter((r) => r.status === 'CHECKED_IN').map((r) => <option key={r.studentId} value={r.studentId}>{r.name} · {r.roomNo}-{r.bedNo}</option>)}</select>
        </Field>
        <div className="grid-2">
          <Field id="op-out" label={t('hs.op.out')} error={errors.outTime}><input id="op-out" type="datetime-local" value={form.outTime ?? ''} onChange={(e) => setForm((f) => ({ ...f, outTime: e.target.value }))} /></Field>
          <Field id="op-back" label={t('hs.op.back')} error={errors.expectedReturn}><input id="op-back" type="datetime-local" value={form.expectedReturn ?? ''} onChange={(e) => setForm((f) => ({ ...f, expectedReturn: e.target.value }))} /></Field>
        </div>
        <Field id="op-dest" label={t('hs.op.dest')} error={errors.destination}><input id="op-dest" value={form.destination ?? ''} onChange={(e) => setForm((f) => ({ ...f, destination: e.target.value }))} /></Field>
        <Field id="op-why" label={t('tr.reason')} error={errors.reason}><input id="op-why" value={form.reason ?? ''} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} /></Field>
      </Modal>
      <Modal open={dialog?.kind === 'phone'} onClose={() => setDialog(null)} title={t('hs.op.byPhone')} subtitle={t('hs.op.byPhoneSub')} onSubmit={save} submitLabel={t('tr.save')} busy={busy} error={error}>
        <Field id="ph-ans" label={t('hs.op.answer')}><select id="ph-ans" value={form.answer} onChange={(e) => setForm((f) => ({ ...f, answer: e.target.value }))}><option value="yes">{t('hs.op.agreed')}</option><option value="no">{t('hs.op.refused')}</option></select></Field>
        <Field id="ph-rem" label={t('hs.op.whoWhen')} error={errors.remarks}><input id="ph-rem" value={form.remarks ?? ''} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} placeholder={t('hs.op.whoWhenPh')} /></Field>
      </Modal>
    </>
  );
}

interface HomeGoing { id: string; studentId: string; student: { name: string } | null; fromDate: string; toDate: string; reason: string; status: string; pickupGuardian: { name: string; phone: string | null } | null; pickupPersonName: string | null; pickupPersonPhone: string | null; remarks: string | null }
interface Guardian { guardianId: string; relation: string; guardian: { name: string; phone: string | null } }

/** Home-going register (M7.3): who collects the student is checked against the guardians on record. */
export function HomeGoingTab({ hostelId, residents, warden }: { hostelId: string; residents: Resident[] | null; warden: boolean }) {
  const { t } = useI18n();
  const day = useDay();
  const toast = useToast();
  const [rows, setRows] = useState<HomeGoing[] | null>(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<HomeGoing | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<HomeGoing[]>(`/hostel/hostels/${hostelId}/home-going`).then(setRows).catch(() => setRows([])); }, [hostelId]);
  useEffect(load, [load]);
  useEffect(() => { if (open && form.studentId) api<{ guardians: Guardian[] }>(`/students/${form.studentId}`).then((s) => setGuardians(s.guardians)).catch(() => setGuardians([])); }, [open, form.studentId]);
  const act = async (g: HomeGoing, path: string, body: object = {}) => {
    try { await api(`/hostel/home-going/${g.id}/${path}`, { method: 'POST', body: JSON.stringify(body) }); setConfirm(null); load(); }
    catch (x) { const a = apiErrors(x); if ((x as { type?: string }).type === 'unlisted-pickup') setConfirm(g); else toast(a.message ?? '', 'bad'); }
  };
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try {
      const other = form.pickup === 'OTHER';
      await api('/hostel/home-going', { method: 'POST', body: JSON.stringify({ studentId: form.studentId, fromDate: form.fromDate, toDate: form.toDate, reason: form.reason, pickupGuardianId: other ? null : form.pickup, pickupPersonName: other ? form.name : null, pickupPersonPhone: other ? form.phone : null }) });
      toast(t('hs.hg.saved')); setOpen(false); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  if (!rows) return <SkeletonRows rows={4} />;
  return (
    <>
      {warden && (
        <div className="panel-head">
          <p className="muted small">{t('hs.hg.hint')}</p>
          <button type="button" className="btn btn-primary btn-sm" disabled={!residents?.some((r) => r.status === 'CHECKED_IN')} onClick={() => { setForm({ studentId: residents?.find((r) => r.status === 'CHECKED_IN')?.studentId ?? '', fromDate: todayIST(), toDate: todayIST(), reason: '', pickup: '', name: '', phone: '' }); setErrors({}); setError(null); setOpen(true); }}><Icon name="plus" size={14} /> {t('hs.hg.new')}</button>
        </div>
      )}
      {rows.length === 0 ? <EmptyState icon="home" title={t('hs.hg.none')} /> : (
        <ul className="pt-list">
          {rows.map((g) => (
            <li key={g.id}>
              <span className="pt-list-main">
                <strong>{g.student?.name} · {day(g.fromDate)} – {day(g.toDate)}</strong>
                <span className="muted small">{g.reason} · {t('hs.hg.pickup')}: {g.pickupGuardian ? `${g.pickupGuardian.name}${g.pickupGuardian.phone ? ` (${g.pickupGuardian.phone})` : ''}` : <>{g.pickupPersonName} ({g.pickupPersonPhone}) <strong className="warn-text">· {t('hs.hg.notOnRecord')}</strong></>}{g.remarks ? ` · ${g.remarks}` : ''}</span>
              </span>
              <span className="pt-list-amt">
                <StatusBadge status={g.status} label={t(`hs.hg.s.${g.status}` as MessageKey)} />
                {warden && g.status === 'REQUESTED' && <><button type="button" className="btn btn-sm" onClick={() => act(g, 'decide', { approve: true })}>{t('hs.approve')}</button><button type="button" className="btn btn-sm btn-ghost danger-text" onClick={() => act(g, 'decide', { approve: false })}>{t('hs.refuse')}</button></>}
                {warden && g.status === 'APPROVED' && <button type="button" className="btn btn-sm btn-primary" onClick={() => act(g, 'depart')}>{t('hs.hg.left')}</button>}
                {warden && g.status === 'DEPARTED' && <button type="button" className="btn btn-sm btn-primary" onClick={() => act(g, 'return')}>{t('hs.hg.back')}</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('hs.hg.new')} onSubmit={save} submitLabel={t('tr.save')} busy={busy} error={error}>
        <Field id="hg-st" label={t('tr.col.student')}><select id="hg-st" value={form.studentId} onChange={(e) => setForm((f) => ({ ...f, studentId: e.target.value, pickup: '' }))}>{(residents ?? []).filter((r) => r.status === 'CHECKED_IN').map((r) => <option key={r.studentId} value={r.studentId}>{r.name} · {r.roomNo}-{r.bedNo}</option>)}</select></Field>
        <div className="grid-2">
          <Field id="hg-from" label={t('hs.hg.from')} error={errors.fromDate}><input id="hg-from" type="date" value={form.fromDate ?? ''} onChange={(e) => setForm((f) => ({ ...f, fromDate: e.target.value }))} /></Field>
          <Field id="hg-to" label={t('hs.hg.to')} error={errors.toDate}><input id="hg-to" type="date" value={form.toDate ?? ''} onChange={(e) => setForm((f) => ({ ...f, toDate: e.target.value }))} /></Field>
        </div>
        <Field id="hg-why" label={t('tr.reason')} error={errors.reason}><input id="hg-why" value={form.reason ?? ''} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} /></Field>
        <Field id="hg-who" label={t('hs.hg.pickupBy')} error={errors.pickupGuardianId}>
          <select id="hg-who" value={form.pickup} onChange={(e) => setForm((f) => ({ ...f, pickup: e.target.value }))}>
            <option value="">{t('hs.hg.choose')}</option>
            {guardians.map((g) => <option key={g.guardianId} value={g.guardianId}>{g.guardian.name} · {t(`stu.rel.${g.relation}` as MessageKey)}{g.guardian.phone ? ` · ${g.guardian.phone}` : ''}</option>)}
            <option value="OTHER">{t('hs.hg.someoneElse')}</option>
          </select>
        </Field>
        {form.pickup === 'OTHER' && <div className="grid-2"><Field id="hg-name" label={t('tr.col.name')} error={errors.pickupPersonName}><input id="hg-name" value={form.name ?? ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field><Field id="hg-phone" label={t('hs.mobile')} error={errors.pickupPersonPhone}><input id="hg-phone" inputMode="numeric" value={form.phone ?? ''} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></Field></div>}
      </Modal>
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={t('hs.hg.confirmTitle')} subtitle={confirm ? t('hs.hg.confirmSub', { name: confirm.pickupPersonName ?? '' }) : undefined} onSubmit={() => confirm && act(confirm, 'decide', { approve: true, confirmUnlistedPickup: true, remarks: form.confirmNote || null })} submitLabel={t('hs.hg.confirm')} busy={busy} error={null}>
        <Field id="hg-note" label={t('hs.hg.confirmNote')}><input id="hg-note" value={form.confirmNote ?? ''} onChange={(e) => setForm((f) => ({ ...f, confirmNote: e.target.value }))} placeholder={t('hs.op.whoWhenPh')} /></Field>
      </Modal>
    </>
  );
}

interface Visitor { id: string; student: { name: string } | null; visitorName: string; relation: string; phone: string; isAuthorisedGuardian: boolean; inTime: string; outTime: string | null }

/** Visitors log (M7.3): a visitor whose phone matches a guardian on record is marked as such. */
export function VisitorsTab({ hostelId, residents, warden }: { hostelId: string; residents: Resident[] | null; warden: boolean }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [date, setDate] = useState(todayIST());
  const [rows, setRows] = useState<Visitor[] | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Visitor[]>(`/hostel/hostels/${hostelId}/visitors?date=${date}`).then(setRows).catch(() => setRows([])); }, [hostelId, date]);
  useEffect(load, [load]);
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try {
      const v = await api<{ isAuthorisedGuardian: boolean }>('/hostel/visitors', { method: 'POST', body: JSON.stringify({ hostelId, ...form }) });
      toast(v.isAuthorisedGuardian ? t('hs.vi.known') : t('hs.vi.unknown'));
      setOpen(false); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="panel-head">
        <label className="filter"><span>{t('hs.vi.day')}</span><input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} /></label>
        {warden && <button type="button" className="btn btn-primary btn-sm" disabled={!residents?.length} onClick={() => { setForm({ studentId: residents?.[0]?.studentId ?? '', visitorName: '', relation: '', phone: '' }); setErrors({}); setError(null); setOpen(true); }}><Icon name="plus" size={14} /> {t('hs.vi.new')}</button>}
      </div>
      {!rows ? <SkeletonRows rows={3} /> : rows.length === 0 ? <EmptyState icon="users" title={t('hs.vi.none')} /> : (
        <ul className="pt-list">
          {rows.map((v) => (
            <li key={v.id}>
              <span className="pt-list-main"><strong>{v.visitorName} ({v.relation}) → {v.student?.name}</strong><span className="muted small">{v.phone} · {when(v.inTime, locale)}{v.outTime ? ` – ${when(v.outTime, locale)}` : ''}</span></span>
              <span className="pt-list-amt">
                {v.isAuthorisedGuardian ? <StatusBadge status="ACTIVE" label={t('hs.vi.guardian')} /> : <StatusBadge status="PENDING" label={t('hs.vi.notGuardian')} />}
                {warden && !v.outTime && <button type="button" className="btn btn-sm" onClick={() => api(`/hostel/visitors/${v.id}/out`, { method: 'POST' }).then(load).catch((x) => toast(apiErrors(x).message ?? '', 'bad'))}>{t('hs.vi.left')}</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('hs.vi.new')} onSubmit={save} submitLabel={t('tr.save')} busy={busy} error={error}>
        <Field id="vi-st" label={t('hs.vi.toMeet')}><select id="vi-st" value={form.studentId} onChange={(e) => setForm((f) => ({ ...f, studentId: e.target.value }))}>{(residents ?? []).map((r) => <option key={r.studentId} value={r.studentId}>{r.name} · {r.roomNo}</option>)}</select></Field>
        <div className="grid-2">
          <Field id="vi-name" label={t('tr.col.name')} error={errors.visitorName}><input id="vi-name" value={form.visitorName ?? ''} onChange={(e) => setForm((f) => ({ ...f, visitorName: e.target.value }))} /></Field>
          <Field id="vi-rel" label={t('hs.vi.relation')} error={errors.relation}><input id="vi-rel" value={form.relation ?? ''} onChange={(e) => setForm((f) => ({ ...f, relation: e.target.value }))} /></Field>
        </div>
        <Field id="vi-phone" label={t('hs.mobile')} error={errors.phone}><input id="vi-phone" inputMode="numeric" value={form.phone ?? ''} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></Field>
      </Modal>
    </>
  );
}

interface Maint { id: string; roomNo: string | null; category: string; description: string; priority: string; status: string; remarks: string | null; assignedTo: { name: string } | null; createdAt: string }

/** Maintenance requests (M7.3): raise, assign to a staff member, resolve. */
export function MaintenanceTab({ hostelId, rooms, warden }: { hostelId: string; rooms: Room[] | null; warden: boolean }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [rows, setRows] = useState<Maint[] | null>(null);
  const [dialog, setDialog] = useState<{ kind: 'new' } | { kind: 'edit'; m: Maint } | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [who, setWho] = useState<PersonPick | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Maint[]>(`/hostel/hostels/${hostelId}/maintenance`).then(setRows).catch(() => setRows([])); }, [hostelId]);
  useEffect(load, [load]);
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try {
      if (dialog?.kind === 'new') await api('/hostel/maintenance', { method: 'POST', body: JSON.stringify({ hostelId, roomId: form.roomId || null, category: form.category, priority: form.priority, description: form.description }) });
      else if (dialog?.kind === 'edit') await api(`/hostel/maintenance/${dialog.m.id}`, { method: 'PATCH', body: JSON.stringify({ status: form.status, remarks: form.remarks || null, ...(who ? { assignedToEmployeeId: who.id } : {}) }) });
      toast(t('hs.mt.saved')); setDialog(null); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  if (!rows) return <SkeletonRows rows={3} />;
  return (
    <>
      {warden && <div className="panel-head"><p className="muted small">{t('hs.mt.hint')}</p><button type="button" className="btn btn-primary btn-sm" onClick={() => { setForm({ roomId: '', category: 'ELECTRICAL', priority: 'NORMAL', description: '' }); setErrors({}); setError(null); setDialog({ kind: 'new' }); }}><Icon name="plus" size={14} /> {t('hs.mt.new')}</button></div>}
      {rows.length === 0 ? <EmptyState icon="settings" title={t('hs.mt.none')} /> : (
        <ul className="pt-list">
          {rows.map((m) => (
            <li key={m.id}>
              <span className="pt-list-main"><strong>{m.roomNo ? `${m.roomNo} · ` : ''}{m.description}</strong><span className="muted small">{t(`hs.mt.cat.${m.category}` as MessageKey)} · {t(`hs.mt.p.${m.priority}` as MessageKey)} · {when(m.createdAt, locale)}{m.assignedTo ? ` · ${m.assignedTo.name}` : ''}{m.remarks ? ` · ${m.remarks}` : ''}</span></span>
              <span className="pt-list-amt">
                <StatusBadge status={m.status === 'RESOLVED' || m.status === 'CLOSED' ? 'ACTIVE' : m.status === 'OPEN' ? 'PENDING' : 'INFO'} label={t(`hs.mt.s.${m.status}` as MessageKey)} />
                {warden && m.status !== 'CLOSED' && <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setForm({ status: m.status, remarks: m.remarks ?? '' }); setWho(null); setErrors({}); setError(null); setDialog({ kind: 'edit', m }); }}>{t('hs.mt.update')}</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Modal open={dialog?.kind === 'new'} onClose={() => setDialog(null)} title={t('hs.mt.new')} onSubmit={save} submitLabel={t('tr.save')} busy={busy} error={error}>
        <div className="grid-2">
          <Field id="mt-room" label={t('hs.roomNo')}><select id="mt-room" value={form.roomId} onChange={(e) => setForm((f) => ({ ...f, roomId: e.target.value }))}><option value="">{t('hs.mt.common')}</option>{(rooms ?? []).map((r) => <option key={r.id} value={r.id}>{r.roomNo}</option>)}</select></Field>
          <Field id="mt-cat" label={t('hs.mt.category')}><select id="mt-cat" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>{MAINTENANCE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`hs.mt.cat.${c}` as MessageKey)}</option>)}</select></Field>
          <Field id="mt-prio" label={t('hs.mt.priority')}><select id="mt-prio" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>{PRIORITIES.map((c) => <option key={c} value={c}>{t(`hs.mt.p.${c}` as MessageKey)}</option>)}</select></Field>
        </div>
        <Field id="mt-desc" label={t('hs.mt.what')} error={errors.description}><textarea id="mt-desc" rows={3} value={form.description ?? ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></Field>
      </Modal>
      <Modal open={dialog?.kind === 'edit'} onClose={() => setDialog(null)} title={t('hs.mt.update')} onSubmit={save} submitLabel={t('tr.save')} busy={busy} error={error}>
        <Field id="lv-who" label={t('hs.mt.assign')}><PersonSearch kind="EMPLOYEE" value={who} onPick={setWho} /></Field>
        <Field id="mt-st" label={t('common.status')}><select id="mt-st" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>{MAINTENANCE_STATUSES.map((c) => <option key={c} value={c}>{t(`hs.mt.s.${c}` as MessageKey)}</option>)}</select></Field>
        <Field id="mt-rem" label={t('hs.mt.remarks')}><input id="mt-rem" value={form.remarks ?? ''} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} /></Field>
      </Modal>
    </>
  );
}
