'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ID_PROOFS, PERMISSIONS, VISIT_PURPOSES } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { todayIST } from '@/components/admissions';
import { PersonPick, PersonSearch } from '@/components/leave';
import { Pill, StaffOpt, useStaffOpts, useWhen } from '@/components/engagement2';

type Tab = 'visitors' | 'passes' | 'calls' | 'post';
interface Visitor { id: string; passNo: string; visitorName: string; phone: string; purpose: string; purposeNote: string | null; idProofType: string | null; idProofLast4: string | null; vehicleNo: string | null; whomToMeet: string | null; student: string | null; inTime: string; outTime: string | null }
interface Pass { id: string; passNo: string; passType: string; reason: string; status: string; createdAt: string; outTime: string | null; actualReturn: string | null; expectedReturn: string | null; person: string; pickup: { name: string; phone: string | null; onRecord: boolean } | null; canDecide: boolean }
interface Call { id: string; callType: string; callerName: string; phone: string; purpose: string; callTime: string; followUpDate: string | null; followUpDone: boolean }
interface Post { id: string; direction: string; fromParty: string; toParty: string; courierName: string | null; trackingNo: string | null; addressedTo: string | null; recordDate: string; handedOverAt: string | null; remarks: string | null }
const PASS_TONE: Record<string, string> = { REQUESTED: 'pill-warn', APPROVED: 'pill-ok', REJECTED: 'pill-bad', OUT: 'pill-info', RETURNED: 'pill-muted' };

/** Front office (M12.3): visitors, gate passes, phone calls and post — one desk, one campus at a time. */
export default function FrontOfficePage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('visitors');
  const [campusId, setCampusId] = useState('');
  const [date, setDate] = useState(todayIST());
  const staff = useStaffOpts('/front-office/staff');
  const [campuses, setCampuses] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => { api<{ id: string; name: string }[]>('/front-office/campuses').then((c) => { setCampuses(c); setCampusId((cur) => cur || c[0]?.id || ''); }).catch(() => setCampuses([])); }, []);
  return (
    <>
      <PageHeader eyebrow={t('nav.operations')} title={t('fo.title')} description={t('fo.desc')} />
      <div className="toolbar">
        <div className="tabs scroll" role="tablist" aria-label={t('fo.title')}>
          {(['visitors', 'passes', 'calls', 'post'] as Tab[]).map((x) => <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(`fo.tab.${x}` as MessageKey)}</button>)}
        </div>
        <div className="p12-filters">
          {campuses && campuses.length > 1 && <label className="p12-inline">{t('common.campus')} <select id="fo-campus" value={campusId} onChange={(e) => setCampusId(e.target.value)}>{campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
          {(tab === 'visitors' || tab === 'passes') && <label className="p12-inline">{t('common.date')} <input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value || todayIST())} /></label>}
        </div>
      </div>
      {!campuses ? <SkeletonRows rows={4} /> : !campusId ? <EmptyState icon="building" title={t('fo.noCampus')} /> : (
        <>
          {tab === 'visitors' && <Visitors campusId={campusId} date={date} staff={staff ?? []} />}
          {tab === 'passes' && <Passes campusId={campusId} date={date} staff={staff ?? []} />}
          {tab === 'calls' && <Calls campusId={campusId} />}
          {tab === 'post' && <Postal campusId={campusId} staff={staff ?? []} />}
        </>
      )}
    </>
  );
}

function useForm<T extends Record<string, unknown>>(init: () => T) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<T>(init);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const start = () => { setForm(init()); setErrors({}); setError(null); setOpen(true); };
  const set = (k: keyof T) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (fn: () => Promise<void>) => {
    setBusy(true); setErrors({}); setError(null);
    try { await fn(); setOpen(false); } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  return { open, setOpen, form, setForm, errors, error, busy, start, set, submit };
}

