'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PERMISSIONS, PTM_MODES } from '@eduerp/shared';
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

interface Row { id: string; title: string; ptmDate: string; startTime: string; endTime: string; slotMinutes: number; mode: string; bookingOpens: string; bookingCloses: string; status: string; slots: number; booked: number }
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Engagement → Parent-teacher meetings (M11.3): PTM days and how full they are. */
export default function PtmPage() {
  const { can } = useSession();
  const { t, locale } = useI18n();
  const toast = useToast();
  const manage = can(PERMISSIONS.PTM_MANAGE);
  const sections = useAcadSections();
  const campuses = useMemo(() => [...new Map((sections ?? []).map((s) => [s.campusId, s.campus])).entries()], [sections]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [levels, setLevels] = useState<string[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Row[]>('/engagement/ptm').then(setRows).catch(() => setRows([])); }, []);
  useEffect(load, [load]);
  const classes = useMemo(() => [...new Map((sections ?? []).filter((s) => s.campusId === form.campusId).map((s) => [s.programLevelId, `${s.program} · ${s.name.split(' – ')[0]}`])).entries()], [sections, form.campusId]);
  const start = () => {
    const d = shift(todayIST(), 7);
    setForm({ campusId: campuses[0]?.[0] ?? '', title: '', ptmDate: d, startTime: '09:30', endTime: '12:30', slotMinutes: '10', mode: 'IN_PERSON', opensDate: todayIST(), opensTime: '09:00', closesDate: shift(d, -1), closesTime: '18:00' });
    setLevels([]); setErrors({}); setError(null); setOpen(true);
  };
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    const body = { campusId: form.campusId, title: form.title, ptmDate: form.ptmDate, startTime: form.startTime, endTime: form.endTime, slotMinutes: form.slotMinutes, mode: form.mode, bookingOpens: `${form.opensDate}T${form.opensTime}:00+05:30`, bookingCloses: `${form.closesDate}T${form.closesTime}:00+05:30`, programLevelIds: levels };
    try { const r = await api<{ id: string; teachers: number; slots: number }>('/engagement/ptm', { method: 'POST', body: JSON.stringify(body) }); toast(t('ptm.added', { n: r.teachers, s: r.slots })); setOpen(false); window.location.href = `/ptm/${r.id}`; }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const d = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const when = (s: string) => new Date(s).toLocaleString(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const now = Date.now();
  return (
    <>
      <PageHeader eyebrow={t('nav.engagement')} title={t('ptm.title')} description={t('ptm.desc')} actions={manage && <button type="button" className="btn btn-primary" onClick={start} disabled={!sections}><Icon name="plus" /> {t('ptm.add')}</button>} />
      {!rows ? <SkeletonRows rows={4} /> : !rows.length ? <EmptyState icon="users" title={t('ptm.none')} text={manage ? t('ptm.noneHint') : undefined} /> : (
        <ul className="ev-list">
          {rows.map((r) => {
            const state = now < Date.parse(r.bookingOpens) ? 'SOON' : now <= Date.parse(r.bookingCloses) ? 'OPEN' : 'CLOSED';
            return (
              <li key={r.id}>
                <Link href={`/ptm/${r.id}`} className="card ev-card">
                  <span className="ev-date"><strong>{new Date(`${r.ptmDate}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', timeZone: 'UTC' })}</strong><span>{new Date(`${r.ptmDate}T00:00:00Z`).toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' })}</span></span>
                  <span className="ev-main"><strong className="hw-title">{r.title}</strong><span className="muted small">{d(r.ptmDate)} · {r.startTime}–{r.endTime} · {t('ptm.slotMin', { n: r.slotMinutes })} · {t(`ptm.mode.${r.mode}` as MessageKey)}</span></span>
                  <span className="ev-side">
                    <span className={`pill ${state === 'OPEN' ? 'pill-ok' : state === 'SOON' ? 'pill-info' : 'pill-muted'}`}>{t(`ptm.booking.${state}` as MessageKey, { when: when(state === 'SOON' ? r.bookingOpens : r.bookingCloses) })}</span>
                    <span className="small">{t('ptm.bookedOf', { n: r.booked, of: r.slots })}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('ptm.add')} subtitle={t('ptm.addSub')} onSubmit={save} submitLabel={t('ptm.create')} busy={busy} error={error} wide>
        <div className="grid-2">
          <Field id="pt-title" label={t('ev.name')} error={errors.title}><input id="pt-title" value={form.title ?? ''} onChange={set('title')} placeholder={t('ptm.namePh')} /></Field>
          {campuses.length > 1 && <Field id="pt-campus" label={t('common.campus')}><select id="pt-campus" value={form.campusId} onChange={(e) => { set('campusId')(e); setLevels([]); }}>{campuses.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></Field>}
        </div>
        <div className="grid-3">
          <Field id="pt-date" label={t('lp.date')} error={errors.ptmDate}><input id="pt-date" type="date" min={todayIST()} value={form.ptmDate ?? ''} onChange={set('ptmDate')} /></Field>
          <Field id="pt-start" label={t('ex.sched.from')} error={errors.startTime}><input id="pt-start" type="time" value={form.startTime ?? ''} onChange={set('startTime')} /></Field>
          <Field id="pt-end" label={t('ex.sched.to')} error={errors.endTime}><input id="pt-end" type="time" value={form.endTime ?? ''} onChange={set('endTime')} /></Field>
        </div>
        <div className="grid-2">
          <Field id="pt-slot" label={t('ptm.slotLabel')} error={errors.slotMinutes}><select id="pt-slot" value={form.slotMinutes} onChange={set('slotMinutes')}>{[5, 10, 15, 20, 30].map((n) => <option key={n} value={n}>{t('ptm.slotMin', { n })}</option>)}</select></Field>
          <Field id="pt-mode" label={t('ptm.modeLabel')}><select id="pt-mode" value={form.mode} onChange={set('mode')}>{PTM_MODES.map((m) => <option key={m} value={m}>{t(`ptm.mode.${m}` as MessageKey)}</option>)}</select></Field>
        </div>
        <div className="grid-2">
          <Field id="pt-od" label={t('ptm.opens')} error={errors.bookingOpens}><span className="dt-pair"><input id="pt-od" type="date" value={form.opensDate ?? ''} onChange={set('opensDate')} /><input aria-label={t('ptm.opensTime')} type="time" value={form.opensTime ?? ''} onChange={set('opensTime')} /></span></Field>
          <Field id="pt-cd" label={t('ptm.closes')} error={errors.bookingCloses}><span className="dt-pair"><input id="pt-cd" type="date" value={form.closesDate ?? ''} onChange={set('closesDate')} /><input aria-label={t('ptm.closesTime')} type="time" value={form.closesTime ?? ''} onChange={set('closesTime')} /></span></Field>
        </div>
        <fieldset className="check-group"><legend>{t('ptm.classes')}</legend>
          {classes.map(([id, n]) => <label key={id} className="check"><input type="checkbox" checked={levels.includes(id)} onChange={(e) => setLevels((l) => (e.target.checked ? [...l, id] : l.filter((x) => x !== id)))} /> {n}</label>)}
          {errors.programLevelIds && <span className="field-error">{errors.programLevelIds}</span>}
        </fieldset>
        <p className="muted small">{t('ptm.slotsHint')}</p>
      </Modal>
    </>
  );
}
