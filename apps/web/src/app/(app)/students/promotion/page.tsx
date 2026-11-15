'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { apiErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { useDay } from '@/components/admissions';
import { studentName } from '@/components/students';

interface Options {
  years: { id: string; name: string; isCurrent: boolean; status: string; startDate: string }[];
  programs: { id: string; name: string; campusId: string; levels: { id: string; name: string; isFinal: boolean }[] }[];
}
interface PlanStudent { id: string; firstName: string; lastName: string | null; admissionNo: string; sectionId: string; sectionName: string; hasDues: boolean; alreadyPlaced: boolean; outcome: 'PROMOTE' | 'DETAIN' | 'PASS_OUT' }
interface PlanSection { fromSectionId: string; fromName: string; toSectionId: string | null; toName: string | null; capacity: number | null; filled: number; incoming: number; after: number; over: boolean; missing: boolean }
interface SectionLite { id: string; name: string; capacity: number }
interface PlanClass {
  levelId: string; levelName: string; programName: string; nextLevelName: string | null; final: boolean;
  students: PlanStudent[]; sections: PlanSection[]; detainSections: PlanSection[]; targetSections: SectionLite[]; sameLevelSections: SectionLite[];
}
interface Preview {
  from: { name: string }; to: { name: string }; classes: PlanClass[]; issues: string[];
  totals: { promote: number; detain: number; passOut: number; skipped: number; withDues: number };
}
interface Run { id: string; from: string; to: string; promoted: number; detained: number; passedOut: number; classes: number; createdAt: string; byName: string | null }
interface Result { promoted: number; detained: number; passedOut: number; skipped: number; from: string; to: string }

/**
 * Year-end promotion wizard: choose the years and classes → check (who moves where, seats, problems;
 * nothing changes) → mark students who stay back / map sections → confirm.
 */
