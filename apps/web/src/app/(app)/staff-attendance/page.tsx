'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { STAFF_ATT_STATUSES } from '@eduerp/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { apiErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { todayIST, useDay } from '@/components/admissions';
import { initials } from '@/components/students';
import { staffName, useStaffOptions } from '@/components/staff';

type Status = (typeof STAFF_ATT_STATUSES)[number];
interface Row { id: string; employeeCode: string; firstName: string; lastName: string | null; designation: string | null; department: string | null; status: Status | null; checkIn: string | null; checkOut: string | null; remarks: string | null; onLeave: { typeName: string; halfDay: boolean } | null }
interface Sheet { date: string; closed: { code: string; detail: string } | null; saved: boolean; staff: Row[] }
type Mark = { status: Status; checkIn: string; checkOut: string; remarks: string };
const SHORT: Record<Status, string> = { PRESENT: 'P', ABSENT: 'A', HALF_DAY: 'H', LEAVE: 'LV', ON_DUTY: 'OD' };

/** Staff attendance (M3.4): the office marks every staff member for the day, with in / out times. */
export default function StaffAttendancePage() {
  const { campusId: sessionCampus } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const day = useDay();
  const opts = useStaffOptions();
  const [campusId, setCampus] = useState('');
  const [date, setDate] = useState(todayIST());
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!opts || campusId) return;
    const linked = new URLSearchParams(window.location.search).get('campus'); // from the dashboard
    setCampus(opts.campuses.some((c) => c.id === linked) ? linked! : sessionCampus || opts.campuses[0]?.id || '');
  }, [opts, campusId, sessionCampus]);

  const load = useCallback(() => {
    if (!campusId) return;
    setSheet(null); setError(null);
    api<Sheet>(`/staff-attendance?campusId=${campusId}&date=${date}`).then((s) => {
      setSheet(s);
      setMarks(Object.fromEntries(s.staff.map((x) => [x.id, { status: x.status ?? (x.onLeave ? 'LEAVE' : 'PRESENT'), checkIn: x.checkIn ?? '', checkOut: x.checkOut ?? '', remarks: x.remarks ?? '' }])));
    }).catch((e) => setError(apiErrors(e).message));
  }, [campusId, date]);
  useEffect(load, [load]);

  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const m of Object.values(marks)) c[m.status] = (c[m.status] ?? 0) + 1; return c; }, [marks]);
  const future = date > todayIST();
  const set = (id: string, p: Partial<Mark>) => setMarks((m) => ({ ...m, [id]: { ...m[id], ...p } }));

  async function save() {
    if (!sheet) return;
    setBusy(true); setError(null);
    try {
      const r = await api<{ total: number; changed: number }>('/staff-attendance', { method: 'POST', body: JSON.stringify({ campusId, date, records: sheet.staff.map((s) => { const m = marks[s.id]; const away = m.status === 'ABSENT' || m.status === 'LEAVE'; return { employeeId: s.id, status: m.status, checkIn: away ? null : m.checkIn || null, checkOut: away ? null : m.checkOut || null, remarks: m.remarks.trim() || null }; }) }) });
      toast(sheet.saved ? t('satt.updated', { n: r.changed }) : t('satt.saved', { n: r.total }));
      load();
    } catch (e) { setError(apiErrors(e).message); } finally { setBusy(false); }
  }

  if (!opts) return <SkeletonRows rows={6} />;
  return (
    <>
      <PageHeader eyebrow={t('nav.attendance')} title={t('nav.staffAttendance')} description={t('satt.desc')} />
      <div className="card filter-bar att-pick">
        {opts.campuses.length > 1 && (
          <label className="filter"><span>{t('common.campus')}</span>
            <select value={campusId} onChange={(e) => setCampus(e.target.value)}>{opts.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </label>
        )}
        <label className="filter"><span>{t('common.date')}</span><input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      {error && !sheet && <EmptyState icon="alert" title={error} />}
      {!sheet ? (!error && <SkeletonRows rows={6} />) : sheet.staff.length === 0 ? <EmptyState icon="users" title={t('satt.noStaff')} /> : (
        <section className="card att-sheet">
          <header className="att-head">
            <div><h2>{day(sheet.date)}</h2><p className="muted small">{t('satt.nStaff', { n: sheet.staff.length })}</p></div>
            <span className={`att-state ${sheet.saved ? 'done' : 'new'}`}><Icon name={sheet.saved ? 'check' : 'clock'} size={14} /> {sheet.saved ? t('satt.stateSaved') : t('att.stateNew')}</span>
          </header>
          {sheet.closed && <p className="note-info att-banner"><Icon name="calendar" size={16} /> {sheet.closed.detail}{sheet.closed.code !== 'date-in-future' ? ` — ${t('satt.closedNote')}` : ''}</p>}
          <ul className="att-counts">{STAFF_ATT_STATUSES.map((k) => <li key={k} className={`att-c-${k === 'ON_DUTY' ? 'PRESENT' : k}`}><strong>{counts[k] ?? 0}</strong> {t(`satt.s.${k}` as MessageKey)}</li>)}</ul>
          <ol className="att-list">
            {sheet.staff.map((s) => {
              const m = marks[s.id];
              return (
                <li key={s.id} className={`att-row satt-row st-${m.status === 'ON_DUTY' ? 'PRESENT' : m.status}`}>
                  <span className="avatar avatar-sm" aria-hidden>{initials(s)}</span>
                  <span className="att-name">
                    <strong>{staffName(s)}</strong>
                    <span className="sub-line muted small">{s.designation ?? s.employeeCode}{s.department ? ` · ${s.department}` : ''}</span>
                    {s.onLeave && <span className="att-flags"><span className="att-flag told"><Icon name="calendar" size={12} /> {t('satt.onLeave', { type: s.onLeave.typeName })}</span></span>}
                  </span>
                  <span className="att-choices" role="radiogroup" aria-label={t('att.markFor', { name: staffName(s) })}>
                    {STAFF_ATT_STATUSES.map((k) => (
                      <button key={k} type="button" role="radio" aria-checked={m.status === k} aria-label={t(`satt.s.${k}` as MessageKey)} title={t(`satt.s.${k}` as MessageKey)} disabled={future}
                        className={`att-btn b-${k === 'ON_DUTY' ? 'PRESENT' : k} ${m.status === k ? 'on' : ''}`} onClick={() => set(s.id, { status: k })}>{SHORT[k]}</button>
                    ))}
                  </span>
                  <span className="satt-times">
                    <input type="time" className="input" aria-label={t('satt.inFor', { name: staffName(s) })} value={m.checkIn} disabled={future || m.status === 'ABSENT' || m.status === 'LEAVE'} onChange={(e) => set(s.id, { checkIn: e.target.value })} />
                    <input type="time" className="input" aria-label={t('satt.outFor', { name: staffName(s) })} value={m.checkOut} disabled={future || m.status === 'ABSENT' || m.status === 'LEAVE'} onChange={(e) => set(s.id, { checkOut: e.target.value })} />
                  </span>
                </li>
              );
            })}
          </ol>
          {!future && (
            <div className="action-row att-actions">
              {error && <p className="form-error" role="alert">{error}</p>}
              <span className="muted small">{t('satt.hint')}</span>
              <span className="action-bar-spacer" />
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}><Icon name="check" size={16} /> {sheet.saved ? t('satt.saveChanges') : t('satt.save')}</button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
