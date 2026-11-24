'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, StatTile, useToast } from '@/components/ui';
import { useFieldName } from '@/components/govt';

type Code = 'SATS' | 'UDISE';
interface Col { key: string; label: string }
interface Layout { code: Code; columns: Col[]; standard: Col[]; custom: boolean; updatedAt: string | null }
interface Layouts { layouts: Layout[]; fields: { key: string; label: string; required: Code[] }[]; canEdit: boolean }
interface Readiness { campuses: { campusId: string; campus: string; students: number; SATS: number; UDISE: number }[]; students: { studentId: string; name: string; admissionNo: string | null; className: string | null; campus: string; SATS: string[]; UDISE: string[] }[]; totalWithGaps: number }

const pct = (a: number, b: number) => (b ? Math.round((a * 100) / b) : 0);

/** Students → SATS & UDISE+ (G1): readiness by school, students with gaps, column layouts, export. */
export default function GovExportsPage() {
  const { t } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const fname = useFieldName();
  const [r, setR] = useState<Readiness | null>(null);
  const [l, setL] = useState<Layouts | null>(null);
  const [campusId, setCampusId] = useState('');
  const [only, setOnly] = useState<'' | Code>('');
  const [edit, setEdit] = useState<{ code: Code; columns: Col[] } | null>(null);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reset, setReset] = useState<Code | null>(null);
  const load = useCallback(() => {
    setR(null);
    api<Readiness>(`/govt/readiness${campusId ? `?campusId=${campusId}` : ''}`).then(setR).catch(() => setR({ campuses: [], students: [], totalWithGaps: 0 }));
  }, [campusId]);
  const loadLayouts = useCallback(() => { api<Layouts>('/govt/layouts').then(setL).catch(() => setL(null)); }, []);
  useEffect(load, [load]);
  useEffect(loadLayouts, [loadLayouts]);
  const [campuses, setCampuses] = useState<{ campusId: string; campus: string }[]>([]);
  useEffect(() => { if (r && !campusId) setCampuses(r.campuses); }, [r, campusId]);
  const totals = useMemo(() => (r?.campuses ?? []).reduce((t, c) => ({ students: t.students + c.students, SATS: t.SATS + c.SATS, UDISE: t.UDISE + c.UDISE }), { students: 0, SATS: 0, UDISE: 0 }), [r]);
  const gaps = (r?.students ?? []).filter((s) => !only || s[only].length);

  const exportIt = async (code: Code, format: 'XLSX' | 'CSV') => {
    try { await api('/reports/exports', { method: 'POST', body: JSON.stringify({ reportCode: `GOV_${code}`, filters: campusId ? { campusId } : {}, format }) }); toast(t('gov.exportQueued')); }
    catch (x) { toast(apiErrors(x).message ?? t('en.failed'), 'bad'); }
  };
  const move = (i: number, d: -1 | 1) => setEdit((e) => { if (!e) return e; const c = [...e.columns]; const j = i + d; if (j < 0 || j >= c.length) return e; [c[i], c[j]] = [c[j], c[i]]; return { ...e, columns: c }; });
  const saveLayout = async () => {
    if (!edit) return;
    setBusy(true); setError(null);
    try { await api(`/govt/layouts/${edit.code}`, { method: 'PUT', body: JSON.stringify({ columns: edit.columns }) }); toast(t('gov.layoutSaved')); setEdit(null); loadLayouts(); }
    catch (x) { setError(apiErrors(x).message); } finally { setBusy(false); }
  };
  const doReset = async () => {
    if (!reset) return;
    setBusy(true);
    try { await api(`/govt/layouts/${reset}/reset`, { method: 'POST' }); toast(t('gov.layoutReset')); setReset(null); loadLayouts(); }
    catch (x) { toast(apiErrors(x).message ?? t('en.failed'), 'bad'); } finally { setBusy(false); }
  };
  const unused = edit && l ? l.fields.filter((f) => !edit.columns.some((c) => c.key === f.key)) : [];

  return (
    <>
      <PageHeader eyebrow={t('nav.students')} title={t('gov.title')} description={t('gov.desc')} />
      {campuses.length > 1 && (
        <div className="filter-bar card">
          <label className="inv-f">{t('act.campus')}<select value={campusId} onChange={(e) => setCampusId(e.target.value)}><option value="">{t('inv.allCampuses')}</option>{campuses.map((c) => <option key={c.campusId} value={c.campusId}>{c.campus}</option>)}</select></label>
        </div>
      )}
      {!r ? <SkeletonRows rows={4} /> : (
        <>
          <div className="stats pay-stats">
            <StatTile icon="cap" label={t('gov.students')} value={totals.students.toLocaleString('en-IN')} />
            <StatTile icon="check" label={t('gov.readySats')} value={`${pct(totals.SATS, totals.students)}%`} hint={t('gov.readyOf', { n: totals.SATS, m: totals.students })} />
            <StatTile icon="check" label={t('gov.readyUdise')} value={`${pct(totals.UDISE, totals.students)}%`} hint={t('gov.readyOf', { n: totals.UDISE, m: totals.students })} />
            <StatTile icon="alert" label={t('gov.withGaps')} value={r.totalWithGaps.toLocaleString('en-IN')} />
          </div>

          <section className="card gov-block" aria-labelledby="gov-exp">
            <h2 id="gov-exp" className="section-title">{t('gov.exportTitle')}</h2>
            <p className="muted small">{t('gov.exportHint')}</p>
            <div className="gov-export-row">
              {(['SATS', 'UDISE'] as Code[]).map((c) => (
                <div key={c} className="gov-export">
                  <div><strong>{t(`gov.exp.${c}` as MessageKey)}</strong><span className="sub-line muted small">{t('gov.columnsN', { n: l?.layouts.find((x) => x.code === c)?.columns.length ?? 0 })}{l?.layouts.find((x) => x.code === c)?.custom ? ` · ${t('gov.ownLayout')}` : ` · ${t('gov.stdLayout')}`}</span></div>
                  <div className="gov-export-actions">
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => void exportIt(c, 'XLSX')}><Icon name="download" size={14} /> {t('rep.excelFile')}</button>
                    <button type="button" className="btn btn-sm" onClick={() => void exportIt(c, 'CSV')}><Icon name="download" size={14} /> CSV</button>
                  </div>
                </div>
              ))}
            </div>
            <p className="small"><Link href="/reports/exports">{t('gov.seeExports')}</Link></p>
          </section>

          <section className="card gov-block" aria-labelledby="gov-schools">
            <h2 id="gov-schools" className="section-title">{t('gov.bySchool')}</h2>
            {!r.campuses.length ? <EmptyState icon="cap" title={t('gov.noStudents')} /> : (
              <div className="table-wrap" role="region" aria-label={t('gov.bySchool')} tabIndex={0}>
                <table className="table">
                  <thead><tr><th scope="col">{t('act.campus')}</th><th scope="col" className="num">{t('gov.students')}</th><th scope="col">{t('gov.exp.SATS')}</th><th scope="col">{t('gov.exp.UDISE')}</th></tr></thead>
                  <tbody>{r.campuses.map((c) => (
                    <tr key={c.campusId}>
                      <td><strong>{c.campus}</strong></td>
                      <td className="num">{c.students}</td>
                      {(['SATS', 'UDISE'] as Code[]).map((k) => (
                        <td key={k}><div className="gov-bar" role="img" aria-label={t('gov.readyOf', { n: c[k], m: c.students })}><span style={{ width: `${pct(c[k], c.students)}%` }} /></div><span className="small muted">{t('gov.readyOf', { n: c[k], m: c.students })}</span></td>
                      ))}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card gov-block" aria-labelledby="gov-gaps">
            <div className="panel-head">
              <h2 id="gov-gaps" className="section-title">{t('gov.gapsTitle')}</h2>
              <div className="seg" role="group" aria-label={t('gov.gapsFilter')}>
                {(['', 'SATS', 'UDISE'] as const).map((k) => <button key={k || 'all'} type="button" className={`seg-btn ${only === k ? 'on' : ''}`} aria-pressed={only === k} onClick={() => setOnly(k)}>{k ? t(`gov.exp.${k}` as MessageKey) : t('act.all')}</button>)}
              </div>
            </div>
            {!gaps.length ? <EmptyState icon="check" title={t('gov.noGaps')} text={t('gov.noGapsText')} /> : (
              <>
                <div className="table-wrap" role="region" aria-label={t('gov.gapsTitle')} tabIndex={0}>
                  <table className="table">
                    <thead><tr><th scope="col">{t('gov.student')}</th><th scope="col">{t('gov.class')}</th><th scope="col">{t('gov.missingCol')}</th><th scope="col"><span className="sr-only">{t('gov.fix')}</span></th></tr></thead>
                    <tbody>{gaps.map((s) => {
                      const list = [...new Set([...(only !== 'UDISE' ? s.SATS : []), ...(only !== 'SATS' ? s.UDISE : [])])];
                      return (
                        <tr key={s.studentId}>
                          <td><strong>{s.name}</strong><span className="sub-line muted small">{s.admissionNo}{campuses.length > 1 ? ` · ${s.campus}` : ''}</span></td>
                          <td>{s.className ?? '—'}</td>
                          <td><ul className="gov-chips">{list.map((m) => <li key={m}>{fname(m)}</li>)}</ul></td>
                          <td><Link className="btn btn-sm" href={`/students/${s.studentId}`}>{t('gov.fix')}</Link></td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                </div>
                {r.totalWithGaps > r.students.length && <p className="muted small">{t('gov.gapsFirst', { n: r.students.length, m: r.totalWithGaps })}</p>}
              </>
            )}
          </section>

          {l && (
            <section className="card gov-block" aria-labelledby="gov-layouts">
              <h2 id="gov-layouts" className="section-title">{t('gov.layoutsTitle')}</h2>
              <p className="muted small">{t('gov.layoutsHint')}</p>
              <div className="gov-layouts">
                {l.layouts.map((x) => (
                  <div key={x.code} className="gov-layout">
                    <div className="panel-head">
                      <h3 className="gov-layout-name">{t(`gov.exp.${x.code}` as MessageKey)} <span className={`badge ${x.custom ? 'ok' : ''}`}>{x.custom ? t('gov.ownLayout') : t('gov.stdLayout')}</span></h3>
                      {l.canEdit && can(PERMISSIONS.GOV_EXPORT_MANAGE) && (
                        <div className="gov-export-actions">
                          <button type="button" className="btn btn-sm" onClick={() => { setError(null); setAdding(''); setEdit({ code: x.code, columns: x.columns.map((c) => ({ key: c.key, label: c.label })) }); }}><Icon name="edit" size={14} /> {t('gov.changeColumns')}</button>
                          {x.custom && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setReset(x.code)}>{t('gov.resetStd')}</button>}
                        </div>
                      )}
                    </div>
                    <ol className="gov-cols">{x.columns.map((c) => <li key={c.key}>{c.label}</li>)}</ol>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? t('gov.editLayout', { name: t(`gov.exp.${edit.code}` as MessageKey) }) : ''} subtitle={t('gov.editLayoutSub')}
        onSubmit={(e) => { e.preventDefault(); void saveLayout(); }} busy={busy} error={error} submitLabel={t('gov.saveLayout')} submitDisabled={!edit?.columns.length}>
        {edit && (
          <>
            <ol className="gov-edit-cols">
              {edit.columns.map((c, i) => (
                <li key={c.key}>
                  <span className="gov-n" aria-hidden="true">{i + 1}</span>
                  <label className="sr-only" htmlFor={`gc-${c.key}`}>{t('gov.columnHeading', { field: fname(c.key) })}</label>
                  <input id={`gc-${c.key}`} value={c.label} maxLength={60} onChange={(e) => setEdit({ ...edit, columns: edit.columns.map((x) => (x.key === c.key ? { ...x, label: e.target.value } : x)) })} />
                  <span className="sub-line muted small gov-field">{fname(c.key)}</span>
                  <span className="gov-edit-btns">
                    <button type="button" className="btn btn-sm btn-ghost" disabled={i === 0} aria-label={t('gov.moveUp', { name: c.label })} onClick={() => move(i, -1)}><Icon name="chevron-up" size={14} /></button>
                    <button type="button" className="btn btn-sm btn-ghost" disabled={i === edit.columns.length - 1} aria-label={t('gov.moveDown', { name: c.label })} onClick={() => move(i, 1)}><Icon name="chevron-down" size={14} /></button>
                    <button type="button" className="btn btn-sm btn-ghost" aria-label={t('gov.removeCol', { name: c.label })} onClick={() => setEdit({ ...edit, columns: edit.columns.filter((x) => x.key !== c.key) })}><Icon name="trash" size={14} /></button>
                  </span>
                </li>
              ))}
            </ol>
            {unused.length > 0 && (
              <div className="gov-add">
                <label htmlFor="gc-add">{t('gov.addColumn')}</label>
                <select id="gc-add" value={adding} onChange={(e) => setAdding(e.target.value)}><option value="">{t('gov.chooseField')}</option>{unused.map((f) => <option key={f.key} value={f.key}>{fname(f.key)}</option>)}</select>
                <button type="button" className="btn btn-sm" disabled={!adding} onClick={() => { const f = l!.fields.find((x) => x.key === adding)!; setEdit({ ...edit, columns: [...edit.columns, { key: f.key, label: f.label }] }); setAdding(''); }}><Icon name="plus" size={14} /> {t('gov.add')}</button>
              </div>
            )}
          </>
        )}
      </Modal>
      <Modal open={!!reset} onClose={() => setReset(null)} title={t('gov.resetTitle')} subtitle={reset ? t(`gov.exp.${reset}` as MessageKey) : ''} onSubmit={(e) => { e.preventDefault(); void doReset(); }} busy={busy} submitLabel={t('gov.resetStd')} danger>
        <p className="muted">{t('gov.resetText')}</p>
      </Modal>
    </>
  );
}
