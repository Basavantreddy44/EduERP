'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { COMPETITION_LEVELS, MEMBER_ROLES } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { todayIST } from '@/components/accounts';
import type { Person } from '@/components/campuslife';
import { ActOpts, ActivityFields, MultiPicker, blankActivity, fmtDay } from '@/components/activities';

interface Detail {
  id: string; name: string; activityType: string; campusId: string; description: string | null; isActive: boolean; coordinator: string | null; coordinatorEmployeeId: string | null;
  years: { id: string; name: string; isCurrent: boolean }[]; yearId: string | null; can: { manage: boolean };
  members: { id: string; studentId: string; name: string; admissionNo: string; className: string | null; teamName: string | null; memberRole: string }[];
  competitions: { id: string; name: string; level: string; venue: string | null; startDate: string; endDate: string; participants: number; winners: number; runnersUp: number; third: number }[];
}

/** One activity (M18.3, M18.4): members by team with their roles, and its competitions. */
export default function ActivityPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [opts, setOpts] = useState<ActOpts | null>(null);
  const [d, setD] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const [yearId, setYearId] = useState('');
  const [add, setAdd] = useState<{ students: Person[]; teamName: string; memberRole: string } | null>(null);
  const [member, setMember] = useState<{ id: string; name: string; teamName: string; memberRole: string } | null>(null);
  const [comp, setComp] = useState<{ name: string; level: string; venue: string; startDate: string; endDate: string; description: string; addToCalendar: boolean } | null>(null);
  const [edit, setEdit] = useState<typeof blankActivity | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<ActOpts>('/activities/options').then(setOpts).catch(() => setOpts(null)); }, []);
  const load = useCallback(() => { api<Detail>(`/activities/${id}${yearId ? `?yearId=${yearId}` : ''}`).then(setD).catch(() => setMissing(true)); }, [id, yearId]);
  useEffect(load, [load]);
  const reset = () => { setErrors({}); setError(null); };
  const run = async (fn: () => Promise<unknown>, done: string, close: () => void) => {
    setBusy(true); reset();
    try { await fn(); toast(done); close(); load(); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  if (missing) return <EmptyState icon="star" title={t('act.notFound')} action={<Link href="/activities" className="btn">{t('act.title')}</Link>} />;
  if (!d) return <SkeletonRows rows={6} />;
  const current = d.years.find((y) => y.id === d.yearId)?.isCurrent ?? false;
  const teams = [...new Set(d.members.map((m) => m.teamName ?? ''))];
  const saveAdd = (e: FormEvent) => { e.preventDefault(); if (add) void run(async () => { const r = await api<{ added: number; already: number }>(`/activities/${d.id}/members`, { method: 'POST', body: JSON.stringify({ studentIds: add.students.map((s) => s.id), teamName: add.teamName || null, memberRole: add.memberRole }) }); if (r.already) toast(t('act.mem.already', { n: r.already })); }, t('act.mem.added'), () => setAdd(null)); };
  const saveMember = (e: FormEvent) => { e.preventDefault(); if (member) void run(() => api(`/activities/members/${member.id}`, { method: 'PUT', body: JSON.stringify({ teamName: member.teamName || null, memberRole: member.memberRole }) }), t('act.saved'), () => setMember(null)); };
  const removeMember = () => { if (member) void run(() => api(`/activities/members/${member.id}`, { method: 'DELETE' }), t('act.mem.removed'), () => setMember(null)); };
  const saveComp = async (e: FormEvent) => {
    e.preventDefault();
    if (!comp) return;
    setBusy(true); reset();
    try { const r = await api<{ id: string }>('/activities/competitions', { method: 'POST', body: JSON.stringify({ ...comp, activityId: d.id, venue: comp.venue || null, description: comp.description || null }) }); toast(t('act.cmp.saved')); router.push(`/activities/competitions/${r.id}`); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const saveEdit = (e: FormEvent) => { e.preventDefault(); if (edit) void run(() => api(`/activities/${d.id}`, { method: 'PUT', body: JSON.stringify({ ...edit, coordinatorEmployeeId: edit.coordinatorEmployeeId || null, description: edit.description || null }) }), t('act.saved'), () => setEdit(null)); };
  return (
    <>
      <Link href="/activities" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('act.title')}</Link>
      <PageHeader eyebrow={t(`act.type.${d.activityType}` as MessageKey)} title={d.name} description={[d.coordinator ? t('act.coordBy', { n: d.coordinator }) : null, d.description, d.isActive ? null : t('act.inactive')].filter(Boolean).join(' · ')}
        actions={d.can.manage && <>
          <button type="button" className="btn btn-ghost" onClick={() => { reset(); setEdit({ campusId: d.campusId, name: d.name, activityType: d.activityType, coordinatorEmployeeId: d.coordinatorEmployeeId ?? '', description: d.description ?? '', isActive: d.isActive }); }}><Icon name="edit" /> {t('act.edit')}</button>
          <button type="button" className="btn" onClick={() => { reset(); setComp({ name: '', level: 'INTRA', venue: '', startDate: todayIST(), endDate: todayIST(), description: '', addToCalendar: true }); }}><Icon name="calendar" /> {t('act.cmp.new')}</button>
          {current && <button type="button" className="btn btn-primary" onClick={() => { reset(); setAdd({ students: [], teamName: '', memberRole: 'MEMBER' }); }}><Icon name="plus" /> {t('act.mem.add')}</button>}
        </>} />

      <section className="card p12-block" aria-labelledby="ac-mem">
        <div className="act-card-head">
          <h2 id="ac-mem" className="section-title">{t('act.mem.title', { n: d.members.length })}</h2>
          {d.years.length > 1 && <label className="inv-f act-year">{t('act.year')}<select value={d.yearId ?? ''} onChange={(e) => setYearId(e.target.value)}>{d.years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</select></label>}
        </div>
        {!d.members.length ? <p className="muted">{t('act.mem.none')}</p> : teams.map((tm) => (
          <div key={tm || 'none'} className="act-team">
            {teams.length > 1 || tm ? <h3 className="small act-team-name">{tm || t('act.mem.noTeam')}</h3> : null}
            <ul className="act-chips">{d.members.filter((m) => (m.teamName ?? '') === tm).map((m) => (
              <li key={m.id}>
                <span><strong>{m.name}</strong><span className="muted small"> · {m.admissionNo}{m.className ? ` · ${m.className}` : ''}</span>{m.memberRole !== 'MEMBER' && <span className="pill pill-info act-role"><span className="pill-dot" />{t(`act.role.${m.memberRole}` as MessageKey)}</span>}</span>
                {d.can.manage && current && <button type="button" className="btn btn-sm btn-ghost icon-btn" aria-label={t('act.editNamed', { n: m.name })} onClick={() => { reset(); setMember({ id: m.id, name: m.name, teamName: m.teamName ?? '', memberRole: m.memberRole }); }}><Icon name="edit" size={14} /></button>}
              </li>
            ))}</ul>
          </div>
        ))}
      </section>

      <section className="card p12-block" aria-labelledby="ac-cmp">
        <h2 id="ac-cmp" className="section-title">{t('act.cmp.title')}</h2>
        {!d.competitions.length ? <p className="muted">{t('act.cmp.none')}</p> : (
          <ul className="p12-action-list">{d.competitions.map((c) => (
            <li key={c.id}>
              <span><Link href={`/activities/competitions/${c.id}`}><strong>{c.name}</strong></Link><span className="sub-line muted small">{t(`act.level.${c.level}` as MessageKey)} · {fmtDay(locale, c.startDate)}{c.endDate !== c.startDate ? ` – ${fmtDay(locale, c.endDate)}` : ''}{c.venue ? ` · ${c.venue}` : ''}</span></span>
              <span className="muted small">{t('act.cmp.summary', { n: c.participants, g: c.winners, s: c.runnersUp, b: c.third })}</span>
            </li>
          ))}</ul>
        )}
      </section>

      <Modal open={!!add} onClose={() => setAdd(null)} title={t('act.mem.add')} subtitle={t('act.mem.addSub', { y: d.years.find((y) => y.isCurrent)?.name ?? '' })} onSubmit={saveAdd} submitLabel={t('act.mem.addBtn', { n: add?.students.length ?? 0 })} busy={busy} error={error} submitDisabled={!add?.students.length} wide>
        {add && <>
          <Field id="am-stu" label={t('act.students')} error={errors.studentIds}><MultiPicker endpoint="/activities/people" value={add.students} onChange={(p) => setAdd({ ...add, students: p })} inputId="am-stu" placeholder={t('act.findStudent')} /></Field>
          <div className="grid-2">
            <Field id="am-team" label={t('act.mem.team')} hint={t('act.optional')} error={errors.teamName}><input id="am-team" value={add.teamName} placeholder={t('act.mem.teamPh')} list="am-teams" onChange={(e) => setAdd({ ...add, teamName: e.target.value })} /><datalist id="am-teams">{teams.filter(Boolean).map((x) => <option key={x} value={x} />)}</datalist></Field>
            <Field id="am-role" label={t('act.mem.role')} error={errors.memberRole}><select id="am-role" value={add.memberRole} onChange={(e) => setAdd({ ...add, memberRole: e.target.value })}>{MEMBER_ROLES.map((r) => <option key={r} value={r}>{t(`act.role.${r}` as MessageKey)}</option>)}</select></Field>
          </div>
        </>}
      </Modal>

      <Modal open={!!member} onClose={() => setMember(null)} title={member?.name ?? ''} onSubmit={saveMember} busy={busy} error={error}>
        {member && <>
          <div className="grid-2">
            <Field id="mm-team" label={t('act.mem.team')} error={errors.teamName}><input id="mm-team" value={member.teamName} onChange={(e) => setMember({ ...member, teamName: e.target.value })} /></Field>
            <Field id="mm-role" label={t('act.mem.role')} error={errors.memberRole}><select id="mm-role" value={member.memberRole} onChange={(e) => setMember({ ...member, memberRole: e.target.value })}>{MEMBER_ROLES.map((r) => <option key={r} value={r}>{t(`act.role.${r}` as MessageKey)}</option>)}</select></Field>
          </div>
          <button type="button" className="btn btn-ghost act-remove" onClick={removeMember} disabled={busy}><Icon name="trash" size={14} /> {t('act.mem.remove')}</button>
        </>}
      </Modal>

      <Modal open={!!comp} onClose={() => setComp(null)} title={t('act.cmp.new')} subtitle={t('act.cmp.newSub', { a: d.name })} onSubmit={saveComp} busy={busy} error={error} wide>
        {comp && <>
          <div className="grid-2">
            <Field id="cp-name" label={t('act.cmp.name')} error={errors.name}><input id="cp-name" value={comp.name} placeholder={t('act.cmp.namePh')} onChange={(e) => setComp({ ...comp, name: e.target.value })} /></Field>
            <Field id="cp-level" label={t('act.cmp.level')} error={errors.level}><select id="cp-level" value={comp.level} onChange={(e) => setComp({ ...comp, level: e.target.value })}>{COMPETITION_LEVELS.map((l) => <option key={l} value={l}>{t(`act.level.${l}` as MessageKey)}</option>)}</select></Field>
          </div>
          <div className="grid-3">
            <Field id="cp-from" label={t('act.cmp.from')} error={errors.startDate}><input id="cp-from" type="date" value={comp.startDate} onChange={(e) => setComp({ ...comp, startDate: e.target.value, endDate: comp.endDate < e.target.value ? e.target.value : comp.endDate })} /></Field>
            <Field id="cp-to" label={t('act.cmp.to')} error={errors.endDate}><input id="cp-to" type="date" min={comp.startDate} value={comp.endDate} onChange={(e) => setComp({ ...comp, endDate: e.target.value })} /></Field>
            <Field id="cp-venue" label={t('act.cmp.venue')} error={errors.venue}><input id="cp-venue" value={comp.venue} onChange={(e) => setComp({ ...comp, venue: e.target.value })} /></Field>
          </div>
          <Field id="cp-desc" label={t('act.description')} hint={t('act.optional')} error={errors.description}><input id="cp-desc" value={comp.description} onChange={(e) => setComp({ ...comp, description: e.target.value })} /></Field>
          <label className="check"><input type="checkbox" checked={comp.addToCalendar} onChange={(e) => setComp({ ...comp, addToCalendar: e.target.checked })} /> {t('act.cmp.calendar')}</label>
        </>}
      </Modal>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={t('act.edit')} onSubmit={saveEdit} busy={busy} error={error}>
        {edit && opts && <ActivityFields form={edit} setForm={setEdit} opts={opts} errors={errors} />}
      </Modal>
    </>
  );
}
