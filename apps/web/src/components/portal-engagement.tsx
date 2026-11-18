'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatINR, toPaise } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { EmptyState, SkeletonRows, useToast } from '@/components/ui';
import { todayIST } from '@/components/admissions';
import { CalendarMonth, CalItem } from '@/components/calendar';

interface Ev { id: string; title: string; description: string | null; eventType: string; startDate: string; endDate: string; startTime: string | null; endTime: string | null; venue: string | null; registrationRequired: boolean; maxParticipants: number | null; requiresConsent: boolean; feeAmount: string | null; response: string | null; billed: boolean; attended: boolean | null }

/** The child's events (answer going / not going, consent) and calendar. */
export function ChildEvents({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [rows, setRows] = useState<Ev[] | null>(null);
  const [view, setView] = useState<'events' | 'calendar'>('events');
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => { api<Ev[]>(`/portal/children/${id}/events`).then(setRows).catch(() => setRows([])); }, [id]);
  useEffect(load, [load]);
  const answer = async (e: Ev, going: boolean) => {
    setBusy(e.id);
    try { const r = await api<{ billed: string | null }>(`/portal/children/${id}/events/${e.id}`, { method: 'POST', body: JSON.stringify({ going }) }); toast(r.billed ? t('pt.ev.billed', { amount: formatINR(toPaise(r.billed)) }) : t('pt.ev.saved')); load(); }
    catch (x) { toast(apiErrors(x).message ?? t('en.failed')); } finally { setBusy(null); }
  };
  const d = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const today = todayIST();
  return (
    <>
      <div className="tabs pt-subtabs" role="tablist" aria-label={t('pt.tab.events')}>
        {(['events', 'calendar'] as const).map((x) => <button key={x} type="button" role="tab" aria-selected={view === x} className={view === x ? 'on' : ''} onClick={() => setView(x)}>{t(x === 'events' ? 'pt.ev.list' : 'pt.ev.calendar')}</button>)}
      </div>
      {view === 'calendar' ? <CalendarMonth load={(from, to) => api<CalItem[]>(`/portal/children/${id}/calendar?from=${from}&to=${to}`)} />
        : !rows ? <SkeletonRows rows={3} /> : !rows.length ? <EmptyState icon="calendar" title={t('pt.ev.none')} text={t('pt.ev.noneHint')} /> : (
          <ul className="pt-hw-list">
            {rows.map((e) => {
              const ask = (e.registrationRequired || e.requiresConsent) && e.startDate >= today;
              return (
                <li key={e.id} className="card pt-event">
                  <div className="pt-hw-head"><span className="hw-subject">{t(`ev.type.${e.eventType}` as MessageKey)}</span><span className="muted small">{d(e.startDate)}{e.endDate !== e.startDate ? ` – ${d(e.endDate)}` : ''}</span></div>
                  <strong className="hw-title">{e.title}</strong>
                  <span className="muted small">{e.startTime ? `${e.startTime}${e.endTime ? `–${e.endTime}` : ''}` : ''}{e.venue ? `${e.startTime ? ' · ' : ''}${e.venue}` : ''}</span>
                  {e.description && <p className="hw-desc">{e.description}</p>}
                  {e.feeAmount && <p className="small"><Icon name="rupee" size={14} /> {t('pt.ev.fee', { amount: formatINR(toPaise(e.feeAmount)) })}</p>}
                  {e.response && <p className={`pt-hw-done${e.response === 'GOING' ? '' : ' muted'}`}><Icon name={e.response === 'GOING' ? 'check' : 'x'} size={16} /> {t(e.response === 'GOING' ? (e.requiresConsent ? 'pt.ev.consented' : 'pt.ev.going') : 'pt.ev.notGoing')}{e.billed ? ` · ${t('pt.ev.billedShort')}` : ''}</p>}
                  {ask && !e.billed && (
                    <span className="row-actions">
                      {e.response !== 'GOING' && <button type="button" className="btn btn-sm btn-primary" disabled={busy === e.id} onClick={() => void answer(e, true)}>{t(e.requiresConsent ? 'pt.ev.giveConsent' : 'pt.ev.register')}</button>}
                      {e.response !== 'NOT_GOING' && <button type="button" className="btn btn-sm" disabled={busy === e.id} onClick={() => void answer(e, false)}>{t('pt.ev.decline')}</button>}
                    </span>
                  )}
                  {e.attended !== null && <p className="muted small">{t(e.attended ? 'pt.ev.attended' : 'pt.ev.absent')}</p>}
                </li>
              );
            })}
          </ul>
        )}
    </>
  );
}

interface PtmTeacher { employeeId: string; name: string; roles: string[]; booking: { id: string; start: string; end: string; room: string | null; status: string; feedback: string | null } | null; free: { id: string; start: string; end: string }[] }
interface PtmDay { id: string; title: string; ptmDate: string; startTime: string; endTime: string; mode: string; bookingOpens: string; bookingCloses: string; open: boolean; teachers: PtmTeacher[] }

