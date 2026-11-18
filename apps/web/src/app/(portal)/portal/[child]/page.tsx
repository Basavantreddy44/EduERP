'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PortalAttendance, formatINR, toPaise } from '@eduerp/shared';
import { api, downloadFile } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { todayIST, useDay } from '@/components/admissions';
import { LiveTrackingSoon, fmtVehicleNo } from '@/components/transport';
import { Lesson, MATERIAL_ICON, Period, Sub, dayKey, dayShortKey, hm, shownDays, weekdayOf } from '@/components/academics';
import { Card, ReportCard } from '@/components/exams';
import { ChildEvents, ChildPtm } from '@/components/portal-engagement';
import { ChildComplaints } from '@/components/portal-complaints';

type Tab = 'attendance' | 'timetable' | 'homework' | 'material' | 'results' | 'events' | 'ptm' | 'complaints' | 'fees' | 'leave' | 'bus' | 'hostel';
const TABS: Tab[] = ['attendance', 'timetable', 'homework', 'material', 'results', 'events', 'ptm', 'fees', 'leave', 'bus', 'hostel', 'complaints'];
const inr = (v: string | number) => formatINR(toPaise(String(v)));
const shiftMonth = (m: string, n: number) => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7); };

/** One child in the parent & student app (M5.2): attendance, fees and leave. */
export default function ChildPage() {
  const { child: id } = useParams<{ child: string }>();
  const { portal, hasModule } = useSession();
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('attendance');
  // The tab follows the address (#attendance, #fees, #leave), so the phone's bottom tabs can switch it.
  useEffect(() => {
    const f = () => { const h = window.location.hash.slice(1) as Tab; setTab(TABS.includes(h) ? h : 'attendance'); };
    f();
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, [id]);
  const child = portal?.children.find((c) => c.id === id);
  if (!portal) return null;
  if (!child) return <EmptyState icon="users" title={t('pt.notYours')} action={<Link href="/portal" className="btn">{t('pt.back')}</Link>} />;
  const tabs = TABS.filter((x) => (x === 'fees' ? hasModule('FEES') : x === 'bus' ? hasModule('TRANSPORT') : x === 'hostel' ? hasModule('HOSTEL') : x === 'results' ? hasModule('EXAMS') : x === 'events' ? hasModule('EVENTS') : x === 'ptm' ? hasModule('MEETINGS') : x === 'complaints' ? hasModule('GRIEVANCE') : x === 'timetable' || x === 'homework' || x === 'material' ? hasModule('ACADEMICS') : hasModule('ATTENDANCE')));
  const pick = (x: Tab) => { setTab(x); history.replaceState(null, '', `#${x}`); window.dispatchEvent(new HashChangeEvent('hashchange')); };

  return (
    <>
      <Link href="/portal" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('pt.allChildren')}</Link>
      <PageHeader title={child.name} description={[child.className ? `${child.className} – ${child.sectionName}` : null, child.admissionNo, child.campusName].filter(Boolean).join(' · ')} />
      <div className="tabs scroll" role="tablist" aria-label={child.name}>
        {tabs.map((x) => (
          <button key={x} role="tab" id={`tab-${x}`} aria-selected={tab === x} aria-controls={`panel-${x}`} className={tab === x ? 'on' : ''} onClick={() => pick(x)}>
            {t(`pt.tab.${x}` as MessageKey)}
          </button>
        ))}
      </div>
      <section role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="pt-panel">
        {tab === 'attendance' && <Attendance id={id} />}
        {tab === 'timetable' && <Timetable id={id} />}
        {tab === 'homework' && <Homework id={id} />}
        {tab === 'material' && <Material id={id} />}
        {tab === 'results' && <Results id={id} />}
        {tab === 'events' && <ChildEvents id={id} />}
        {tab === 'ptm' && <ChildPtm id={id} />}
        {tab === 'complaints' && <ChildComplaints id={id} />}
        {tab === 'fees' && <Fees id={id} />}
        {tab === 'leave' && <Leave id={id} />}
        {tab === 'bus' && <Bus id={id} />}
        {tab === 'hostel' && <Hostel id={id} />}
      </section>
    </>
  );
}

// ───────────── Attendance ─────────────

