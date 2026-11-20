'use client';

import { useEffect, useState } from 'react';
import { ACTIVITY_TYPES } from '@eduerp/shared';
import type { FieldErrors } from '@/lib/form';
import { Field } from '@/components/Modal';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { EmptyState, SkeletonRows } from '@/components/ui';
import type { Person } from '@/components/campuslife';

/** Phase 18: labs, and sports & activities — shared bits. */

export const fmtDay = (locale: string, x: string | null | undefined) => (x ? new Date(`${x.slice(0, 10)}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');

const TONE: Record<string, string> = {
  SCHEDULED: 'pill-info', COMPLETED: 'pill-ok', CANCELLED: 'pill-muted',
  REPORTED: 'pill-warn', PENDING_APPROVAL: 'pill-warn', CHARGED: 'pill-bad', WAIVED: 'pill-muted',
  WORKING: 'pill-ok', NEEDS_REPAIR: 'pill-warn', DAMAGED: 'pill-bad', DISPOSED: 'pill-muted',
  OK: 'pill-ok', DUE: 'pill-warn', OVERDUE: 'pill-bad',
  WINNER: 'pill-ok', RUNNER_UP: 'pill-info', THIRD: 'pill-info', SPECIAL: 'pill-info', PARTICIPATED: 'pill-muted',
};
/** Status pill with a translated label (prefix + status). */
export function ActPill({ prefix, status }: { prefix: string; status: string }) {
  const { t } = useI18n();
  return <span className={`pill ${TONE[status] ?? 'pill-muted'}`}><span className="pill-dot" />{t(`${prefix}.${status}` as MessageKey)}</span>;
}

/** Picks several students (or staff) through a module's own search. */
export function MultiPicker({ endpoint, value, onChange, inputId, placeholder, single = false }: { endpoint: string; value: Person[]; onChange: (p: Person[]) => void; inputId: string; placeholder: string; single?: boolean }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Person[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const h = window.setTimeout(() => { api<Person[]>(`${endpoint}${endpoint.includes('?') ? '&' : '?'}q=${encodeURIComponent(q)}`).then(setHits).catch(() => setHits([])); }, 250);
    return () => window.clearTimeout(h);
  }, [q, endpoint]);
  const add = (p: Person) => { onChange(single ? [p] : value.some((v) => v.id === p.id) ? value : [...value, p]); setQ(''); setHits([]); };
  return (
    <div className="act-picker">
      {value.length > 0 && (
        <ul className="act-chips" aria-label={t('act.chosen')}>
          {value.map((p) => (
            <li key={p.id}><span>{p.name}<span className="muted small"> · {p.code}{p.detail ? ` · ${p.detail}` : ''}</span></span>
              <button type="button" className="btn btn-sm btn-ghost icon-btn" aria-label={t('act.removeNamed', { n: p.name })} onClick={() => onChange(value.filter((v) => v.id !== p.id))}><Icon name="x" size={14} /></button></li>
          ))}
        </ul>
      )}
      {(!single || !value.length) && (
        <div className="leave-search">
          <input id={inputId} className="input" type="search" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
          {hits.length > 0 && (
            <ul className="leave-hits" role="listbox" aria-label={t('leave.results')}>
              {hits.map((h) => <li key={`${h.type}-${h.id}`}><button type="button" role="option" aria-selected={value.some((v) => v.id === h.id)} onClick={() => add(h)}><strong>{h.name}</strong><span className="muted small">{h.type === 'EMPLOYEE' ? t('cl.staff') : t('cl.student')} · {h.code}{h.detail ? ` · ${h.detail}` : ''}</span></button></li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export interface StudentActivityView {
  activities: { id: string; name: string; activityType: string; teamName: string | null; memberRole: string }[];
  competitions: { id: string; name: string; level: string; date: string | null; category: string; result: string }[];
  achievements: { id: string; title: string; category: string; level: string; achievementDate: string | null; description: string | null }[];
}

/** A student's activities, competition entries and verified achievements (student profile and parent app). */
export function StudentActivities({ path }: { path: string }) {
  const { t, locale } = useI18n();
  const [v, setV] = useState<StudentActivityView | null>(null);
  useEffect(() => { api<StudentActivityView>(path).then(setV).catch(() => setV({ activities: [], competitions: [], achievements: [] })); }, [path]);
  if (!v) return <SkeletonRows rows={3} />;
  if (!v.activities.length && !v.competitions.length && !v.achievements.length) return <EmptyState icon="star" title={t('act.stu.none')} text={t('act.stu.noneHint')} />;
  return (
    <div className="act-student">
      {v.achievements.length > 0 && (
        <section aria-labelledby="act-ach-h">
          <h3 id="act-ach-h" className="card-title">{t('act.stu.achievements')}</h3>
          <ul className="act-awards">{v.achievements.map((a) => (
            <li key={a.id}>
              <span className="act-medal" aria-hidden><Icon name="star" size={18} /></span>
              <span><strong>{a.title}</strong><span className="sub-line muted small">{t(`act.level.${a.level}` as MessageKey)} · {t(`act.cat.${a.category}` as MessageKey)} · {fmtDay(locale, a.achievementDate)}</span>{a.description && <span className="sub-line small">{a.description}</span>}</span>
            </li>
          ))}</ul>
        </section>
      )}
      {v.activities.length > 0 && (
        <section aria-labelledby="act-mem-h">
          <h3 id="act-mem-h" className="card-title">{t('act.stu.activities')}</h3>
          <ul className="act-chips act-chips-static">{v.activities.map((a) => (
            <li key={a.id}><span><strong>{a.name}</strong><span className="muted small"> · {t(`act.type.${a.activityType}` as MessageKey)}{a.teamName ? ` · ${a.teamName}` : ''}{a.memberRole !== 'MEMBER' ? ` · ${t(`act.role.${a.memberRole}` as MessageKey)}` : ''}</span></span></li>
          ))}</ul>
        </section>
      )}
      {v.competitions.length > 0 && (
        <section aria-labelledby="act-cmp-h">
          <h3 id="act-cmp-h" className="card-title">{t('act.stu.competitions')}</h3>
          <ul className="p12-action-list">{v.competitions.map((c) => (
            <li key={c.id}><span>{c.name}<span className="sub-line muted small">{t(`act.level.${c.level}` as MessageKey)}{c.category ? ` · ${c.category}` : ''} · {fmtDay(locale, c.date)}</span></span><ActPill prefix="act.res" status={c.result} /></li>
          ))}</ul>
        </section>
      )}
    </div>
  );
}

export interface ActOpts { campuses: { id: string; name: string }[]; staff: { id: string; name: string; campusId: string }[]; year: { id: string; name: string } | null; can: { manage: boolean; add: boolean } }
export const blankActivity = { campusId: '', name: '', activityType: 'SPORT', coordinatorEmployeeId: '', description: '', isActive: true };

/** Activity form fields (new and edit). */
export function ActivityFields({ form, setForm, opts, errors }: { form: typeof blankActivity; setForm: (f: typeof blankActivity) => void; opts: ActOpts; errors: FieldErrors }) {
  const { t } = useI18n();
  return (
    <>
      <div className="grid-2">
        <Field id="ac-name" label={t('act.name')} error={errors.name}><input id="ac-name" value={form.name} placeholder={t('act.namePh')} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field id="ac-type" label={t('act.kind')} error={errors.activityType}><select id="ac-type" value={form.activityType} onChange={(e) => setForm({ ...form, activityType: e.target.value })}>{ACTIVITY_TYPES.map((x) => <option key={x} value={x}>{t(`act.type.${x}` as MessageKey)}</option>)}</select></Field>
      </div>
      <div className="grid-2">
        {opts.campuses.length > 1 && <Field id="ac-campus" label={t('act.campus')} error={errors.campusId}><select id="ac-campus" value={form.campusId} onChange={(e) => setForm({ ...form, campusId: e.target.value, coordinatorEmployeeId: '' })}>{opts.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
        <Field id="ac-coord" label={t('act.coordinator')} error={errors.coordinatorEmployeeId}><select id="ac-coord" value={form.coordinatorEmployeeId} onChange={(e) => setForm({ ...form, coordinatorEmployeeId: e.target.value })}><option value="">—</option>{opts.staff.filter((s) => s.campusId === form.campusId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      </div>
      <Field id="ac-desc" label={t('act.description')} hint={t('act.optional')} error={errors.description}><input id="ac-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
      <label className="check"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> {t('act.active')}</label>
    </>
  );
}