function Visitors({ campusId, date, staff }: { campusId: string; date: string; staff: StaffOpt[] }) {
  const { t } = useI18n();
  const toast = useToast();
  const w = useWhen();
  const [rows, setRows] = useState<Visitor[] | null>(null);
  const [student, setStudent] = useState<PersonPick | null>(null);
  const f = useForm(() => ({ visitorName: '', phone: '', purpose: 'PARENT_VISIT', purposeNote: '', idProofType: '', idProofLast4: '', whomToMeetEmployeeId: '', vehicleNo: '' }));
  const load = useCallback(() => { setRows(null); api<Visitor[]>(`/front-office/visitors?campusId=${campusId}&date=${date}`).then(setRows).catch(() => setRows([])); }, [campusId, date]);
  useEffect(load, [load]);
  const save = (e?: FormEvent) => {
    e?.preventDefault();
    void f.submit(async () => {
      const v = f.form;
      const r = await api<{ passNo: string }>('/front-office/visitors', { method: 'POST', body: JSON.stringify({ campusId, visitorName: v.visitorName, phone: v.phone, purpose: v.purpose, purposeNote: v.purposeNote || null, idProofType: v.idProofType || null, idProofLast4: v.idProofLast4 || null, whomToMeetEmployeeId: v.whomToMeetEmployeeId || null, studentId: student?.id ?? null, vehicleNo: v.vehicleNo || null }) });
      toast(t('fo.vis.inToast', { no: r.passNo })); load();
    });
  };
  const out = async (v: Visitor) => { try { await api(`/front-office/visitors/${v.id}/out`, { method: 'POST', body: '{}' }); toast(t('fo.vis.outToast', { name: v.visitorName })); load(); } catch (x) { toast(apiErrors(x).message ?? t('en.failed')); } };
  const inside = (rows ?? []).filter((r) => !r.outTime).length;
  return (
    <>
      <div className="panel-head">
        <p className="muted">{rows ? t('fo.vis.count', { n: rows.length, inside }) : ''}</p>
        {date === todayIST() && <button type="button" className="btn btn-primary" onClick={() => { setStudent(null); f.start(); }}><Icon name="plus" /> {t('fo.vis.add')}</button>}
      </div>
      {!rows ? <SkeletonRows rows={4} /> : !rows.length ? <EmptyState icon="users" title={t('fo.vis.none')} /> : (
        <div className="table-wrap card p12-table">
          <table className="table">
            <thead><tr><th scope="col">{t('fo.pass')}</th><th scope="col">{t('fo.vis.who')}</th><th scope="col">{t('fo.vis.purpose')}</th><th scope="col">{t('fo.vis.meeting')}</th><th scope="col">{t('fo.vis.in')}</th><th scope="col">{t('fo.vis.out')}</th></tr></thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id} className={v.outTime ? 'row-dim' : undefined}>
                  <td><span className="code">{v.passNo}</span></td>
                  <td><strong>{v.visitorName}</strong><span className="sub-line muted small">{v.phone}{v.idProofType ? ` · ${t(`fo.id.${v.idProofType}` as MessageKey)} ••••${v.idProofLast4 ?? ''}` : ''}{v.vehicleNo ? ` · ${v.vehicleNo}` : ''}</span></td>
                  <td>{t(`fo.purpose.${v.purpose}` as MessageKey)}{v.purposeNote && <span className="sub-line muted small">{v.purposeNote}</span>}</td>
                  <td>{[v.whomToMeet, v.student].filter(Boolean).join(' · ') || '—'}</td>
                  <td>{w.time(v.inTime)}</td>
                  <td>{v.outTime ? w.time(v.outTime) : <button type="button" className="btn btn-sm" onClick={() => void out(v)} aria-label={t('fo.vis.markOutNamed', { name: v.visitorName })}><Icon name="logout" /> {t('fo.vis.markOut')}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={f.open} onClose={() => f.setOpen(false)} title={t('fo.vis.add')} subtitle={t('fo.vis.addSub')} onSubmit={save} submitLabel={t('fo.vis.issue')} busy={f.busy} error={f.error} wide>
        <div className="grid-2">
          <Field id="fv-name" label={t('fo.vis.name')} error={f.errors.visitorName}><input id="fv-name" value={f.form.visitorName} onChange={f.set('visitorName')} autoComplete="off" /></Field>
          <Field id="fv-phone" label={t('fo.phone')} error={f.errors.phone}><input id="fv-phone" inputMode="numeric" value={f.form.phone} onChange={f.set('phone')} placeholder="98XXXXXXXX" /></Field>
        </div>
        <div className="grid-2">
          <Field id="fv-purpose" label={t('fo.vis.purpose')}><select id="fv-purpose" value={f.form.purpose} onChange={f.set('purpose')}>{VISIT_PURPOSES.map((p) => <option key={p} value={p}>{t(`fo.purpose.${p}` as MessageKey)}</option>)}</select></Field>
          <Field id="fv-note" label={t('fo.vis.note')} error={f.errors.purposeNote}><input id="fv-note" value={f.form.purposeNote} onChange={f.set('purposeNote')} /></Field>
        </div>
        <div className="grid-2">
          <Field id="fv-staff" label={t('fo.vis.toMeet')}><select id="fv-staff" value={f.form.whomToMeetEmployeeId} onChange={f.set('whomToMeetEmployeeId')}><option value="">—</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}{s.designation ? ` · ${s.designation}` : ''}</option>)}</select></Field>
          <Field id="fv-student" label={t('fo.vis.student')} hint={t('fo.vis.studentHint')}><PersonSearch kind="STUDENT" value={student} onPick={setStudent} deskCampusId={campusId} inputId="fv-student" /></Field>
        </div>
        <div className="grid-3">
          <Field id="fv-idt" label={t('fo.vis.idType')}><select id="fv-idt" value={f.form.idProofType} onChange={f.set('idProofType')}><option value="">{t('fo.vis.noId')}</option>{ID_PROOFS.map((p) => <option key={p} value={p}>{t(`fo.id.${p}` as MessageKey)}</option>)}</select></Field>
          <Field id="fv-id4" label={t('fo.vis.idLast4')} hint={t('fo.vis.idLast4Hint')} error={f.errors.idProofLast4}><input id="fv-id4" maxLength={4} value={f.form.idProofLast4} disabled={!f.form.idProofType} onChange={f.set('idProofLast4')} autoComplete="off" /></Field>
          <Field id="fv-veh" label={t('fo.vis.vehicle')} error={f.errors.vehicleNo}><input id="fv-veh" value={f.form.vehicleNo} onChange={f.set('vehicleNo')} placeholder="KA 01 AB 1234" /></Field>
        </div>
      </Modal>
    </>
  );
}

