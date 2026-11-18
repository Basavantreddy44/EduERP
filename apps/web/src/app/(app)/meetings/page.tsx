'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { MEETING_TYPES, PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { todayIST } from '@/components/admissions';
import { Pill, StaffChecklist, StaffOpt, useWhen } from '@/components/engagement2';

interface Row { id: string; title: string; meetingType: string; startAt: string; endAt: string; venue: string | null; status: string; minutesStatus: string | null; invited: number; accepted: number; myRsvp: string | null; openActions: number }
interface Action { id: string; description: string; dueDate: string; status: string; overdue: boolean; meeting: { id: string; title: string } }
interface Committee { id: string; name: string; description: string | null; campusId: string | null; members: { employeeId: string; name: string; memberRole: string }[] }
interface Options { staff: StaffOpt[]; departments: { id: string; name: string }[] }

/** Staff meetings & committees (M12.1): my meetings, my action items; managers schedule and keep committees. */
export default function MeetingsPage() {
  const { can } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const w = useWhen();
  const manage = can(PERMISSIONS.MEETING_MANAGE);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [opts, setOpts] = useState<Options | null>(null);
  const [committees, setCommittees] = useState<Committee[]>([]);
  const [open, setOpen] = useState(false);
  const [showCommittees, setShowCommittees] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [invite, setInvite] = useState<string[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api<Row[]>('/meetings').then(setRows).catch(() => setRows([]));
    api<Action[]>('/meetings/my-actions').then(setActions).catch(() => setActions([]));
    api<Committee[]>('/meetings/committees').then(setCommittees).catch(() => setCommittees([]));
  }, []);
  useEffect(load, [load]);
  useEffect(() => { if (manage) api<Options>('/meetings/options').then(setOpts).catch(() => setOpts({ staff: [], departments: [] })); }, [manage]);
  const start = () => {
    setForm({ title: '', meetingType: 'STAFF', committeeId: committees[0]?.id ?? '', departmentId: opts?.departments[0]?.id ?? '', date: todayIST(), from: '15:30', to: '16:30', venue: '', meetingLink: '', agenda: '' });
    setInvite([]); setErrors({}); setError(null); setOpen(true);
  };
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    const body = {
      meetingType: form.meetingType, title: form.title, venue: form.venue || null, meetingLink: form.meetingLink || null,
      committeeId: form.meetingType === 'COMMITTEE' ? form.committeeId || null : null, departmentId: form.meetingType === 'DEPARTMENT' ? form.departmentId || null : null,
      startAt: `${form.date}T${form.from}:00+05:30`, endAt: `${form.date}T${form.to}:00+05:30`, employeeIds: invite,
      agenda: form.agenda.split('\n').map((x) => x.trim()).filter(Boolean),
    };
    try { const r = await api<{ id: string; invitees: number }>('/meetings', { method: 'POST', body: JSON.stringify(body) }); toast(t('mt.added', { n: r.invitees })); setOpen(false); window.location.href = `/meetings/${r.id}`; }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const now = Date.now();
  const upcoming = (rows ?? []).filter((r) => Date.parse(r.endAt) >= now && r.status !== 'CANCELLED');
  const past = (rows ?? []).filter((r) => !upcoming.includes(r)).reverse();
  const card = (r: Row) => (
    <li key={r.id}>
      <Link href={`/meetings/${r.id}`} className="card ev-card">
        <span className="ev-date"><strong>{w.dayNum(r.startAt)}</strong><span>{w.mon(r.startAt)}</span></span>
        <span className="ev-main">
          <strong className="hw-title">{r.title}</strong>
          <span className="muted small">{t(`mt.type.${r.meetingType}` as MessageKey)} · {w.time(r.startAt)}–{w.time(r.endAt)}{r.venue ? ` · ${r.venue}` : ''}</span>
        </span>
        <span className="ev-side">
          {r.myRsvp && Date.parse(r.startAt) > now && <Pill tone={r.myRsvp === 'ACCEPTED' ? 'pill-ok' : r.myRsvp === 'DECLINED' ? 'pill-muted' : 'pill-warn'}>{t(`mt.rsvp.${r.myRsvp}` as MessageKey)}</Pill>}
          {r.minutesStatus && <Pill tone={r.minutesStatus === 'APPROVED' ? 'pill-ok' : 'pill-info'}>{t(`mt.minutes.${r.minutesStatus}` as MessageKey)}</Pill>}
          <span className="small">{t('mt.acceptedOf', { n: r.accepted, of: r.invited })}{r.openActions ? ` · ${t('mt.openActions', { n: r.openActions })}` : ''}</span>
        </span>
      </Link>
    </li>
  );
  return (
    <>
      <PageHeader eyebrow={t('nav.engagement')} title={t('mt.title')} description={t('mt.desc')}
        actions={manage && <><button type="button" className="btn" onClick={() => setShowCommittees(true)}><Icon name="users" /> {t('mt.committees')}</button><button type="button" className="btn btn-primary" onClick={start} disabled={!opts}><Icon name="plus" /> {t('mt.add')}</button></>} />
      {actions.length > 0 && (
        <section aria-labelledby="mt-acts" className="card p12-actions">
          <h2 id="mt-acts" className="section-title"><Icon name="clipboard" /> {t('mt.myActions')}</h2>
          <ul>
            {actions.map((a) => (
              <li key={a.id}>
                <span><strong>{a.description}</strong><span className="muted small"> · <Link href={`/meetings/${a.meeting.id}`}>{a.meeting.title}</Link></span></span>
                <Pill tone={a.overdue ? 'pill-bad' : 'pill-info'}>{a.overdue ? t('mt.overdueOn', { d: w.date(a.dueDate) }) : t('mt.dueOn', { d: w.date(a.dueDate) })}</Pill>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!rows ? <SkeletonRows rows={4} /> : !rows.length ? <EmptyState icon="users" title={t('mt.none')} text={manage ? t('mt.noneHint') : undefined} /> : (
        <>
          <h2 className="section-title">{t('mt.upcoming')}</h2>
          {upcoming.length ? <ul className="ev-list">{upcoming.map(card)}</ul> : <p className="muted">{t('mt.noUpcoming')}</p>}
          {past.length > 0 && <><h2 className="section-title">{t('mt.past')}</h2><ul className="ev-list">{past.map(card)}</ul></>}
        </>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('mt.add')} subtitle={t('mt.addSub')} onSubmit={save} submitLabel={t('mt.create')} busy={busy} error={error} wide>
        <div className="grid-2">
          <Field id="mt-title" label={t('mt.name')} error={errors.title}><input id="mt-title" value={form.title ?? ''} onChange={set('title')} placeholder={t('mt.namePh')} /></Field>
          <Field id="mt-type" label={t('mt.typeLabel')}><select id="mt-type" value={form.meetingType} onChange={set('meetingType')}>{MEETING_TYPES.map((m) => <option key={m} value={m}>{t(`mt.type.${m}` as MessageKey)}</option>)}</select></Field>
        </div>
        {form.meetingType === 'COMMITTEE' && (
          <Field id="mt-com" label={t('mt.committee')} error={errors.committeeId} hint={t('mt.committeeHint')}>
            {committees.length ? <select id="mt-com" value={form.committeeId} onChange={set('committeeId')}>{committees.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select> : <p className="muted small" id="mt-com">{t('mt.noCommittees')}</p>}
          </Field>
        )}
        {form.meetingType === 'DEPARTMENT' && (
          <Field id="mt-dept" label={t('mt.department')} error={errors.departmentId} hint={t('mt.departmentHint')}><select id="mt-dept" value={form.departmentId} onChange={set('departmentId')}>{opts?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        )}
        <div className="grid-3">
          <Field id="mt-date" label={t('common.date')} error={errors.startAt}><input id="mt-date" type="date" value={form.date ?? ''} onChange={set('date')} /></Field>
          <Field id="mt-from" label={t('ex.sched.from')}><input id="mt-from" type="time" value={form.from ?? ''} onChange={set('from')} /></Field>
          <Field id="mt-to" label={t('ex.sched.to')} error={errors.endAt}><input id="mt-to" type="time" value={form.to ?? ''} onChange={set('to')} /></Field>
        </div>
        <div className="grid-2">
          <Field id="mt-venue" label={t('mt.venue')} error={errors.venue}><input id="mt-venue" value={form.venue ?? ''} onChange={set('venue')} placeholder={t('mt.venuePh')} /></Field>
          <Field id="mt-link" label={t('mt.link')} hint={t('mt.linkHint')} error={errors.meetingLink}><input id="mt-link" type="url" value={form.meetingLink ?? ''} onChange={set('meetingLink')} placeholder="https://" /></Field>
        </div>
        {opts && <StaffChecklist staff={opts.staff} departments={opts.departments} value={invite} onChange={setInvite} legend={form.meetingType === 'COMMITTEE' || form.meetingType === 'DEPARTMENT' ? t('mt.alsoInvite') : t('mt.invite')} />}
        {errors.employeeIds && <span className="field-error">{errors.employeeIds}</span>}
        <Field id="mt-agenda" label={t('mt.agenda')} hint={t('mt.agendaHint')} error={errors.agenda}><textarea id="mt-agenda" rows={4} value={form.agenda ?? ''} onChange={set('agenda')} /></Field>
      </Modal>
      {showCommittees && <Committees committees={committees} staff={opts?.staff ?? []} onClose={() => setShowCommittees(false)} onSaved={load} />}
    </>
  );
}

function Committees({ committees, staff, onClose, onSaved }: { committees: Committee[]; staff: StaffOpt[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [edit, setEdit] = useState<Committee | 'new' | null>(null);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [members, setMembers] = useState<{ employeeId: string; memberRole: string }[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = (c: Committee | 'new') => {
    setEdit(c); setErrors({}); setError(null);
    setName(c === 'new' ? '' : c.name); setDesc(c === 'new' ? '' : c.description ?? '');
    setMembers(c === 'new' ? [] : c.members.map((m) => ({ employeeId: m.employeeId, memberRole: m.memberRole })));
  };
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!edit) return;
    setBusy(true); setErrors({}); setError(null);
    try {
      await api(edit === 'new' ? '/meetings/committees' : `/meetings/committees/${edit.id}`, { method: edit === 'new' ? 'POST' : 'PUT', body: JSON.stringify({ name, description: desc || null, members }) });
      toast(t('mt.com.saved')); setEdit(null); onSaved();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  if (edit) {
    const ids = members.map((m) => m.employeeId);
    return (
      <Modal open onClose={() => setEdit(null)} title={edit === 'new' ? t('mt.com.add') : edit.name} onSubmit={save} submitLabel={t('common.save')} busy={busy} error={error} wide>
        <Field id="cm-name" label={t('common.name')} error={errors.name}><input id="cm-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('mt.com.namePh')} /></Field>
        <Field id="cm-desc" label={t('mt.com.purpose')} error={errors.description}><input id="cm-desc" value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        <StaffChecklist staff={staff} value={ids} onChange={(v) => setMembers(v.map((id) => members.find((m) => m.employeeId === id) ?? { employeeId: id, memberRole: 'MEMBER' }))} legend={t('mt.com.members')} />
        {members.length > 0 && (
          <ul className="p12-roles" aria-label={t('mt.com.roles')}>
            {members.map((m) => (
              <li key={m.employeeId}>
                <span>{staff.find((s) => s.id === m.employeeId)?.name ?? ''}</span>
                <select aria-label={t('mt.com.roleOf', { name: staff.find((s) => s.id === m.employeeId)?.name ?? '' })} value={m.memberRole} onChange={(e) => setMembers((l) => l.map((x) => (x.employeeId === m.employeeId ? { ...x, memberRole: e.target.value } : x)))}>
                  {['CHAIR', 'SECRETARY', 'MEMBER'].map((r) => <option key={r} value={r}>{t(`mt.role.${r}` as MessageKey)}</option>)}
                </select>
              </li>
            ))}
          </ul>
        )}
        {errors.members && <span className="field-error">{errors.members}</span>}
        <p className="muted small">{t('mt.com.hint')}</p>
      </Modal>
    );
  }
  return (
    <Modal open onClose={onClose} title={t('mt.committees')} subtitle={t('mt.com.sub')} onSubmit={(e) => { e.preventDefault(); onClose(); }} submitLabel={t('common.close')} hideCancel wide>
      {!committees.length ? <EmptyState icon="users" title={t('mt.noCommittees')} /> : (
        <ul className="p12-committees">
          {committees.map((c) => (
            <li key={c.id} className="card">
              <span><strong>{c.name}</strong>{c.description && <span className="muted small"> · {c.description}</span>}
                <span className="sub-line small">{c.members.map((m) => `${m.name}${m.memberRole !== 'MEMBER' ? ` (${t(`mt.role.${m.memberRole}` as MessageKey)})` : ''}`).join(', ')}</span>
              </span>
              <button type="button" className="btn btn-sm" onClick={() => open(c)}><Icon name="edit" /> {t('common.edit')}</button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn-primary" onClick={() => open('new')}><Icon name="plus" /> {t('mt.com.add')}</button>
    </Modal>
  );
}
