'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { ITEM_CONDITIONS, ROLL_STATUSES, ROOM_STATUSES, ROOM_TYPES, formatINR, toPaise } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from './Icon';
import { Field, Modal } from './Modal';
import { EmptyState, SkeletonRows, StatusBadge, useToast } from './ui';
import { todayIST, useDay } from './admissions';
import { PersonPick, PersonSearch } from './leave';
import { Bed, Resident, Room } from './hostel';

type Dialog =
  | { kind: 'room'; room: Room | null }
  | { kind: 'bulk' }
  | { kind: 'inventory'; room: Room }
  | { kind: 'allot'; room: Room; bed: Bed }
  | { kind: 'bed'; room: Room; bed: Bed };

/** Rooms board (M7.1): every room with its beds; add rooms, edit a room and its items, allot a free bed. */
export function RoomsTab({ hostelId, rooms, manage, allot, reload }: { hostelId: string; rooms: Room[] | null; manage: boolean; allot: boolean; reload: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [items, setItems] = useState<{ id?: string; itemName: string; quantity: string; unitCost: string }[]>([]);
  const [who, setWho] = useState<PersonPick | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const open = (d: Dialog) => {
    setErrors({}); setError(null); setWho(null);
    if (d.kind === 'room') setForm(d.room ? { roomNo: d.room.roomNo, block: d.room.block ?? '', floor: d.room.floor ?? '', roomType: d.room.roomType, capacity: String(d.room.capacity), isAc: d.room.isAc, feeAmount: String(Number(d.room.feeAmount)), status: d.room.status } : { roomNo: '', block: '', floor: '', roomType: 'DOUBLE', capacity: '2', isAc: false, feeAmount: '' });
    if (d.kind === 'bulk') setForm({ block: '', floor: '', prefix: '', from: '101', to: '110', roomType: 'TRIPLE', capacity: '3', isAc: false, feeAmount: '' });
    if (d.kind === 'inventory') setItems(d.room.inventory.length ? d.room.inventory.map((i) => ({ id: i.id, itemName: i.itemName, quantity: String(i.quantity), unitCost: String(Number(i.unitCost)) })) : [{ itemName: 'Cot', quantity: '1', unitCost: '' }, { itemName: 'Mattress', quantity: '1', unitCost: '' }]);
    if (d.kind === 'allot') setForm({ checkInDate: todayIST(), bill: true });
    if (d.kind === 'bed') setForm({ reason: '' });
    setDialog(d);
  };
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!dialog) return;
    setBusy(true); setErrors({}); setError(null);
    const empty = (v: unknown) => (String(v ?? '').trim() === '' ? null : String(v).trim());
    try {
      if (dialog.kind === 'room') {
        const body = { roomNo: form.roomNo, block: empty(form.block), floor: empty(form.floor), roomType: form.roomType, capacity: Number(form.capacity), isAc: !!form.isAc, feeAmount: form.feeAmount || '0', ...(dialog.room ? { status: form.status } : {}) };
        await api(dialog.room ? `/hostel/rooms/${dialog.room.id}` : `/hostel/hostels/${hostelId}/rooms`, { method: dialog.room ? 'PATCH' : 'POST', body: JSON.stringify(body) });
        toast(t('hs.roomSaved'));
      } else if (dialog.kind === 'bulk') {
        const r = await api<{ created: number }>(`/hostel/hostels/${hostelId}/rooms/bulk`, { method: 'POST', body: JSON.stringify({ block: empty(form.block), floor: empty(form.floor), prefix: form.prefix, from: Number(form.from), to: Number(form.to), roomType: form.roomType, capacity: Number(form.capacity), isAc: !!form.isAc, feeAmount: form.feeAmount || '0' }) });
        toast(t('hs.roomsAdded', { n: r.created }));
      } else if (dialog.kind === 'inventory') {
        await api(`/hostel/rooms/${dialog.room.id}/inventory`, { method: 'PUT', body: JSON.stringify({ items: items.filter((i) => i.itemName.trim()).map((i) => ({ id: i.id, itemName: i.itemName, quantity: Number(i.quantity || 1), unitCost: i.unitCost || '0' })) }) });
        toast(t('hs.itemsSaved'));
      } else if (dialog.kind === 'allot') {
        if (!who) { setError(t('hs.chooseStudent')); return; }
        const r = await api<{ billed: { room?: string; deposit?: string } }>('/hostel/allotments', { method: 'POST', body: JSON.stringify({ studentId: who.id, bedId: dialog.bed.id, checkInDate: form.checkInDate, bill: !!form.bill }) });
        const billed = [r.billed.room && formatINR(toPaise(r.billed.room)), r.billed.deposit && `${t('hs.deposit')} ${formatINR(toPaise(r.billed.deposit))}`].filter(Boolean).join(' + ');
        toast(billed ? t('hs.allottedBilled', { amount: billed }) : t('hs.allotted'));
      } else if (dialog.kind === 'bed') {
        await api(`/hostel/beds/${dialog.bed.id}`, { method: 'PATCH', body: JSON.stringify({ status: dialog.bed.status === 'BLOCKED' ? 'VACANT' : 'BLOCKED', reason: empty(form.reason) }) });
        toast(t('hs.bedSaved'));
      }
      setDialog(null); reload();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message ?? Object.values(a.fields)[0] ?? null); } finally { setBusy(false); }
  };

  if (!rooms) return <SkeletonRows rows={4} />;
  // Ground floor first (G / GF / 0), then 1, 2, 3…, then anything else alphabetically.
  const floorRank = (f: string) => (/^(g|gf|ground|0)$/i.test(f) ? -1 : /^\d+$/.test(f) ? Number(f) : 1000);
  const floors = [...new Set(rooms.map((r) => r.floor ?? ''))].sort((a, b) => floorRank(a) - floorRank(b) || a.localeCompare(b));
  return (
    <>
      {manage && (
        <div className="panel-head">
          <p className="muted small">{t('hs.roomsHint')}</p>
          <span className="btn-row">
            <button type="button" className="btn btn-sm" onClick={() => open({ kind: 'bulk' })}><Icon name="layers" size={14} /> {t('hs.addRooms')}</button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => open({ kind: 'room', room: null })}><Icon name="plus" size={14} /> {t('hs.addRoom')}</button>
          </span>
        </div>
      )}
      {rooms.length === 0 ? <EmptyState icon="building" title={t('hs.noRooms')} text={t('hs.noRoomsHint')} /> : floors.map((f) => (
        <section key={f || 'none'} className="floor">
          {floors.length > 1 && <h3 className="section-title">{f ? t('hs.floor', { f }) : t('hs.noFloor')}</h3>}
          <ul className="room-grid">
            {rooms.filter((r) => (r.floor ?? '') === f).map((r) => (
              <li key={r.id} className={`card room-card ${r.status !== 'AVAILABLE' ? 'room-off' : ''}`}>
                <div className="room-head">
                  <strong>{r.roomNo}</strong>
                  <span className="muted small">{t(`hs.room.${r.roomType}` as MessageKey)}{r.isAc ? ' · AC' : ''} · {formatINR(toPaise(r.feeAmount))}/{t('tr.year')}</span>
                  {r.status !== 'AVAILABLE' && <StatusBadge status={r.status} label={t(`hs.rstatus.${r.status}` as MessageKey)} />}
                </div>
                <ul className="bed-list">
                  {r.beds.map((b) => (
                    <li key={b.id}>
                      {b.occupant ? (
                        // Someone has the bed: a plain row with a link to the student (no nested controls).
                        <div className={`bed bed-${b.status.toLowerCase()}`}>
                          <span className="bed-no" aria-hidden="true">{b.bedNo}</span>
                          <span className="bed-who"><span className="sr-only">{t('hs.bed')} {b.bedNo}: </span><Link href={`/students/${b.occupant.studentId}`}>{b.occupant.name}</Link></span>
                          {b.occupant.status === 'RESERVED' && <span className="bed-tag">{t('hs.reservedTag')}</span>}
                        </div>
                      ) : (
                        <button type="button" className={`bed bed-${b.status.toLowerCase()}`}
                          disabled={!((b.status === 'VACANT' && r.status === 'AVAILABLE' && allot) || ((b.status === 'VACANT' || b.status === 'BLOCKED') && manage))}
                          onClick={() => (b.status === 'VACANT' && r.status === 'AVAILABLE' && allot ? open({ kind: 'allot', room: r, bed: b }) : open({ kind: 'bed', room: r, bed: b }))}
                          aria-label={`${r.roomNo}-${b.bedNo}: ${t(`hs.bed.${b.status.toLowerCase()}` as MessageKey)}`}>
                          <span className="bed-no">{b.bedNo}</span>
                          <span className="bed-who">{t(`hs.bed.${b.status.toLowerCase()}` as MessageKey)}</span>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {manage && (
                  <div className="room-actions">
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => open({ kind: 'room', room: r })}><Icon name="edit" size={14} /> {t('hs.editRoom')}</button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => open({ kind: 'inventory', room: r })}><Icon name="clipboard" size={14} /> {t('hs.items', { n: r.inventory.length })}</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <Modal open={dialog?.kind === 'room'} onClose={() => setDialog(null)} title={dialog?.kind === 'room' && dialog.room ? t('hs.editRoomN', { no: dialog.room.roomNo }) : t('hs.addRoom')} onSubmit={save} submitLabel={t('tr.save')} busy={busy} error={error}>
        <div className="grid-2">
          <Field id="rm-no" label={t('hs.roomNo')} error={errors.roomNo}><input id="rm-no" value={String(form.roomNo ?? '')} onChange={set('roomNo')} /></Field>
          <Field id="rm-type" label={t('hs.roomType')} error={errors.roomType}><select id="rm-type" value={String(form.roomType)} onChange={set('roomType')}>{ROOM_TYPES.map((x) => <option key={x} value={x}>{t(`hs.room.${x}` as MessageKey)}</option>)}</select></Field>
          <Field id="rm-block" label={t('hs.block')} error={errors.block}><input id="rm-block" value={String(form.block ?? '')} onChange={set('block')} /></Field>
          <Field id="rm-floor" label={t('hs.floorLabel')} error={errors.floor}><input id="rm-floor" value={String(form.floor ?? '')} onChange={set('floor')} /></Field>
          <Field id="rm-cap" label={t('hs.beds')} error={errors.capacity}><input id="rm-cap" type="number" min={1} max={40} value={String(form.capacity ?? '')} onChange={set('capacity')} /></Field>
          <Field id="rm-fee" label={t('hs.yearFee')} error={errors.feeAmount}><input id="rm-fee" type="number" min={0} value={String(form.feeAmount ?? '')} onChange={set('feeAmount')} /></Field>
          {dialog?.kind === 'room' && dialog.room && <Field id="rm-status" label={t('common.status')} error={errors.status}><select id="rm-status" value={String(form.status)} onChange={set('status')}>{ROOM_STATUSES.map((x) => <option key={x} value={x}>{t(`hs.rstatus.${x}` as MessageKey)}</option>)}</select></Field>}
        </div>
        <label className="check"><input type="checkbox" checked={!!form.isAc} onChange={(e) => setForm((f) => ({ ...f, isAc: e.target.checked }))} /> {t('hs.ac')}</label>
      </Modal>

      <Modal open={dialog?.kind === 'bulk'} onClose={() => setDialog(null)} title={t('hs.addRooms')} subtitle={t('hs.addRoomsSub')} onSubmit={save} submitLabel={t('hs.create')} busy={busy} error={error}>
        <div className="grid-2">
          <Field id="bk-prefix" label={t('hs.prefix')} hint={t('hs.prefixHint')}><input id="bk-prefix" value={String(form.prefix ?? '')} onChange={set('prefix')} /></Field>
          <Field id="bk-floor" label={t('hs.floorLabel')}><input id="bk-floor" value={String(form.floor ?? '')} onChange={set('floor')} /></Field>
          <Field id="bk-from" label={t('hs.fromNo')} error={errors.from}><input id="bk-from" type="number" value={String(form.from ?? '')} onChange={set('from')} /></Field>
          <Field id="bk-to" label={t('hs.toNo')} error={errors.to}><input id="bk-to" type="number" value={String(form.to ?? '')} onChange={set('to')} /></Field>
          <Field id="bk-type" label={t('hs.roomType')}><select id="bk-type" value={String(form.roomType)} onChange={set('roomType')}>{ROOM_TYPES.map((x) => <option key={x} value={x}>{t(`hs.room.${x}` as MessageKey)}</option>)}</select></Field>
          <Field id="bk-cap" label={t('hs.beds')} error={errors.capacity}><input id="bk-cap" type="number" min={1} max={40} value={String(form.capacity ?? '')} onChange={set('capacity')} /></Field>
          <Field id="bk-fee" label={t('hs.yearFee')} error={errors.feeAmount}><input id="bk-fee" type="number" min={0} value={String(form.feeAmount ?? '')} onChange={set('feeAmount')} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={!!form.isAc} onChange={(e) => setForm((f) => ({ ...f, isAc: e.target.checked }))} /> {t('hs.ac')}</label>
      </Modal>

      <Modal open={dialog?.kind === 'inventory'} onClose={() => setDialog(null)} title={dialog?.kind === 'inventory' ? t('hs.itemsOf', { no: dialog.room.roomNo }) : ''} subtitle={t('hs.itemsSub')} onSubmit={save} submitLabel={t('tr.save')} busy={busy} error={error} wide>
        <table className="table inv-edit">
          <thead><tr><th>{t('hs.item')}</th><th>{t('hs.qty')}</th><th>{t('hs.cost')}</th><th aria-label={t('tr.removeStop')} /></tr></thead>
          <tbody>
            {items.map((i, k) => (
              <tr key={i.id ?? `n${k}`}>
                <td><input aria-label={t('hs.item')} value={i.itemName} onChange={(e) => setItems((a) => a.map((x, j) => (j === k ? { ...x, itemName: e.target.value } : x)))} /></td>
                <td><input aria-label={t('hs.qty')} type="number" min={1} value={i.quantity} onChange={(e) => setItems((a) => a.map((x, j) => (j === k ? { ...x, quantity: e.target.value } : x)))} /></td>
                <td><input aria-label={t('hs.cost')} type="number" min={0} value={i.unitCost} onChange={(e) => setItems((a) => a.map((x, j) => (j === k ? { ...x, unitCost: e.target.value } : x)))} /></td>
                <td><button type="button" className="btn btn-ghost icon-btn danger-text" aria-label={t('hs.removeItem')} onClick={() => setItems((a) => a.filter((_, j) => j !== k))}><Icon name="trash" size={16} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="btn btn-sm" onClick={() => setItems((a) => [...a, { itemName: '', quantity: '1', unitCost: '' }])}><Icon name="plus" size={14} /> {t('hs.addItem')}</button>
      </Modal>

      <Modal open={dialog?.kind === 'allot'} onClose={() => setDialog(null)} title={dialog?.kind === 'allot' ? t('hs.allotBed', { bed: `${dialog.room.roomNo}-${dialog.bed.bedNo}` }) : ''} subtitle={t('hs.allotSub')} onSubmit={save} submitLabel={t('hs.allot')} busy={busy} error={error}>
        <Field id="lv-who" label={t('tr.col.student')}><PersonSearch kind="STUDENT" value={who} onPick={setWho} /></Field>
        <Field id="al-date" label={t('hs.checkInDate')} error={errors.checkInDate}><input id="al-date" type="date" value={String(form.checkInDate ?? '')} onChange={set('checkInDate')} /></Field>
        <label className="check"><input type="checkbox" checked={!!form.bill} onChange={(e) => setForm((f) => ({ ...f, bill: e.target.checked }))} /> {t('hs.billIt')}</label>
        <p className="muted small">{t('hs.billHint')}</p>
      </Modal>

      <Modal open={dialog?.kind === 'bed'} onClose={() => setDialog(null)} title={dialog?.kind === 'bed' ? (dialog.bed.status === 'BLOCKED' ? t('hs.unblockBed') : t('hs.blockBed')) : ''} onSubmit={save} submitLabel={t('tr.save')} busy={busy} error={error}>
        {dialog?.kind === 'bed' && dialog.bed.status !== 'BLOCKED' && <Field id="bd-reason" label={t('tr.reason')}><input id="bd-reason" value={String(form.reason ?? '')} onChange={set('reason')} placeholder={t('hs.blockPh')} /></Field>}
        {dialog?.kind === 'bed' && dialog.bed.status === 'BLOCKED' && <p className="muted">{dialog.bed.blockedReason ?? ''}</p>}
      </Modal>
    </>
  );
}

/** Residents (M7.2): check in, check out (item conditions), change room. */
export function ResidentsTab({ residents, rooms, allot, reload }: { residents: Resident[] | null; rooms: Room[] | null; allot: boolean; reload: () => void }) {
  const { t } = useI18n();
  const day = useDay();
  const toast = useToast();
  const [d, setD] = useState<{ kind: 'in' | 'out' | 'move'; r: Resident } | null>(null);
  const [cond, setCond] = useState<Record<string, string>>({});
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const roomOf = (r: Resident) => rooms?.find((x) => x.roomNo === r.roomNo) ?? null;
  const open = (kind: 'in' | 'out' | 'move', r: Resident) => {
    setError(null);
    setCond(Object.fromEntries((roomOf(r)?.inventory ?? []).map((i) => [i.id, 'GOOD'])));
    setForm(kind === 'move' ? { bedId: '', date: todayIST(), reason: '' } : { checkOutDate: todayIST(), reason: '' });
    setD({ kind, r });
  };
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!d) return;
    setBusy(true); setError(null);
    const items = Object.entries(cond).map(([inventoryItemId, condition]) => ({ inventoryItemId, condition }));
    try {
      if (d.kind === 'in') { await api(`/hostel/allotments/${d.r.id}/check-in`, { method: 'POST', body: JSON.stringify({ items }) }); toast(t('hs.checkedIn', { name: d.r.name })); }
      if (d.kind === 'out') {
        const r = await api<{ damage: { amount: string; status: string } | null; deposit: { refundable: string } }>(`/hostel/allotments/${d.r.id}/vacate`, { method: 'POST', body: JSON.stringify({ checkOutDate: form.checkOutDate, items: d.r.status === 'CHECKED_IN' ? items : [], reason: form.reason || null }) });
        toast(r.damage ? t('hs.outDamage', { amount: formatINR(toPaise(r.damage.amount)), refund: formatINR(toPaise(r.deposit.refundable)) }) : t('hs.checkedOut', { refund: formatINR(toPaise(r.deposit.refundable)) }));
      }
      if (d.kind === 'move') { await api(`/hostel/allotments/${d.r.id}/change-room`, { method: 'POST', body: JSON.stringify(form) }); toast(t('hs.moved')); }
      setD(null); reload();
    } catch (x) { const a = apiErrors(x); setError(a.message ?? Object.values(a.fields)[0] ?? null); } finally { setBusy(false); }
  };
  if (!residents) return <SkeletonRows rows={4} />;
  const room = d ? roomOf(d.r) : null;
  const free = (rooms ?? []).filter((r) => r.status === 'AVAILABLE').flatMap((r) => r.beds.filter((b) => b.status === 'VACANT').map((b) => ({ id: b.id, label: `${r.roomNo}-${b.bedNo}` })));
  return (
    <>
      {residents.length === 0 ? <EmptyState icon="users" title={t('hs.noResidents')} text={t('hs.noResidentsHint')} /> : (
        <div className="table-wrap card">
          <table className="table">
            <thead><tr><th>{t('hs.roomBed')}</th><th>{t('tr.col.student')}</th><th className="hide-sm">{t('tr.col.parent')}</th><th>{t('common.status')}</th><th aria-label={t('hs.actions')} /></tr></thead>
            <tbody>
              {residents.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.roomNo}-{r.bedNo}</strong>{r.floor && <span className="sub-line muted">{t('hs.floor', { f: r.floor })}</span>}</td>
                  <td><Link href={`/students/${r.studentId}`}>{r.name}</Link><span className="sub-line muted mono">{r.admissionNo}</span></td>
                  <td className="hide-sm">{r.guardianName ?? '—'}{r.guardianPhone && <span className="sub-line"><a href={`tel:${r.guardianPhone}`}>{r.guardianPhone}</a></span>}</td>
                  <td><StatusBadge status={r.status} label={t(`hs.astatus.${r.status}` as MessageKey)} /><span className="sub-line muted small">{t('tr.since', { date: day(r.checkInDate) })}</span></td>
                  <td className="row-actions">
                    {allot && r.status === 'RESERVED' && <button type="button" className="btn btn-sm" onClick={() => open('in', r)}>{t('hs.checkIn')}</button>}
                    {allot && r.status === 'CHECKED_IN' && <button type="button" className="btn btn-sm btn-ghost" onClick={() => open('move', r)}>{t('hs.changeRoom')}</button>}
                    {allot && <button type="button" className="btn btn-sm btn-ghost danger-text" onClick={() => open('out', r)}>{r.status === 'RESERVED' ? t('hs.cancel') : t('hs.checkOut')}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!d} onClose={() => setD(null)} title={d ? t(d.kind === 'in' ? 'hs.checkInN' : d.kind === 'out' ? (d.r.status === 'RESERVED' ? 'hs.cancelN' : 'hs.checkOutN') : 'hs.changeRoomN', { name: d.r.name }) : ''}
        subtitle={d?.kind === 'out' && d.r.status === 'CHECKED_IN' ? t('hs.checkOutSub') : d?.kind === 'in' ? t('hs.checkInSub') : undefined} onSubmit={save} submitLabel={t('tr.save')} busy={busy} error={error} danger={d?.kind === 'out'} wide={d?.kind !== 'move'}>
        {d && (d.kind === 'in' || (d.kind === 'out' && d.r.status === 'CHECKED_IN')) && (
          room?.inventory.length ? (
            <ul className="cond-list">
              {room.inventory.map((i) => (
                <li key={i.id}>
                  <span><strong>{i.itemName}</strong> <span className="muted small">× {i.quantity} · {formatINR(toPaise(i.unitCost))}</span></span>
                  <span className="seg" role="radiogroup" aria-label={i.itemName}>
                    {ITEM_CONDITIONS.map((c) => <button key={c} type="button" role="radio" aria-checked={cond[i.id] === c} className={`seg-btn ${cond[i.id] === c ? `on c-${c}` : ''}`} onClick={() => setCond((x) => ({ ...x, [i.id]: c }))}>{t(`hs.cond.${c}` as MessageKey)}</button>)}
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="muted">{t('hs.noItems')}</p>
        )}
        {d?.kind === 'out' && <div className="grid-2"><Field id="vo-date" label={t('hs.checkOutDate')}><input id="vo-date" type="date" value={form.checkOutDate ?? ''} onChange={(e) => setForm((f) => ({ ...f, checkOutDate: e.target.value }))} /></Field><Field id="vo-reason" label={t('tr.reason')}><input id="vo-reason" value={form.reason ?? ''} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} /></Field></div>}
        {d?.kind === 'move' && (
          <>
            <Field id="mv-bed" label={t('hs.newBed')}><select id="mv-bed" value={form.bedId} onChange={(e) => setForm((f) => ({ ...f, bedId: e.target.value }))}><option value="">{t('hs.chooseBed')}</option>{free.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></Field>
            <div className="grid-2">
              <Field id="mv-date" label={t('hs.moveDate')}><input id="mv-date" type="date" value={form.date ?? ''} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></Field>
              <Field id="mv-reason" label={t('tr.reason')}><input id="mv-reason" value={form.reason ?? ''} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} /></Field>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

interface RollRow { studentId: string; name: string; admissionNo: string; roomNo: string; bedNo: string; status: string; saved: boolean; parentNotified: boolean }

/** Night roll-call (M7.3): everyone present by default; mark exceptions; parents of absent students alerted. */
export function RollCallTab({ hostelId, warden }: { hostelId: string; warden: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const [date, setDate] = useState(todayIST());
  const [rows, setRows] = useState<RollRow[] | null>(null);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    setRows(null);
    api<{ students: RollRow[] }>(`/hostel/hostels/${hostelId}/roll-call?date=${date}`)
      .then((r) => { if (live) { setRows(r.students); setMarks(Object.fromEntries(r.students.map((s) => [s.studentId, s.status]))); } })
      .catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [hostelId, date, reload]);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api<{ saved: number; alerted: number }>('/hostel/roll-call', { method: 'POST', body: JSON.stringify({ hostelId, date, records: Object.entries(marks).map(([studentId, status]) => ({ studentId, status })) }) });
      toast(r.alerted ? t('hs.rollSavedAlert', { n: r.alerted }) : t('hs.rollSaved'));
      setReload((n) => n + 1);
    } catch (x) { toast(apiErrors(x).message ?? '', 'bad'); } finally { setBusy(false); }
  };
  const absent = Object.values(marks).filter((s) => s === 'ABSENT').length;
  return (
    <>
      <div className="panel-head">
        <label className="filter"><span>{t('hs.night')}</span><input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} /></label>
        {warden && rows && rows.length > 0 && <button type="button" className="btn btn-primary" disabled={busy} onClick={save}><Icon name="check" size={16} /> {t('hs.saveRoll', { absent })}</button>}
      </div>
      {!rows ? <SkeletonRows rows={5} /> : rows.length === 0 ? <EmptyState icon="users" title={t('hs.noResidents')} /> : (
        <ul className="roll-list">
          {rows.map((r) => (
            <li key={r.studentId} className={marks[r.studentId] === 'ABSENT' ? 'is-absent' : ''}>
              <span className="roll-who"><strong>{r.name}</strong><span className="muted small">{r.roomNo}-{r.bedNo} · {r.admissionNo}{r.parentNotified ? ` · ${t('hs.parentTold')}` : ''}</span></span>
              <span className="seg" role="radiogroup" aria-label={r.name}>
                {ROLL_STATUSES.map((s) => <button key={s} type="button" role="radio" aria-checked={marks[r.studentId] === s} disabled={!warden} className={`seg-btn ${marks[r.studentId] === s ? `on r-${s}` : ''}`} onClick={() => setMarks((m) => ({ ...m, [r.studentId]: s }))}>{t(`hs.roll.${s}` as MessageKey)}</button>)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="soon-line small"><Icon name="phone" size={14} /> {t('hs.smsAlerts')} <span className="soon-badge">{t('common.comingSoon')}</span></p>
    </>
  );
}
