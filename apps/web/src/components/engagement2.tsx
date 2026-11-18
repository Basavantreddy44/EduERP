'use client';

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';

/** Phase 12 helpers shared by meetings, complaints, front office and department requests. */
export interface StaffOpt { id: string; name: string; code: string; designation: string | null; departmentId: string | null; campusId: string }

export const PRIORITY_TONE: Record<string, string> = { LOW: 'pill-muted', MEDIUM: 'pill-info', HIGH: 'pill-warn', URGENT: 'pill-bad' };
export const COMPLAINT_TONE: Record<string, string> = { OPEN: 'pill-info', IN_PROGRESS: 'pill-warn', RESOLVED: 'pill-ok', CLOSED: 'pill-muted', REOPENED: 'pill-bad' };
export const REQUEST_TONE: Record<string, string> = { PENDING_APPROVAL: 'pill-warn', REJECTED: 'pill-bad', OPEN: 'pill-info', IN_PROGRESS: 'pill-warn', COMPLETED: 'pill-ok', CLOSED: 'pill-muted' };

export function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`pill ${tone}`}><span className="pill-dot" />{children}</span>;
}

/** Date & time helpers in Indian time, in the reader's language. */
export function useWhen() {
  const { locale } = useI18n();
  return useMemo(() => ({
    dt: (s: string | Date) => new Date(s).toLocaleString(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }),
    day: (s: string | Date) => new Date(s).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }),
    time: (s: string | Date) => new Date(s).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }),
    dayNum: (s: string | Date) => new Date(s).toLocaleDateString(locale, { day: 'numeric', timeZone: 'Asia/Kolkata' }),
    mon: (s: string | Date) => new Date(s).toLocaleDateString(locale, { month: 'short', timeZone: 'Asia/Kolkata' }),
    date: (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
  }), [locale]);
}

/** “Due in 5 h” / “2 days late” for a deadline. */
export function useDue() {
  const { t } = useI18n();
  return (dueAt: string, done: boolean) => {
    if (done) return null;
    const h = Math.round((Date.parse(dueAt) - Date.now()) / 3_600_000);
    if (h < 0) return { late: true, text: Math.abs(h) >= 48 ? t('p12.lateDays', { n: Math.floor(Math.abs(h) / 24) }) : t('p12.lateHours', { n: Math.max(1, Math.abs(h)) }) };
    return { late: false, text: h >= 48 ? t('p12.dueDays', { n: Math.floor(h / 24) }) : t('p12.dueHours', { n: Math.max(1, h) }) };
  };
}

/** Staff list for pickers from an endpoint the user can reach. */
export function useStaffOpts(url: string | null) {
  const [rows, setRows] = useState<StaffOpt[] | null>(null);
  useEffect(() => { if (url) api<StaffOpt[]>(url).then(setRows).catch(() => setRows([])); }, [url]);
  return rows;
}