function Passes({ campusId, date, staff }: { campusId: string; date: string; staff: StaffOpt[] }) {
  const { t } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const w = useWhen();
  const [rows, setRows] = useState<Pass[] | null>(null);
  const [student, setStudent] = useState<PersonPick | null>(null);
  const [guardians, setGuardians] = useState<{ id: string; name: string; phone: string | null; relation: string }[]>([]);
  const f = useForm(() => ({ passType: 'STUDENT', employeeId: '', reason: '', pickup: '', pickupPersonName: '', pickupPersonPhone: '', returnTime: '' }));
  const load = useCallback(() => { setRows(null); api<Pass[]>(`/front-office/gate-passes?campusId=${campusId}&date=${date}`).then(setRows).catch(() => setRows([])); }, [campusId, date]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!student) { setGuardians([]); return; }
    api<typeof guardians>(`/front-office/students/${student.id}/guardians`).then((g) => { setGuardians(g); f.setForm((x) => ({ ...x, pickup: g[0]?.id ?? 'OTHER' })); }).catch(() => setGuardians([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student]);
  const save = (e?: FormEvent) => {
    e?.preventDefault();
    void f.submit(async () => {
      const v = f.form;
      const stu = v.passType === 'STUDENT';
      const other = v.pickup === 'OTHER';
      const r = await api<{ passNo: string; status: string }>('/front-office/gate-passes', { method: 'POST', body: JSON.stringify({
        campusId, passType: v.passType, reason: v.reason, studentId: stu ? student?.id ?? null : null, employeeId: stu ? null : v.employeeId || null,
        pickupGuardianId: stu && !other ? v.pickup || null : null, pickupPersonName: stu && other ? v.pickupPersonName || null : null, pickupPersonPhone: stu && other ? v.pickupPersonPhone || null : null,
        expectedReturn: v.returnTime ? `${todayIST()}T${v.returnTime}:00+05:30` : null,
      }) });
      toast(r.status === 'APPROVED' ? t('fo.gp.readyToast', { no: r.passNo }) : t('fo.gp.waitToast', { no: r.passNo })); load();
    });
  };
  const act = async (p: Pass, path: string, done: string, body: unknown = {}) => { try { await api(`/front-office/gate-passes/${p.id}/${path}`, { method: 'POST', body: JSON.stringify(body) }); toast(done); load(); } catch (x) { toast(apiErrors(x).message ?? t('en.failed')); } };
  const waiting = (rows ?? []).filter((r) => r.status === 'REQUESTED');
  return (
    <>
      <div className="panel-head">
        <p className="muted">{t('fo.gp.hint')}</p>
        <button type="button" className="btn btn-primary" onClick={() => { setStudent(null); f.start(); }}><Icon name="plus" /> {t('fo.gp.add')}</button>
      </div>
      {waiting.length > 0 && can(PERMISSIONS.FRONT_APPROVE) && <p className="notice"><Icon name="clock" /> {t('fo.gp.waiting', { n: waiting.length })}</p>}
      {!rows ? <SkeletonRows rows={4} /> : !rows.length ? <EmptyState icon="lock" title={t('fo.gp.none')} /> : (
        <div className="table-wrap card p12-table">
          <table className="table">
            <thead><tr><th scope="col">{t('fo.pass')}</th><th scope="col">{t('fo.gp.person')}</th><th scope="col">{t('fo.gp.reason')}</th><th scope="col">{t('fo.gp.pickup')}</th><th scope="col">{t('common.status')}</th><th scope="col"><span className="sr-only">{t('common.actions')}</span></th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={p.status === 'RETURNED' || p.status === 'REJECTED' ? 'row-dim' : undefined}>
                  <td><span className="code">{p.passNo}</span><span className="sub-line muted small">{w.dt(p.createdAt)}</span></td>
                  <td>{p.person}<span className="sub-line muted small">{t(`fo.gp.type.${p.passType}` as MessageKey)}</span></td>
                  <td>{p.reason}{p.expectedReturn && <span className="sub-line muted small">{t('fo.gp.backBy', { time: w.time(p.expectedReturn) })}</span>}</td>
                  <td>{p.pickup ? <>{p.pickup.name}<span className="sub-line muted small">{p.pickup.phone ?? ''}{p.pickup.onRecord ? ` · ${t('fo.gp.onRecord')}` : ` · ${t('fo.gp.notOnRecord')}`}</span></> : '—'}</td>
                  <td><Pill tone={PASS_TONE[p.status]}>{t(`fo.gp.status.${p.status}` as MessageKey)}</Pill>{p.outTime && <span className="sub-line muted small">{t('fo.gp.leftAt', { time: w.time(p.outTime) })}{p.actualReturn ? ` · ${t('fo.gp.backAt', { time: w.time(p.actualReturn) })}` : ''}</span>}</td>
                  <td className="row-actions">
                    {p.canDecide && <><button type="button" className="btn btn-sm btn-primary" onClick={() => void act(p, 'decide', t('fo.gp.approvedToast'), { approve: true })}><Icon name="check" /> {t('fo.gp.approve')}</button><button type="button" className="btn btn-sm btn-ghost" onClick={() => void act(p, 'decide', t('fo.gp.rejectedToast'), { approve: false })}>{t('fo.gp.reject')}</button></>}
                    {p.status === 'REQUESTED' && !p.canDecide && <span className="muted small">{t('fo.gp.needsOther')}</span>}
                    {p.status === 'APPROVED' && <button type="button" className="btn btn-sm" onClick={() => void act(p, 'out', t('fo.gp.outToast'))}><Icon name="logout" /> {t('fo.gp.markOut')}</button>}
                    {p.status === 'OUT' && <button type="button" className="btn btn-sm" onClick={() => void act(p, 'return', t('fo.gp.backToast'))}><Icon name="check" /> {t('fo.gp.markBack')}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={f.open} onClose={() => f.setOpen(false)} title={t('fo.gp.add')} subtitle={t('fo.gp.addSub')} onSubmit={save} submitLabel={t('fo.gp.issue')} busy={f.busy} error={f.error} wide>
        <fieldset className="p12-seg"><legend>{t('fo.gp.for')}</legend>
          {['STUDENT', 'STAFF'].map((x) => <label key={x} className="check"><input type="radio" name="gp-type" checked={f.form.passType === x} onChange={() => f.setForm((v) => ({ ...v, passType: x }))} /> {t(`fo.gp.type.${x}` as MessageKey)}</label>)}
        </fieldset>
        {f.form.passType === 'STUDENT' ? (
          <>
            <Field id="gp-student" label={t('fo.gp.student')} error={f.errors.studentId}><PersonSearch kind="STUDENT" value={student} onPick={setStudent} deskCampusId={campusId} inputId="gp-student" /></Field>
            {student && (
              <fieldset className="check-group"><legend>{t('fo.gp.whoCollects')}</legend>
                {guardians.map((g) => <label key={g.id} className="check"><input type="radio" name="gp-pick" checked={f.form.pickup === g.id} onChange={() => f.setForm((v) => ({ ...v, pickup: g.id }))} /> {g.name} <span className="muted small">· {g.relation}{g.phone ? ` · ${g.phone}` : ''}</span></label>)}
                <label className="check"><input type="radio" name="gp-pick" checked={f.form.pickup === 'OTHER'} onChange={() => f.setForm((v) => ({ ...v, pickup: 'OTHER' }))} /> {t('fo.gp.someoneElse')}</label>
                {f.errors.pickupGuardianId && <span className="field-error">{f.errors.pickupGuardianId}</span>}
              </fieldset>
            )}
            {student && f.form.pickup === 'OTHER' && (
              <>
                <div className="grid-2">
                  <Field id="gp-pname" label={t('fo.gp.pickupName')} error={f.errors.pickupPersonName}><input id="gp-pname" value={f.form.pickupPersonName} onChange={f.set('pickupPersonName')} /></Field>
                  <Field id="gp-pphone" label={t('fo.phone')} error={f.errors.pickupPersonPhone}><input id="gp-pphone" inputMode="numeric" value={f.form.pickupPersonPhone} onChange={f.set('pickupPersonPhone')} /></Field>
                </div>
                <p className="notice"><Icon name="info" /> {t('fo.gp.otherNote')}</p>
              </>
            )}
          </>
        ) : (
          <Field id="gp-staff" label={t('fo.gp.staffMember')} error={f.errors.employeeId}><select id="gp-staff" value={f.form.employeeId} onChange={f.set('employeeId')}><option value="">—</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}{s.designation ? ` · ${s.designation}` : ''}</option>)}</select></Field>
        )}
        <div className="grid-2">
          <Field id="gp-reason" label={t('fo.gp.reason')} error={f.errors.reason}><input id="gp-reason" value={f.form.reason} onChange={f.set('reason')} placeholder={t('fo.gp.reasonPh')} /></Field>
          <Field id="gp-back" label={t('fo.gp.returnTime')} hint={t('fo.gp.returnHint')} error={f.errors.expectedReturn}><input id="gp-back" type="time" value={f.form.returnTime} onChange={f.set('returnTime')} /></Field>
        </div>
        {f.form.passType === 'STAFF' && <p className="muted small">{t('fo.gp.staffNote')}</p>}
      </Modal>
    </>
  );
}

function Calls({ campusId }: { campusId: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const w = useWhen();
  const [rows, setRows] = useState<Call[] | null>(null);
  const f = useForm(() => ({ callType: 'INCOMING', callerName: '', phone: '', purpose: '', followUpDate: '' }));
  const load = useCallback(() => { setRows(null); api<Call[]>(`/front-office/calls?campusId=${campusId}`).then(setRows).catch(() => setRows([])); }, [campusId]);
  useEffect(load, [load]);
  const save = (e?: FormEvent) => { e?.preventDefault(); void f.submit(async () => { await api('/front-office/calls', { method: 'POST', body: JSON.stringify({ ...f.form, campusId, followUpDate: f.form.followUpDate || null }) }); toast(t('fo.call.saved')); load(); }); };
  const done = async (c: Call) => { try { await api(`/front-office/calls/${c.id}/done`, { method: 'POST', body: '{}' }); toast(t('fo.call.doneToast')); load(); } catch (x) { toast(apiErrors(x).message ?? t('en.failed')); } };
  const pending = (rows ?? []).filter((c) => c.followUpDate && !c.followUpDone);
  return (
    <>
      <div className="panel-head">
        <p className="muted">{pending.length ? t('fo.call.pending', { n: pending.length }) : t('fo.call.hint')}</p>
        <button type="button" className="btn btn-primary" onClick={f.start}><Icon name="phone" /> {t('fo.call.add')}</button>
      </div>
      {!rows ? <SkeletonRows rows={4} /> : !rows.length ? <EmptyState icon="phone" title={t('fo.call.none')} /> : (
        <div className="table-wrap card p12-table">
          <table className="table">
            <thead><tr><th scope="col">{t('fo.call.when')}</th><th scope="col">{t('fo.call.caller')}</th><th scope="col">{t('fo.call.about')}</th><th scope="col">{t('fo.call.followUp')}</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>{w.dt(c.callTime)}<span className="sub-line muted small">{t(`fo.call.type.${c.callType}` as MessageKey)}</span></td>
                  <td>{c.callerName}<span className="sub-line muted small">{c.phone}</span></td>
                  <td>{c.purpose}</td>
                  <td>{!c.followUpDate ? '—' : c.followUpDone ? <Pill tone="pill-ok">{t('fo.call.done')}</Pill> : <span className="p12-inline"><span className={c.followUpDate < todayIST() ? 'text-bad' : undefined}>{w.date(c.followUpDate)}</span> <button type="button" className="btn btn-sm" onClick={() => void done(c)}><Icon name="check" /> {t('fo.call.markDone')}</button></span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={f.open} onClose={() => f.setOpen(false)} title={t('fo.call.add')} onSubmit={save} submitLabel={t('common.save')} busy={f.busy} error={f.error}>
        <fieldset className="p12-seg"><legend>{t('fo.call.kind')}</legend>
          {['INCOMING', 'OUTGOING'].map((x) => <label key={x} className="check"><input type="radio" name="fc-type" checked={f.form.callType === x} onChange={() => f.setForm((v) => ({ ...v, callType: x }))} /> {t(`fo.call.type.${x}` as MessageKey)}</label>)}
        </fieldset>
        <div className="grid-2">
          <Field id="fc-name" label={t('fo.call.caller')} error={f.errors.callerName}><input id="fc-name" value={f.form.callerName} onChange={f.set('callerName')} /></Field>
          <Field id="fc-phone" label={t('fo.phone')} error={f.errors.phone}><input id="fc-phone" inputMode="numeric" value={f.form.phone} onChange={f.set('phone')} /></Field>
        </div>
        <Field id="fc-about" label={t('fo.call.about')} error={f.errors.purpose}><input id="fc-about" value={f.form.purpose} onChange={f.set('purpose')} placeholder={t('fo.call.aboutPh')} /></Field>
        <Field id="fc-fu" label={t('fo.call.followUpOn')} hint={t('fo.call.followUpHint')} error={f.errors.followUpDate}><input id="fc-fu" type="date" min={todayIST()} value={f.form.followUpDate} onChange={f.set('followUpDate')} /></Field>
      </Modal>
    </>
  );
}

function Postal({ campusId, staff }: { campusId: string; staff: StaffOpt[] }) {
  const { t } = useI18n();
  const toast = useToast();
  const w = useWhen();
  const [rows, setRows] = useState<Post[] | null>(null);
  const f = useForm(() => ({ direction: 'INWARD', fromParty: '', toParty: '', courierName: '', trackingNo: '', addressedToEmployeeId: '', remarks: '' }));
  const load = useCallback(() => { setRows(null); api<Post[]>(`/front-office/postal?campusId=${campusId}`).then(setRows).catch(() => setRows([])); }, [campusId]);
  useEffect(load, [load]);
  const save = (e?: FormEvent) => {
    e?.preventDefault();
    const v = f.form;
    void f.submit(async () => { await api('/front-office/postal', { method: 'POST', body: JSON.stringify({ campusId, direction: v.direction, fromParty: v.fromParty, toParty: v.toParty, courierName: v.courierName || null, trackingNo: v.trackingNo || null, addressedToEmployeeId: v.direction === 'INWARD' ? v.addressedToEmployeeId || null : null, remarks: v.remarks || null }) }); toast(t('fo.post.saved')); load(); });
  };
  const hand = async (p: Post) => { try { await api(`/front-office/postal/${p.id}/handed-over`, { method: 'POST', body: '{}' }); toast(t('fo.post.handedToast')); load(); } catch (x) { toast(apiErrors(x).message ?? t('en.failed')); } };
  const waiting = (rows ?? []).filter((p) => p.direction === 'INWARD' && !p.handedOverAt).length;
  return (
    <>
      <div className="panel-head">
        <p className="muted">{waiting ? t('fo.post.waiting', { n: waiting }) : t('fo.post.hint')}</p>
        <button type="button" className="btn btn-primary" onClick={f.start}><Icon name="mail" /> {t('fo.post.add')}</button>
      </div>
      {!rows ? <SkeletonRows rows={4} /> : !rows.length ? <EmptyState icon="mail" title={t('fo.post.none')} /> : (
        <div className="table-wrap card p12-table">
          <table className="table">
            <thead><tr><th scope="col">{t('common.date')}</th><th scope="col">{t('fo.post.fromTo')}</th><th scope="col">{t('fo.post.courier')}</th><th scope="col">{t('fo.post.handover')}</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>{w.dt(p.recordDate)}<span className="sub-line"><Pill tone={p.direction === 'INWARD' ? 'pill-info' : 'pill-muted'}>{t(`fo.post.dir.${p.direction}` as MessageKey)}</Pill></span></td>
                  <td>{p.fromParty} → {p.toParty}{p.remarks && <span className="sub-line muted small">{p.remarks}</span>}</td>
                  <td>{p.courierName ?? '—'}{p.trackingNo && <span className="sub-line muted small code">{p.trackingNo}</span>}</td>
                  <td>{p.direction === 'OUTWARD' ? '—' : p.handedOverAt ? <>{t('fo.post.handedAt', { time: w.dt(p.handedOverAt) })}{p.addressedTo && <span className="sub-line muted small">{p.addressedTo}</span>}</> : <button type="button" className="btn btn-sm" onClick={() => void hand(p)}><Icon name="check" /> {p.addressedTo ? t('fo.post.giveTo', { name: p.addressedTo }) : t('fo.post.markHanded')}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={f.open} onClose={() => f.setOpen(false)} title={t('fo.post.add')} onSubmit={save} submitLabel={t('common.save')} busy={f.busy} error={f.error} wide>
        <fieldset className="p12-seg"><legend>{t('fo.post.kind')}</legend>
          {['INWARD', 'OUTWARD'].map((x) => <label key={x} className="check"><input type="radio" name="fp-dir" checked={f.form.direction === x} onChange={() => f.setForm((v) => ({ ...v, direction: x }))} /> {t(`fo.post.dir.${x}` as MessageKey)}</label>)}
        </fieldset>
        <div className="grid-2">
          <Field id="fp-from" label={t('fo.post.from')} error={f.errors.fromParty}><input id="fp-from" value={f.form.fromParty} onChange={f.set('fromParty')} /></Field>
          <Field id="fp-to" label={t('fo.post.to')} error={f.errors.toParty}><input id="fp-to" value={f.form.toParty} onChange={f.set('toParty')} /></Field>
        </div>
        <div className="grid-3">
          <Field id="fp-courier" label={t('fo.post.courier')} error={f.errors.courierName}><input id="fp-courier" value={f.form.courierName} onChange={f.set('courierName')} placeholder={t('fo.post.courierPh')} /></Field>
          <Field id="fp-track" label={t('fo.post.tracking')} error={f.errors.trackingNo}><input id="fp-track" value={f.form.trackingNo} onChange={f.set('trackingNo')} /></Field>
          {f.form.direction === 'INWARD' && <Field id="fp-staff" label={t('fo.post.forStaff')}><select id="fp-staff" value={f.form.addressedToEmployeeId} onChange={f.set('addressedToEmployeeId')}><option value="">—</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>}
        </div>
        <Field id="fp-rem" label={t('fo.post.remarks')} error={f.errors.remarks}><input id="fp-rem" value={f.form.remarks} onChange={f.set('remarks')} /></Field>
      </Modal>
    </>
  );
}
