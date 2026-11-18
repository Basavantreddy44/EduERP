'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export interface AttPeriod { id: string; name: string; startTime: string; endTime: string; isBreak: boolean }
export interface AttOptions {
  year: { id: string; name: string; startDate: string; endDate: string } | null;
  today: string;
  campuses: { id: string; code: string; name: string; mode: 'DAILY' | 'PERIOD'; weeklyOff: string; periods: AttPeriod[] }[];
  sections: { id: string; name: string; campusId: string; level: { id: string; name: string; program: { name: string } } }[];
}

export function useAttendanceOptions() {
  const [opts, setOpts] = useState<AttOptions | null>(null);
  useEffect(() => { api<AttOptions>('/attendance/options').then(setOpts).catch(() => setOpts({ year: null, today: '', campuses: [], sections: [] })); }, []);
  return opts;
}

export const ATT_SHORT: Record<string, string> = { PRESENT: 'P', ABSENT: 'A', LATE: 'L', HALF_DAY: 'H', LEAVE: 'LV' };
