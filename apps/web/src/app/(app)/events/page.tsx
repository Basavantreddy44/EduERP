'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { EVENT_TYPES, PERMISSIONS, formatINR, toPaise } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { todayIST } from '@/components/admissions';
import { useAcadSections } from '@/components/academics';
import { AudiencePicker, Target } from '@/components/engagement';
import { CalendarMonth, CalItem } from '@/components/calendar';

interface EventRow { id: string; campusId: string | null; title: string; eventType: string; startDate: string; endDate: string; startTime: string | null; venue: string | null; registrationRequired: boolean; maxParticipants: number | null; requiresConsent: boolean; feeAmount: string | null; status: string; going: number; notGoing: number }
interface FeeOptions { heads: { id: string; name: string; status: string }[] }

/** Engagement → Events & calendar (M11.2). */
export default function EventsPage() {
  const { can } = useSession();
  const { t, locale } = useI18n();
  const toast = useToast();
  const manage = can(PERMISSIONS.EVENT_MANAGE);
  const sections = useAcadSections();
  const campuses = useMemo(() => [...new Map((sections ?? []).map((s) => [s.campusId, s.campus])).entries()], [sections]);
  const [tab, setTab] = useState<'list' | 'calendar'>('list');
  const [rows, setRows] = useState<EventRow[] | null>(null);
  const [heads, setHeads] = useState<FeeOptions['heads']>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [targets, setTargets] = useState<Target[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<EventRow[]>('/engagement/events').then(setRows).catch(() => setRows([])); }, []);
  useEffect(load, [load]);
  const start = () => {
    setForm({ campusId: campuses.length === 1 ? campuses[0][0] : '', title: '', eventType: 'CULTURAL', startDate: todayIST(), endDate: todayIST(), startTime: '', endTime: '', venue: '', description: '', registrationRequired: false, maxParticipants: '', requiresConsent: false, feeHeadId: '', feeAmount: '', publish: true });
    setTargets([{ targetType: 'ALL' }]); setErrors({}); setError(null); setOpen(true);
    api<FeeOptions>('/fees/setup/options').then((o) => setHeads(o.heads.filter((h) => h.status === 'ACTIVE'))).catch(() => setHeads([]));
  };
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    const body = { ...form, campusId: form.campusId || null, startTime: form.startTime || null, endTime: form.endTime || null, venue: form.venue || null, description: form.description || null, maxParticipants: form.maxParticipants || null, feeHeadId: form.feeHeadId || null, feeAmount: form.feeAmount || null, targets };
    try { const r = await api<{ id: string }>('/engagement/events', { method: 'POST', body: JSON.stringify(body) }); toast(t('ev.added')); setOpen(false); window.location.href = `/events/${r.id}`; }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const d = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const today = todayIST();
  const upcoming = (rows ?? []).filter((r) => r.endDate >= today);
  const past = (rows ?? []).filter((r) => r.endDate < today).reverse();
  const row = (r: EventRow) => (
    <li key={r.id}>
      <Link href={`/events/${r.id}`} className={`card ev-card${r.status !== 'PUBLISHED' ? ' not-live' : ''}`}>
        <span className="ev-date"><strong>{new Date(`${r.startDate}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', timeZone: 'UTC' })}</strong><span>{new Date(`${r.startDate}T00:00:00Z`).toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' })}</span></span>
        <span className="ev-main">
          <span className="hw-subject">{t(`ev.type.${r.eventType}` as MessageKey)}{r.status !== 'PUBLISHED' ? ` · ${t(`ev.status.${r.status}` as MessageKey)}` : ''}</span>
          <strong className="hw-title">{r.title}</strong>
          <span className="muted small">{d(r.startDate)}{r.endDate !== r.startDate ? ` – ${d(r.endDate)}` : ''}{r.startTime ? ` · ${r.startTime}` : ''}{r.venue ? ` · ${r.venue}` : ''}</span>
        </span>
        <span className="ev-side">
          {r.feeAmount && <span className="pill pill-info">{formatINR(toPaise(r.feeAmount))}</span>}
          {(r.registrationRequired || r.requiresConsent) && <span className="small">{t('ev.goingN', { n: r.going })}{r.maxParticipants ? ` / ${r.maxParticipants}` : ''}</span>}
        </span>
      </Link>
    </li>
  );

  return (
    <>
      <PageHeader eyebrow={t('nav.engagement')} title={t('ev.title')} description={t('ev.desc')} actions={manage && <button type="button" className="btn btn-primary" onClick={start} disabled={!sections}><Icon name="plus" /> {t('ev.add')}</button>} />
      <div className="tabs" role="tablist" aria-label={t('ev.title')}>
        {(['list', 'calendar'] as const).map((x) => <button key={x} type="button" role="tab" id={`tab-${x}`} aria-selected={tab === x} aria-controls={`panel-${x}`} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(`ev.tab.${x}` as MessageKey)}</button>)}
      </div>
      <section role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="ac-panel">
        {tab === 'calendar' ? <CalendarMonth load={(from, to) => api<CalItem[]>(`/engagement/calendar?from=${from}&to=${to}`)} link={(i) => (i.kind === 'EVENT' && i.id ? `/events/${i.id}` : i.kind === 'PTM' && i.id ? `/ptm/${i.id}` : null)} />
          : !rows ? <SkeletonRows rows={4} /> : !rows.length ? <EmptyState icon="calendar" title={t('ev.none')} text={manage ? t('ev.noneHint') : undefined} /> : (
            <>
              <h2 className="section-title first">{t('ev.upcoming')}</h2>
              {upcoming.length ? <ul className="ev-list">{upcoming.map(row)}</ul> : <p className="muted">{t('ev.noUpcoming')}</p>}
              {past.length > 0 && <><h2 className="section-title">{t('ev.past')}</h2><ul className="ev-list">{past.map(row)}</ul></>}
            </>
          )}
      </section>
      <Modal open={open} onClose={() => setOpen(false)} title={t('ev.add')} onSubmit={save} submitLabel={form.publish ? t('ev.publish') : t('sm.saveDraft')} busy={busy} error={error} wide>
        <div className="grid-2">
          <Field id="ev-title" label={t('ev.name')} error={errors.title}><input id="ev-title" value={String(form.title ?? '')} onChange={set('title')} placeholder={t('ev.namePh')} /></Field>
          <Field id="ev-type" label={t('ev.kind')}><select id="ev-type" value={String(form.eventType)} onChange={set('eventType')}>{EVENT_TYPES.map((x) => <option key={x} value={x}>{t(`ev.type.${x}` as MessageKey)}</option>)}</select></Field>
        </div>
        <div className="grid-2">
          <Field id="ev-start" label={t('ex.from')} error={errors.startDate}><input id="ev-start" type="date" value={String(form.startDate)} onChange={set('startDate')} /></Field>
          <Field id="ev-end" label={t('ex.to')} error={errors.endDate}><input id="ev-end" type="date" min={String(form.startDate)} value={String(form.endDate)} onChange={set('endDate')} /></Field>
        </div>
        <div className="grid-2">
          <Field id="ev-st" label={t('ex.sched.from')} error={errors.startTime}><input id="ev-st" type="time" value={String(form.startTime)} onChange={set('startTime')} /></Field>
          <Field id="ev-et" label={t('ex.sched.to')} error={errors.endTime}><input id="ev-et" type="time" value={String(form.endTime)} onChange={set('endTime')} /></Field>
        </div>
        <div className="grid-2">
          <Field id="ev-venue" label={t('ev.venue')}><input id="ev-venue" value={String(form.venue ?? '')} onChange={set('venue')} /></Field>
          {campuses.length > 1 && <Field id="ev-campus" label={t('common.campus')} error={errors.campusId}><select id="ev-campus" value={String(form.campusId)} onChange={set('campusId')}><option value="">{t('ev.allCampuses')}</option>{campuses.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></Field>}
        </div>
        <Field id="ev-desc" label={t('ev.about')}><textarea id="ev-desc" rows={3} value={String(form.description ?? '')} onChange={set('description')} /></Field>
        {sections && <AudiencePicker sections={sections} value={targets} onChange={setTargets} error={errors.targets} />}
        <fieldset className="check-group"><legend>{t('ev.replies')}</legend>
          <label className="check"><input type="checkbox" checked={!!form.registrationRequired} onChange={(e) => setForm((f) => ({ ...f, registrationRequired: e.target.checked }))} /> {t('ev.registration')}</label>
          <label className="check"><input type="checkbox" checked={!!form.requiresConsent} onChange={(e) => setForm((f) => ({ ...f, requiresConsent: e.target.checked }))} /> {t('ev.consent')}</label>
        </fieldset>
        {(form.registrationRequired || form.requiresConsent) && (
          <div className="grid-2">
            <Field id="ev-max" label={t('ev.max')} hint={t('ev.maxHint')} error={errors.maxParticipants}><input id="ev-max" type="number" min={1} value={String(form.maxParticipants ?? '')} onChange={set('maxParticipants')} /></Field>
            <Field id="ev-fee" label={t('ev.fee')} hint={t('ev.feeHint')} error={errors.feeAmount}><input id="ev-fee" type="number" min={0} value={String(form.feeAmount ?? '')} onChange={set('feeAmount')} /></Field>
          </div>
        )}
        {form.feeAmount && <Field id="ev-head" label={t('ev.feeHead')} error={errors.feeHeadId}><select id="ev-head" value={String(form.feeHeadId)} onChange={set('feeHeadId')}><option value="">—</option>{heads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>}
        <label className="check"><input type="checkbox" checked={!!form.publish} onChange={(e) => setForm((f) => ({ ...f, publish: e.target.checked }))} /> {t('ev.publishNow')}</label>
      </Modal>
    </>
  );
}
