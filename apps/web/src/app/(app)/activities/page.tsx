'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { ACTIVITY_TYPES } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { ActOpts, ActivityFields, blankActivity } from '@/components/activities';

interface Activity { id: string; name: string; activityType: string; campusId: string; campus: string; coordinatorEmployeeId: string | null; coordinator: string | null; description: string | null; isActive: boolean; members: number; competitions: number; can: { manage: boolean } }

/** Sports & activities (M18.3): sports, clubs and houses with their coordinators. */
export default function ActivitiesPage() {
  const { t } = useI18n();
  const toast = useToast();
  const [opts, setOpts] = useState<ActOpts | null>(null);
  const [rows, setRows] = useState<Activity[] | null>(null);
  const [form, setForm] = useState<typeof blankActivity | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => { api<ActOpts>('/activities/options').then(setOpts).catch(() => setOpts(null)); }, []);
  useEffect(() => { api<Activity[]>('/activities').then(setRows).catch(() => setRows([])); }, [reload]);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true); setErrors({}); setError(null);
    try { await api('/activities', { method: 'POST', body: JSON.stringify({ ...form, coordinatorEmployeeId: form.coordinatorEmployeeId || null, description: form.description || null }) }); toast(t('act.saved')); setForm(null); setReload((n) => n + 1); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader eyebrow={t('nav.sports')} title={t('act.title')} description={opts?.year ? t('act.descYear', { y: opts.year.name }) : t('act.desc')}
        actions={opts?.can.manage && <button type="button" className="btn btn-primary" onClick={() => { setErrors({}); setError(null); setForm({ ...blankActivity, campusId: opts.campuses[0]?.id ?? '' }); }}><Icon name="plus" /> {t('act.new')}</button>} />
      {!rows ? <SkeletonRows rows={4} /> : !rows.length ? <EmptyState icon="star" title={t('act.none')} text={t('act.noneHint')} /> : (
        ACTIVITY_TYPES.filter((ty) => rows.some((r) => r.activityType === ty)).map((ty) => (
          <section key={ty} aria-labelledby={`ty-${ty}`} className="act-group">
            <h2 id={`ty-${ty}`} className="section-title">{t(`act.types.${ty}` as MessageKey)}</h2>
            <div className="act-cards">
              {rows.filter((r) => r.activityType === ty).map((a) => (
                <Link key={a.id} href={`/activities/${a.id}`} className={`card act-card act-link ${a.isActive ? '' : 'muted'}`}>
                  <h3 className="card-title">{a.name}</h3>
                  <p className="muted small">{[a.campus, a.coordinator ? t('act.coordBy', { n: a.coordinator }) : null, a.isActive ? null : t('act.inactive')].filter(Boolean).join(' · ')}</p>
                  {a.description && <p className="small act-desc">{a.description}</p>}
                  <div className="act-card-foot"><span className="chip">{t('act.membersN', { n: a.members })}</span><span className="chip">{t('act.compsN', { n: a.competitions })}</span></div>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title={t('act.new')} subtitle={t('act.newSub')} onSubmit={save} busy={busy} error={error}>
        {form && opts && <ActivityFields form={form} setForm={setForm} opts={opts} errors={errors} />}
      </Modal>
    </>
  );
}
