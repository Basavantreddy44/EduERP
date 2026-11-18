'use client';

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ATTENDANCE_STATUSES, PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { apiErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { useDay } from '@/components/admissions';
import { initials, studentName } from '@/components/students';
import { ATT_SHORT, useAttendanceOptions } from '@/components/attendance';

type Status = (typeof ATTENDANCE_STATUSES)[number];
interface SheetStudent { id: string; firstName: string; lastName: string | null; admissionNo: string; rollNo: string | null; status: Status | null; remarks: string | null; parentNotified: boolean; pendingCorrection: { id: string; newStatus: Status } | null; onLeave: { typeName: string; halfDay: boolean } | null }
interface SaveResult { status: string; alerts: { alerted: number; noEmail: number; alreadyTold: number; skipped: string | null } | null }
interface Sheet {
  section: { id: string; name: string; className: string; programName: string; campusId: string; year: string };
  date: string; mode: 'DAILY' | 'PERIOD'; period: { id: string; name: string; startTime: string; endTime: string } | null;
  closed: { code: string; detail: string } | null;
  session: { id: string; status: string; submittedAt: string | null; updatedAt: string; takenBy: string | null } | null;
  canMark: boolean; canCorrect: boolean; students: SheetStudent[];
}
type Mark = { status: Status; remarks: string };

/** Take attendance (M3.2): choose a class and day; everyone is present unless tapped otherwise; save a draft or submit. */
function TakeAttendance() {
  const { can } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const day = useDay();
  const params = useSearchParams();
  const path = usePathname();
  const opts = useAttendanceOptions();
  const [sectionId, setSection] = useState(params.get('section') ?? '');
  const [date, setDate] = useState(params.get('date') ?? '');
  const [periodId, setPeriod] = useState(params.get('period') ?? '');
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [correcting, setCorrecting] = useState<SheetStudent | null>(null);

  useEffect(() => { if (opts && !date) setDate(opts.today); }, [opts, date]);
  const section = opts?.sections.find((s) => s.id === sectionId);
  const campus = opts?.campuses.find((c) => c.id === section?.campusId);
  const periods = (campus?.periods ?? []).filter((p) => !p.isBreak);
  useEffect(() => {
    if (campus?.mode === 'PERIOD' && periods.length && !periods.some((p) => p.id === periodId)) {
      // Default to the period running now (or the first).
      const now = new Date(Date.now() + 330 * 60_000).toISOString().slice(11, 16);
      setPeriod((periods.find((p) => p.startTime <= now && now < p.endTime) ?? periods[0]).id);
    }
    if (campus?.mode === 'DAILY' && periodId) setPeriod('');
  }, [campus?.mode, periods, periodId]);

  const load = useCallback(() => {
    if (!sectionId || !date || (campus?.mode === 'PERIOD' && !periodId)) { setSheet(null); return; }
    setSheet(null); setLoadError(null);
    api<Sheet>(`/attendance/sheet?sectionId=${sectionId}&date=${date}${campus?.mode === 'PERIOD' ? `&periodId=${periodId}` : ''}`)
      .then((s) => {
        setSheet(s);
        setMarks(Object.fromEntries(s.students.map((x) => [x.id, { status: x.status ?? 'PRESENT', remarks: x.remarks ?? '' }])));
      })
      .catch((e) => setLoadError(apiErrors(e).message));
    const p = new URLSearchParams({ section: sectionId, date, ...(periodId ? { period: periodId } : {}) });
    window.history.replaceState(null, '', `${path}?${p.toString()}`);
  }, [sectionId, date, periodId, campus?.mode, path]);
  useEffect(load, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { PRESENT: 0, ABSENT: 0, LATE: 0, HALF_DAY: 0, LEAVE: 0 };
    for (const m of Object.values(marks)) c[m.status] += 1;
    return c;
  }, [marks]);
  const editable = !!sheet?.canMark && can(PERMISSIONS.ATT_MARK);
  const setMark = (id: string, status: Status) => setMarks((m) => ({ ...m, [id]: { ...m[id], status } }));

  async function save(submit: boolean) {
    if (!sheet) return;
    setBusy(true); setError(null);
    try {
      const res = await api<SaveResult>('/attendance/sheet', {
        method: 'POST',
        body: JSON.stringify({ sectionId, date, periodId: sheet.period?.id ?? null, submit, records: sheet.students.map((s) => ({ studentId: s.id, status: marks[s.id].status, remarks: marks[s.id].remarks.trim() || null })) }),
      });
      const al = res.alerts;
      toast(submit ? `${t('att.submitted', { p: counts.PRESENT + counts.LATE + counts.HALF_DAY, a: counts.ABSENT })}${al && al.alerted ? ` · ${t('att.parentsTold', { n: al.alerted })}` : ''}${al && al.noEmail ? ` · ${t('att.noEmailN', { n: al.noEmail })}` : ''}` : t('att.draftSaved'));
      setConfirm(false);
      load();
    } catch (e) { setError(apiErrors(e).message); } finally { setBusy(false); }
  }

  if (!opts) return <SkeletonRows rows={6} />;
  if (!opts.year) return <EmptyState icon="calendar" title={t('att.noYear')} />;
  const groups = [...new Set(opts.sections.map((s) => `${s.level.program.name}`))];

  return (
    <>
      <PageHeader eyebrow={t('nav.attendance')} title={t('att.title')} description={t('att.desc')}
        actions={can(PERMISSIONS.ATT_READ) ? <Link className="btn" href={`/attendance/day${date ? `?date=${date}` : ''}`}><Icon name="layers" /> {t('att.dayLink')}</Link> : undefined} />

      <div className="card filter-bar att-pick">
        <label className="filter att-class">
          <span>{t('att.class')}</span>
          <select value={sectionId} onChange={(e) => setSection(e.target.value)}>
            <option value="">{t('att.chooseClass')}</option>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {opts.sections.filter((s) => s.level.program.name === g).map((s) => <option key={s.id} value={s.id}>{s.level.name} – {s.name}{opts.campuses.length > 1 ? ` · ${opts.campuses.find((c) => c.id === s.campusId)?.code ?? ''}` : ''}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="filter">
          <span>{t('common.date')}</span>
          <input type="date" value={date} max={opts.today} min={opts.year.startDate} onChange={(e) => setDate(e.target.value)} />
        </label>
        {campus?.mode === 'PERIOD' && (
          <label className="filter">
            <span>{t('att.period')}</span>
            <select value={periodId} onChange={(e) => setPeriod(e.target.value)}>
              {periods.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.startTime}–{p.endTime}</option>)}
            </select>
          </label>
        )}
      </div>

      {!sectionId ? (
        <EmptyState icon="users" title={t('att.pickTitle')} text={t('att.pickText')} />
      ) : campus?.mode === 'PERIOD' && periods.length === 0 ? (
        <EmptyState icon="clock" title={t('att.noPeriods')} text={t('att.noPeriodsText')} action={can(PERMISSIONS.ATT_SETUP) ? <Link className="btn btn-primary" href="/attendance/periods"><Icon name="clock" /> {t('nav.bellTimings')}</Link> : undefined} />
      ) : loadError ? (
        <EmptyState icon="alert" title={loadError} />
      ) : !sheet ? (
        <SkeletonRows rows={8} />
      ) : (
        <section className="card att-sheet" aria-labelledby="att-h">
          <header className="att-head">
            <div>
              <h2 id="att-h">{sheet.section.className} – {sheet.section.name}{sheet.period ? <span className="muted"> · {sheet.period.name}</span> : null}</h2>
              <p className="muted small">{day(sheet.date)} · {sheet.section.programName} · {t('att.nStudents', { n: sheet.students.length })}</p>
            </div>
            <span className={`att-state ${sheet.session?.status === 'SUBMITTED' ? 'done' : sheet.session ? 'draft' : 'new'}`}>
              <Icon name={sheet.session?.status === 'SUBMITTED' ? 'lock' : sheet.session ? 'edit' : 'clock'} size={14} />
              {sheet.session?.status === 'SUBMITTED' ? t('att.stateSubmitted') : sheet.session ? t('att.stateDraft') : t('att.stateNew')}
            </span>
          </header>

          {sheet.closed && <p className="note-info att-banner"><Icon name="calendar" size={16} /> {sheet.closed.detail}</p>}
          {sheet.session?.status === 'SUBMITTED' && (
            <p className="note-info att-banner"><Icon name="lock" size={16} /> {t('att.lockedNote', { by: sheet.session.takenBy ?? '—', at: new Date(sheet.session.submittedAt!).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) })}</p>
          )}

          <ul className="att-counts" aria-live="polite">
            {ATTENDANCE_STATUSES.map((k) => <li key={k} className={`att-c-${k}`}><strong>{counts[k]}</strong> {t(`att.s.${k}` as MessageKey)}</li>)}
          </ul>

          {editable && (
            <div className="att-bulk">
              <button type="button" className="btn btn-sm" onClick={() => setMarks((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { ...v, status: v.status === 'LEAVE' ? 'LEAVE' : 'PRESENT' }])))}><Icon name="check" size={15} /> {t('att.allPresent')}</button>
              <span className="muted small">{t('att.tapHint')}</span>
            </div>
          )}

          {sheet.students.length === 0 ? <p className="muted">{t('att.noStudents')}</p> : (
            <ol className="att-list">
              {sheet.students.map((s) => {
                const m = marks[s.id];
                return (
                  <li key={s.id} className={`att-row st-${m.status}`}>
                    <span className="att-roll mono" aria-hidden>{s.rollNo ?? '–'}</span>
                    <span className="avatar avatar-sm" aria-hidden>{initials(s)}</span>
                    <span className="att-name">
                      <strong>{studentName(s)}</strong>
                      <span className="sub-line muted small mono">{s.admissionNo}{m.remarks && <span className="att-remark"> · {m.remarks}</span>}</span>
                      {(s.parentNotified || s.pendingCorrection || s.onLeave) && (
                        <span className="att-flags">
                          {s.onLeave && <span className="att-flag told"><Icon name="calendar" size={12} /> {t('satt.onLeave', { type: s.onLeave.typeName })}</span>}
                          {s.parentNotified && <span className="att-flag told"><Icon name="mail" size={12} /> {t('att.parentTold')}</span>}
                          {s.pendingCorrection && <span className="att-flag pending"><Icon name="clock" size={12} /> {t('att.correctionPending', { s: t(`att.s.${s.pendingCorrection.newStatus}` as MessageKey) })}</span>}
                        </span>
                      )}
                    </span>
                    <span className="att-choices" role="radiogroup" aria-label={t('att.markFor', { name: studentName(s) })}>
                      {ATTENDANCE_STATUSES.map((k) => (
                        <button key={k} type="button" role="radio" aria-checked={m.status === k} disabled={!editable} title={t(`att.s.${k}` as MessageKey)}
                          aria-label={t(`att.s.${k}` as MessageKey)} className={`att-btn b-${k} ${m.status === k ? 'on' : ''}`} onClick={() => setMark(s.id, k)}>
                          {ATT_SHORT[k]}
                        </button>
                      ))}
                      {editable && <button type="button" className="btn btn-ghost icon-btn att-note-btn" aria-label={t('att.addNote', { name: studentName(s) })} onClick={() => setNoteFor(s.id)}><Icon name="edit" size={15} /></button>}
                      {sheet.canCorrect && !s.pendingCorrection && <button type="button" className="btn btn-sm att-fix-btn" aria-label={t('att.correctFor', { name: studentName(s) })} onClick={() => setCorrecting(s)}><Icon name="swap" size={14} /> {t('att.correct')}</button>}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}

          {editable && sheet.students.length > 0 && (
            <div className="action-row att-actions">
              {error && <p className="form-error" role="alert">{error}</p>}
              <span className="muted small">{t('att.saveHint')}</span>
              <span className="action-bar-spacer" />
              <button type="button" className="btn" disabled={busy} onClick={() => void save(false)}><Icon name="edit" size={16} /> {t('att.saveDraft')}</button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => { setError(null); setConfirm(true); }}><Icon name="lock" size={16} /> {t('att.submit')}</button>
            </div>
          )}
        </section>
      )}

      {correcting && sheet?.session && <CorrectionDialog student={correcting} sessionId={sheet.session.id} onClose={() => setCorrecting(null)} onDone={(applied) => { setCorrecting(null); toast(applied ? t('att.corrApplied') : t('att.corrSent')); load(); }} />}
      {noteFor && sheet && (
        <Modal open onClose={() => setNoteFor(null)} title={t('att.note')} subtitle={studentName(sheet.students.find((s) => s.id === noteFor)!)} submitLabel={t('common.save')}
          onSubmit={(e) => { e.preventDefault(); setNoteFor(null); }}>
          <label className="sr-only" htmlFor="att-note">{t('att.note')}</label>
          <input id="att-note" className="input" maxLength={200} autoFocus value={marks[noteFor].remarks} placeholder={t('att.notePh')} onChange={(e) => setMarks((m) => ({ ...m, [noteFor]: { ...m[noteFor], remarks: e.target.value } }))} />
        </Modal>
      )}
      {confirm && sheet && (
        <Modal open onClose={() => setConfirm(false)} title={t('att.confirmTitle')} subtitle={`${sheet.section.className} – ${sheet.section.name} · ${day(sheet.date)}${sheet.period ? ` · ${sheet.period.name}` : ''}`}
          submitLabel={t('att.submit')} busy={busy} error={error} onSubmit={(e) => { e.preventDefault(); void save(true); }}>
          <ul className="att-counts">{ATTENDANCE_STATUSES.filter((k) => counts[k]).map((k) => <li key={k} className={`att-c-${k}`}><strong>{counts[k]}</strong> {t(`att.s.${k}` as MessageKey)}</li>)}</ul>
          {counts.ABSENT > 0 && <p className="small">{t('att.absentList')} {sheet.students.filter((s) => marks[s.id].status === 'ABSENT').map(studentName).join(', ')}</p>}
          <p className="note-info"><Icon name="info" size={15} /> {t('att.confirmNote')}</p>
        </Modal>
      )}
    </>
  );
}

function CorrectionDialog({ student, sessionId, onClose, onDone }: { student: SheetStudent; sessionId: string; onClose: () => void; onDone: (applied: boolean) => void }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status>(student.status === 'ABSENT' ? 'PRESENT' : 'ABSENT');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 5) return setErrors({ reason: t('att.reasonMin') });
    setBusy(true); setError(null);
    try {
      const c = await api<{ status: string }>('/attendance/corrections', { method: 'POST', body: JSON.stringify({ sessionId, studentId: student.id, newStatus: status, reason: reason.trim() }) });
      onDone(c.status === 'APPROVED');
    } catch (err) { const r = apiErrors(err); setErrors(r.fields); setError(r.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={t('att.correctTitle')} subtitle={`${studentName(student)} · ${t('att.nowMarked', { s: t(`att.s.${student.status ?? 'PRESENT'}` as MessageKey) })}`} submitLabel={t('att.correctSubmit')} busy={busy} error={error} onSubmit={submit}>
      <fieldset className="field">
        <legend className="label">{t('att.newMark')}</legend>
        <div className="segmented" role="radiogroup" aria-label={t('att.newMark')}>
          {ATTENDANCE_STATUSES.filter((k) => k !== student.status).map((k) => <button key={k} type="button" role="radio" aria-checked={status === k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{t(`att.s.${k}` as MessageKey)}</button>)}
        </div>
      </fieldset>
      <Field id="corr-reason" label={t('app.reasonRequired')} error={errors.reason}><textarea id="corr-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('att.correctPh')} /></Field>
      <p className="note-info"><Icon name="info" size={15} /> {t('att.correctNote')}</p>
    </Modal>
  );
}

export default function AttendancePage() {
  return <Suspense fallback={<SkeletonRows rows={6} />}><TakeAttendance /></Suspense>;
}
