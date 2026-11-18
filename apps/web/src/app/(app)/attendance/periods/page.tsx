'use client';

import { useEffect, useState } from 'react';
import { PERMISSIONS, savePeriodsSchema } from '@eduerp/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { apiErrors, validate } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { AttPeriod, useAttendanceOptions } from '@/components/attendance';

type Draft = { key: string; name: string; startTime: string; endTime: string; isBreak: boolean };
const toDraft = (p: AttPeriod | Omit<AttPeriod, 'id'>, i: number): Draft => ({ key: 'id' in p ? p.id : `n${i}-${Date.now()}`, name: p.name, startTime: p.startTime, endTime: p.endTime, isBreak: p.isBreak });
const addMin = (hhmm: string, m: number) => { const [h, mm] = hhmm.split(':').map(Number); const t = Math.min(h * 60 + mm + m, 23 * 60 + 59); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

/** Bell timings per campus (M3.2). Used for period-wise attendance, later by the timetable. */
export default function BellTimingsPage() {
  const { can, campusId: sessionCampus } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const opts = useAttendanceOptions();
  const [campusId, setCampus] = useState('');
  const [rows, setRows] = useState<Draft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canEdit = can(PERMISSIONS.ATT_SETUP);

  useEffect(() => { if (opts && !campusId) setCampus(sessionCampus || opts.campuses[0]?.id || ''); }, [opts, campusId, sessionCampus]);
  useEffect(() => {
    if (!campusId) return;
    setRows(null);
    api<AttPeriod[]>(`/attendance/periods?campusId=${campusId}`).then((p) => setRows(p.map(toDraft))).catch(() => setRows([]));
  }, [campusId]);

  const campus = opts?.campuses.find((c) => c.id === campusId);
  const set = (i: number, patch: Partial<Draft>) => setRows((r) => r!.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const add = (isBreak = false) => setRows((r) => {
    const last = r![r!.length - 1];
    const start = last ? last.endTime : '09:00';
    const teaching = r!.filter((x) => !x.isBreak).length;
    return [...r!, { key: `n${Date.now()}`, name: isBreak ? t('att.breakName') : `${t('att.periodShort')}${teaching + 1}`, startTime: start, endTime: addMin(start, isBreak ? 15 : 45), isBreak }];
  });

  async function save() {
    const body = { campusId, periods: rows!.map(({ name, startTime, endTime, isBreak }) => ({ name: name.trim(), startTime, endTime, isBreak })) };
    const v = validate(savePeriodsSchema, body);
    if (!v.ok) return setError(Object.values(v.errors)[0] ?? t('att.periodsInvalid'));
    setBusy(true); setError(null);
    try { const p = await api<AttPeriod[]>('/attendance/periods', { method: 'PUT', body: JSON.stringify(body) }); setRows(p.map(toDraft)); toast(t('att.periodsSaved')); }
    catch (e) { setError(apiErrors(e).message); } finally { setBusy(false); }
  }

  if (!opts) return <SkeletonRows rows={6} />;
  return (
    <>
      <PageHeader eyebrow={t('nav.attendance')} title={t('nav.bellTimings')} description={t('att.periodsDesc')} />
      {opts.campuses.length > 1 && (
        <div className="card filter-bar">
          <label className="filter"><span>{t('common.campus')}</span>
            <select value={campusId} onChange={(e) => setCampus(e.target.value)}>{opts.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </label>
        </div>
      )}
      {campus && <p className="note-info"><Icon name="info" size={15} /> {campus.mode === 'PERIOD' ? t('att.modePeriod') : t('att.modeDaily')}</p>}
      {rows === null ? <SkeletonRows rows={4} /> : (
        <section className="card">
          {rows.length === 0 && <EmptyState icon="clock" title={t('att.noPeriods')} text={t('att.periodsEmptyText')} />}
          {rows.length > 0 && (
            <div className="table-wrap">
              <table className="table bell-table">
                <caption className="sr-only">{t('nav.bellTimings')}</caption>
                <thead><tr><th scope="col">#</th><th scope="col">{t('att.periodName')}</th><th scope="col">{t('att.starts')}</th><th scope="col">{t('att.ends')}</th><th scope="col">{t('att.isBreak')}</th>{canEdit && <th scope="col"><span className="sr-only">{t('stu.remove')}</span></th>}</tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.key} className={r.isBreak ? 'bell-break' : ''}>
                      <td className="muted">{i + 1}</td>
                      <td><input className="input" aria-label={`${t('att.periodName')} ${i + 1}`} value={r.name} maxLength={30} disabled={!canEdit} onChange={(e) => set(i, { name: e.target.value })} /></td>
                      <td><input className="input" type="time" aria-label={`${t('att.starts')} ${r.name}`} value={r.startTime} disabled={!canEdit} onChange={(e) => set(i, { startTime: e.target.value })} /></td>
                      <td><input className="input" type="time" aria-label={`${t('att.ends')} ${r.name}`} value={r.endTime} disabled={!canEdit} onChange={(e) => set(i, { endTime: e.target.value })} /></td>
                      <td><input type="checkbox" aria-label={`${t('att.isBreak')} ${r.name}`} checked={r.isBreak} disabled={!canEdit} onChange={(e) => set(i, { isBreak: e.target.checked })} /></td>
                      {canEdit && <td><button type="button" className="btn btn-ghost icon-btn" aria-label={`${t('stu.remove')} ${r.name}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Icon name="trash" size={16} /></button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {canEdit && (
            <div className="action-row">
              <button type="button" className="btn btn-sm" onClick={() => add(false)}><Icon name="plus" size={15} /> {t('att.addPeriod')}</button>
              <button type="button" className="btn btn-sm" onClick={() => add(true)}><Icon name="plus" size={15} /> {t('att.addBreak')}</button>
              <span className="action-bar-spacer" />
              {error && <span className="form-error" role="alert">{error}</span>}
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}><Icon name="check" size={16} /> {t('common.save')}</button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
