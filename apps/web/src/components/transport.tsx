'use client';

import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from './Icon';

/** Transport (Phase 6) shared pieces for the web screens. */

export type ExpiryState = 'OK' | 'DUE_SOON' | 'EXPIRED' | 'MISSING';

export interface VehicleRow {
  id: string; campusId: string; vehicleNo: string; vehicleType: string; makeModel: string | null; seatingCapacity: number; ownership: string; ownerName: string | null; status: string;
  seatsUsed: number; attention: number;
  documents: { docType: string; id: string | null; docNo: string | null; validTo: string | null; state: ExpiryState; daysLeft: number | null }[];
  routes: { id: string; routeNo: string; name: string }[];
}

export interface CrewRow {
  id: string; employeeId: string; role: string; name: string; employeeCode: string; phone: string | null; campusId: string;
  licenseNo: string | null; licenseExpiry: string | null; badgeNo: string | null; licenseState: ExpiryState | null; status: string; routes: string[];
}

export interface RouteRow {
  id: string; campusId: string; routeNo: string; name: string; shift: string; status: string;
  vehicle: { id: string; vehicleNo: string; seatingCapacity: number; status: string } | null;
  driver: { id: string; name: string; phone: string | null } | null;
  attendant: { id: string; name: string; phone: string | null } | null;
  stopCount: number; firstStop: string | null; lastStop: string | null; startsAt: string | null; seatsUsed: number;
}

/** Vehicle number shown with spaces for reading: KA01AB1234 → KA 01 AB 1234. */
export const fmtVehicleNo = (v: string) => v.replace(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/, (_, a, b, c, d) => [a, b, c, d].filter(Boolean).join(' '));

/** Where a document or licence stands, as a coloured, labelled pill (never colour alone). */
export function ExpiryPill({ state, daysLeft }: { state: ExpiryState; daysLeft?: number | null }) {
  const { t } = useI18n();
  const tone = { OK: 'ok', DUE_SOON: 'warn', EXPIRED: 'bad', MISSING: 'muted' }[state];
  const text = state === 'DUE_SOON' && daysLeft !== null && daysLeft !== undefined ? t('tr.state.dueIn', { n: daysLeft }) : t(`tr.state.${state}` as MessageKey);
  return <span className={`pill pill-${tone}`}><span className="pill-dot" />{text}</span>;
}

/** Seats used out of seats, with a bar that turns amber near full and red when full. */
export function SeatBar({ used, seats }: { used: number; seats: number }) {
  const { t } = useI18n();
  const pct = seats ? Math.min(100, Math.round((used / seats) * 100)) : 0;
  const tone = used >= seats ? 'full' : pct >= 85 ? 'near' : 'ok';
  return (
    <span className={`seat-bar seat-${tone}`} title={t('tr.seatsOf', { used, seats })}>
      <span className="seat-track" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
      <span className="seat-num">{t('tr.seatsOf', { used, seats })}</span>
    </span>
  );
}

/** "Live bus location — Coming soon" (needs GPS devices; owner, 2026-11-17). */
export function LiveTrackingSoon() {
  const { t } = useI18n();
  return (
    <p className="soon-line small"><Icon name="route" size={14} /> {t('tr.live')} <span className="soon-badge">{t('common.comingSoon')}</span></p>
  );
}
