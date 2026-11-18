'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { PageHeader, SkeletonRows } from '@/components/ui';
import { HostelRow, OccupancyBar, Resident, Room } from '@/components/hostel';
import { ResidentsTab, RollCallTab, RoomsTab } from '@/components/hostel-rooms';
import { HomeGoingTab, MaintenanceTab, OutpassTab, VisitorsTab } from '@/components/hostel-life';

type Tab = 'rooms' | 'residents' | 'roll' | 'outpass' | 'home' | 'visitors' | 'maint';
const TABS: Tab[] = ['rooms', 'residents', 'roll', 'outpass', 'home', 'visitors', 'maint'];

/** One hostel (Phase 7): rooms board, residents, night roll-call, outpasses, home-going, visitors, maintenance. */
export default function HostelPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('rooms');
  const [hostel, setHostel] = useState<HostelRow | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [residents, setResidents] = useState<Resident[] | null>(null);
  const load = useCallback(() => {
    api<HostelRow[]>('/hostel/hostels').then((r) => setHostel(r.find((x) => x.id === id) ?? null)).catch(() => setHostel(null));
    api<{ rooms: Room[] }>(`/hostel/hostels/${id}/rooms`).then((r) => setRooms(r.rooms)).catch(() => setRooms([]));
    api<Resident[]>(`/hostel/hostels/${id}/residents`).then(setResidents).catch(() => setResidents([]));
  }, [id]);
  useEffect(load, [load]);
  useEffect(() => { const h = window.location.hash.slice(1) as Tab; if (TABS.includes(h)) setTab(h); }, []);
  const pick = (x: Tab) => { setTab(x); history.replaceState(null, '', `#${x}`); };
  if (!hostel) return <SkeletonRows rows={6} />;
  const warden = can(PERMISSIONS.HOSTEL_WARDEN);

  return (
    <>
      <Link href="/hostel" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('hs.title')}</Link>
      <PageHeader eyebrow={t(`hs.type.${hostel.hostelType}` as MessageKey)} title={hostel.name}
        description={[hostel.warden ? `${t('hs.warden')}: ${hostel.warden.name}${hostel.warden.phone ? ` (${hostel.warden.phone})` : ''}` : t('hs.noWarden'), t('hs.nRooms', { n: hostel.rooms })].join(' · ')} />
      <div className="card hostel-occ"><OccupancyBar h={hostel} /></div>
      <div className="tabs scroll" role="tablist" aria-label={hostel.name}>
        {TABS.map((x) => (
          <button key={x} role="tab" type="button" id={`tab-${x}`} aria-selected={tab === x} aria-controls={`panel-${x}`} className={tab === x ? 'on' : ''} onClick={() => pick(x)}>
            {t(`hs.tab.${x}` as MessageKey)}{x === 'residents' && residents ? <span className="tab-count">{residents.length}</span> : null}
          </button>
        ))}
      </div>
      <section role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="tr-panel">
        {tab === 'rooms' && <RoomsTab hostelId={id} rooms={rooms} manage={can(PERMISSIONS.HOSTEL_MANAGE)} allot={can(PERMISSIONS.HOSTEL_ALLOT)} reload={load} />}
        {tab === 'residents' && <ResidentsTab residents={residents} rooms={rooms} allot={can(PERMISSIONS.HOSTEL_ALLOT)} reload={load} />}
        {tab === 'roll' && <RollCallTab hostelId={id} warden={warden} />}
        {tab === 'outpass' && <OutpassTab hostelId={id} residents={residents} warden={warden} />}
        {tab === 'home' && <HomeGoingTab hostelId={id} residents={residents} warden={warden} />}
        {tab === 'visitors' && <VisitorsTab hostelId={id} residents={residents} warden={warden} />}
        {tab === 'maint' && <MaintenanceTab hostelId={id} rooms={rooms} warden={warden} />}
      </section>
    </>
  );
}
