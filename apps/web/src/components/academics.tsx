'use client';

import { ReactNode, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import type { IconName } from '@/components/Icon';

/** Academics I (Phase 8) shared pieces: section picker and the week grid. */

export interface AcadSection { id: string; name: string; program: string; campusId: string; campus: string; programLevelId: string; mine: boolean }
export interface Period { id: string; name: string; startTime: string; endTime: string; isBreak: boolean }
export interface Lesson { id: string; dayOfWeek: number; periodId: string; subjectId: string; employeeId: string; roomId: string | null; subject: string; subjectCode: string; teacher: string; room: string | null; section?: string | null }
export interface Sub { id: string; date: string; status: string; reason: string; timetableEntryId: string; section: string; period: string; startTime: string | null; subject: string; absent: string; substitute: string }
export interface StaffOpt { id: string; name: string; code: string; designation: string | null }

export const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const dayKey = (d: number) => `ac.day.${d}` as MessageKey;
export const dayShortKey = (d: number) => `ac.dayShort.${d}` as MessageKey;
/** 1 = Monday … 7 = Sunday, for a yyyy-mm-dd date. */
export const weekdayOf = (d: string) => ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
export const hm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');

/** The current-year sections the user may work with (a teacher's own first). */
export function useAcadSections() {
  const [rows, setRows] = useState<AcadSection[] | null>(null);
  useEffect(() => { api<AcadSection[]>('/academics/sections').then((r) => setRows([...r.filter((s) => s.mine), ...r.filter((s) => !s.mine)])).catch(() => setRows([])); }, []);
  return rows;
}

/** A labelled section select, grouped by course; remembers the choice in the address (?section=). */
export function SectionSelect({ sections, value, onChange, id = 'ac-section' }: { sections: AcadSection[]; value: string; onChange: (id: string) => void; id?: string }) {
  const { t } = useI18n();
  const mine = sections.filter((s) => s.mine);
  const groups = [...new Set(sections.filter((s) => !s.mine).map((s) => s.program))];
  return (
    <label className="ac-picker" htmlFor={id}>
      <span>{t('ac.section')}</span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {mine.length > 0 && <optgroup label={t('ac.myClasses')}>{mine.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>}
        {groups.map((g) => <optgroup key={g} label={g}>{sections.filter((s) => !s.mine && s.program === g).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>)}
      </select>
    </label>
  );
}

/** Reads/writes ?section= so a refresh or a shared link opens the same class. */
export function useSectionParam(sections: AcadSection[] | null) {
  const [id, setId] = useState('');
  useEffect(() => {
    if (!sections?.length) return;
    const q = new URLSearchParams(window.location.search).get('section');
    setId(q && sections.some((s) => s.id === q) ? q : sections[0].id);
  }, [sections]);
  const choose = (v: string) => {
    setId(v);
    const u = new URL(window.location.href); u.searchParams.set('section', v); history.replaceState(null, '', u);
  };
  return [id, choose] as const;
}

/** Days that have lessons, at least Monday–Saturday. */
export const shownDays = (lessons: { dayOfWeek: number }[]) => DAYS.filter((d) => d <= 6 || lessons.some((l) => l.dayOfWeek === d));

/**
 * The week as a table: periods down, days across. `cell` renders one slot; breaks span the row.
 * On phones the table scrolls sideways inside its card (the page itself never does).
 */
export function WeekGrid({ periods, days, cell, label }: { periods: Period[]; days: readonly number[]; cell: (day: number, p: Period) => ReactNode; label: string }) {
  const { t } = useI18n();
  return (
    <div className="table-wrap card" role="region" aria-label={label} tabIndex={0}>
      <table className="table tt-grid">
        <thead>
          <tr><th scope="col" className="tt-period-h">{t('ac.period')}</th>{days.map((d) => <th key={d} scope="col"><span className="tt-day-long">{t(dayKey(d))}</span><span className="tt-day-short" aria-hidden="true">{t(dayShortKey(d))}</span></th>)}</tr>
        </thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p.id} className={p.isBreak ? 'tt-break' : undefined}>
              <th scope="row" className="tt-period"><strong>{p.name}</strong><span className="muted small">{hm(p.startTime)}–{hm(p.endTime)}</span></th>
              {p.isBreak ? <td colSpan={days.length} className="tt-break-cell">{p.name}</td> : days.map((d) => <td key={d} className="tt-cell">{cell(d, p)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One lesson inside a grid cell. */
export function LessonChip({ l, show = 'teacher', sub }: { l: Pick<Lesson, 'subject' | 'subjectCode' | 'teacher' | 'room'> & { section?: string | null }; show?: 'teacher' | 'section'; sub?: string | null }) {
  const { t } = useI18n();
  return (
    <div className={`tt-lesson${sub ? ' tt-subbed' : ''}`}>
      <strong title={l.subject}>{l.subject}</strong>
      <span>{show === 'section' ? l.section : l.teacher}</span>
      {l.room && <span className="muted">{l.room}</span>}
      {sub && <span className="tt-sub-note">{t('ac.subBy', { name: sub })}</span>}
    </div>
  );
}

/** Icon for each kind of study material. */
export const MATERIAL_ICON: Record<string, IconName> = { NOTE: 'clipboard', LINK: 'route', VIDEO: 'eye', FILE: 'file' };
