'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, uploadFile } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { todayIST } from '@/components/accounts';
import { fmtDay } from '@/components/activities';
import { DriveFields, PlcPill, blankDrive, ctcRange, driveBody, lakh, score } from '@/components/placements';

interface App { id: string; studentId: string; name: string; admissionNo: string; program: string | null; className: string | null; appliedAt: string; status: string; currentRound: string | null; remarks: string | null; offer: { id: string; ctc: string; offerDate: string; joiningDate: string | null; status: string; hasLetter: boolean } | null }
interface Drive {
  id: string; title: string; campusId: string; companyId: string; jobType: string; ctcMin: string | null; ctcMax: string | null; eligibleProgramIds: string[]; programs: string[]; passingYear: number; scoreType: string; minScore: string | null; maxBacklogs: number | null; allowPlaced: boolean;
  lastDateToApply: string; driveDate: string | null; rounds: string[]; description: string | null; status: string; company: { id: string; name: string; industry: string | null; website: string | null; status: string }; can: { manage: boolean }; applications: App[];
}
interface Eligible { studentId: string; name: string; admissionNo: string; program: string | null; className: string | null; score: string | null; scoreType: string | null; backlogs: number | null; reasons: string[]; applied: boolean }
const NEXT: Record<string, string[]> = { DRAFT: ['OPEN', 'CANCELLED'], OPEN: ['CLOSED', 'CANCELLED'], CLOSED: ['OPEN', 'COMPLETED', 'CANCELLED'], COMPLETED: [], CANCELLED: [] };

