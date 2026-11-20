'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { COMPETITION_RESULTS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import type { Person } from '@/components/campuslife';
import { ActPill, MultiPicker, fmtDay } from '@/components/activities';

interface Comp {
  id: string; name: string; level: string; venue: string | null; startDate: string; endDate: string; description: string | null; eventId: string | null;
  activity: { id: string; name: string; activityType: string }; can: { manage: boolean };
  participants: { id: string; studentId: string; name: string; admissionNo: string; className: string | null; category: string; result: string; remarks: string | null; achievementId: string | null; achievementVerified: boolean }[];
}

/** A competition (M18.4): entries by category, results, and achievements made from results. */
export default function CompetitionPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const toast = useToast();
  const [c, setC] = useState<Comp | null>(null);
  const [missing, setMissing] = useState(false);
  const [add, setAdd] = useState<{ students: Person[]; category: string } | null>(null);
  const [award, setAward] = useState<{ pid: string; name: string; postToFeed: boolean } | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Comp>(`/activities/competitions/${id}`).then(setC).catch(() => setMissing(true)); }, [id]);
  useEffect(load, [load]);
  if (missing) return <EmptyState icon="calendar" title={t('act.cmp.notFound')} action={<Link href="/activities" className="btn">{t('act.title')}</Link>} />;
  if (!c) return <SkeletonRows rows={6} />;
  const reset = () => { setErrors({}); setError(null); };
  const saveAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!add) return;
    setBusy(true); reset();
    try { const r = await api<{ added: number; already: number }>(`/activities/competitions/${c.id}/participants`, { method: 'POST', body: JSON.stringify({ studentIds: add.students.map((s) => s.id), category: add.category.trim() }) }); toast(r.already ? t('act.part.addedSome', { n: r.added, m: r.already }) : t('act.part.added', { n: r.added })); setAdd(null); load(); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const setResult = async (pid: string, result: string) => {
    try { await api(`/activities/participants/${pid}`, { method: 'PUT', body: JSON.stringify({ result }) }); load(); }
    catch (x) { toast(apiErrors(x).message ?? t('en.failed'), 'bad'); load(); }
  };
  const remove = async (pid: string) => {
    try { await api(`/activities/participants/${pid}`, { method: 'DELETE' }); toast(t('act.part.removed')); load(); }
    catch (x) { toast(apiErrors(x).message ?? t('en.failed'), 'bad'); }
  };
  const saveAward = async (e: FormEvent) => {
    e.preventDefault();
    if (!award) return;
    setBusy(true); reset();
    try { const r = await api<{ title: string }>(`/activities/participants/${award.pid}/achievement`, { method: 'POST', body: JSON.stringify({ postToFeed: award.postToFeed }) }); toast(t('act.ach.recorded', { title: r.title })); setAward(null); load(); }
    catch (x) { const a = apiErrors(x); setError(a.message); } finally { setBusy(false); }
  };
  const cats = [...new Set(c.participants.map((p) => p.category))];
  return (
    <>
      <Link href={`/activities/${c.activity.id}`} className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {c.activity.name}</Link>
      <PageHeader eyebrow={`${t(`act.level.${c.level}` as MessageKey)} · ${c.activity.name}`} title={c.name}
        description={[`${fmtDay(locale, c.startDate)}${c.endDate !== c.startDate ? ` – ${fmtDay(locale, c.endDate)}` : ''}`, c.venue, c.eventId ? t('act.cmp.onCalendar') : null].filter(Boolean).join(' · ')}
        actions={c.can.manage && <button type="button" className="btn btn-primary" onClick={() => { reset(); setAdd({ students: [], category: cats[0] ?? '' }); }}><Icon name="plus" /> {t('act.part.add')}</button>} />
      {c.description && <p className="muted">{c.description}</p>}
      {!c.participants.length ? <EmptyState icon="users" title={t('act.part.none')} text={c.can.manage ? t('act.part.noneHint') : undefined} /> : cats.map((cat) => (
        <section key={cat || 'none'} className="card p12-block" aria-labelledby={`cat-${cat || 'none'}`}>
          <h2 id={`cat-${cat || 'none'}`} className="section-title">{cat || t('act.part.noCategory')}</h2>
          <div className="table-wrap" role="region" aria-label={cat || t('act.part.noCategory')} tabIndex={0}>
            <table className="table">
              <thead><tr><th scope="col">{t('act.student')}</th><th scope="col">{t('act.part.result')}</th><th scope="col"><span className="sr-only">{t('common.actions')}</span></th></tr></thead>
              <tbody>{c.participants.filter((p) => p.category === cat).map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong><span className="sub-line muted small">{p.admissionNo}{p.className ? ` · ${p.className}` : ''}</span></td>
                  <td>{c.can.manage && !p.achievementVerified
                    ? <select aria-label={t('act.part.resultFor', { n: p.name })} value={p.result} onChange={(e) => void setResult(p.id, e.target.value)}>{COMPETITION_RESULTS.map((r) => <option key={r} value={r}>{t(`act.res.${r}` as MessageKey)}</option>)}</select>
                    : <ActPill prefix="act.res" status={p.result} />}</td>
                  <td>
                    {p.achievementId
                      ? <span className="pill pill-ok"><span className="pill-dot" />{t('act.part.onRecord')}</span>
                      : c.can.manage && <span className="row-actions">
                        {p.result !== 'PARTICIPATED' && <button type="button" className="btn btn-sm btn-primary" onClick={() => { reset(); setAward({ pid: p.id, name: p.name, postToFeed: ['WINNER', 'RUNNER_UP', 'THIRD'].includes(p.result) && c.level !== 'INTRA' }); }}><Icon name="star" size={14} /> {t('act.part.award')}</button>}
                        <button type="button" className="btn btn-sm btn-ghost icon-btn" aria-label={t('act.removeNamed', { n: p.name })} onClick={() => void remove(p.id)}><Icon name="trash" size={14} /></button>
                      </span>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      ))}

      <Modal open={!!add} onClose={() => setAdd(null)} title={t('act.part.add')} subtitle={t('act.part.addSub')} onSubmit={saveAdd} submitLabel={t('act.mem.addBtn', { n: add?.students.length ?? 0 })} busy={busy} error={error} submitDisabled={!add?.students.length} wide>
        {add && <>
          <Field id="pa-cat" label={t('act.part.category')} hint={t('act.part.categoryHint')} error={errors.category}><input id="pa-cat" value={add.category} list="pa-cats" placeholder={t('act.part.categoryPh')} onChange={(e) => setAdd({ ...add, category: e.target.value })} /><datalist id="pa-cats">{cats.filter(Boolean).map((x) => <option key={x} value={x} />)}</datalist></Field>
          <Field id="pa-stu" label={t('act.students')} error={errors.studentIds}><MultiPicker endpoint="/activities/people" value={add.students} onChange={(p) => setAdd({ ...add, students: p })} inputId="pa-stu" placeholder={t('act.findStudent')} /></Field>
        </>}
      </Modal>

      <Modal open={!!award} onClose={() => setAward(null)} title={t('act.part.awardTitle', { n: award?.name ?? '' })} subtitle={t('act.part.awardSub')} onSubmit={saveAward} submitLabel={t('act.part.award')} busy={busy} error={error}>
        {award && <label className="check"><input type="checkbox" checked={award.postToFeed} onChange={(e) => setAward({ ...award, postToFeed: e.target.checked })} /> {t('act.ach.toFeed')}</label>}
      </Modal>
    </>
  );
}
