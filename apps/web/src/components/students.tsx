'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export interface StudentOptions {
  year: { id: string; name: string; status: string } | null;
  years: { id: string; name: string; isCurrent: boolean; status: string }[];
  campuses: { id: string; code: string; name: string }[];
  programs: { id: string; name: string; campusId: string; levels: { id: string; name: string }[] }[];
  sections: { id: string; name: string; programLevelId: string; capacity: number; status: string }[];
}

/** Years, classes and sections for the student filters (GET /students/options). */
export function useStudentOptions(academicYearId?: string) {
  const [opts, setOpts] = useState<StudentOptions | null>(null);
  useEffect(() => {
    api<StudentOptions>(`/students/options${academicYearId ? `?academicYearId=${academicYearId}` : ''}`)
      .then(setOpts)
      .catch(() => setOpts({ year: null, years: [], campuses: [], programs: [], sections: [] }));
  }, [academicYearId]);
  return opts;
}

export const studentName = (s: { firstName: string; lastName: string | null }) => `${s.firstName} ${s.lastName ?? ''}`.trim();
export const initials = (s: { firstName: string; lastName: string | null }) =>
  (s.firstName.charAt(0) + (s.lastName?.replace(/[^A-Za-zಀ-೿]/g, '').charAt(0) ?? '')).toUpperCase();

/** Age in completed years on a calendar day (dates are stored as UTC midnight). */
export function ageOn(dob: string, on = new Date()) {
  const d = new Date(dob);
  let a = on.getUTCFullYear() - d.getUTCFullYear();
  if (on.getUTCMonth() < d.getUTCMonth() || (on.getUTCMonth() === d.getUTCMonth() && on.getUTCDate() < d.getUTCDate())) a -= 1;
  return a;
}

export interface SeatOption { id: string; name: string; capacity: number; filled: number; available: number; level?: { name: string; program: { name: string } } }

/** Section cards with a seat meter; full sections cannot be chosen. */
export function SeatPicker({ seats, value, onChange, label, currentId }: { seats: SeatOption[]; value: string; onChange: (id: string) => void; label: string; currentId?: string | null }) {
  const { t } = useI18n();
  return (
    <div className="seat-grid" role="radiogroup" aria-label={label}>
      {seats.map((s) => {
        const current = s.id === currentId;
        const full = s.available === 0 && !current;
        const on = value === s.id;
        return (
          <button key={s.id} type="button" role="radio" aria-checked={on} disabled={full || current} className={`seat-card ${on ? 'on' : ''} ${full ? 'full' : ''} ${current ? 'current' : ''}`} onClick={() => onChange(s.id)}>
            <span className="seat-name">{s.level ? `${s.level.name} – ` : ''}{s.name}</span>
            {s.level && <span className="small muted">{s.level.program.name}</span>}
            <span className="seat-meter" aria-hidden><span style={{ width: `${Math.min(100, (s.filled / s.capacity) * 100)}%` }} /></span>
            <span className="small">{current ? t('stu.sec.current') : full ? t('app.enrol.full') : t('app.enrol.seatsLeft', { n: s.available, cap: s.capacity })}</span>
          </button>
        );
      })}
    </div>
  );
}
