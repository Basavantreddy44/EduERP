'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ApiError, api } from '@/lib/api';
import { apiErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { AcadSection, SectionSelect, useAcadSections, useSectionParam } from '@/components/academics';

interface ResultRow { id: string; studentId: string; name: string; admissionNo: string; total: number; maxTotal: number; percentage: number; grade: string | null; rank: number | null; attendance: number | null; remarks: string | null; resultStatus: string; subjects: { subjectId: string; percent: number; grade: string | null; isPass: boolean }[] }
interface Version { id: string; version: number; status: string; preparedBy: string | null; preparedAt: string; publishedBy: string | null; publishedAt: string | null; results: ResultRow[] }
interface View {
  section: { id: string; name: string; campusId: string };
  scheme: { id: string; name: string; terms: { code: string; name: string }[]; coAreas: { id: string; name: string }[]; coGrades: string[] } | null;
  subjects: { id: string; code: string; name: string }[];
  canPrepare: boolean; draft: Version | null; published: Version | null;
}

/** Exams → Results (M9.3): calculate a class's results from verified marks, add remarks, publish; report cards. */
export default function ResultsPage() {
  const { t } = useI18n();
  const sections = useAcadSections();
  const [sectionId, choose] = useSectionParam(sections);
  const section = sections?.find((s) => s.id === sectionId);
  return (
    <>
      <PageHeader eyebrow={t('nav.exams')} title={t('ex.res.title')} description={t('ex.res.desc')} />
      {!sections ? <SkeletonRows rows={5} /> : !sections.length ? <EmptyState icon="layers" title={t('ac.noSections')} text={t('ac.noSectionsHint')} /> : (
        <>
          <div className="panel-head"><SectionSelect sections={sections} value={sectionId} onChange={choose} /></div>
          {section && <SectionResults key={section.id} section={section} />}
        </>
      )}
    </>
  );
}

function SectionResults({ section }: { section: AcadSection }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [term, setTerm] = useState('');
  const [v, setV] = useState<View | null>(null);
  const [tab, setTab] = useState<'results' | 'co'>('results');
  const [show, setShow] = useState<'draft' | 'published'>('draft');
  const [error, setError] = useState<{ msg: string; list: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [remark, setRemark] = useState<ResultRow | null>(null);
  const [remarkText, setRemarkText] = useState('');
  const load = useCallback((code: string) => {
    api<View>(`/exams/results/sections/${section.id}?termCode=${encodeURIComponent(code || 'ANNUAL')}`).then((x) => {
      setV(x);
      const first = x.scheme?.terms[0]?.code ?? '';
      // First load: switch to the scheme's first term (the effect then loads it).
      if (!code && first && first !== 'ANNUAL') { setTerm(first); return; }
      if (!code && first) setTerm(first);
      setShow(x.draft ? 'draft' : 'published');
    }).catch(() => setV(null));
  }, [section.id]);
  useEffect(() => { load(term); }, [load, term]);

  const calculate = async () => {
    setBusy(true); setError(null);
    try { const r = await api<{ version: number; students: number; passed: number }>('/exams/results/calculate', { method: 'POST', body: JSON.stringify({ sectionId: section.id, termCode: term }) }); toast(t('ex.res.calculated', { v: r.version, n: r.students, p: r.passed })); load(term); }
    catch (x) { setError({ msg: x instanceof ApiError ? x.message : t('ex.res.failed'), list: x instanceof ApiError && (x.errors?.length ?? 0) > 1 ? (x.errors ?? []).map((e) => e.message) : [] }); } finally { setBusy(false); }
  };
  const publish = async (id: string) => {
    setBusy(true); setError(null);
    try { const r = await api<{ version: number; notified: number }>(`/exams/results/publications/${id}/publish`, { method: 'POST', body: '{}' }); toast(t('ex.res.publishedToast', { v: r.version, n: r.notified })); load(term); }
    catch (x) { setError({ msg: apiErrors(x).message ?? t('ex.res.failed'), list: [] }); } finally { setBusy(false); }
  };
  const saveRemark = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!remark) return;
    setBusy(true);
    try { await api(`/exams/results/${remark.id}`, { method: 'PATCH', body: JSON.stringify({ remarks: remarkText || null }) }); toast(t('ex.res.remarkSaved', { name: remark.name })); setRemark(null); load(term); }
    catch (x) { setError({ msg: apiErrors(x).message ?? t('ex.res.failed'), list: [] }); } finally { setBusy(false); }
  };

  if (!v) return <SkeletonRows rows={6} />;
  if (!v.scheme) return <EmptyState icon="layers" title={t('ex.res.noScheme')} text={t('ex.res.noSchemeHint')} action={<Link href="/exams" className="btn">{t('nav.exams')}</Link>} />;
  const ver = show === 'draft' ? v.draft : v.published;
  const when = (s: string | null) => (s ? new Date(s).toLocaleString(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '');
  const subjects = v.subjects.filter((s) => ver?.results.some((r) => r.subjects.some((x) => x.subjectId === s.id)));
  const passed = ver?.results.filter((r) => r.resultStatus === 'PASS').length ?? 0;

  return (
    <>
      <div className="panel-head">
        <label className="ac-picker" htmlFor="res-term"><span>{t('ex.res.term')}</span>
          <select id="res-term" value={term} onChange={(e) => setTerm(e.target.value)}>{v.scheme.terms.map((x) => <option key={x.code} value={x.code}>{x.code === 'FINAL' ? t('ex.res.final') : x.name}</option>)}</select>
        </label>
        {v.scheme.coAreas.length > 0 && term !== 'FINAL' && (
          <div className="tabs" role="tablist" aria-label={section.name}>
            {(['results', 'co'] as const).map((x) => <button key={x} type="button" role="tab" id={`tab-${x}`} aria-selected={tab === x} aria-controls={`panel-${x}`} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(x === 'results' ? 'ex.res.tabResults' : 'ex.card.co')}</button>)}
          </div>
        )}
      </div>
      {tab === 'co' && term !== 'FINAL' ? <CoGrades section={section} term={term} /> : (
        <section role="tabpanel" id="panel-results" aria-labelledby="tab-results">
          <div className="tt-status">
            <p>
              {v.published && <button type="button" className={`pill pill-ok pill-btn${show === 'published' ? ' on' : ''}`} aria-pressed={show === 'published'} onClick={() => setShow('published')}><span className="pill-dot" />{t('ex.res.publishedV', { v: v.published.version })}</button>}
              {v.draft && <button type="button" className={`pill pill-warn pill-btn${show === 'draft' ? ' on' : ''}`} aria-pressed={show === 'draft'} onClick={() => setShow('draft')}>{t('ex.res.draftV', { v: v.draft.version })}</button>}
              {!v.published && !v.draft && <span className="pill pill-muted">{t('ex.res.notYet')}</span>}
            </p>
            {v.canPrepare && <span className="row-actions">
              <button type="button" className="btn" onClick={() => void calculate()} disabled={busy}><Icon name="layers" /> {v.draft ? t('ex.res.recalculate') : t('ex.res.calculate')}</button>
              {v.draft && <button type="button" className="btn btn-primary" onClick={() => void publish(v.draft!.id)} disabled={busy}><Icon name="check" /> {t('ex.res.publish')}</button>}
            </span>}
          </div>
          {error && <div className="form-error" role="alert"><p><Icon name="alert" /> {error.msg}</p>{error.list.length > 0 && <ul className="tt-clashes">{error.list.map((m) => <li key={m}>{m}</li>)}</ul>}</div>}
          {!ver ? <EmptyState icon="star" title={t('ex.res.none')} text={v.canPrepare ? t('ex.res.noneHint') : t('ex.res.noneHintRead')} /> : (
            <>
              <p className="muted small">
                {ver.status === 'DRAFT' ? t('ex.res.draftNote', { name: ver.preparedBy ?? '', when: when(ver.preparedAt) }) : t('ex.res.pubNote', { name: ver.publishedBy ?? '', when: when(ver.publishedAt) })}
                {' · '}{t('ex.res.passedOf', { p: passed, n: ver.results.length })}
              </p>
              <div className="table-wrap card" role="region" aria-label={t('ex.res.tableLabel', { name: section.name })} tabIndex={0}>
                <table className="table results-table">
                  <thead>
                    <tr>
                      <th scope="col" className="num">{t('ex.card.rank')}</th><th scope="col">{t('ex.card.student')}</th>
                      {subjects.map((s) => <th key={s.id} scope="col" className="num"><abbr title={s.name}>{s.code}</abbr></th>)}
                      <th scope="col" className="num">%</th><th scope="col">{t('ex.card.grade')}</th><th scope="col">{t('ex.card.result')}</th><th scope="col"><span className="sr-only">{t('common.actions')}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {ver.results.map((r) => (
                      <tr key={r.id}>
                        <td className="num">{r.rank ?? '—'}</td>
                        <th scope="row">{r.name}<span className="sub-line muted">{r.remarks ? `“${r.remarks}”` : r.admissionNo}</span></th>
                        {subjects.map((s) => { const x = r.subjects.find((y) => y.subjectId === s.id); return <td key={s.id} className={`num${x && !x.isPass ? ' fail-cell' : ''}`}>{x ? <>{x.percent}<span className="sub-line muted">{x.grade}</span></> : '—'}</td>; })}
                        <td className="num"><strong>{r.percentage}</strong></td>
                        <td>{r.grade ?? '—'}</td>
                        <td><span className={`pill ${r.resultStatus === 'PASS' ? 'pill-ok' : 'pill-bad'}`}>{t(`ex.status.${r.resultStatus}` as MessageKey)}</span></td>
                        <td className="row-actions">
                          {ver.status === 'DRAFT' && <button type="button" className="btn btn-sm" onClick={() => { setRemark(r); setRemarkText(r.remarks ?? ''); }} aria-label={t('ex.res.remarkFor', { name: r.name })}><Icon name="edit" /></button>}
                          <Link href={`/exams/report-card/${r.id}`} className="btn btn-sm" aria-label={t('ex.res.cardFor', { name: r.name })}><Icon name="file" /> {t('ex.res.card')}</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
      <Modal open={!!remark} onClose={() => setRemark(null)} title={t('ex.res.remarkTitle', { name: remark?.name ?? '' })} onSubmit={saveRemark} submitLabel={t('tr.save')} busy={busy}>
        <Field id="rem" label={t('ex.card.remarks')} hint={t('ex.res.remarkHint')}><textarea id="rem" rows={3} maxLength={500} value={remarkText} onChange={(e) => setRemarkText(e.target.value)} /></Field>
      </Modal>
    </>
  );
}

interface CoView { areas: { id: string; name: string }[]; scale: { grade: string; description: string | null }[]; students: { id: string; name: string; rollNo: string | null }[]; grades: { studentId: string; areaId: string; grade: string }[]; canEdit: boolean }

function CoGrades({ section, term }: { section: AcadSection; term: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [v, setV] = useState<CoView | null>(null);
  const [g, setG] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<CoView>(`/exams/co-scholastic/sections/${section.id}?termCode=${term}`).then((x) => { setV(x); setG(Object.fromEntries(x.grades.map((y) => [`${y.studentId}:${y.areaId}`, y.grade]))); }).catch(() => setV(null)); }, [section.id, term]);
  const save = async () => {
    setBusy(true); setError(null);
    const grades = Object.entries(g).filter(([, v2]) => v2).map(([k, grade]) => { const [studentId, areaId] = k.split(':'); return { studentId, areaId, grade }; });
    try { await api('/exams/co-scholastic', { method: 'PUT', body: JSON.stringify({ sectionId: section.id, termCode: term, grades }) }); toast(t('ex.co.saved')); }
    catch (x) { setError(apiErrors(x).message); } finally { setBusy(false); }
  };
  if (!v) return <SkeletonRows rows={5} />;
  return (
    <section role="tabpanel" id="panel-co" aria-labelledby="tab-co">
      <p className="muted small">{t('ex.co.hint')} {v.scale.map((s) => `${s.grade} = ${s.description ?? ''}`).join(' · ')}</p>
      {error && <p className="form-error" role="alert"><Icon name="alert" /> {error}</p>}
      <div className="table-wrap card">
        <table className="table">
          <thead><tr><th scope="col">{t('ex.card.student')}</th>{v.areas.map((a) => <th key={a.id} scope="col">{a.name}</th>)}</tr></thead>
          <tbody>
            {v.students.map((s) => (
              <tr key={s.id}>
                <th scope="row">{s.rollNo ? `${s.rollNo}. ` : ''}{s.name}</th>
                {v.areas.map((a) => (
                  <td key={a.id}>
                    <select aria-label={t('ex.co.gradeOf', { name: s.name, area: a.name })} value={g[`${s.id}:${a.id}`] ?? ''} disabled={!v.canEdit} onChange={(e) => setG((x) => ({ ...x, [`${s.id}:${a.id}`]: e.target.value }))}>
                      <option value="">—</option>{v.scale.map((x) => <option key={x.grade} value={x.grade}>{x.grade}</option>)}
                    </select>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {v.canEdit && <div className="row-actions end"><button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}><Icon name="check" /> {busy ? t('common.saving') : t('ex.co.save')}</button></div>}
    </section>
  );
}
