'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { hostelDailyNoteSchema } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, validate } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { todayIST, useDay } from '@/components/admissions';

interface Hostel { id: string; name: string; campusId: string; hostelType: string; status?: string }
interface Person { studentId: string; name: string; admissionNo: string; room: string; bed: string }
interface Report {
  hostel: { id: string; name: string; campus: string; hostelType: string };
  date: string; residents: number; rollCallTaken: boolean; present: number; absent: number; onOutpass: number; onLeave: number; notMarked: number;
  absentees: (Person & { remarks: string | null })[];
  out: (Person & { kind: 'OUTPASS' | 'HOME'; detail: string; back: string | null; due: string | null })[];
  sick: (Person & { complaint: string; outcome: string; at: string })[];
  meals: { breakfast: number; lunch: number; snacks: number; dinner: number } | null;
  remarks: string | null; remarksSavedAt: string | null; canWrite: boolean;
}

/** Hostel → Daily report (Phase 21 R4): the warden's day for one hostel, printable. */
export default function HostelDailyPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const day = useDay();
  const [hostels, setHostels] = useState<Hostel[] | null>(null);
  const [hostelId, setHostelId] = useState('');
  const [date, setDate] = useState(todayIST());
  const [r, setR] = useState<Report | null>(null);
  const [remarks, setRemarks] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Hostel[]>('/hostel/hostels').then((h) => {
      const list = (Array.isArray(h) ? h : []).filter((x) => x.status !== 'INACTIVE');
      setHostels(list);
      if (list.length) setHostelId((v) => v || list[0].id);
    }).catch(() => setHostels([]));
  }, []);
  useEffect(() => {
    if (!hostelId) return;
    setR(null);
    api<Report>(`/hostel-day/${hostelId}?date=${date}`).then((x) => { setR(x); setRemarks(x.remarks ?? ''); setErr(null); }).catch(() => setR(null));
  }, [hostelId, date]);

  async function save(e: FormEvent) {
    e.preventDefault();
    const v = validate(hostelDailyNoteSchema, { date, remarks });
    if (!v.ok) return setErr(v.errors.remarks ?? v.errors.date ?? null);
    setBusy(true);
    try {
      const s = await api<{ remarks: string; remarksSavedAt: string }>(`/hostel-day/${hostelId}/remarks`, { method: 'PUT', body: JSON.stringify(v.data) });
      setR((x) => (x ? { ...x, ...s } : x));
      setErr(null);
      toast(t('hd.saved'));
    } catch (e2) {
      const { fields, message } = apiErrors(e2);
      setErr(fields.remarks ?? fields.date ?? message);
    } finally {
      setBusy(false);
    }
  }
  const time = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

  return (
    <>
      <div className="no-print">
        <PageHeader eyebrow={t('nav.hostel')} title={t('hd.title')} description={t('hd.desc')}
          actions={r && <button type="button" className="btn" onClick={() => window.print()}><Icon name="receipt" /> {t('hd.print')}</button>} />
        {hostels && hostels.length > 0 && (
          <div className="toolbar">
            <label className="inline-field">{t('hd.hostel')}
              <select value={hostelId} onChange={(e) => setHostelId(e.target.value)}>
                {hostels.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </label>
            <label className="inline-field">{t('hd.date')} <input type="date" value={date} max={todayIST()} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
          </div>
        )}
      </div>
      {!hostels ? <SkeletonRows /> : !hostels.length ? <EmptyState icon="building" title={t('hd.noHostel')} /> : !r ? <SkeletonRows /> : (
        <article className="hd-sheet" aria-label={t('hd.title')}>
          <header className="hd-head">
            <div>
              <h2>{r.hostel.name}</h2>
              <p className="muted">{r.hostel.campus} · {day(r.date)}</p>
            </div>
            <span className="hd-print-title">{t('hd.title')}</span>
          </header>

          <div className="stats hd-stats">
            <div className="stat"><span className="stat-icon"><Icon name="users" size={20} /></span><span className="stat-text"><span className="stat-label">{t('hd.residents')}</span><span className="stat-value">{r.residents}</span></span></div>
            <div className="stat stat-ok"><span className="stat-icon"><Icon name="check" size={20} /></span><span className="stat-text"><span className="stat-label">{t('hd.present')}</span><span className="stat-value">{r.rollCallTaken ? r.present : '—'}</span></span></div>
            <div className={`stat ${r.absent ? 'stat-bad' : ''}`}><span className="stat-icon"><Icon name="alert" size={20} /></span><span className="stat-text"><span className="stat-label">{t('hd.absent')}</span><span className="stat-value">{r.rollCallTaken ? r.absent : '—'}</span></span></div>
            <div className="stat"><span className="stat-icon"><Icon name="logout" size={20} /></span><span className="stat-text"><span className="stat-label">{t('hd.away')}</span><span className="stat-value">{r.out.length}</span></span></div>
            <div className={`stat ${r.sick.length ? 'stat-warn' : ''}`}><span className="stat-icon"><Icon name="shield" size={20} /></span><span className="stat-text"><span className="stat-label">{t('hd.sick')}</span><span className="stat-value">{r.sick.length}</span></span></div>
          </div>
          {!r.rollCallTaken ? (
            <p className="notice notice-warn"><Icon name="alert" />{t('hd.noRollCall')} <Link href={`/hostel/${r.hostel.id}`}>{t('hd.takeRollCall')}</Link></p>
          ) : r.notMarked > 0 && <p className="notice"><Icon name="info" />{t('hd.notMarked', { n: r.notMarked })}</p>}

          <div className="hd-grid">
            <section className="card" aria-labelledby="hd-abs">
              <h3 id="hd-abs" className="card-title">{t('hd.absentees')}</h3>
              {!r.absentees.length ? <p className="muted small">{r.rollCallTaken ? t('hd.noneAbsent') : '—'}</p> : (
                <ul className="hd-list">{r.absentees.map((a) => <li key={a.studentId}><strong>{a.name}</strong> <span className="muted small">{a.admissionNo} · {t('hd.room', { room: a.room, bed: a.bed })}</span>{a.remarks && <span className="small">{a.remarks}</span>}</li>)}</ul>
              )}
            </section>
            <section className="card" aria-labelledby="hd-out">
              <h3 id="hd-out" className="card-title">{t('hd.outTitle')}</h3>
              {!r.out.length ? <p className="muted small">{t('hd.noneOut')}</p> : (
                <ul className="hd-list">{r.out.map((o, i) => <li key={`${o.studentId}-${i}`}><strong>{o.name}</strong> <span className="muted small">{o.kind === 'OUTPASS' ? t('hd.outpass') : t('hd.homeGoing')} · {o.detail}</span><span className="small">{o.back ? t('hd.back', { at: o.kind === 'OUTPASS' ? time(o.back) : day(o.back) }) : o.due ? t('hd.due', { at: time(o.due) }) : t('hd.notBack')}</span></li>)}</ul>
              )}
            </section>
            <section className="card" aria-labelledby="hd-sick">
              <h3 id="hd-sick" className="card-title">{t('hd.sickTitle')}</h3>
              {!r.sick.length ? <p className="muted small">{t('hd.noneSick')}</p> : (
                <ul className="hd-list">{r.sick.map((s, i) => <li key={`${s.studentId}-${i}`}><strong>{s.name}</strong> <span className="muted small">{time(s.at)} · {s.complaint}</span><span className="small">{t(`hd.outcome.${s.outcome}` as MessageKey)}</span></li>)}</ul>
              )}
            </section>
            <section className="card" aria-labelledby="hd-meals">
              <h3 id="hd-meals" className="card-title">{t('hd.mealsTitle')}</h3>
              {!r.meals ? <p className="muted small">{t('hd.noMeals')} <Link href="/hostel/diet" className="no-print">{t('hd.openMeals')}</Link></p> : (
                <>
                  <dl className="hd-meals">
                    {(['breakfast', 'lunch', 'snacks', 'dinner'] as const).map((m) => <div key={m}><dt>{t(`diet.meal.${m}` as MessageKey)}</dt><dd>{r.meals![m]}</dd></div>)}
                  </dl>
                  <p className="muted small">{t('hd.mealsSchool')}</p>
                </>
              )}
            </section>
          </div>

          <section className="card hd-remarks" aria-labelledby="hd-rem">
            <h3 id="hd-rem" className="card-title">{t('hd.remarks')}</h3>
            {r.canWrite ? (
              <form onSubmit={save} noValidate className="no-print-form">
                <label htmlFor="hd-text" className="sr-only">{t('hd.remarks')}</label>
                <textarea id="hd-text" rows={4} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={t('hd.remarksHint')} aria-invalid={!!err} aria-describedby={err ? 'hd-err' : undefined} />
                {err && <p id="hd-err" className="err" role="alert">{err}</p>}
                <div className="form-actions no-print">
                  {r.remarksSavedAt && <span className="muted small">{t('hd.savedAt', { at: time(r.remarksSavedAt) })}</span>}
                  <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? t('common.saving') : t('common.save')}</button>
                </div>
                <p className="hd-remarks-print">{remarks || '—'}</p>
              </form>
            ) : <p>{r.remarks ?? <span className="muted">{t('hd.noRemarks')}</span>}</p>}
          </section>
          <p className="hd-sign">{t('hd.signature')}</p>
        </article>
      )}
    </>
  );
}
