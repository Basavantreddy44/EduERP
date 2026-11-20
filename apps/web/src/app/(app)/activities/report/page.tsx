'use client';

import { useEffect, useState } from 'react';
import { COMPETITION_LEVELS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { EmptyState, PageHeader, SkeletonRows, StatTile } from '@/components/ui';
import { fyStart, todayIST } from '@/components/accounts';
import { saveText, toCsv } from '@/components/payroll';

interface Row { activityId: string; activity: string; activityType: string; competitions: number; entries: number; students: number; gold: number; silver: number; bronze: number; medalsByLevel: Record<string, number> }
interface Report { rows: Row[]; totals: { competitions: number; entries: number; gold: number; silver: number; bronze: number; achievements: number } }

/** Sports & activities → Report (M18.4): participation and medals by activity and level. */
export default function ActivityReportPage() {
  const { t } = useI18n();
  const [from, setFrom] = useState(fyStart());
  const [to, setTo] = useState(todayIST());
  const [r, setR] = useState<Report | null>(null);
  useEffect(() => { setR(null); api<Report>(`/activities/report?from=${from}&to=${to}`).then(setR).catch(() => setR({ rows: [], totals: { competitions: 0, entries: 0, gold: 0, silver: 0, bronze: 0, achievements: 0 } })); }, [from, to]);
  const levels = COMPETITION_LEVELS.filter((l) => (r?.rows ?? []).some((x) => x.medalsByLevel[l] > 0));
  const download = () => {
    if (!r) return;
    const cols = [{ key: 'activity', label: t('act.one') }, { key: 'competitions', label: t('act.rep.competitions') }, { key: 'entries', label: t('act.rep.entries') }, { key: 'students', label: t('act.students') }, { key: 'gold', label: t('act.res.WINNER') }, { key: 'silver', label: t('act.res.RUNNER_UP') }, { key: 'bronze', label: t('act.res.THIRD') }, ...levels.map((l) => ({ key: l, label: t(`act.level.${l}` as MessageKey) }))];
    saveText(`activities-${from}-to-${to}.csv`, toCsv(cols, r.rows.map(({ medalsByLevel, ...x }) => ({ ...x, ...medalsByLevel }))));
  };
  return (
    <>
      <PageHeader eyebrow={t('nav.sports')} title={t('act.rep.title')} description={t('act.rep.desc')} actions={<button type="button" className="btn" onClick={download} disabled={!r?.rows.length}><Icon name="download" /> {t('inv.rep.csv')}</button>} />
      <div className="filter-bar card">
        <label className="inv-f">{t('inv.rep.from')}<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inv-f">{t('inv.rep.to')}<input type="date" value={to} min={from} max={todayIST()} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {!r ? <SkeletonRows rows={4} /> : (
        <>
          <div className="stats pay-stats">
            <StatTile icon="calendar" label={t('act.rep.competitions')} value={r.totals.competitions} />
            <StatTile icon="users" label={t('act.rep.entries')} value={r.totals.entries} />
            <StatTile icon="star" label={t('act.rep.medals')} value={`${r.totals.gold} · ${r.totals.silver} · ${r.totals.bronze}`} hint={t('act.rep.medalsHint')} />
            <StatTile icon="check" label={t('act.rep.achievements')} value={r.totals.achievements} href="/activities/achievements" />
          </div>
          {!r.rows.length ? <EmptyState icon="calendar" title={t('act.rep.none')} /> : (
            <div className="table-wrap card" role="region" aria-label={t('act.rep.title')} tabIndex={0}>
              <table className="table">
                <thead><tr><th scope="col">{t('act.one')}</th><th scope="col" className="num">{t('act.rep.competitions')}</th><th scope="col" className="num">{t('act.rep.entries')}</th><th scope="col" className="num">{t('act.students')}</th><th scope="col" className="num">{t('act.res.WINNER')}</th><th scope="col" className="num">{t('act.res.RUNNER_UP')}</th><th scope="col" className="num">{t('act.res.THIRD')}</th>{levels.map((l) => <th key={l} scope="col" className="num">{t(`act.level.${l}` as MessageKey)}</th>)}</tr></thead>
                <tbody>{r.rows.map((x) => (
                  <tr key={x.activityId}>
                    <td><strong>{x.activity}</strong><span className="sub-line muted small">{t(`act.type.${x.activityType}` as MessageKey)}</span></td>
                    <td className="num">{x.competitions}</td><td className="num">{x.entries}</td><td className="num">{x.students}</td>
                    <td className="num"><strong>{x.gold}</strong></td><td className="num">{x.silver}</td><td className="num">{x.bronze}</td>
                    {levels.map((l) => <td key={l} className="num muted">{x.medalsByLevel[l] || '—'}</td>)}
                  </tr>
                ))}</tbody>
              </table>
              {levels.length > 0 && <p className="muted small act-note">{t('act.rep.levelNote')}</p>}
            </div>
          )}
        </>
      )}
    </>
  );
}
