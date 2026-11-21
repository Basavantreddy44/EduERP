'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { EmptyState, SkeletonRows, useToast } from '@/components/ui';
import { fmtDay } from '@/components/activities';
import { PlcPill, ctcRange, lakh, score } from '@/components/placements';

interface View {
  self: boolean;
  profile: { isOptedIn: boolean; isPlaced: boolean; passingYear: number | null; scoreType: string | null; score: string | null; backlogs: number | null; verified: boolean } | null;
  openDrives: { id: string; title: string; company: string; jobType: string; ctcMin: string | null; ctcMax: string | null; lastDateToApply: string; driveDate: string | null; description: string | null; eligible: boolean; reasons: string[] }[];
  applications: { id: string; title: string; company: string; jobType: string; status: string; currentRound: string | null; rounds: string[]; driveDate: string | null; offer: { id: string; ctc: string; offerDate: string; joiningDate: string | null; status: string } | null }[];
}

/** The student app's Placements tab (M19.2, M19.3): open drives, applying, the application's progress and the offer. */
export function ChildPlacements({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [v, setV] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<View>(`/placements/children/${id}`).then(setV).catch(() => setV({ self: false, profile: null, openDrives: [], applications: [] })); }, [id]);
  useEffect(load, [load]);
  const act = async (path: string, body: object, done: string) => {
    setBusy(true);
    try { await api(path, { method: 'POST', body: JSON.stringify(body) }); toast(done); load(); }
    catch (x) { toast(apiErrors(x).message ?? t('en.failed'), 'bad'); } finally { setBusy(false); }
  };
  if (!v) return <SkeletonRows rows={3} />;
  if (!v.profile && !v.applications.length && !v.openDrives.length) return <EmptyState icon="file" title={t('pt.plc.none')} text={t('pt.plc.noneHint')} />;
  return (
    <div className="act-student">
      {v.profile && (
        <p className="notice">{v.profile.isPlaced ? <><Icon name="check" size={16} /> {t('pt.plc.placed')}</> : <><Icon name="info" size={16} /> {t('pt.plc.profile', { s: score(v.profile.score, v.profile.scoreType), b: v.profile.backlogs ?? '—', y: v.profile.passingYear ?? '—' })}</>}</p>
      )}
      {!v.self && <p className="muted small">{t('pt.plc.parentNote')}</p>}
      {v.applications.length > 0 && (
        <section aria-labelledby="pp-apps">
          <h3 id="pp-apps" className="card-title">{t('pt.plc.applications')}</h3>
          <ul className="pay-mine">{v.applications.map((a) => (
            <li key={a.id} className="card">
              <span><strong>{a.title}</strong><span className="sub-line muted small">{a.company} · {t(`plc.job.${a.jobType}` as MessageKey)}{a.driveDate ? ` · ${t('plc.d.driveOn', { d: fmtDay(locale, a.driveDate) })}` : ''}</span>
                {a.currentRound && <span className="sub-line small">{t('plc.a.round', { r: a.currentRound })}</span>}
                {a.offer && <span className="sub-line small"><strong>{t('pt.plc.offer', { ctc: lakh(a.offer.ctc) })}</strong> <PlcPill prefix="plc.os" status={a.offer.status} />{a.offer.joiningDate ? ` · ${t('plc.o.joins', { d: fmtDay(locale, a.offer.joiningDate) })}` : ''}</span>}</span>
              <span className="pay-mine-amt">
                <PlcPill prefix="plc.as" status={a.status} />
                {v.self && a.offer?.status === 'OFFERED' && <span className="row-actions">
                  <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void act(`/placements/children/${id}/offers/${a.offer!.id}`, { status: 'ACCEPTED' }, t('pt.plc.accepted'))}>{t('pt.plc.accept')}</button>
                  <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void act(`/placements/children/${id}/offers/${a.offer!.id}`, { status: 'DECLINED' }, t('pt.plc.declined'))}>{t('pt.plc.decline')}</button>
                </span>}
                {v.self && ['APPLIED', 'SHORTLISTED', 'IN_PROCESS'].includes(a.status) && <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void act(`/placements/children/${id}/applications/${a.id}/withdraw`, {}, t('pt.plc.withdrawn'))}>{t('pt.plc.withdraw')}</button>}
              </span>
            </li>
          ))}</ul>
        </section>
      )}
      <section aria-labelledby="pp-open">
        <h3 id="pp-open" className="card-title">{t('pt.plc.open')}</h3>
        {!v.openDrives.length ? <p className="muted">{t('pt.plc.noOpen')}</p> : (
          <ul className="pay-mine">{v.openDrives.map((d) => (
            <li key={d.id} className="card">
              <span><strong>{d.title}</strong><span className="sub-line muted small">{d.company} · {t(`plc.job.${d.jobType}` as MessageKey)} · {ctcRange(d.ctcMin, d.ctcMax)}</span>
                <span className="sub-line small">{t('pt.plc.applyBy', { d: fmtDay(locale, d.lastDateToApply) })}</span>
                {!d.eligible && d.reasons.length > 0 && <span className="sub-line small">{t('pt.plc.notEligible')}: {d.reasons.map((r) => t(`plc.why.${r}` as MessageKey)).join(' · ')}</span>}</span>
              <span className="pay-mine-amt">{v.self && d.eligible ? <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void act(`/placements/children/${id}/drives/${d.id}/apply`, {}, t('pt.plc.applied'))}>{t('pt.plc.apply')}</button> : !d.eligible && <span className="pill pill-muted"><span className="pill-dot" />{t('pt.plc.notEligible')}</span>}</span>
            </li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}