function Attendance({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const [month, setMonth] = useState(todayIST().slice(0, 7));
  const [a, setA] = useState<PortalAttendance | null>(null);
  useEffect(() => { setA(null); api<PortalAttendance>(`/portal/children/${id}/attendance?month=${month}`).then(setA).catch(() => setA(null)); }, [id, month]);
  const label = new Date(`${month}-01T00:00:00Z`).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const lead = a ? (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7 : 0; // Monday first
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' }));
  const low = a?.totals.pct !== null && a?.totals.pct !== undefined && a.totals.pct < a.minPercent;

  return (
    <>
      <div className="month-nav">
        <button type="button" className="btn btn-ghost icon-btn" aria-label={t('rep.prevMonth')} onClick={() => setMonth(shiftMonth(month, -1))}><Icon name="chevronRight" className="flip" /></button>
        <strong aria-live="polite">{label}</strong>
        <button type="button" className="btn btn-ghost icon-btn" aria-label={t('rep.nextMonth')} disabled={month >= todayIST().slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))}><Icon name="chevronRight" /></button>
      </div>
      {!a ? <SkeletonRows rows={4} /> : (
        <>
          <div className="pt-tiles">
            <div className={`pt-tile ${low ? 'bad' : ''}`}><span>{t('pt.att.pct')}</span><strong>{a.totals.pct === null ? '–' : `${a.totals.pct}%`}</strong><small>{a.totals.pct === null ? t('rep.noMarks') : low ? t('pt.att.below', { n: a.minPercent }) : t('pt.att.min', { n: a.minPercent })}</small></div>
            <div className="pt-tile"><span>{t('pt.att.present')}</span><strong>{a.totals.present + a.totals.late}</strong><small>{t('pt.att.lateHalf', { late: a.totals.late, half: a.totals.halfDay })}</small></div>
            <div className="pt-tile"><span>{t('pt.att.absent')}</span><strong>{a.totals.absent}</strong></div>
            <div className="pt-tile"><span>{t('pt.att.leave')}</span><strong>{a.totals.leave}</strong></div>
          </div>
          <div className="cal">
            <div className="cal-head" aria-hidden="true">{weekdays.map((w) => <span key={w}>{w}</span>)}</div>
            <ol className="cal-grid" aria-label={label}>
              {Array.from({ length: lead }, (_, i) => <li key={`x${i}`} className="cal-cell empty" aria-hidden="true" />)}
              {a.days.map((d) => {
                const n = Number(d.date.slice(8));
                const what = d.mark ? t(`pt.mark.${d.mark}` as MessageKey) !== `pt.mark.${d.mark}` ? t(`pt.mark.${d.mark}` as MessageKey) : d.mark : d.kind === 'holiday' ? d.holiday ?? t('pt.holiday') : d.kind === 'off' ? t('pt.weeklyOff') : d.kind === 'future' ? '' : t('rep.notMarked');
                return (
                  <li key={d.date} className={`cal-cell k-${d.kind}`} title={what || undefined} aria-label={what ? `${n}: ${what}` : String(n)}>
                    <b>{n}</b>
                    {d.mark ? <i className={`cal-mark c-${d.mark.includes('/') ? 'P' : d.mark}`}>{d.mark}</i> : d.kind === 'holiday' ? <i className="cal-mark hol-mark">{t('pt.holShort')}</i> : null}
                  </li>
                );
              })}
            </ol>
          </div>
          <p className="muted small rep-legend">{t('pt.att.legend')}</p>
        </>
      )}
    </>
  );
}

// ───────────── Fees ─────────────

interface Fees {
  year: { name: string } | null;
  totals: { net: string; paid: string; balance: string; overdue: string };
  invoices: { id: string; invoiceNo: string; description: string; dueDate: string; status: string; net: string; paid: string; balance: string }[];
  receipts: { id: string; receiptNo: string; paymentDate: string; amount: string; paymentMode: string; status: string }[];
  onlinePayment: boolean;
}
interface Receipt {
  receiptNo: string; paymentDate: string; amount: string; paymentMode: string; referenceNo: string | null; payerName: string | null; status: string;
  institution: string; className: string | null; balanceAfter: string;
  student: { firstName: string; lastName: string | null; admissionNo: string; campus: { name: string } };
  allocations: { amount: string; invoice: { invoiceNo: string }; item: { feeHead: { name: string } } }[];
}

