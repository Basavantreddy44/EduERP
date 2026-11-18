'use client';

import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';

/** Hostel (Phase 7) shared pieces for the web screens. */

export interface HostelRow {
  id: string; campusId: string; name: string; hostelType: string; status: string; depositAmount: string; wardenEmployeeId: string | null;
  warden: { id: string; name: string; phone: string | null } | null;
  rooms: number; beds: number; vacant: number; reserved: number; occupied: number; blocked: number;
}
export interface Bed { id: string; bedNo: string; status: string; blockedReason: string | null; occupant: { allotmentId: string; studentId: string; name: string; admissionNo: string; status: string } | null }
export interface Room {
  id: string; hostelId: string; block: string | null; floor: string | null; roomNo: string; roomType: string; capacity: number; isAc: boolean; feeAmount: string; status: string;
  beds: Bed[]; inventory: { id: string; itemName: string; quantity: number; unitCost: string }[];
}
export interface Resident { id: string; status: string; checkInDate: string; studentId: string; name: string; admissionNo: string; roomNo: string; bedNo: string; block: string | null; floor: string | null; guardianName: string | null; guardianPhone: string | null }

/** Occupancy as one stacked bar with a legend (counts in text, never colour alone). */
export function OccupancyBar({ h }: { h: Pick<HostelRow, 'beds' | 'occupied' | 'reserved' | 'vacant' | 'blocked'> }) {
  const { t } = useI18n();
  const parts = [['occupied', h.occupied], ['reserved', h.reserved], ['vacant', h.vacant], ['blocked', h.blocked]] as const;
  const total = Math.max(1, h.beds);
  return (
    <div className="occ">
      <div className="occ-bar" role="img" aria-label={parts.map(([k, n]) => `${t(`hs.bed.${k}` as MessageKey)}: ${n}`).join(', ')}>
        {parts.map(([k, n]) => (n ? <span key={k} className={`occ-${k}`} style={{ width: `${(n / total) * 100}%` }} /> : null))}
      </div>
      <ul className="occ-legend">
        {parts.map(([k, n]) => <li key={k}><i className={`occ-dot occ-${k}`} aria-hidden="true" />{t(`hs.bed.${k}` as MessageKey)} <strong>{n}</strong></li>)}
      </ul>
    </div>
  );
}

/** "11 Nov, 6:30 pm" in India time. */
export const when = (iso: string | null | undefined, locale: string) => (iso ? new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—');

/** datetime-local value (India time) → ISO with offset. */
export const localToIso = (v: string) => (v ? new Date(`${v}:00+05:30`).toISOString() : '');
export const isoToLocal = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 16);
