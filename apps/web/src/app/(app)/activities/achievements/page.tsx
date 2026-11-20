'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ACHIEVEMENT_CATEGORIES, COMPETITION_LEVELS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { todayIST } from '@/components/accounts';
import type { Person } from '@/components/campuslife';
import { ActOpts, MultiPicker, fmtDay } from '@/components/activities';

interface Ach { id: string; person: string; personDetail: string; kind: 'STUDENT' | 'STAFF'; title: string; category: string; level: string; achievementDate: string; description: string | null; isVerified: boolean; onFeed: boolean; fromResult: boolean; can: { verify: boolean; remove: boolean } }

/** Sports & activities → Achievements (M18.4): recorded by teachers, verified by a coordinator. */
export default function AchievementsPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [opts, setOpts] = useState<ActOpts | null>(null);
  const [filter, setFilter] = useState<'' | 'PENDING' | 'VERIFIED'>('');
  const [rows, setRows] = useState<Ach[] | null>(null);
  const [form, setForm] = useState<{ who: Person[]; title: string; category: string; level: string; achievementDate: string; description: string } | null>(null);
  const [verify, setVerify] = useState<{ a: Ach; postToFeed: boolean } | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<ActOpts>('/activities/options').then(setOpts).catch(() => setOpts(null)); }, []);
  const load = useCallback(() => { setRows(null); api<Ach[]>(`/activities/achievements${filter ? `?status=${filter}` : ''}`).then(setRows).catch(() => setRows([])); }, [filter]);
  useEffect(load, [load]);
  const reset = () => { setErrors({}); setError(null); };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true); reset();
    const p = form.who[0];
    try {
      const r = await api<{ isVerified: boolean }>('/activities/achievements', { method: 'POST', body: JSON.stringify({ studentId: p?.type === 'STUDENT' ? p.id : null, employeeId: p?.type === 'EMPLOYEE' ? p.id : null, title: form.title, category: form.category, level: form.level, achievementDate: form.achievementDate, description: form.description || null }) });
      toast(r.isVerified ? t('act.ach.savedVerified') : t('act.ach.savedPending')); setForm(null); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const saveVerify = async (e: FormEvent) => {
    e.preventDefault();
    if (!verify) return;
    setBusy(true); reset();
    try { await api(`/activities/achievements/${verify.a.id}/verify`, { method: 'POST', body: JSON.stringify({ postToFeed: verify.postToFeed }) }); toast(t('act.ach.verifiedToast')); setVerify(null); load(); }
    catch (x) { setError(apiErrors(x).message); } finally { setBusy(false); }
  };
  const remove = async (a: Ach) => {
    try { await api(`/activities/achievements/${a.id}`, { method: 'DELETE' }); toast(t('act.ach.removed')); load(); }
    catch (x) { toast(apiErrors(x).message ?? t('en.failed'), 'bad'); }
  };
  const pending = (rows ?? []).filter((r) => !r.isVerified).length;
  return (
    <>
      <PageHeader eyebrow={t('nav.sports')} title={t('act.ach.title')} description={t('act.ach.desc')}
        actions={opts?.can.add && <button type="button" className="btn btn-primary" onClick={() => { reset(); setForm({ who: [], title: '', category: 'SPORTS', level: 'INTRA', achievementDate: todayIST(), description: '' }); }}><Icon name="plus" /> {t('act.ach.new')}</button>} />
      <div className="tabs" role="tablist" aria-label={t('act.ach.title')}>
        {(['', 'PENDING', 'VERIFIED'] as const).map((x) => <button key={x || 'all'} role="tab" aria-selected={filter === x} className={filter === x ? 'on' : ''} onClick={() => setFilter(x)}>{x ? t(`act.ach.f.${x}` as MessageKey) : t('act.all')}{x === 'PENDING' && filter === '' && pending > 0 ? <span className="tab-count">{pending}</span> : null}</button>)}
      </div>
      {!rows ? <SkeletonRows rows={4} /> : !rows.length ? <EmptyState icon="star" title={t('act.ach.none')} /> : (
        <ul className="act-ach-list">{rows.map((a) => (
          <li key={a.id} className="card">
            <span className="act-medal" aria-hidden><Icon name="star" size={18} /></span>
            <span className="act-what">
              <strong>{a.title}</strong>
              <span className="sub-line small">{a.person}<span className="muted"> · {a.kind === 'STAFF' ? t('cl.staff') : a.personDetail}</span></span>
              <span className="sub-line muted small">{t(`act.level.${a.level}` as MessageKey)} · {t(`act.cat.${a.category}` as MessageKey)} · {fmtDay(locale, a.achievementDate)}{a.onFeed ? ` · ${t('act.ach.onFeed')}` : ''}</span>
              {a.description && <span className="sub-line small">{a.description}</span>}
            </span>
            <span className="act-actions">
              {a.isVerified ? <span className="pill pill-ok"><span className="pill-dot" />{t('act.ach.verified')}</span> : <span className="pill pill-warn"><span className="pill-dot" />{t('act.ach.pending')}</span>}
              {a.can.verify && <button type="button" className="btn btn-sm btn-primary" onClick={() => { reset(); setVerify({ a, postToFeed: false }); }}>{t('act.ach.verify')}</button>}
              {a.can.remove && <button type="button" className="btn btn-sm btn-ghost icon-btn" aria-label={t('act.removeNamed', { n: a.title })} onClick={() => void remove(a)}><Icon name="trash" size={14} /></button>}
            </span>
          </li>
        ))}</ul>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title={t('act.ach.new')} subtitle={opts?.can.manage ? t('act.ach.newSubCoord') : t('act.ach.newSub')} onSubmit={save} busy={busy} error={error} submitDisabled={!form?.who.length} wide>
        {form && <>
          <Field id="ah-who" label={t('act.ach.who')} error={errors.studentId}><MultiPicker endpoint="/activities/people?kind=ANY" value={form.who} onChange={(p) => setForm({ ...form, who: p })} inputId="ah-who" placeholder={t('act.ach.findWho')} single /></Field>
          <Field id="ah-title" label={t('act.ach.titleLabel')} error={errors.title}><input id="ah-title" value={form.title} placeholder={t('act.ach.titlePh')} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <div className="grid-3">
            <Field id="ah-cat" label={t('act.ach.category')} error={errors.category}><select id="ah-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{ACHIEVEMENT_CATEGORIES.map((c) => <option key={c} value={c}>{t(`act.cat.${c}` as MessageKey)}</option>)}</select></Field>
            <Field id="ah-level" label={t('act.cmp.level')} error={errors.level}><select id="ah-level" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>{COMPETITION_LEVELS.map((l) => <option key={l} value={l}>{t(`act.level.${l}` as MessageKey)}</option>)}</select></Field>
            <Field id="ah-date" label={t('act.date')} error={errors.achievementDate}><input id="ah-date" type="date" max={todayIST()} value={form.achievementDate} onChange={(e) => setForm({ ...form, achievementDate: e.target.value })} /></Field>
          </div>
          <Field id="ah-desc" label={t('act.description')} hint={t('act.optional')} error={errors.description}><input id="ah-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        </>}
      </Modal>

      <Modal open={!!verify} onClose={() => setVerify(null)} title={t('act.ach.verifyTitle')} subtitle={verify ? `${verify.a.title} · ${verify.a.person}` : undefined} onSubmit={saveVerify} submitLabel={t('act.ach.verify')} busy={busy} error={error}>
        {verify && <>
          <p className="muted">{verify.a.kind === 'STUDENT' ? t('act.ach.verifyNote') : t('act.ach.verifyNoteStaff')}</p>
          <label className="check"><input type="checkbox" checked={verify.postToFeed} onChange={(e) => setVerify({ ...verify, postToFeed: e.target.checked })} /> {t('act.ach.toFeed')}</label>
        </>}
      </Modal>
    </>
  );
}