/** One drive (M19.2, M19.3): eligibility, applications round by round, offers. */
export default function DrivePage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const toast = useToast();
  const [d, setD] = useState<Drive | null>(null);
  const [missing, setMissing] = useState(false);
  const [edit, setEdit] = useState<ReturnType<typeof blankDrive> | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [enrol, setEnrol] = useState<{ list: Eligible[] | null; chosen: string[] } | null>(null);
  const [upd, setUpd] = useState<{ a: App; status: string; currentRound: string; remarks: string } | null>(null);
  const [offer, setOffer] = useState<{ a: App; ctc: string; offerDate: string; joiningDate: string; remarks: string } | null>(null);
  const [answer, setAnswer] = useState<{ a: App; status: 'ACCEPTED' | 'DECLINED' | 'REVOKED' } | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Drive>(`/placements/drives/${id}`).then(setD).catch(() => setMissing(true)); }, [id]);
  useEffect(load, [load]);
  const reset = () => { setErrors({}); setError(null); };
  const run = async (fn: () => Promise<unknown>, done: string, close: () => void) => {
    setBusy(true); reset();
    try { await fn(); toast(done); close(); load(); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  if (missing) return <EmptyState icon="file" title={t('plc.d.notFound')} action={<Link href="/placements" className="btn">{t('plc.d.title')}</Link>} />;
  if (!d) return <SkeletonRows rows={6} />;
  const manage = d.can.manage;
  const openEnrol = () => { reset(); setEnrol({ list: null, chosen: [] }); api<Eligible[]>(`/placements/drives/${d.id}/eligible`).then((l) => setEnrol({ list: l, chosen: [] })).catch(() => setEnrol({ list: [], chosen: [] })); };
  const uploadLetter = async (a: App, file: File | undefined) => {
    if (!file || !a.offer) return;
    try { await uploadFile(`/placements/offers/${a.offer.id}/letter`, file); toast(t('plc.o.letterSaved')); load(); }
    catch (x) { toast(apiErrors(x).message ?? t('en.failed'), 'bad'); }
  };
  const active = d.applications.filter((a) => a.status !== 'WITHDRAWN');
  return (
    <>
      <Link href="/placements" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('plc.d.title')}</Link>
      <PageHeader eyebrow={`${d.company.name}${d.company.industry ? ` · ${d.company.industry}` : ''}`} title={d.title}
        description={`${t(`plc.job.${d.jobType}` as MessageKey)} · ${ctcRange(d.ctcMin, d.ctcMax)} · ${t('plc.batchOf', { y: d.passingYear })}`}
        actions={<>
          <PlcPill prefix="plc.ds" status={d.status} />
          {manage && !['COMPLETED', 'CANCELLED'].includes(d.status) && <button type="button" className="btn btn-ghost" onClick={() => { reset(); setEdit({ campusId: d.campusId, companyId: d.companyId, title: d.title, jobType: d.jobType, ctcMin: d.ctcMin ?? '', ctcMax: d.ctcMax ?? '', eligibleProgramIds: d.eligibleProgramIds, passingYear: String(d.passingYear), scoreType: d.scoreType, minScore: d.minScore ?? '', maxBacklogs: d.maxBacklogs == null ? '' : String(d.maxBacklogs), allowPlaced: d.allowPlaced, lastDateToApply: d.lastDateToApply, driveDate: d.driveDate ?? '', rounds: d.rounds.join(', '), description: d.description ?? '' }); }}><Icon name="edit" /> {t('plc.d.edit')}</button>}
          {manage && NEXT[d.status].map((s) => <button key={s} type="button" className={`btn ${s === 'OPEN' ? 'btn-primary' : s === 'CANCELLED' ? 'btn-ghost' : ''}`} onClick={() => { reset(); setStatus(s); }}>{t(`plc.d.to.${s}` as MessageKey)}</button>)}
        </>} />
      {d.company.status === 'BLACKLISTED' && <p className="notice notice-warn"><Icon name="alert" size={16} /> {t('plc.co.isBlacklisted')}</p>}

      <section className="card p12-block" aria-labelledby="dr-facts">
        <h2 id="dr-facts" className="section-title">{t('plc.d.eligibility')}</h2>
        <dl className="inv-facts">
          <div><dt>{t('plc.d.programmes')}</dt><dd>{d.programs.length ? d.programs.join(', ') : t('plc.d.allProgrammes')}</dd></div>
          <div><dt>{t('plc.d.minScore')}</dt><dd>{d.minScore ? score(d.minScore, d.scoreType) : '—'}</dd></div>
          <div><dt>{t('plc.d.maxBacklogs')}</dt><dd>{d.maxBacklogs ?? '—'}</dd></div>
          <div><dt>{t('plc.d.lastDate')}</dt><dd>{fmtDay(locale, d.lastDateToApply)}</dd></div>
          <div><dt>{t('plc.d.driveDate')}</dt><dd>{fmtDay(locale, d.driveDate)}</dd></div>
          <div><dt>{t('plc.d.rounds')}</dt><dd>{d.rounds.length ? d.rounds.join(' → ') : '—'}</dd></div>
        </dl>
        {d.allowPlaced && <p className="muted small">{t('plc.d.allowPlacedNote')}</p>}
        {d.description && <p className="pre-wrap small">{d.description}</p>}
      </section>

      <section className="card p12-block" aria-labelledby="dr-apps">
        <div className="act-card-head">
          <h2 id="dr-apps" className="section-title">{t('plc.a.title', { n: active.length })}</h2>
          {manage && ['OPEN', 'CLOSED'].includes(d.status) && <button type="button" className="btn btn-sm" onClick={openEnrol}><Icon name="plus" size={14} /> {t('plc.a.enrol')}</button>}
        </div>
        {!d.applications.length ? <p className="muted">{d.status === 'DRAFT' ? t('plc.a.noneDraft') : t('plc.a.none')}</p> : (
          <div className="table-wrap" role="region" aria-label={t('plc.a.title', { n: active.length })} tabIndex={0}>
            <table className="table">
              <thead><tr><th scope="col">{t('act.student')}</th><th scope="col">{t('plc.a.stage')}</th><th scope="col">{t('plc.o.title')}</th><th scope="col"><span className="sr-only">{t('common.actions')}</span></th></tr></thead>
              <tbody>{d.applications.map((a) => (
                <tr key={a.id} className={a.status === 'WITHDRAWN' ? 'muted' : undefined}>
                  <td><strong>{a.name}</strong><span className="sub-line muted small">{[a.admissionNo, a.program, a.className].filter(Boolean).join(' · ')}</span></td>
                  <td><PlcPill prefix="plc.as" status={a.status} />{a.currentRound && <span className="sub-line muted small">{t('plc.a.round', { r: a.currentRound })}</span>}{a.remarks && <span className="sub-line small">{a.remarks}</span>}</td>
                  <td>{a.offer ? <><strong>{lakh(a.offer.ctc)}</strong> <PlcPill prefix="plc.os" status={a.offer.status} /><span className="sub-line muted small">{fmtDay(locale, a.offer.offerDate)}{a.offer.joiningDate ? ` · ${t('plc.o.joins', { d: fmtDay(locale, a.offer.joiningDate) })}` : ''}{a.offer.hasLetter ? ` · ${t('plc.o.hasLetter')}` : ''}</span></> : '—'}</td>
                  <td>{manage && a.status !== 'WITHDRAWN' && <span className="row-actions plc-actions">
                    {!['SELECTED', 'REJECTED'].includes(a.status) && <button type="button" className="btn btn-sm" onClick={() => { reset(); setUpd({ a, status: a.status === 'APPLIED' ? 'SHORTLISTED' : a.status, currentRound: a.currentRound ?? d.rounds[0] ?? '', remarks: a.remarks ?? '' }); }}>{t('plc.a.update')}</button>}
                    {a.status === 'SELECTED' && (!a.offer || ['DECLINED', 'REVOKED'].includes(a.offer.status)) && <button type="button" className="btn btn-sm btn-primary" onClick={() => { reset(); setOffer({ a, ctc: d.ctcMin ?? '', offerDate: todayIST(), joiningDate: '', remarks: '' }); }}>{t('plc.o.record')}</button>}
                    {a.offer?.status === 'OFFERED' && <>
                      <button type="button" className="btn btn-sm" onClick={() => { reset(); setAnswer({ a, status: 'ACCEPTED' }); }}>{t('plc.o.accepted')}</button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => { reset(); setAnswer({ a, status: 'DECLINED' }); }}>{t('plc.o.declined')}</button>
                    </>}
                    {a.offer && ['OFFERED', 'ACCEPTED'].includes(a.offer.status) && <>
                      <label className="btn btn-sm btn-ghost plc-upload">{t('plc.o.letter')}<input type="file" accept="application/pdf" className="sr-only" aria-label={t('plc.o.letterFor', { n: a.name })} onChange={(e) => void uploadLetter(a, e.target.files?.[0])} /></label>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => { reset(); setAnswer({ a, status: 'REVOKED' }); }}>{t('plc.o.revoke')}</button>
                    </>}
                  </span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={t('plc.d.edit')} onSubmit={(e) => { e.preventDefault(); if (edit) void run(() => api(`/placements/drives/${d.id}`, { method: 'PUT', body: JSON.stringify(driveBody(edit)) }), t('plc.d.saved'), () => setEdit(null)); }} busy={busy} error={error} wide>
        {edit && <DriveFields form={edit} setForm={setEdit} errors={errors} />}
      </Modal>

      <Modal open={!!status} onClose={() => setStatus(null)} title={status ? t(`plc.d.confirm.${status}` as MessageKey) : ''} subtitle={status === 'OPEN' ? t('plc.d.openNote') : undefined} onSubmit={(e: FormEvent) => { e.preventDefault(); if (status) void run(async () => { const r = await api<{ told: number }>(`/placements/drives/${d.id}/status`, { method: 'POST', body: JSON.stringify({ status }) }); if (status === 'OPEN' && r.told) toast(t('plc.d.told', { n: r.told })); }, t('act.saved'), () => setStatus(null)); }} submitLabel={status ? t(`plc.d.to.${status}` as MessageKey) : ''} busy={busy} error={error} danger={status === 'CANCELLED'}>
        <p className="muted">{d.title} · {d.company.name}</p>
      </Modal>

      <Modal open={!!enrol} onClose={() => setEnrol(null)} title={t('plc.a.enrol')} subtitle={t('plc.a.enrolSub')} onSubmit={(e) => { e.preventDefault(); if (enrol) void run(async () => { const r = await api<{ added: number; already: number }>(`/placements/drives/${d.id}/applications`, { method: 'POST', body: JSON.stringify({ studentIds: enrol.chosen }) }); toast(t('plc.a.enrolled', { n: r.added })); }, t('act.saved'), () => setEnrol(null)); }} submitLabel={t('plc.a.enrolN', { n: enrol?.chosen.length ?? 0 })} busy={busy} error={error} submitDisabled={!enrol?.chosen.length} wide>
        {enrol && (!enrol.list ? <SkeletonRows rows={4} /> : !enrol.list.length ? <p className="muted">{t('plc.a.noStudents')}</p> : (
          <ul className="plc-elig">{enrol.list.map((s) => {
            const ok = !s.reasons.length && !s.applied;
            return (
              <li key={s.studentId} className={ok ? undefined : 'muted'}>
                <label className="check"><input type="checkbox" disabled={!ok} checked={enrol.chosen.includes(s.studentId)} onChange={(e) => setEnrol({ ...enrol, chosen: e.target.checked ? [...enrol.chosen, s.studentId] : enrol.chosen.filter((x) => x !== s.studentId) })} />
                  <span><strong>{s.name}</strong><span className="sub-line small">{[s.admissionNo, s.program, score(s.score, s.scoreType), s.backlogs != null ? t('plc.backlogsN', { n: s.backlogs }) : null].filter(Boolean).join(' · ')}</span>
                    {s.applied ? <span className="sub-line small">{t('plc.a.alreadyApplied')}</span> : s.reasons.length > 0 && <span className="sub-line small">{s.reasons.map((r) => t(`plc.why.${r}` as MessageKey)).join(' · ')}</span>}</span></label>
              </li>
            );
          })}</ul>
        ))}
      </Modal>

      <Modal open={!!upd} onClose={() => setUpd(null)} title={upd?.a.name ?? ''} subtitle={t('plc.a.updateSub')} onSubmit={(e) => { e.preventDefault(); if (upd) void run(() => api(`/placements/applications/${upd.a.id}`, { method: 'PUT', body: JSON.stringify({ status: upd.status, currentRound: upd.currentRound || null, remarks: upd.remarks || null }) }), t('act.saved'), () => setUpd(null)); }} busy={busy} error={error}>
        {upd && <>
          <div className="grid-2">
            <Field id="ap-st" label={t('plc.a.stage')} error={errors.status}><select id="ap-st" value={upd.status} onChange={(e) => setUpd({ ...upd, status: e.target.value })}>{['SHORTLISTED', 'IN_PROCESS', 'SELECTED', 'REJECTED'].map((s) => <option key={s} value={s}>{t(`plc.as.${s}` as MessageKey)}</option>)}</select></Field>
            {d.rounds.length > 0 && <Field id="ap-rd" label={t('plc.a.roundLabel')} error={errors.currentRound}><select id="ap-rd" value={upd.currentRound} onChange={(e) => setUpd({ ...upd, currentRound: e.target.value })}><option value="">—</option>{d.rounds.map((r) => <option key={r} value={r}>{r}</option>)}</select></Field>}
          </div>
          <Field id="ap-rm" label={t('act.remarks')} error={errors.remarks}><input id="ap-rm" value={upd.remarks} onChange={(e) => setUpd({ ...upd, remarks: e.target.value })} /></Field>
          <p className="muted small"><Icon name="info" size={14} /> {t('plc.a.tellNote')}</p>
        </>}
      </Modal>

      <Modal open={!!offer} onClose={() => setOffer(null)} title={t('plc.o.record')} subtitle={offer?.a.name} onSubmit={(e) => { e.preventDefault(); if (offer) void run(() => api(`/placements/applications/${offer.a.id}/offer`, { method: 'POST', body: JSON.stringify({ ctc: offer.ctc, offerDate: offer.offerDate, joiningDate: offer.joiningDate || null, remarks: offer.remarks || null }) }), t('plc.o.saved'), () => setOffer(null)); }} busy={busy} error={error}>
        {offer && <>
          <Field id="of-ctc" label={t('plc.o.ctc')} hint={t('plc.d.ctcHint')} error={errors.ctc}><input id="of-ctc" inputMode="decimal" value={offer.ctc} onChange={(e) => setOffer({ ...offer, ctc: e.target.value })} /></Field>
          <div className="grid-2">
            <Field id="of-date" label={t('plc.o.date')} error={errors.offerDate}><input id="of-date" type="date" value={offer.offerDate} onChange={(e) => setOffer({ ...offer, offerDate: e.target.value })} /></Field>
            <Field id="of-join" label={t('plc.o.joining')} hint={t('act.optional')} error={errors.joiningDate}><input id="of-join" type="date" min={offer.offerDate} value={offer.joiningDate} onChange={(e) => setOffer({ ...offer, joiningDate: e.target.value })} /></Field>
          </div>
          <Field id="of-rm" label={t('act.remarks')} error={errors.remarks}><input id="of-rm" value={offer.remarks} onChange={(e) => setOffer({ ...offer, remarks: e.target.value })} /></Field>
        </>}
      </Modal>

      <Modal open={!!answer} onClose={() => setAnswer(null)} title={answer ? t(`plc.o.confirm.${answer.status}` as MessageKey, { n: answer.a.name }) : ''} subtitle={answer?.status === 'ACCEPTED' ? t('plc.o.acceptNote') : undefined} onSubmit={(e) => { e.preventDefault(); if (answer?.a.offer) void run(() => api(`/placements/offers/${answer.a.offer!.id}/status`, { method: 'POST', body: JSON.stringify({ status: answer.status }) }), t('act.saved'), () => setAnswer(null)); }} submitLabel={answer ? t(`plc.os.${answer.status}` as MessageKey) : ''} busy={busy} error={error} danger={answer?.status === 'REVOKED'}>
        {answer?.a.offer && <p className="muted">{lakh(answer.a.offer.ctc)} · {d.company.name}</p>}
      </Modal>
    </>
  );
}
