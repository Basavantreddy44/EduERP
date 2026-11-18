'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PERMISSIONS, formatINR, toPaise } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from './Icon';
import { Field, Modal } from './Modal';
import { EmptyState, SkeletonRows, StatusBadge, useToast } from './ui';
import { todayIST, useDay } from './admissions';

interface Stay { id: string; status: string; checkInDate: string; checkOutDate: string | null; endReason: string | null; hostel: string; hostelId: string; roomNo: string; bedNo: string; floor: string | null; warden: { name: string; phone: string | null } | null; damages: { id: string; description: string; amount: string; status: string }[] }
interface History { stays: Stay[]; deposit: { billed: string; paid: string; damagesCharged: string; damagesPending: string; refundable: string } }
interface FreeBeds { hasHostelHead: boolean; hasDepositHead: boolean; hostels: { id: string; name: string; depositAmount: string; rooms: { id: string; roomNo: string; roomType: string; isAc: boolean; feeAmount: string; beds: { id: string; bedNo: string }[] }[] }[] }

/** Student profile → Hostel (M7.2): current stay, deposit position, allot a bed, history. */
export function StudentHostel({ studentId, active }: { studentId: string; active: boolean }) {
  const { can } = useSession();
  const { t } = useI18n();
  const day = useDay();
  const toast = useToast();
  const allot = can(PERMISSIONS.HOSTEL_ALLOT);
  const [h, setH] = useState<History | null>(null);
  const [free, setFree] = useState<FreeBeds | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<History>(`/hostel/students/${studentId}`).then(setH).catch(() => setH({ stays: [], deposit: { billed: '0', paid: '0', damagesCharged: '0', damagesPending: '0', refundable: '0' } })); }, [studentId]);
  useEffect(load, [load]);
  const current = h?.stays.find((s) => s.status === 'CHECKED_IN' || s.status === 'RESERVED') ?? null;
  const start = () => {
    setError(null); setFree(null);
    api<FreeBeds>(`/hostel/students/${studentId}/free-beds`).then((f) => { setFree(f); const h0 = f.hostels.find((x) => x.rooms.length); setForm({ hostelId: h0?.id ?? '', roomId: h0?.rooms[0]?.id ?? '', bedId: h0?.rooms[0]?.beds[0]?.id ?? '', checkInDate: todayIST(), bill: f.hasHostelHead }); }).catch((x) => setError(apiErrors(x).message));
    setOpen(true);
  };
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api<{ billed: { room?: string; deposit?: string } }>('/hostel/allotments', { method: 'POST', body: JSON.stringify({ studentId, bedId: form.bedId, checkInDate: form.checkInDate, bill: !!form.bill }) });
      const billed = [r.billed.room && formatINR(toPaise(r.billed.room)), r.billed.deposit && `${t('hs.deposit')} ${formatINR(toPaise(r.billed.deposit))}`].filter(Boolean).join(' + ');
      toast(billed ? t('hs.allottedBilled', { amount: billed }) : t('hs.allotted'));
      setOpen(false); load();
    } catch (x) { const a = apiErrors(x); setError(a.message ?? Object.values(a.fields)[0] ?? null); } finally { setBusy(false); }
  };
  if (!h) return <SkeletonRows rows={3} />;
  const hostel = free?.hostels.find((x) => x.id === form.hostelId);
  const room = hostel?.rooms.find((r) => r.id === form.roomId);

  return (
    <>
      {current ? (
        <div className="card bus-card">
          <div className="bus-card-main">
            <span className="soon-icon bus-icon"><Icon name="building" size={22} /></span>
            <div>
              <h3 className="card-title">{current.hostel} · {t('hs.roomBedN', { room: current.roomNo, bed: current.bedNo })}</h3>
              <p className="muted">{t(`hs.astatus.${current.status}` as MessageKey)} · {t('tr.since', { date: day(current.checkInDate) })}{current.warden ? ` · ${t('hs.warden')}: ${current.warden.name}${current.warden.phone ? ` (${current.warden.phone})` : ''}` : ''}</p>
            </div>
          </div>
          <Link href={`/hostel/${current.hostelId}#residents`} className="btn btn-ghost">{t('hs.openHostel')} <Icon name="arrowRight" size={15} /></Link>
        </div>
      ) : (
        <EmptyState icon="building" title={t('hs.noStay')} text={t('hs.noStayHint')} action={allot && active ? <button type="button" className="btn btn-primary" onClick={start}><Icon name="plus" /> {t('hs.allot')}</button> : undefined} />
      )}
      {toPaise(h.deposit.billed) > 0 && (
        <dl className="dep-sum card">
          <div><dt>{t('hs.dep.billed')}</dt><dd>{formatINR(toPaise(h.deposit.billed))}</dd></div>
          <div><dt>{t('hs.dep.paid')}</dt><dd>{formatINR(toPaise(h.deposit.paid))}</dd></div>
          <div><dt>{t('hs.dep.damages')}</dt><dd>{formatINR(toPaise(h.deposit.damagesCharged) + toPaise(h.deposit.damagesPending))}{toPaise(h.deposit.damagesPending) > 0 && <span className="muted small"> ({t('hs.dep.pending')})</span>}</dd></div>
          <div><dt>{t('hs.dep.refundable')}</dt><dd><strong>{formatINR(toPaise(h.deposit.refundable))}</strong></dd></div>
        </dl>
      )}
      {h.stays.filter((s) => s !== current).length > 0 && (
        <>
          <h3 className="section-title">{t('tr.earlier')}</h3>
          <ul className="pt-list">
            {h.stays.filter((s) => s !== current).map((s) => (
              <li key={s.id}>
                <span className="pt-list-main"><strong>{s.hostel} · {s.roomNo}-{s.bedNo}</strong><span className="muted small">{day(s.checkInDate)} – {day(s.checkOutDate)}{s.endReason ? ` · ${s.endReason}` : ''}{s.damages.map((d) => ` · ${d.description} ${formatINR(toPaise(d.amount))} (${t(`hs.dmg.${d.status}` as MessageKey)})`).join('')}</span></span>
                <StatusBadge status={s.status === 'VACATED' ? 'CLOSED' : s.status} label={t(`hs.astatus.${s.status}` as MessageKey)} />
              </li>
            ))}
          </ul>
        </>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('hs.allot')} subtitle={t('hs.allotSub')} onSubmit={save} submitLabel={t('hs.allot')} busy={busy || !free} error={error} submitDisabled={!form.bedId}>
        {!free ? <SkeletonRows rows={3} /> : free.hostels.every((x) => !x.rooms.length) ? <p className="muted">{t('hs.noFreeBeds')}</p> : (
          <>
            <Field id="sa-h" label={t('hs.hostel')}><select id="sa-h" value={String(form.hostelId)} onChange={(e) => { const x = free.hostels.find((y) => y.id === e.target.value); setForm((f) => ({ ...f, hostelId: e.target.value, roomId: x?.rooms[0]?.id ?? '', bedId: x?.rooms[0]?.beds[0]?.id ?? '' })); }}>{free.hostels.filter((x) => x.rooms.length).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
            <div className="grid-2">
              <Field id="sa-r" label={t('hs.roomNo')}><select id="sa-r" value={String(form.roomId)} onChange={(e) => { const r = hostel?.rooms.find((y) => y.id === e.target.value); setForm((f) => ({ ...f, roomId: e.target.value, bedId: r?.beds[0]?.id ?? '' })); }}>{(hostel?.rooms ?? []).map((r) => <option key={r.id} value={r.id}>{r.roomNo} · {t(`hs.room.${r.roomType}` as MessageKey)}{r.isAc ? ' · AC' : ''} · {formatINR(toPaise(r.feeAmount))}</option>)}</select></Field>
              <Field id="sa-b" label={t('hs.bed')}><select id="sa-b" value={String(form.bedId)} onChange={(e) => setForm((f) => ({ ...f, bedId: e.target.value }))}>{(room?.beds ?? []).map((b) => <option key={b.id} value={b.id}>{b.bedNo}</option>)}</select></Field>
            </div>
            <Field id="sa-d" label={t('hs.checkInDate')}><input id="sa-d" type="date" value={String(form.checkInDate)} onChange={(e) => setForm((f) => ({ ...f, checkInDate: e.target.value }))} /></Field>
            <label className="check"><input type="checkbox" checked={!!form.bill} disabled={!free.hasHostelHead} onChange={(e) => setForm((f) => ({ ...f, bill: e.target.checked }))} /> {t('hs.billIt')}</label>
            <p className="muted small">{free.hasHostelHead ? t('hs.billHint') : t('hs.noFeeHead')}{hostel && toPaise(hostel.depositAmount) > 0 ? ` ${t('hs.depNote', { amount: formatINR(toPaise(hostel.depositAmount)) })}` : ''}</p>
          </>
        )}
      </Modal>
    </>
  );
}