/** Parent-teacher meetings: book a time with each teacher, cancel, and leave feedback after. */
export function ChildPtm({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [days, setDays] = useState<PtmDay[] | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [fb, setFb] = useState<Record<string, string>>({});
  const load = useCallback(() => { api<PtmDay[]>(`/portal/children/${id}/ptm`).then(setDays).catch(() => setDays([])); }, [id]);
  useEffect(load, [load]);
  const book = async (teacher: PtmTeacher) => {
    const slotId = pick[teacher.employeeId] ?? teacher.free[0]?.id;
    if (!slotId) return;
    try { await api(`/portal/children/${id}/ptm/book`, { method: 'POST', body: JSON.stringify({ slotId }) }); toast(t('pt.ptm.booked', { name: teacher.name })); load(); } catch (x) { toast(apiErrors(x).message ?? t('en.failed')); load(); }
  };
  const cancel = async (bid: string) => {
    try { await api(`/portal/children/${id}/ptm/bookings/${bid}/cancel`, { method: 'POST', body: '{}' }); toast(t('pt.ptm.cancelled')); load(); } catch (x) { toast(apiErrors(x).message ?? t('en.failed')); }
  };
  const feedback = async (bid: string) => {
    try { await api(`/portal/children/${id}/ptm/bookings/${bid}/feedback`, { method: 'POST', body: JSON.stringify({ feedback: fb[bid] }) }); toast(t('pt.ptm.thanks')); load(); } catch (x) { toast(apiErrors(x).message ?? t('en.failed')); }
  };
  const d = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const when = (s: string) => new Date(s).toLocaleString(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const today = todayIST();
  if (!days) return <SkeletonRows rows={3} />;
  if (!days.length) return <EmptyState icon="users" title={t('pt.ptm.none')} text={t('pt.ptm.noneHint')} />;
  return (
    <>
      {days.map((s) => (
        <section key={s.id} className="pt-ptm" aria-labelledby={`ptm-${s.id}`}>
          <h2 id={`ptm-${s.id}`} className="section-title first">{s.title}</h2>
          <p className="muted small">{d(s.ptmDate)} · {s.startTime}–{s.endTime} · {t(`ptm.mode.${s.mode}` as MessageKey)}</p>
          {!s.open && s.ptmDate >= today && <p className="notice"><Icon name="clock" /> {Date.now() < Date.parse(s.bookingOpens) ? t('pt.ptm.opens', { when: when(s.bookingOpens) }) : t('pt.ptm.closed')}</p>}
          <ul className="pt-hw-list">
            {s.teachers.map((x) => (
              <li key={x.employeeId} className="card pt-ptm-teacher">
                <strong>{x.name}</strong>
                <span className="muted small">{x.roles.map((r) => (r === 'CLASS_TEACHER' ? t('ac.classTeacher') : r)).join(' · ')}</span>
                {x.booking ? (
                  <>
                    <p className="pt-hw-done"><Icon name="check" size={16} /> {t('pt.ptm.yourTime', { start: x.booking.start, end: x.booking.end })}{x.booking.room ? ` · ${x.booking.room}` : ''}</p>
                    {x.booking.status === 'BOOKED' && s.ptmDate > today && <button type="button" className="btn btn-sm" onClick={() => void cancel(x.booking!.id)}>{t('pt.ptm.cancel')}</button>}
                    {x.booking.status === 'ATTENDED' && (x.booking.feedback ? <p className="muted small">{t('ptm.feedback')}: “{x.booking.feedback}”</p> : (
                      <span className="pt-fb"><label className="sr-only" htmlFor={`fb-${x.booking.id}`}>{t('pt.ptm.feedback')}</label><input id={`fb-${x.booking.id}`} placeholder={t('pt.ptm.feedback')} value={fb[x.booking.id] ?? ''} onChange={(e) => setFb((f) => ({ ...f, [x.booking!.id]: e.target.value }))} /><button type="button" className="btn btn-sm" disabled={(fb[x.booking.id] ?? '').trim().length < 2} onClick={() => void feedback(x.booking!.id)}>{t('en.send')}</button></span>
                    ))}
                  </>
                ) : s.open ? (
                  x.free.length ? (
                    <span className="pt-book">
                      <label className="sr-only" htmlFor={`sl-${s.id}-${x.employeeId}`}>{t('pt.ptm.chooseTime', { name: x.name })}</label>
                      <select id={`sl-${s.id}-${x.employeeId}`} value={pick[x.employeeId] ?? x.free[0].id} onChange={(e) => setPick((p) => ({ ...p, [x.employeeId]: e.target.value }))}>{x.free.map((f) => <option key={f.id} value={f.id}>{f.start}–{f.end}</option>)}</select>
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => void book(x)}>{t('pt.ptm.book')}</button>
                    </span>
                  ) : <p className="muted small">{t('pt.ptm.full')}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
