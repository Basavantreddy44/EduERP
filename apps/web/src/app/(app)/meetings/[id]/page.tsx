'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { todayIST } from '@/components/admissions';
import { Pill, useWhen } from '@/components/engagement2';

interface Person { employeeId: string; name: string; designation: string | null; rsvp: string; attended: boolean | null }
interface ActionRow { id: string; description: string; ownerEmployeeId: string; owner: string; dueDate: string; status: string; note: string | null; overdue: boolean }
interface View {
  meeting: { id: string; title: string; meetingType: string; startAt: string; endAt: string; venue: string | null; meetingLink: string | null; status: string; organiser: string; committee: string | null };
  myEmployeeId: string | null; canRecord: boolean; canApprove: boolean;
  agenda: { itemNo: number; title: string }[];
  participants: Person[];
  minutes: { text: string | null; status: string; recordedBy: string | null; approvedBy: string | null; approvedAt: string | null } | null;
  actions: ActionRow[];
}
const shift = (n: number) => new Date(Date.parse(`${todayIST()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** One meeting: details, invitations, attendance, minutes (draft → circulated → approved) and action items. */
export default function MeetingPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const toast = useToast();
  const w = useWhen();
  const [v, setV] = useState<View | null>(null);
  const [missing, setMissing] = useState(false);
  const [text, setText] = useState('');
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const [act, setAct] = useState<{ description: string; ownerEmployeeId: string; dueDate: string } | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api<View>(`/meetings/${id}`).then((x) => {
      setV(x); setText(x.minutes?.text ?? '');
      setMarks(Object.fromEntries(x.participants.map((p) => [p.employeeId, p.attended ?? p.rsvp === 'ACCEPTED'])));
    }).catch(() => setMissing(true));
  }, [id]);
  useEffect(load, [load]);
  const call = async (path: string, body: unknown, done: string) => {
    setBusy(true);
    try { await api(`/meetings/${path}`, { method: 'POST', body: JSON.stringify(body) }); toast(done); load(); return true; }
    catch (x) { toast(apiErrors(x).message ?? t('en.failed')); return false; } finally { setBusy(false); }
  };
  const addAction = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!act) return;
    setBusy(true); setErrors({}); setError(null);
    try { await api(`/meetings/${id}/actions`, { method: 'POST', body: JSON.stringify(act) }); toast(t('mt.act.added')); setAct(null); load(); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  if (missing) return <EmptyState icon="users" title={t('mt.notFound')} action={<Link href="/meetings" className="btn">{t('mt.title')}</Link>} />;
  if (!v) return <SkeletonRows rows={6} />;
  const m = v.meeting;
  const started = Date.parse(m.startAt) <= Date.now();
  const me = v.participants.find((p) => p.employeeId === v.myEmployeeId);
  const approved = v.minutes?.status === 'APPROVED';
  const count = (r: string) => v.participants.filter((p) => p.rsvp === r).length;
  return (
    <>
      <Link href="/meetings" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('mt.title')}</Link>
      <PageHeader eyebrow={m.committee ?? t(`mt.type.${m.meetingType}` as MessageKey)} title={m.title}
        description={`${w.day(m.startAt)} · ${w.time(m.startAt)}–${w.time(m.endAt)}${m.venue ? ` · ${m.venue}` : ''}`}
        actions={m.meetingLink && <a className="btn" href={m.meetingLink} target="_blank" rel="noopener noreferrer"><Icon name="route" /> {t('mt.join')}</a>} />
      {me && !started && m.status === 'SCHEDULED' && (
        <div className="card p12-rsvp">
          <span>{me.rsvp === 'PENDING' ? t('mt.rsvpAsk') : t(`mt.rsvpSaid.${me.rsvp}` as MessageKey)}</span>
          <span className="row-actions">
            <button type="button" className={`btn btn-sm${me.rsvp === 'ACCEPTED' ? ' btn-primary' : ''}`} aria-pressed={me.rsvp === 'ACCEPTED'} disabled={busy} onClick={() => void call(`${id}/rsvp`, { accept: true }, t('mt.rsvp.ACCEPTED'))}><Icon name="check" /> {t('mt.attend')}</button>
            <button type="button" className={`btn btn-sm${me.rsvp === 'DECLINED' ? ' btn-primary' : ''}`} aria-pressed={me.rsvp === 'DECLINED'} disabled={busy} onClick={() => void call(`${id}/rsvp`, { accept: false }, t('mt.rsvp.DECLINED'))}><Icon name="x" /> {t('mt.decline')}</button>
          </span>
        </div>
      )}
      <div className="p12-grid">
        <div>
          <section aria-labelledby="mt-ag" className="card p12-block">
            <h2 id="mt-ag" className="section-title">{t('mt.agenda')}</h2>
            {v.agenda.length ? <ol className="p12-agenda">{v.agenda.map((a) => <li key={a.itemNo}>{a.title}</li>)}</ol> : <p className="muted">{t('mt.noAgenda')}</p>}
            <p className="muted small">{t('mt.organisedBy', { name: m.organiser })}</p>
          </section>
          <section aria-labelledby="mt-min" className="card p12-block">
            <h2 id="mt-min" className="section-title">{t('mt.minutesTitle')} {v.minutes && <Pill tone={approved ? 'pill-ok' : 'pill-info'}>{t(`mt.minutes.${v.minutes.status}` as MessageKey)}</Pill>}</h2>
            {v.canRecord && !approved && started ? (
              <>
                <label className="sr-only" htmlFor="mt-text">{t('mt.minutesTitle')}</label>
                <textarea id="mt-text" rows={8} className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('mt.minutesPh')} />
                <div className="row-actions">
                  <button type="button" className="btn" disabled={busy || text.trim().length < 10} onClick={() => void call(`${id}/minutes`, { minutesText: text }, t('mt.minutesSaved'))}>{t('common.save')}</button>
                  {v.minutes?.status === 'DRAFT' && <button type="button" className="btn btn-primary" disabled={busy || text !== (v.minutes.text ?? '')} onClick={() => void call(`${id}/minutes/circulate`, {}, t('mt.circulated'))}><Icon name="mail" /> {t('mt.circulate')}</button>}
                </div>
                {v.minutes?.status === 'DRAFT' && text !== (v.minutes.text ?? '') && <p className="muted small">{t('mt.saveFirst')}</p>}
              </>
            ) : v.minutes?.text ? <div className="p12-minutes">{v.minutes.text}</div> : <p className="muted">{started ? t('mt.noMinutes') : t('mt.minutesLater')}</p>}
            {v.minutes?.status === 'CIRCULATED' && v.canApprove && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void call(`${id}/minutes/approve`, {}, t('mt.approvedToast'))}><Icon name="check" /> {t('mt.approve')}</button>}
            {v.minutes?.status === 'CIRCULATED' && !v.canApprove && <p className="muted small">{m.committee ? t('mt.chairApproves') : t('mt.organiserApproves')}</p>}
            {approved && <p className="muted small"><Icon name="lock" size={14} /> {t('mt.approvedBy', { name: v.minutes!.approvedBy ?? '', d: w.dt(v.minutes!.approvedAt!) })}</p>}
          </section>
          <section aria-labelledby="mt-acts" className="card p12-block">
            <h2 id="mt-acts" className="section-title">{t('mt.actions')}</h2>
            {v.actions.length ? (
              <ul className="p12-action-list">
                {v.actions.map((a) => {
                  const mine = a.ownerEmployeeId === v.myEmployeeId;
                  const live = a.status === 'OPEN' || a.status === 'IN_PROGRESS';
                  return (
                    <li key={a.id}>
                      <span><strong className={a.status === 'CANCELLED' ? 'strike' : undefined}>{a.description}</strong><span className="sub-line muted small">{a.owner} · {t('mt.dueOn', { d: w.date(a.dueDate) })}{a.note ? ` · “${a.note}”` : ''}</span></span>
                      <span className="row-actions">
                        <Pill tone={a.status === 'DONE' ? 'pill-ok' : a.status === 'CANCELLED' ? 'pill-muted' : a.overdue ? 'pill-bad' : 'pill-info'}>{a.overdue && live ? t('mt.act.late') : t(`mt.act.${a.status}` as MessageKey)}</Pill>
                        {live && (mine || v.canRecord) && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void call(`actions/${a.id}/status`, { status: 'DONE' }, t('mt.act.doneToast'))}><Icon name="check" /> {t('mt.act.markDone')}</button>}
                        {a.status === 'OPEN' && mine && <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void call(`actions/${a.id}/status`, { status: 'IN_PROGRESS' }, t('mt.act.IN_PROGRESS'))}>{t('mt.act.start')}</button>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="muted">{t('mt.noActions')}</p>}
            {v.canRecord && <button type="button" className="btn btn-sm" onClick={() => { setErrors({}); setError(null); setAct({ description: '', ownerEmployeeId: v.participants[0]?.employeeId ?? '', dueDate: shift(7) }); }}><Icon name="plus" /> {t('mt.act.add')}</button>}
          </section>
        </div>
        <section aria-labelledby="mt-who" className="card p12-block">
          <h2 id="mt-who" className="section-title">{t('mt.invitees')}</h2>
          <p className="muted small">{started && v.participants.some((p) => p.attended !== null) ? t('mt.presentOf', { n: v.participants.filter((p) => p.attended).length, of: v.participants.length }) : t('mt.rsvpCounts', { a: count('ACCEPTED'), d: count('DECLINED'), p: count('PENDING') })}</p>
          <ul className="p12-people">
            {v.participants.map((p) => (
              <li key={p.employeeId}>
                {v.canRecord && started
                  ? <label className="check"><input type="checkbox" checked={!!marks[p.employeeId]} onChange={(e) => setMarks((x) => ({ ...x, [p.employeeId]: e.target.checked }))} /> <span>{p.name}{p.designation && <span className="muted small"> · {p.designation}</span>}</span></label>
                  : <span>{p.name}{p.designation && <span className="muted small"> · {p.designation}</span>}</span>}
                {started && p.attended !== null
                  ? <Pill tone={p.attended ? 'pill-ok' : 'pill-muted'}>{p.attended ? t('mt.present') : t('mt.absent')}</Pill>
                  : <Pill tone={p.rsvp === 'ACCEPTED' ? 'pill-ok' : p.rsvp === 'DECLINED' ? 'pill-muted' : 'pill-warn'}>{t(`mt.rsvp.${p.rsvp}` as MessageKey)}</Pill>}
              </li>
            ))}
          </ul>
          {v.canRecord && started && <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void call(`${id}/attendance`, { rows: v.participants.map((p) => ({ employeeId: p.employeeId, attended: !!marks[p.employeeId] })) }, t('mt.attendanceSaved'))}><Icon name="check" /> {t('mt.saveAttendance')}</button>}
        </section>
      </div>
      <Modal open={!!act} onClose={() => setAct(null)} title={t('mt.act.add')} onSubmit={addAction} submitLabel={t('common.save')} busy={busy} error={error}>
        <Field id="ma-desc" label={t('mt.act.what')} error={errors.description}><input id="ma-desc" value={act?.description ?? ''} onChange={(e) => setAct((a) => a && { ...a, description: e.target.value })} placeholder={t('mt.act.whatPh')} /></Field>
        <div className="grid-2">
          <Field id="ma-owner" label={t('mt.act.owner')} error={errors.ownerEmployeeId}><select id="ma-owner" value={act?.ownerEmployeeId ?? ''} onChange={(e) => setAct((a) => a && { ...a, ownerEmployeeId: e.target.value })}>{v.participants.map((p) => <option key={p.employeeId} value={p.employeeId}>{p.name}</option>)}</select></Field>
          <Field id="ma-due" label={t('mt.act.due')} error={errors.dueDate}><input id="ma-due" type="date" min={todayIST()} value={act?.dueDate ?? ''} onChange={(e) => setAct((a) => a && { ...a, dueDate: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}