function Fees({ id }: { id: string }) {
  const { t } = useI18n();
  const day = useDay();
  const toast = useToast();
  const [f, setF] = useState<Fees | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<Fees>(`/portal/children/${id}/fees`).then(setF).catch(() => setF(null)); }, [id]);
  const payNow = async () => {
    setBusy(true);
    try { window.location.href = (await api<{ url: string }>(`/portal/children/${id}/pay`, { method: 'POST' })).url; }
    catch (e) { toast(apiErrors(e).message ?? t('pt.payFailed'), 'bad'); setBusy(false); }
  };
  if (!f) return <SkeletonRows rows={4} />;
  const owes = toPaise(f.totals.balance) > 0;
  const today = todayIST();

  return (
    <>
      <div className="card pt-due">
        <div>
          <span className="muted">{t('pt.fee.balance')}</span>
          <strong className="dash-big">{inr(f.totals.balance)}</strong>
          {toPaise(f.totals.overdue) > 0 && <span className="pt-overdue">{t('pt.fee.overdue', { amount: inr(f.totals.overdue) })}</span>}
          <span className="muted small">{t('pt.fee.paidOf', { paid: inr(f.totals.paid), net: inr(f.totals.net) })}</span>
        </div>
        {owes && (f.onlinePayment
          ? <button type="button" className="btn btn-primary" disabled={busy} onClick={payNow}><Icon name="rupee" size={16} /> {t('pt.fee.pay', { amount: inr(f.totals.balance) })}</button>
          : <p className="soon-line small"><Icon name="rupee" size={14} /> {t('pt.fee.payOnline')} <span className="soon-badge">{t('common.comingSoon')}</span></p>)}
      </div>

      <h3 className="section-title">{t('pt.fee.bills')}</h3>
      {f.invoices.length === 0 ? <p className="muted">{t('pt.fee.noBills')}</p> : (
        <ul className="pt-list">
          {f.invoices.map((i) => (
            <li key={i.id}>
              <span className="pt-list-main"><strong>{i.description}</strong><span className="muted small">{i.invoiceNo} · {t('pt.fee.due', { date: day(i.dueDate) })}</span></span>
              <span className="pt-list-amt">
                <strong>{inr(i.balance)}</strong>
                <StatusBadge status={toPaise(i.balance) > 0 && i.dueDate.slice(0, 10) < today ? 'OVERDUE' : i.status} label={toPaise(i.balance) > 0 && i.dueDate.slice(0, 10) < today ? t('pt.fee.overdueTag') : undefined} />
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="section-title">{t('pt.fee.receipts')}</h3>
      {f.receipts.length === 0 ? <p className="muted">{t('pt.fee.noReceipts')}</p> : (
        <ul className="pt-list">
          {f.receipts.map((r) => (
            <li key={r.id}>
              <span className="pt-list-main"><strong>{r.receiptNo}</strong><span className="muted small">{day(r.paymentDate)} · {t(`fee.mode.${r.paymentMode}` as MessageKey)}</span></span>
              <span className="pt-list-amt">
                <strong>{inr(r.amount)}</strong>
                {r.status === 'SUCCESS'
                  ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => api<Receipt>(`/portal/children/${id}/receipts/${r.id}`).then(setReceipt)}><Icon name="receipt" size={14} /> {t('pt.fee.view')}</button>
                  : <StatusBadge status={r.status} />}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Modal open={!!receipt} onClose={() => setReceipt(null)} title={t('pt.fee.receiptTitle', { no: receipt?.receiptNo ?? '' })} onSubmit={() => window.print()} submitLabel={t('pt.fee.print')} wide>
        {receipt && (
          <div className="pt-receipt print-area">
            <p className="pt-receipt-school">{receipt.institution} · {receipt.student.campus.name}</p>
            <dl className="pt-receipt-meta">
              <div><dt>{t('pt.fee.student')}</dt><dd>{receipt.student.firstName} {receipt.student.lastName ?? ''} ({receipt.student.admissionNo}){receipt.className ? ` · ${receipt.className}` : ''}</dd></div>
              <div><dt>{t('pt.fee.date')}</dt><dd>{day(receipt.paymentDate)}</dd></div>
              <div><dt>{t('pt.fee.mode')}</dt><dd>{t(`fee.mode.${receipt.paymentMode}` as MessageKey)}{receipt.referenceNo ? ` · ${receipt.referenceNo}` : ''}</dd></div>
            </dl>
            <table>
              <thead><tr><th>{t('pt.fee.head')}</th><th className="num">{t('pt.fee.amount')}</th></tr></thead>
              <tbody>{receipt.allocations.map((x, i) => <tr key={i}><td>{x.item.feeHead.name} <span className="muted small">({x.invoice.invoiceNo})</span></td><td className="num">{inr(x.amount)}</td></tr>)}</tbody>
              <tfoot><tr><th>{t('pt.fee.total')}</th><th className="num">{inr(receipt.amount)}</th></tr></tfoot>
            </table>
            <p className="muted small">{t('pt.fee.balanceAfter', { amount: inr(receipt.balanceAfter) })}</p>
          </div>
        )}
      </Modal>
    </>
  );
}

// ───────────── Leave ─────────────

interface LeaveOverview {
  year: string | null;
  types: { id: string; name: string; allowed: number | null; taken: number; waiting: number; left: number | null }[];
  requests: { id: string; type: string; fromDate: string; toDate: string; halfDay: boolean; days: number; reason: string; status: string; decisionRemarks: string | null; appliedByMe: boolean; canCancel: boolean }[];
}

function Leave({ id }: { id: string }) {
  const { t } = useI18n();
  const day = useDay();
  const toast = useToast();
  const [l, setL] = useState<LeaveOverview | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ leaveTypeId: '', fromDate: todayIST(), toDate: todayIST(), halfDay: false, reason: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<LeaveOverview>(`/portal/children/${id}/leave`).then(setL).catch(() => setL(null)); }, [id]);
  useEffect(load, [load]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try {
      const r = await api<{ status: string }>(`/portal/children/${id}/leave`, { method: 'POST', body: JSON.stringify({ ...form, toDate: form.halfDay ? form.fromDate : form.toDate }) });
      toast(r.status === 'APPROVED' ? t('pt.leave.approved') : t('pt.leave.sent'));
      setOpen(false); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const withdraw = async (rid: string) => {
    try { await api(`/portal/children/${id}/leave/${rid}/cancel`, { method: 'POST' }); toast(t('pt.leave.withdrawn')); load(); }
    catch (x) { toast(apiErrors(x).message ?? '', 'bad'); }
  };
  if (!l) return <SkeletonRows rows={4} />;

  return (
    <>
      <div className="pt-leave-head">
        <ul className="pt-chips">
          {l.types.map((x) => <li key={x.id}><strong>{x.name}</strong> <span className="muted small">{x.left === null ? t('pt.leave.taken', { n: x.taken }) : t('pt.leave.left', { left: x.left, allowed: x.allowed ?? 0 })}</span></li>)}
        </ul>
        {l.types.length > 0 && <button type="button" className="btn btn-primary" onClick={() => { setForm({ leaveTypeId: l.types[0].id, fromDate: todayIST(), toDate: todayIST(), halfDay: false, reason: '' }); setErrors({}); setError(null); setOpen(true); }}><Icon name="plus" size={16} /> {t('pt.leave.apply')}</button>}
      </div>
      {l.types.length === 0 && <p className="muted">{t('pt.leave.noTypes')}</p>}
      {l.requests.length === 0 ? <EmptyState icon="calendar" title={t('pt.leave.none')} /> : (
        <ul className="pt-list">
          {l.requests.map((r) => (
            <li key={r.id}>
              <span className="pt-list-main">
                <strong>{r.type} · {r.fromDate === r.toDate ? day(r.fromDate) : `${day(r.fromDate)} – ${day(r.toDate)}`}{r.halfDay ? ` (${t('pt.leave.half')})` : ''}</strong>
                <span className="muted small">{r.reason}{r.decisionRemarks ? ` · ${r.decisionRemarks}` : ''}{!r.appliedByMe ? ` · ${t('pt.leave.bySchool')}` : ''}</span>
              </span>
              <span className="pt-list-amt">
                <StatusBadge status={r.status} />
                {r.canCancel && <button type="button" className="btn btn-sm btn-ghost danger-text" onClick={() => withdraw(r.id)}>{t('pt.leave.withdraw')}</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('pt.leave.apply')} subtitle={t('pt.leave.applySub')} onSubmit={submit} submitLabel={t('pt.leave.send')} busy={busy} error={error}>
        <Field id="lv-type" label={t('pt.leave.type')} error={errors.leaveTypeId}>
          <select id="lv-type" value={form.leaveTypeId} onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value })}>
            {l.types.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <div className="grid-2">
          <Field id="lv-from" label={t('pt.leave.from')} error={errors.fromDate}><input id="lv-from" type="date" value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value, toDate: e.target.value > form.toDate ? e.target.value : form.toDate })} /></Field>
          {!form.halfDay && <Field id="lv-to" label={t('pt.leave.to')} error={errors.toDate}><input id="lv-to" type="date" min={form.fromDate} value={form.toDate} onChange={(e) => setForm({ ...form, toDate: e.target.value })} /></Field>}
        </div>
        <label className="check"><input type="checkbox" checked={form.halfDay} onChange={(e) => setForm({ ...form, halfDay: e.target.checked })} /> {t('pt.leave.halfDay')}</label>
        <Field id="lv-reason" label={t('pt.leave.reason')} error={errors.reason}><textarea id="lv-reason" rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
      </Modal>
    </>
  );
}

// ───────────── Bus (Phase 6) ─────────────

interface BusTrip { stopName: string; pickupTime: string | null; dropTime: string | null; routeNo: string; routeName: string; vehicleNo: string | null; driverName: string | null; driverPhone: string | null; pickupDrop: string; startDate: string }

function Bus({ id }: { id: string }) {
  const { t } = useI18n();
  const day = useDay();
  const [b, setB] = useState<{ current: BusTrip | null } | null>(null);
  useEffect(() => { api<{ current: BusTrip | null }>(`/portal/children/${id}/transport`).then(setB).catch(() => setB({ current: null })); }, [id]);
  if (!b) return <SkeletonRows rows={3} />;
  const c = b.current;
  return (
    <>
      {!c ? <EmptyState icon="bus" title={t('pt.bus.none')} text={t('pt.bus.noneHint')} /> : (
        <div className="card pt-bus">
          <p className="eyebrow">{t('tr.routeEyebrow', { no: c.routeNo })} · {c.routeName}</p>
          <h2 className="card-title">{c.stopName}</h2>
          <dl className="pt-bus-times">
            {c.pickupTime && c.pickupDrop !== 'DROP' && <div><dt>{t('pt.bus.pickup')}</dt><dd>{c.pickupTime}</dd></div>}
            {c.dropTime && c.pickupDrop !== 'PICKUP' && <div><dt>{t('pt.bus.drop')}</dt><dd>{c.dropTime}</dd></div>}
          </dl>
          <ul className="pt-bus-facts">
            {c.vehicleNo && <li><Icon name="bus" size={16} /> {fmtVehicleNo(c.vehicleNo)}</li>}
            {c.driverName && <li><Icon name="users" size={16} /> {t('tr.col.driver')}: {c.driverName}{c.driverPhone && <> · <a href={`tel:${c.driverPhone}`}>{c.driverPhone}</a></>}</li>}
            <li><Icon name="calendar" size={16} /> {t('tr.since', { date: day(c.startDate) })}</li>
          </ul>
        </div>
      )}
      <LiveTrackingSoon />
    </>
  );
}

// ───────────── Hostel (Phase 7) ─────────────

interface HostelView {
  stay: { hostel: string; roomNo: string; bedNo: string; status: string; checkInDate: string; warden: { name: string; phone: string | null } | null } | null;
  nights: { date: string; status: string }[];
  outpasses: { id: string; destination: string; reason: string; outTime: string; expectedReturn: string; status: string; parentApproval: string; wardenApproval: string }[];
  homeGoings: { id: string; fromDate: string; toDate: string; reason: string; status: string }[];
  mess: { plan: string; today: { meal: string; items: string }[] } | null;
}

function Hostel({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const day = useDay();
  const toast = useToast();
  const [h, setH] = useState<HostelView | null>(null);
  const load = useCallback(() => { api<HostelView>(`/portal/children/${id}/hostel`).then(setH).catch(() => setH(null)); }, [id]);
  useEffect(load, [load]);
  const decide = async (oid: string, approve: boolean) => {
    try { await api(`/portal/children/${id}/outpasses/${oid}/decide`, { method: 'POST', body: JSON.stringify({ approve }) }); toast(approve ? t('pt.hs.approved') : t('pt.hs.refused')); load(); }
    catch (x) { toast(apiErrors(x).message ?? '', 'bad'); }
  };
  const fmt = (iso: string) => new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  if (!h) return <SkeletonRows rows={3} />;
  if (!h.stay) return <EmptyState icon="building" title={t('pt.hs.none')} />;
  const waiting = h.outpasses.filter((o) => o.status === 'REQUESTED' && o.parentApproval === 'PENDING');
  return (
    <>
      <div className="card pt-bus">
        <p className="eyebrow">{h.stay.hostel}</p>
        <h2 className="card-title">{t('hs.roomBedN', { room: h.stay.roomNo, bed: h.stay.bedNo })}</h2>
        {h.stay.warden && <p className="muted">{t('hs.warden')}: {h.stay.warden.name}{h.stay.warden.phone && <> · <a href={`tel:${h.stay.warden.phone}`}>{h.stay.warden.phone}</a></>}</p>}
      </div>
      {waiting.length > 0 && (
        <section className="card pt-waiting" aria-labelledby="pt-op-h">
          <h3 id="pt-op-h" className="card-title">{t('pt.hs.askTitle')}</h3>
          {waiting.map((o) => (
            <div key={o.id} className="pt-op">
              <p><strong>{o.destination}</strong> · {fmt(o.outTime)} – {fmt(o.expectedReturn)}<br /><span className="muted small">{o.reason}</span></p>
              <span className="btn-row"><button type="button" className="btn btn-primary btn-sm" onClick={() => decide(o.id, true)}>{t('hs.approve')}</button><button type="button" className="btn btn-sm btn-ghost danger-text" onClick={() => decide(o.id, false)}>{t('hs.refuse')}</button></span>
            </div>
          ))}
        </section>
      )}
      <h3 className="section-title">{t('pt.hs.nights')}</h3>
      {h.nights.length === 0 ? <p className="muted">{t('pt.hs.noNights')}</p> : (
        <ul className="pt-chips">{h.nights.map((n) => <li key={n.date}><strong>{day(n.date)}</strong> <span className={`small r-txt-${n.status}`}>{t(`hs.roll.${n.status}` as MessageKey)}</span></li>)}</ul>
      )}
      {h.outpasses.filter((o) => !waiting.includes(o)).length > 0 && (
        <>
          <h3 className="section-title">{t('pt.hs.outpasses')}</h3>
          <ul className="pt-list">{h.outpasses.filter((o) => !waiting.includes(o)).map((o) => <li key={o.id}><span className="pt-list-main"><strong>{o.destination}</strong><span className="muted small">{fmt(o.outTime)} – {fmt(o.expectedReturn)}</span></span><StatusBadge status={o.status} label={t(`hs.op.s.${o.status}` as MessageKey)} /></li>)}</ul>
        </>
      )}
      {h.mess && (
        <>
          <h3 className="section-title">{t('pt.hs.mess', { plan: h.mess.plan })}</h3>
          {h.mess.today.length === 0 ? <p className="muted">{t('ms.noMenu')}</p> : <ul className="pt-list">{h.mess.today.map((m) => <li key={m.meal}><span className="pt-list-main"><strong>{t(`ms.meal.${m.meal}` as MessageKey)}</strong><span className="muted small">{m.items}</span></span></li>)}</ul>}
        </>
      )}
      <p className="soon-line small"><Icon name="phone" size={14} /> {t('hs.smsAlerts')} <span className="soon-badge">{t('common.comingSoon')}</span></p>
    </>
  );
}

// ───────────── Timetable (Phase 8) ─────────────

interface ChildWeek { periods: Period[]; entries: Lesson[]; substitutions: Sub[] }

/** The child's day, one day at a time (phone friendly), with substitute teachers marked. */
function Timetable({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const [w, setW] = useState<ChildWeek | null | undefined>(undefined);
  const today = todayIST();
  const [day, setDay] = useState(Math.min(weekdayOf(today), 6));
  useEffect(() => { api<{ timetable: ChildWeek | null }>(`/portal/children/${id}/timetable`).then((r) => setW(r.timetable)).catch(() => setW(null)); }, [id]);
  if (w === undefined) return <SkeletonRows rows={5} />;
  if (!w) return <EmptyState icon="grid" title={t('pt.tt.none')} text={t('pt.tt.noneHint')} />;
  const days = shownDays(w.entries);
  // The date of the chosen weekday in the coming 7 days (today counts).
  const dateOf = (d: number) => { for (let i = 0; i < 7; i++) { const x = new Date(Date.parse(`${today}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10); if (weekdayOf(x) === d) return x; } return today; };
  const date = dateOf(day);
  const subs = w.substitutions.filter((x) => x.date === date);
  return (
    <>
      <div className="pt-days" role="group" aria-label={t('pt.tt.pickDay')}>
        {days.map((d) => (
          <button key={d} type="button" className={d === day ? 'on' : ''} aria-pressed={d === day} onClick={() => setDay(d)}>
            <span aria-hidden="true">{t(dayShortKey(d))}</span><span className="sr-only">{t(dayKey(d))}</span>
            {d === weekdayOf(today) && <i className="pt-today-dot" aria-hidden="true" />}
          </button>
        ))}
      </div>
      <p className="muted small pt-day-date">{new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</p>
      <ol className="pt-lessons">
        {w.periods.map((p) => {
          if (p.isBreak) return <li key={p.id} className="pt-lesson pt-break"><span className="pt-time">{hm(p.startTime)}</span><span>{p.name}</span></li>;
          const l = w.entries.find((e) => e.dayOfWeek === day && e.periodId === p.id);
          const sub = l && subs.find((x) => x.timetableEntryId === l.id);
          return (
            <li key={p.id} className={`pt-lesson${l ? '' : ' pt-free'}`}>
              <span className="pt-time"><strong>{hm(p.startTime)}</strong><span className="muted small">{p.name}</span></span>
              {l ? (
                <span className="pt-what"><strong>{l.subject}</strong>
                  <span className="muted small">{sub ? <><s>{l.teacher}</s> → {sub.substitute}</> : l.teacher}{l.room ? ` · ${l.room}` : ''}</span>
                  {sub && <span className="pill pill-info">{t('pt.tt.substitute')}</span>}
                </span>
              ) : <span className="muted">{t('ac.free')}</span>}
            </li>
          );
        })}
      </ol>
    </>
  );
}

// ───────────── Homework & diary (Phase 8) ─────────────

interface ChildHw {
  items: { id: string; subject: string; title: string; description: string | null; dueDate: string; allowSubmission: boolean; submission: { text: string | null; submittedAt: string; grade: string | null; feedback: string | null; status: string } | null }[];
  diary: { id: string; noteDate: string; note: string; forChild: boolean; needsAck: boolean; acknowledged: boolean }[];
}

function Homework({ id }: { id: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const day = useDay();
  const [d, setD] = useState<ChildHw | null>(null);
  const [open, setOpen] = useState<ChildHw['items'][number] | null>(null);
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<ChildHw>(`/portal/children/${id}/homework`).then(setD).catch(() => setD({ items: [], diary: [] })); }, [id]);
  useEffect(load, [load]);
  const today = todayIST();
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!open) return;
    setBusy(true); setErrors({}); setError(null);
    try {
      await api(`/portal/children/${id}/homework/${open.id}/submit`, { method: 'POST', body: JSON.stringify({ text }) });
      toast(t('pt.hw.sent')); setOpen(null); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const seen = async (noteId: string) => {
    try { await api(`/portal/children/${id}/diary/${noteId}/seen`, { method: 'POST', body: '{}' }); load(); } catch (x) { toast(apiErrors(x).message ?? t('pt.hw.seenFailed')); }
  };
  if (!d) return <SkeletonRows rows={4} />;
  const due = d.items.filter((h) => h.dueDate >= today).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const past = d.items.filter((h) => h.dueDate < today).sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  const card = (h: ChildHw['items'][number]) => {
    const x = h.submission;
    return (
      <li key={h.id} className="card pt-hw">
        <div className="pt-hw-head"><span className="hw-subject">{h.subject}</span><span className={`pill ${h.dueDate === today ? 'pill-warn' : 'pill-muted'}`}>{h.dueDate === today ? t('ac.hw.dueToday') : t('ac.hw.due', { date: day(h.dueDate) })}</span></div>
        <strong className="hw-title">{h.title}</strong>
        {h.description && <p className="hw-desc">{h.description}</p>}
        {x?.status === 'MARKED' ? <p className="pt-hw-grade"><span className="pill pill-ok">{t('ac.hw.grade', { g: x.grade ?? '' })}</span> {x.feedback}</p>
          : x ? <p className="pt-hw-done"><Icon name="check" size={16} /> {t('pt.hw.submitted')}</p>
          : !h.allowSubmission ? <p className="muted small">{t('pt.hw.noSubmit')}</p> : null}
        {h.allowSubmission && x?.status !== 'MARKED' && (
          <button type="button" className={`btn btn-sm${x ? '' : ' btn-primary'}`} onClick={() => { setText(x?.text ?? ''); setErrors({}); setError(null); setOpen(h); }}>
            <Icon name="edit" /> {x ? t('pt.hw.change') : t('pt.hw.submit')}
          </button>
        )}
      </li>
    );
  };
  return (
    <>
      <h2 className="section-title first">{t('pt.hw.due')}</h2>
      {due.length ? <ul className="pt-hw-list">{due.map(card)}</ul> : <p className="muted">{t('pt.hw.nothingDue')}</p>}
      <h2 className="section-title">{t('pt.hw.diary')}</h2>
      {!d.diary.length ? <p className="muted">{t('pt.hw.noNotes')}</p> : (
        <ul className="pt-hw-list">
          {d.diary.map((n) => (
            <li key={n.id} className={`card pt-note${n.forChild ? ' for-child' : ''}`}>
              <div className="pt-hw-head"><span className="muted small">{day(n.noteDate)}</span>{n.forChild && <span className="pill pill-info">{t('pt.hw.forChild')}</span>}</div>
              <p>{n.note}</p>
              {n.needsAck && (n.acknowledged ? <p className="pt-hw-done"><Icon name="check" size={16} /> {t('pt.hw.seen')}</p>
                : <button type="button" className="btn btn-sm btn-primary" onClick={() => void seen(n.id)}><Icon name="eye" /> {t('pt.hw.markSeen')}</button>)}
            </li>
          ))}
        </ul>
      )}
      {past.length > 0 && (<><h2 className="section-title">{t('pt.hw.earlier')}</h2><ul className="pt-hw-list">{past.map(card)}</ul></>)}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.title ?? ''} subtitle={open?.subject} onSubmit={submit} submitLabel={t('pt.hw.send')} busy={busy} error={error}>
        <Field id="hw-answer" label={t('pt.hw.answer')} hint={t('pt.hw.answerHint')} error={errors.text}><textarea id="hw-answer" rows={6} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      </Modal>
    </>
  );
}

// ───────────── Results (Phase 9) ─────────────

interface ResultItem { id: string; term: string; year: string; percentage: number; grade: string | null; rank: number | null; resultStatus: string; publishedAt: string | null }

/** Published results; tap one to see (and print) the report card. */
function Results({ id }: { id: string }) {
  const { t } = useI18n();
  const [list, setList] = useState<ResultItem[] | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { api<ResultItem[]>(`/portal/children/${id}/results`).then(setList).catch(() => setList([])); }, [id]);
  useEffect(() => { if (!open) { setCard(null); return; } api<Card>(`/portal/children/${id}/results/${open}`).then(setCard).catch(() => setOpen(null)); }, [id, open]);
  if (!list) return <SkeletonRows rows={3} />;
  if (open) return (
    <>
      <div className="row-actions no-print rc-bar">
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(null)}><Icon name="chevronRight" size={16} className="flip" /> {t('pt.res.all')}</button>
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => window.print()}><Icon name="download" /> {t('ex.card.print')}</button>
      </div>
      {card ? <ReportCard c={card} /> : <SkeletonRows rows={6} />}
    </>
  );
  if (!list.length) return <EmptyState icon="star" title={t('pt.res.none')} text={t('pt.res.noneHint')} />;
  return (
    <ul className="pt-hw-list">
      {list.map((r) => (
        <li key={r.id}>
          <button type="button" className="card pt-result" onClick={() => setOpen(r.id)}>
            <span><strong>{r.term}</strong><span className="sub-line muted">{r.year}</span></span>
            <span className="pt-result-nums"><strong>{r.percentage}%</strong>{r.grade && <span className="pill pill-info">{r.grade}</span>}</span>
            <span className="muted small">{r.rank ? t('pt.res.rank', { n: r.rank }) : ''}{r.rank ? ' · ' : ''}{t(`ex.status.${r.resultStatus}` as MessageKey)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ───────────── Study material (Phase 10) ─────────────

interface MatItem { id: string; subject: string; title: string; description: string | null; materialType: string; hasFile: boolean; publishedAt: string | null; opened: boolean }
interface MatOpen { id: string; title: string; description: string | null; materialType: string; url: string | null; body: string | null; fileId: string | null }

/** Published notes, links, videos and files of the child's class, by subject. */
function Material({ id }: { id: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [items, setItems] = useState<MatItem[] | null>(null);
  const [subject, setSubject] = useState('');
  const [open, setOpen] = useState<MatOpen | null>(null);
  const load = useCallback(() => { api<{ items: MatItem[] }>(`/portal/children/${id}/materials`).then((r) => setItems(r.items)).catch(() => setItems([])); }, [id]);
  useEffect(load, [load]);
  const show = async (m: MatItem) => {
    try {
      const o = await api<MatOpen>(`/portal/children/${id}/materials/${m.id}/open`, { method: 'POST', body: '{}' });
      if (o.materialType === 'FILE') await downloadFile(`/portal/children/${id}/materials/${m.id}/file`);
      else setOpen(o);
      setItems((x) => x?.map((y) => (y.id === m.id ? { ...y, opened: true } : y)) ?? x);
    } catch (x) { toast(apiErrors(x).message ?? t('pt.mat.failed')); }
  };
  if (!items) return <SkeletonRows rows={4} />;
  if (!items.length) return <EmptyState icon="book" title={t('pt.mat.none')} text={t('pt.mat.noneHint')} />;
  const subjects = [...new Set(items.map((m) => m.subject))];
  const shown = items.filter((m) => !subject || m.subject === subject);
  return (
    <>
      {subjects.length > 1 && (
        <div className="chip-row pt-mat-filter" role="group" aria-label={t('ac.subject')}>
          <button type="button" className={`chip chip-btn${!subject ? ' on' : ''}`} aria-pressed={!subject} onClick={() => setSubject('')}>{t('pt.mat.all')}</button>
          {subjects.map((s) => <button key={s} type="button" className={`chip chip-btn${subject === s ? ' on' : ''}`} aria-pressed={subject === s} onClick={() => setSubject(s)}>{s}</button>)}
        </div>
      )}
      <ul className="pt-hw-list">
        {shown.map((m) => (
          <li key={m.id}>
            <button type="button" className="card pt-mat" onClick={() => void show(m)}>
              <span className="sm-icon" aria-hidden="true"><Icon name={MATERIAL_ICON[m.materialType] ?? 'file'} /></span>
              <span className="pt-mat-main"><span className="hw-subject">{m.subject} · {t(`sm.type.${m.materialType}` as MessageKey)}</span><strong>{m.title}</strong>{m.description && <span className="muted small">{m.description}</span>}</span>
              {!m.opened && <span className="pill pill-info">{t('pt.mat.new')}</span>}
            </button>
          </li>
        ))}
      </ul>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.title ?? ''} subtitle={open?.description ?? undefined} onSubmit={() => setOpen(null)} hideCancel submitLabel={t('common.close')}>
        {open?.materialType === 'NOTE' && <div className="pt-mat-note">{open.body}</div>}
        {open?.url && <a href={open.url} target="_blank" rel="noopener noreferrer" className="btn btn-primary"><Icon name={open.materialType === 'VIDEO' ? 'eye' : 'route'} /> {open.materialType === 'VIDEO' ? t('pt.mat.watch') : t('pt.mat.openLink')}<span className="sr-only"> {t('sm.newTab')}</span></a>}
      </Modal>
    </>
  );
}
