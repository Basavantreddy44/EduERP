'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ENTRANCE_ALLOTMENT_STATUSES, PERMISSIONS, allotmentJoinSchema, allotmentStatusSchema } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors, validate } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { todayIST, useDay } from '@/components/admissions';

interface Row {
  id: string; campusId: string; levelName: string; entranceRegNo: string; name: string; gender: string; dob: string; category: string | null; quota: string | null; rank: number | null;
  fatherName: string | null; motherName: string | null; parentPhone: string; address: string | null; status: string; statusDate: string | null; statusReason: string | null; studentId: string | null; admissionNo: string | null;
}
interface Summary { campusId: string; campus: string; district: string | null; allotted: number; joined: number; waiting: number; notReported: number; cancelled: number }
interface Data { year: { id: string; name: string } | null; summary: Summary[]; rows: Row[] }
interface SectionOpt { id: string; name: string; available: number; level: { name: string; program: { name: string } } }
type Dialog = { kind: 'join'; row: Row } | { kind: 'status'; row: Row; to: 'NOT_REPORTED' | 'CANCELLED' | 'ALLOTTED' } | null;

/** Students → Allotment list (Phase 21 R1): who was allotted to each school and who joined. */
export default function AllotmentsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const day = useDay();
  const { can } = useSession();
  const canJoin = can(PERMISSIONS.ALLOT_JOIN);
  const canManage = can(PERMISSIONS.ALLOT_MANAGE);
  const [data, setData] = useState<Data | null>(null);
  const [campusId, setCampusId] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [dlg, setDlg] = useState<Dialog>(null);
  const [sections, setSections] = useState<SectionOpt[] | null>(null);
  const [f, setF] = useState({ sectionId: '', joinedOn: todayIST(), admissionNo: '', rollNo: '', date: todayIST(), reason: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (campusId) p.set('campusId', campusId);
    if (status) p.set('status', status);
    if (q.trim()) p.set('q', q.trim());
    api<Data>(`/allotments?${p}`).then(setData).catch(() => setData({ year: null, summary: [], rows: [] }));
  }, [campusId, status, q]);
  useEffect(() => { const h = setTimeout(load, q ? 300 : 0); return () => clearTimeout(h); }, [load, q]);

  const school = useMemo(() => new Map((data?.summary ?? []).map((s) => [s.campusId, s.campus])), [data]);
  const totals = (data?.summary ?? []).reduce((a, s) => ({ allotted: a.allotted + s.allotted, joined: a.joined + s.joined, waiting: a.waiting + s.waiting, notReported: a.notReported + s.notReported }), { allotted: 0, joined: 0, waiting: 0, notReported: 0 });

  async function openJoin(row: Row) {
    setDlg({ kind: 'join', row }); setErrors({}); setSections(null);
    setF({ sectionId: '', joinedOn: todayIST(), admissionNo: '', rollNo: '', date: todayIST(), reason: '' });
    const s = await api<SectionOpt[]>(`/allotments/${row.id}/sections`).catch(() => []);
    setSections(s);
    if (s.length === 1 && s[0].available > 0) setF((x) => ({ ...x, sectionId: s[0].id }));
  }
  function openStatus(row: Row, to: 'NOT_REPORTED' | 'CANCELLED' | 'ALLOTTED') {
    setDlg({ kind: 'status', row, to }); setErrors({});
    setF({ sectionId: '', joinedOn: todayIST(), admissionNo: '', rollNo: '', date: todayIST(), reason: '' });
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!dlg) return;
    const join = dlg.kind === 'join';
    const v = join ? validate(allotmentJoinSchema, { sectionId: f.sectionId, joinedOn: f.joinedOn, admissionNo: f.admissionNo, rollNo: f.rollNo }) : validate(allotmentStatusSchema, { status: dlg.to, date: f.date, reason: f.reason });
    if (!v.ok) return setErrors(v.errors);
    setBusy(true);
    try {
      const r = await api<{ admissionNo?: string }>(`/allotments/${dlg.row.id}/${join ? 'join' : 'status'}`, { method: 'POST', body: JSON.stringify(v.data) });
      toast(join ? t('al.joinedToast', { name: dlg.row.name, no: r.admissionNo ?? '' }) : t(`al.toast.${dlg.to}` as MessageKey, { name: dlg.row.name }));
      setDlg(null);
      load();
    } catch (err) {
      const { fields, message } = apiErrors(err);
      setErrors({ ...fields, ...(message && !Object.keys(fields).length ? { form: message } : {}) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow={t('nav.students')} title={t('al.title')} description={data?.year ? t('al.desc', { year: data.year.name }) : t('al.descNoYear')}
        actions={canManage && <Link href="/imports" className="btn"><Icon name="upload" /> {t('al.import')}</Link>} />

      {!data ? <SkeletonRows /> : !data.year ? (
        <EmptyState icon="calendar" title={t('al.noYear')} />
      ) : !data.summary.length ? (
        <EmptyState icon="clipboard" title={t('al.empty')} text={canManage ? t('al.emptyManage') : t('al.emptySchool')}
          action={canManage && <Link href="/imports" className="btn btn-primary"><Icon name="upload" /> {t('al.import')}</Link>} />
      ) : (
        <>
          <div className="stats">
            <div className="stat"><span className="stat-icon"><Icon name="clipboard" size={20} /></span><span className="stat-text"><span className="stat-label">{t('al.allotted')}</span><span className="stat-value">{totals.allotted}</span></span></div>
            <div className="stat stat-ok"><span className="stat-icon"><Icon name="check" size={20} /></span><span className="stat-text"><span className="stat-label">{t('al.joined')}</span><span className="stat-value">{totals.joined}</span></span></div>
            <div className="stat"><span className="stat-icon"><Icon name="clock" size={20} /></span><span className="stat-text"><span className="stat-label">{t('al.waiting')}</span><span className="stat-value">{totals.waiting}</span></span></div>
            <div className={`stat ${totals.notReported ? 'stat-bad' : ''}`}><span className="stat-icon"><Icon name="alert" size={20} /></span><span className="stat-text"><span className="stat-label">{t('al.notReported')}</span><span className="stat-value">{totals.notReported}</span></span></div>
          </div>

          {data.summary.length > 1 && (
            <section className="card" aria-labelledby="al-by-school">
              <h2 id="al-by-school" className="card-title">{t('al.bySchool')}</h2>
              <div className="table-wrap" role="region" aria-labelledby="al-by-school" tabIndex={0}>
                <table>
                  <thead><tr><th scope="col">{t('common.campus')}</th><th scope="col">{t('al.district')}</th><th scope="col" className="num">{t('al.allotted')}</th><th scope="col" className="num">{t('al.joined')}</th><th scope="col" className="num">{t('al.waiting')}</th><th scope="col" className="num">{t('al.notReported')}</th><th scope="col" className="num">{t('al.cancelled')}</th></tr></thead>
                  <tbody>
                    {data.summary.map((s) => (
                      <tr key={s.campusId}>
                        <th scope="row"><button type="button" className="btn-link" onClick={() => setCampusId(s.campusId)}>{s.campus}</button></th>
                        <td>{s.district ?? '—'}</td><td className="num">{s.allotted}</td><td className="num">{s.joined}</td><td className="num">{s.waiting}</td><td className="num">{s.notReported}</td><td className="num">{s.cancelled}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <div className="toolbar">
            <label className="search"><Icon name="search" size={16} /><input placeholder={t('al.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('al.search')} /></label>
            {data.summary.length > 1 && (
              <select value={campusId} onChange={(e) => setCampusId(e.target.value)} aria-label={t('common.campus')}>
                <option value="">{t('common.allCampuses')}</option>
                {data.summary.map((s) => <option key={s.campusId} value={s.campusId}>{s.campus}</option>)}
              </select>
            )}
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('common.status')}>
              <option value="">{t('al.allStatuses')}</option>
              {ENTRANCE_ALLOTMENT_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}` as MessageKey)}</option>)}
            </select>
            <span className="muted">{t('al.count', { n: data.rows.length })}</span>
          </div>

          {!data.rows.length ? <EmptyState icon="search" title={t('al.noMatch')} /> : (
            <div className="table-wrap" role="region" aria-label={t('al.title')} tabIndex={0}>
              <table className="al-table">
                <thead><tr><th scope="col">{t('al.child')}</th><th scope="col">{t('al.class')}</th><th scope="col">{t('al.parent')}</th><th scope="col">{t('al.quota')}</th><th scope="col">{t('common.status')}</th><th scope="col"><span className="sr-only">{t('al.actions')}</span></th></tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.studentId ? <Link href={`/students/${r.studentId}`}>{r.name}</Link> : r.name}</strong>
                        <span className="sub-line muted small">{r.entranceRegNo} · {t(r.gender === 'FEMALE' ? 'al.girl' : r.gender === 'MALE' ? 'al.boy' : 'al.other')} · {day(r.dob)}</span>
                      </td>
                      <td>{r.levelName}<span className="sub-line muted small">{school.get(r.campusId) ?? ''}</span></td>
                      <td>{r.fatherName ?? r.motherName ?? '—'}<span className="sub-line muted small"><a href={`tel:${r.parentPhone}`}>{r.parentPhone}</a></span></td>
                      <td>{[r.category, r.quota].filter(Boolean).join(' · ') || '—'}{r.rank && <span className="sub-line muted small">{t('al.rank', { n: r.rank })}</span>}</td>
                      <td>
                        <StatusBadge status={r.status} />
                        {r.status === 'JOINED' && r.admissionNo && <span className="sub-line muted small">{r.admissionNo}</span>}
                        {['NOT_REPORTED', 'CANCELLED'].includes(r.status) && <span className="sub-line muted small">{r.statusReason}</span>}
                      </td>
                      <td className="num al-actions">
                        {r.status === 'ALLOTTED' && canJoin && <button type="button" className="btn btn-sm btn-primary" onClick={() => openJoin(r)}>{t('al.markJoined')}</button>}
                        {r.status === 'ALLOTTED' && canJoin && <button type="button" className="btn btn-sm" onClick={() => openStatus(r, 'NOT_REPORTED')}>{t('al.markNotReported')}</button>}
                        {r.status !== 'JOINED' && r.status !== 'CANCELLED' && canManage && <button type="button" className="btn btn-sm btn-ghost danger-text" onClick={() => openStatus(r, 'CANCELLED')}>{t('al.cancel')}</button>}
                        {(r.status === 'NOT_REPORTED' || (r.status === 'CANCELLED' && canManage)) && <button type="button" className="btn btn-sm" onClick={() => openStatus(r, 'ALLOTTED')}>{t('al.reopen')}</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <Modal open={dlg?.kind === 'join'} onClose={() => setDlg(null)} title={t('al.joinTitle', { name: dlg?.row.name ?? '' })} subtitle={dlg ? `${dlg.row.levelName} · ${school.get(dlg.row.campusId) ?? ''}` : undefined}
        onSubmit={submit} submitLabel={t('al.join')} busy={busy} error={errors.form} submitDisabled={!sections || !sections.some((s) => s.available > 0)}>
        {sections && !sections.length && <div className="notice notice-warn"><Icon name="alert" />{t('al.noSection', { cls: dlg?.row.levelName ?? '' })}</div>}
        <div className="grid-2">
          <Field id="al-sec" label={t('al.section')} error={errors.sectionId}>
            <select id="al-sec" value={f.sectionId} onChange={(e) => setF({ ...f, sectionId: e.target.value })}>
              <option value="">{t('mv.choose')}</option>
              {(sections ?? []).map((s) => <option key={s.id} value={s.id} disabled={s.available === 0}>{s.level.name} – {s.name} · {t('mv.seats', { n: s.available })}</option>)}
            </select>
          </Field>
          <Field id="al-on" label={t('al.joinedOn')} error={errors.joinedOn}><input id="al-on" type="date" value={f.joinedOn} max={todayIST()} onChange={(e) => setF({ ...f, joinedOn: e.target.value })} /></Field>
        </div>
        <div className="grid-2">
          <Field id="al-adm" label={t('al.admissionNo')} error={errors.admissionNo} hint={t('al.admissionHint')}><input id="al-adm" value={f.admissionNo} onChange={(e) => setF({ ...f, admissionNo: e.target.value })} /></Field>
          <Field id="al-roll" label={t('al.rollNo')} error={errors.rollNo}><input id="al-roll" value={f.rollNo} onChange={(e) => setF({ ...f, rollNo: e.target.value })} /></Field>
        </div>
        <p className="muted small">{t('al.joinNote')}</p>
      </Modal>

      <Modal open={dlg?.kind === 'status'} onClose={() => setDlg(null)} title={dlg?.kind === 'status' ? t(`al.title.${dlg.to}` as MessageKey, { name: dlg.row.name }) : ''}
        onSubmit={submit} submitLabel={dlg?.kind === 'status' ? t(`al.do.${dlg.to}` as MessageKey) : ''} busy={busy} error={errors.form} danger={dlg?.kind === 'status' && dlg.to === 'CANCELLED'}>
        {dlg?.kind === 'status' && dlg.to !== 'ALLOTTED' && <Field id="al-date" label={t('al.statusDate')} error={errors.date}><input id="al-date" type="date" value={f.date} max={todayIST()} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>}
        <Field id="al-reason" label={t('al.reason')} error={errors.reason}><input id="al-reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      </Modal>
    </>
  );
}
