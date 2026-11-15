'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Campus select for forms. Institution-wide users also get "Whole institution" (value ''),
 * campus-limited users only see their campuses (the API filters the list).
 */
export function CampusPicker({ id, value, onChange, allowInstitution, institutionLabel = 'Whole institution' }: { id: string; value: string; onChange: (v: string) => void; allowInstitution: boolean; institutionLabel?: string }) {
  const [campuses, setCampuses] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    api<{ id: string; name: string }[]>('/campuses').then(setCampuses).catch(() => setCampuses([]));
  }, []);
  useEffect(() => {
    if (!allowInstitution && !value && campuses[0]) onChange(campuses[0].id);
  }, [allowInstitution, value, campuses, onChange]);
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {allowInstitution && <option value="">{institutionLabel}</option>}
      {campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}
