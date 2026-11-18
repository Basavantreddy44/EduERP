'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { todayIST } from '@/components/admissions';

interface Booking { id: string; studentId: string; student: string; admissionNo: string; section: string; parent: string | null; status: string; notes: string | null; feedback: string | null }
interface Slot { id: string; start: string; end: string; room: string | null; isBlocked: boolean; booking: Booking | null }
interface View { session: { id: string; title: string; ptmDate: string; startTime: string; endTime: string; slotMinutes: number; mode: string; classes: string[] }; own: boolean; myEmployeeId: string | null; teachers: { employeeId: string; name: string; slots: Slot[] }[] }

/** One PTM day: every teacher's slots (office) or the signed-in teacher's own, with outcomes and notes. */
export default function PtmDayPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const toast = useToast();
  const [v, setV] = useState<View | null>(null);
  const [missing, setMissing] = useState(false);
  const [teacher, setTeacher] = useState('');
  const [rec, setRec] = useState<{ booking: Booking; slot: Slot } | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<View>(`/engagement/ptm/${id}`).then((x) => { setV(x); setTeacher((cur) => cur || x.teachers[0]?.employeeId || ''); }).catch(() => setMissing(true)); }, [id]);
  useEffect(load, [load]);
  const block = async (s: Slot) => {
    try { await api(`/engagement/ptm/slots/${s.id}`, { method: 'POST', body: JSON.stringify({ blocked: !s.isBlocked }) }); load(); } catch (x) { toast(apiErrors(x).message ?? t('en.failed')); }
  };
  const save = async (status: 'ATTENDED' | 'NO_SHOW', e?: FormEvent) => {
    e?.preventDefault();
    if (!rec) return;
    setBusy(true);
    try { await api(`/engagement/ptm/bookings/${rec.booking.id}/outcome`, { method: 'POST', body: JSON.stringify({ status, notes: notes || null }) }); toast(t('ptm.recorded')); setRec(null); load(); } catch (x) { toast(apiErrors(x).message ?? t('en.failed')); } finally { setBusy(false); }
  };
  if (missing) return <EmptyState icon="users" title={t('ptm.notFound')} action={<Link href="/ptm" className="btn">{t('ptm.title')}</Link>} />;
  if (!v) return <SkeletonRows rows={6} />;
  const s = v.session;
  const day = new Date(`${s.ptmDate}T00:00:00Z`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const onDay = s.ptmDate <= todayIST();
  const tch = v.teachers.find((x) => x.employeeId === teacher);
  const booked = (x: { slots: Slot[] }) => x.slots.filter((y) => y.booking).length;
  return (
    <>
      <Link href="/ptm" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('ptm.title')}</Link>
      <PageHeader eyebrow={t(`ptm.mode.${s.mode}` as MessageKey)} title={s.title} description={`${day} · ${s.startTime}–${s.endTime} · ${s.classes.join(', ')}`} />
      {!v.teachers.length ? <EmptyState icon="users" title={v.own ? t('ptm.noOwn') : t('ptm.noTeachers')} /> : (
        <>
          {!v.own && (
            <ul className="chip-row ptm-teachers" aria-label={t('ac.teachers')}>
              {v.teachers.map((x) => <li key={x.employeeId}><button type="button" className={`chip chip-btn${x.employeeId === teacher ? ' on' : ''}`} aria-pressed={x.employeeId === teacher} onClick={() => setTeacher(x.employeeId)}>{x.name} · {booked(x)}/{x.slots.length}</button></li>)}
            </ul>
          )}
          {tch && (
            <section aria-labelledby="ptm-t">
              <h2 id="ptm-t" className="section-title">{tch.name} · {t('ptm.bookedOf', { n: booked(tch), of: tch.slots.length })}</h2>
              <ol className="ptm-slots">
                {tch.slots.map((x) => (
                  <li key={x.id} className={`card ptm-slot${x.booking ? ' booked' : x.isBlocked ? ' blocked' : ''}`}>
                    <span className="pt-time"><strong>{x.start}</strong><span className="muted small">–{x.end}</span></span>
                    {x.booking ? (
                      <span className="ptm-who">
                        <strong>{x.booking.student}</strong><span className="muted small">{x.booking.section} · {x.booking.admissionNo}{x.booking.parent ? ` · ${t('ptm.parent', { name: x.booking.parent })}` : ''}</span>
                        {x.booking.notes && <span className="small">“{x.booking.notes}”</span>}
                        {x.booking.feedback && <span className="small muted">{t('ptm.feedback')}: “{x.booking.feedback}”</span>}
                      </span>
                    ) : <span className="muted">{x.isBlocked ? t('ptm.blocked') : t('ptm.free')}</span>}
                    <span className="row-actions">
                      {x.booking && <span className={`pill ${x.booking.status === 'ATTENDED' ? 'pill-ok' : x.booking.status === 'NO_SHOW' ? 'pill-bad' : 'pill-info'}`}>{t(`ptm.status.${x.booking.status}` as MessageKey)}</span>}
                      {x.booking && onDay && <button type="button" className="btn btn-sm" onClick={() => { setNotes(x.booking!.notes ?? ''); setRec({ booking: x.booking!, slot: x }); }}>{t('ptm.record')}</button>}
                      {!x.booking && !onDay && <button type="button" className="btn btn-sm btn-ghost" onClick={() => void block(x)}>{x.isBlocked ? t('ptm.unblock') : t('ptm.block')}</button>}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}
      <Modal open={!!rec} onClose={() => setRec(null)} title={t('ptm.recordTitle', { name: rec?.booking.student ?? '' })} subtitle={rec ? `${rec.slot.start}–${rec.slot.end}` : undefined} onSubmit={(e) => void save('ATTENDED', e)} submitLabel={t('ptm.attended')} busy={busy}>
        <Field id="ptm-notes" label={t('ptm.notes')} hint={t('ptm.notesHint')}><textarea id="ptm-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <button type="button" className="btn btn-ghost" onClick={() => void save('NO_SHOW')} disabled={busy}>{t('ptm.noShow')}</button>
      </Modal>
    </>
  );
}