/** Ticking checkboxes from a long staff list, with a filter box. */
export function StaffChecklist({ staff, value, onChange, legend, departments }: { staff: StaffOpt[]; value: string[]; onChange: (v: string[]) => void; legend: string; departments?: { id: string; name: string }[] }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const dept = new Map((departments ?? []).map((d) => [d.id, d.name]));
  const shown = staff.filter((s) => !q.trim() || `${s.name} ${s.code} ${s.designation ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <fieldset className="check-group p12-staff">
      <legend>{legend} <span className="muted small">· {t('p12.chosen', { n: value.length })}</span></legend>
      <input type="search" className="input" aria-label={t('p12.filterStaff')} placeholder={t('p12.filterStaff')} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="p12-staff-list">
        {shown.map((s) => (
          <label key={s.id} className="check">
            <input type="checkbox" checked={value.includes(s.id)} onChange={(e) => onChange(e.target.checked ? [...value, s.id] : value.filter((x) => x !== s.id))} />
            <span>{s.name}<span className="muted small"> · {[s.designation, s.departmentId ? dept.get(s.departmentId) : null].filter(Boolean).join(' · ') || s.code}</span></span>
          </label>
        ))}
        {!shown.length && <p className="muted small">{t('common.noMatches')}</p>}
      </div>
    </fieldset>
  );
}

export const priorityKey = (p: string) => `p12.priority.${p}` as MessageKey;

// ───────────── Complaint thread (staff page and parent app) ─────────────

export interface ComplaintView {
  complaint: { id: string; complaintNo: string; subject: string; description: string; category: string; priority: string; status: string; dueAt: string; resolvedAt: string | null; closedAt: string | null; rating: number | null; escalated: boolean; createdAt: string; raisedBy: string; raisedByType: string; student: { name: string; admissionNo: string } | null; handler: string | null; assignedEmployeeId: string | null };
  canWork: boolean; canClose: boolean;
  updates: { id: string; type: string; message: string | null; isInternal: boolean; oldStatus: string | null; newStatus: string | null; by: string; at: string }[];
}

export function ComplaintThread({ v }: { v: ComplaintView }) {
  const { t } = useI18n();
  const w = useWhen();
  return (
    <ol className="timeline p12-thread">
      <li><span className="timeline-dot" /><div><strong>{v.complaint.raisedBy}</strong> <span className="muted small">· {w.dt(v.complaint.createdAt)}</span><p className="p12-msg">{v.complaint.description}</p></div></li>
      {v.updates.filter((u) => u.message || u.newStatus).filter((u, i) => i > 0 || u.message).map((u) => (
        <li key={u.id} className={u.isInternal ? 'p12-internal' : undefined}>
          <span className="timeline-dot" />
          <div>
            <strong>{u.by}</strong> <span className="muted small">· {w.dt(u.at)}</span>
            {u.isInternal && <> <Pill tone="pill-muted"><Icon name="lock" size={12} /> {t('cp.internal')}</Pill></>}
            {u.newStatus && <> <Pill tone={COMPLAINT_TONE[u.newStatus] ?? 'pill-info'}>{t(`cp.status.${u.newStatus}` as MessageKey)}</Pill></>}
            {u.message && <p className="p12-msg">{u.message}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The complainant’s choice once a complaint is resolved: close with a rating, or reopen with a reason. */
export function ComplaintCloseBox({ onSend }: { onSend: (body: { close: boolean; rating?: number; message?: string | null }) => Promise<string | null> }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<'close' | 'reopen'>('close');
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true); setErr(null);
    setErr(await onSend(mode === 'close' ? { close: true, rating, message: message || null } : { close: false, message }));
    setBusy(false);
  };
  return (
    <div className="card p12-close">
      <h3 className="section-title">{t('cp.resolvedAsk')}</h3>
      <div className="tabs" role="tablist" aria-label={t('cp.resolvedAsk')}>
        <button type="button" role="tab" aria-selected={mode === 'close'} className={mode === 'close' ? 'on' : ''} onClick={() => setMode('close')}>{t('cp.yesClose')}</button>
        <button type="button" role="tab" aria-selected={mode === 'reopen'} className={mode === 'reopen' ? 'on' : ''} onClick={() => setMode('reopen')}>{t('cp.noReopen')}</button>
      </div>
      {mode === 'close' && (
        <fieldset className="p12-stars"><legend>{t('cp.rate')}</legend>
          {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className={n <= rating ? 'on' : ''} aria-pressed={n === rating} aria-label={t('cp.stars', { n })} onClick={() => setRating(n)}><Icon name="star" size={22} /></button>)}
        </fieldset>
      )}
      <label className="sr-only" htmlFor="cp-close-msg">{mode === 'close' ? t('cp.closeNote') : t('cp.reopenWhy')}</label>
      <textarea id="cp-close-msg" className="input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={mode === 'close' ? t('cp.closeNote') : t('cp.reopenWhy')} />
      {err && <p className="field-error" role="alert">{err}</p>}
      <button type="button" className="btn btn-primary" disabled={busy || (mode === 'close' ? !rating : message.trim().length < 2)} onClick={() => void send()}>{mode === 'close' ? t('cp.closeIt') : t('cp.reopenIt')}</button>
    </div>
  );
}
