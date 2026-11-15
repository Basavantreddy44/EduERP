'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';

export interface AdmYear { id: string; name: string; isCurrent: boolean }
export interface AdmProgram { id: string; name: string; campusId: string; campus: { code: string; name: string }; levels: { id: string; name: string }[] }
export interface AdmOptions { years: AdmYear[]; programs: AdmProgram[] }

/** Open years and the classes this user takes admissions for (GET /admissions/options). */
export function useAdmissionOptions() {
  const [opts, setOpts] = useState<AdmOptions | null>(null);
  useEffect(() => {
    api<AdmOptions>('/admissions/options').then(setOpts).catch(() => setOpts({ years: [], programs: [] }));
  }, []);
  const currentYear = opts?.years.find((y) => y.isCurrent)?.id ?? opts?.years[0]?.id ?? '';
  const campusOfLevel = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of opts?.programs ?? []) for (const l of p.levels) m.set(l.id, p.campusId);
    return m;
  }, [opts]);
  return { opts, currentYear, campusOfLevel };
}

/** One select for campus + class: options grouped "Campus · Programme". Follows the campus chosen in the top bar. */
export function ClassSelect({ id, value, onChange, programs, invalid }: { id: string; value: string; onChange: (levelId: string) => void; programs: AdmProgram[]; invalid?: boolean }) {
  const { campusId } = useSession();
  const { t } = useI18n();
  const shown = programs.filter((p) => !campusId || p.campusId === campusId);
  const multiCampus = new Set(shown.map((p) => p.campusId)).size > 1;
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid || undefined}>
      <option value="">{t('adm.chooseClass')}</option>
      {shown.map((p) => (
        <optgroup key={p.id} label={multiCampus ? `${p.campus.name} · ${p.name}` : p.name}>
          {p.levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

/** Dates stored as calendar days (UTC midnight) shown in the user's language. */
export function useDay() {
  const { locale } = useI18n();
  return (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
}

/** Today in India as YYYY-MM-DD (matches the server's working day). */
export const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