export default function PromotionPage() {
  const { can } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const day = useDay();
  const [opts, setOpts] = useState<Options | null>(null);
  const [fromYearId, setFrom] = useState('');
  const [toYearId, setTo] = useState('');
  const [levels, setLevels] = useState<string[]>([]);
  const [detain, setDetain] = useState<string[]>([]);
  const [sectionMap, setMap] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);

  useEffect(() => {
    api<Options>('/promotions/options').then((o) => {
      setOpts(o);
      const cur = o.years.findIndex((y) => y.isCurrent);
      const from = o.years[cur >= 0 ? cur : 0];
      const next = o.years.find((y) => from && y.startDate > from.startDate && y.status !== 'CLOSED');
      setFrom(from?.id ?? '');
      setTo(next?.id ?? '');
    }).catch(() => setOpts({ years: [], programs: [] }));
  }, []);
  const loadRuns = useCallback(() => { api<Run[]>('/promotions').then(setRuns).catch(() => setRuns([])); }, []);
  useEffect(loadRuns, [loadRuns]);

  const body = useMemo(() => ({ fromYearId, toYearId, programLevelIds: levels, detainIds: detain, sectionMap }), [fromYearId, toYearId, levels, detain, sectionMap]);
  const check = useCallback(async () => {
    if (!fromYearId || !toYearId || !levels.length) return;
    setChecking(true);
    setError(null);
    try { setPreview(await api<Preview>('/promotions/preview', { method: 'POST', body: JSON.stringify(body) })); } catch (e) { setPreview(null); setError(apiErrors(e).message); } finally { setChecking(false); }
  }, [body, fromYearId, toYearId, levels.length]);
  // Once a check has been shown, keep it up to date as choices change.
  useEffect(() => { if (preview) void check(); }, [detain, sectionMap]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetPlan = () => { setPreview(null); setDetain([]); setMap({}); setResult(null); setError(null); };
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  async function commit() {
    setBusy(true); setError(null);
    try {
      const r = await api<Result>('/promotions', { method: 'POST', body: JSON.stringify(body) });
      setResult(r); setConfirm(false); setPreview(null); setDetain([]); setMap({});
      toast(t('stu.pro.done', { n: r.promoted + r.detained + r.passedOut }));
      loadRuns();
    } catch (e) { setError(apiErrors(e).message); } finally { setBusy(false); }
  }

  if (!can(PERMISSIONS.STU_PROMOTE)) return <EmptyState icon="lock" title={t('stu.pro.noAccess')} />;
  if (!opts) return <SkeletonRows rows={6} />;
  const years = opts.years;
  const fromYear = years.find((y) => y.id === fromYearId);
  const laterYears = years.filter((y) => fromYear && y.startDate > fromYear.startDate && y.status !== 'CLOSED');
  const yearName = (id: string) => years.find((y) => y.id === id)?.name ?? '';
  const moving = preview ? preview.totals.promote + preview.totals.detain + preview.totals.passOut : 0;

  return (
    <>
      <PageHeader eyebrow={t('nav.students')} title={t('stu.pro.title')} description={t('stu.pro.desc')} />

      {years.length < 2 || !laterYears.length ? (
        <EmptyState icon="calendar" title={t('stu.pro.noNextYear')} text={t('stu.pro.noNextYearText')} action={<Link className="btn btn-primary" href="/academic-years"><Icon name="calendar" /> {t('nav.academicYears')}</Link>} />
      ) : (
        <>
          {result && (
            <section className="card pro-result" aria-live="polite">
              <span className="pro-result-icon" aria-hidden><Icon name="check" size={22} /></span>
              <div>
                <h2>{t('stu.pro.resultTitle', { from: result.from, to: result.to })}</h2>
                <p>{t('stu.pro.resultText', { promoted: result.promoted, detained: result.detained, passedOut: result.passedOut })}</p>
                <p className="muted small">{t('stu.pro.resultNote')}</p>
              </div>
            </section>
          )}

          <section className="card pro-card">
            <h2 className="section-title"><span className="step-no">1</span> {t('stu.pro.step1')}</h2>
            <div className="bill-filters">
              <label className="filter"><span>{t('stu.pro.fromYear')}</span>
                <select value={fromYearId} onChange={(e) => { setFrom(e.target.value); setTo(''); resetPlan(); }}>
                  {years.map((y) => <option key={y.id} value={y.id}>{y.name}{y.isCurrent ? ` (${t('stu.pro.current')})` : ''}</option>)}
                </select>
              </label>
              <Icon name="arrowRight" size={18} className="pro-arrow" />
              <label className="filter"><span>{t('stu.pro.toYear')}</span>
                <select value={toYearId} onChange={(e) => { setTo(e.target.value); resetPlan(); }}>
                  <option value="">—</option>
                  {laterYears.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
                </select>
              </label>
            </div>

            <fieldset className="pro-classes">
              <legend className="label">{t('stu.pro.classes')}</legend>
              {opts.programs.map((p) => {
                const all = p.levels.every((l) => levels.includes(l.id));
                return (
                  <div key={p.id} className="pro-program">
                    <div className="pro-program-head">
                      <strong>{p.name}</strong>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setLevels(all ? levels.filter((x) => !p.levels.some((l) => l.id === x)) : [...new Set([...levels, ...p.levels.map((l) => l.id)])]); resetPlan(); }}>
                        {all ? t('stu.pro.clearAll') : t('stu.pro.selectAll')}
                      </button>
                    </div>
                    <div className="pro-chips">
                      {p.levels.map((l) => (
                        <label key={l.id} className={`pro-chip ${levels.includes(l.id) ? 'on' : ''}`}>
                          <input type="checkbox" checked={levels.includes(l.id)} onChange={() => { setLevels(toggle(levels, l.id)); resetPlan(); }} />
                          {l.name}{l.isFinal && <span className="muted small"> · {t('stu.pro.finalShort')}</span>}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </fieldset>
            <div className="action-row">
              <span className="muted small">{t('stu.pro.safe')}</span>
              <span className="action-bar-spacer" />
              <button type="button" className="btn btn-primary" disabled={!toYearId || !levels.length || checking} onClick={() => void check()}>
                <Icon name="search" size={16} /> {checking ? t('stu.pro.checking') : preview ? t('stu.pro.checkAgain') : t('stu.pro.check')}
              </button>
            </div>
            {error && !confirm && <p className="form-error" role="alert">{error}</p>}
          </section>

          {preview && (
            <section className="card pro-card" aria-busy={checking}>
              <h2 className="section-title"><span className="step-no">2</span> {t('stu.pro.step2', { from: preview.from.name, to: preview.to.name })}</h2>
              <div className="fee-tiles">
                <div className="fee-tile"><span>{t('stu.pro.tPromote')}</span><strong>{preview.totals.promote}</strong></div>
                <div className="fee-tile"><span>{t('stu.pro.tDetain')}</span><strong>{preview.totals.detain}</strong></div>
                <div className="fee-tile"><span>{t('stu.pro.tPassOut')}</span><strong>{preview.totals.passOut}</strong></div>
                <div className="fee-tile"><span>{t('stu.pro.tSkipped')}</span><strong>{preview.totals.skipped}</strong>{preview.totals.skipped > 0 && <em className="muted">{t('stu.pro.tSkippedHint')}</em>}</div>
                <div className={`fee-tile ${preview.totals.withDues ? 'due has' : ''}`}><span>{t('stu.pro.tDues')}</span><strong>{preview.totals.withDues}</strong>{preview.totals.withDues > 0 && <em><Icon name="info" size={13} /> {t('stu.pro.tDuesHint')}</em>}</div>
              </div>

              {preview.issues.length > 0 && (
                <div className="pro-issues" role="alert">
                  <strong><Icon name="alert" size={16} /> {t('stu.pro.issuesTitle', { n: preview.issues.length })}</strong>
                  <ul>{preview.issues.map((m) => <li key={m}>{m}</li>)}</ul>
                  <p className="small">{t('stu.pro.issuesHelp')} <Link href="/classes">{t('nav.classes')}</Link></p>
                </div>
              )}

              {preview.classes.map((c) => <ClassPlan key={c.levelId} c={c} toYear={preview.to.name} detain={detain} map={sectionMap}
                onDetain={(id) => setDetain(toggle(detain, id))} onMap={(from, to) => setMap({ ...sectionMap, [from]: to })} />)}

              <div className="action-row">
                <span className="muted small">{preview.issues.length ? t('stu.pro.fixFirst') : t('stu.pro.ready', { n: moving })}</span>
                <span className="action-bar-spacer" />
                <button type="button" className="btn btn-primary" disabled={!!preview.issues.length || !moving || checking} onClick={() => { setError(null); setConfirm(true); }}>
                  <Icon name="cap" size={16} /> {t('stu.pro.commit', { n: moving })}
                </button>
              </div>
            </section>
          )}
        </>
      )}

      <h2 className="section-title">{t('stu.pro.history')}</h2>
      {runs === null ? <SkeletonRows rows={2} /> : runs.length === 0 ? <p className="muted small">{t('stu.pro.noRuns')}</p> : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">{t('stu.pro.history')}</caption>
            <thead><tr><th scope="col">{t('common.date')}</th><th scope="col">{t('stu.pro.years')}</th><th scope="col" className="num">{t('stu.pro.tPromote')}</th><th scope="col" className="num">{t('stu.pro.tDetain')}</th><th scope="col" className="num">{t('stu.pro.tPassOut')}</th><th scope="col">{t('stu.pro.by')}</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{day(r.createdAt)}<span className="sub-line muted small">{new Date(r.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span></td>
                  <td>{r.from} → {r.to}<span className="sub-line muted small">{t('stu.pro.nClasses', { n: r.classes })}</span></td>
                  <td className="num strong">{r.promoted}</td><td className="num">{r.detained}</td><td className="num">{r.passedOut}</td>
                  <td>{r.byName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirm && preview && (
        <Modal open onClose={() => setConfirm(false)} title={t('stu.pro.confirmTitle', { from: yearName(fromYearId), to: yearName(toYearId) })} submitLabel={t('stu.pro.commit', { n: moving })} busy={busy} error={error}
          onSubmit={(e) => { e.preventDefault(); void commit(); }}>
          <ul className="pro-confirm">
            <li><strong>{preview.totals.promote}</strong> {t('stu.pro.cPromote', { to: preview.to.name })}</li>
            {preview.totals.detain > 0 && <li><strong>{preview.totals.detain}</strong> {t('stu.pro.cDetain')}</li>}
            {preview.totals.passOut > 0 && <li><strong>{preview.totals.passOut}</strong> {t('stu.pro.cPassOut')}</li>}
          </ul>
          <p className="note-info"><Icon name="info" size={15} /> {t('stu.pro.confirmNote')}</p>
        </Modal>
      )}
    </>
  );
}

function ClassPlan({ c, toYear, detain, map, onDetain, onMap }: { c: PlanClass; toYear: string; detain: string[]; map: Record<string, string>; onDetain: (id: string) => void; onMap: (from: string, to: string) => void }) {
  const { t } = useI18n();
  const rows: { s: PlanSection; pool: SectionLite[]; cls: string; stay: boolean }[] = [
    ...c.sections.map((s) => ({ s, pool: c.targetSections, cls: c.nextLevelName ?? '', stay: false })),
    ...c.detainSections.map((s) => ({ s, pool: c.sameLevelSections, cls: c.levelName, stay: true })),
  ];
  const moving = c.students.filter((s) => !s.alreadyPlaced);
  return (
    <article className="pro-class">
      <header className="pro-class-head">
        <h3>{c.levelName} <Icon name="arrowRight" size={16} /> {c.final ? <span className="pro-final">{t('stu.pro.passesOut')}</span> : c.nextLevelName}</h3>
        <span className="muted small">{c.programName} · {t('stu.pro.nStudents', { n: moving.length })}</span>
      </header>

      {rows.length > 0 && (
        <ul className="pro-sections">
          {rows.map(({ s, pool, cls, stay }) => {
            const value = map[s.fromSectionId] && pool.some((p) => p.id === map[s.fromSectionId]) ? map[s.fromSectionId] : s.toSectionId ?? '';
            return (
              <li key={`${stay ? 'stay' : 'up'}-${s.fromSectionId}`} className={s.missing || s.over ? 'bad' : ''}>
                <span className="pro-from">{c.levelName} – {s.fromName}<span className="sub-line muted small">{t(stay ? 'stu.pro.nStaying' : 'stu.pro.nMoving', { n: s.incoming })}</span></span>
                <Icon name="arrowRight" size={16} />
                <label className="pro-to">
                  <span className="sr-only">{t('stu.pro.targetFor', { section: `${c.levelName} ${s.fromName}` })}</span>
                  <select value={value} onChange={(e) => onMap(s.fromSectionId, e.target.value)}>
                    {!value && <option value="">{t('stu.pro.pickSection')}</option>}
                    {pool.map((p) => <option key={p.id} value={p.id}>{cls} – {p.name}</option>)}
                  </select>
                </label>
                <span className="pro-seats small">
                  {s.missing ? <span className="pill pill-bad">{t('stu.pro.noSection', { year: toYear })}</span>
                    : s.over ? <span className="pill pill-bad">{t('stu.pro.over', { n: s.after, cap: s.capacity ?? 0 })}</span>
                      : <span className="muted">{t('stu.pro.seats', { n: s.after, cap: s.capacity ?? 0 })}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <details className="pro-students">
        <summary>{t('stu.pro.studentList', { n: c.students.length })}{c.students.some((s) => detain.includes(s.id)) && <span className="pill pill-warn">{t('stu.pro.nStay', { n: c.students.filter((s) => detain.includes(s.id)).length })}</span>}</summary>
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">{t('stu.pro.studentList', { n: c.students.length })}</caption>
            <thead><tr><th scope="col">{t('stu.col.student')}</th><th scope="col">{t('stu.pro.section')}</th><th scope="col">{t('stu.pro.outcome')}</th><th scope="col">{c.final ? t('stu.pro.repeat') : t('stu.pro.stayBack')}</th></tr></thead>
            <tbody>
              {c.students.map((s) => (
                <tr key={s.id} className={s.alreadyPlaced ? 'row-muted' : ''}>
                  <td><Link href={`/students/${s.id}`}>{studentName(s)}</Link><span className="sub-line muted small mono">{s.admissionNo}</span></td>
                  <td>{s.sectionName}</td>
                  <td>
                    {s.alreadyPlaced ? t('stu.pro.alreadyIn', { year: toYear }) : s.outcome === 'DETAIN' ? t('stu.pro.oDetain', { cls: c.levelName }) : s.outcome === 'PASS_OUT' ? t('stu.pro.oPassOut') : t('stu.pro.oPromote', { cls: c.nextLevelName ?? '' })}
                    {s.hasDues && <span className="pill pill-warn pro-dues">{t('stu.pro.feesDue')}</span>}
                  </td>
                  <td>
                    <input type="checkbox" aria-label={t('stu.pro.stayFor', { name: studentName(s) })} disabled={s.alreadyPlaced} checked={detain.includes(s.id)} onChange={() => onDetain(s.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </article>
  );
}
