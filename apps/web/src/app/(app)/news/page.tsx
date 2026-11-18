'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { PERMISSIONS, POST_TYPES } from '@eduerp/shared';
import { api, uploadFile } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { useAcadSections } from '@/components/academics';
import { AudiencePicker, Post, PostCard, Target } from '@/components/engagement';

interface Report { id: string; reason: string; details: string | null; createdAt: string; reportedBy: string; kind: 'POST' | 'COMMENT'; postId: string | null; text: string; hidden: boolean }
type Tab = 'feed' | 'pending' | 'reports';

/** Engagement → News (M11.1): the school news feed, posts waiting for approval and reports. */
export default function NewsPage() {
  const { can } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const moderator = can(PERMISSIONS.FEED_MODERATE);
  const canPost = moderator || can(PERMISSIONS.FEED_POST);
  const sections = useAcadSections();
  const [tab, setTab] = useState<Tab>('feed');
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [reports, setReports] = useState<Report[] | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ postType: string; title: string; body: string; allowComments: boolean; targets: Target[] }>({ postType: 'NEWS', title: '', body: '', allowComments: true, targets: [] });
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setPosts(null);
    if (tab === 'reports') { api<Report[]>('/engagement/feed/reports').then(setReports).catch(() => setReports([])); return; }
    api<Post[]>(`/engagement/feed${tab === 'pending' ? '?pending=1' : ''}`).then(setPosts).catch(() => setPosts([]));
  }, [tab]);
  useEffect(load, [load]);
  const start = () => { setForm({ postType: 'NEWS', title: '', body: '', allowComments: true, targets: [{ targetType: 'ALL' }] }); setFiles([]); setErrors({}); setError(null); setOpen(true); };
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try {
      const fileIds: string[] = [];
      for (const f of files) fileIds.push((await uploadFile<{ id: string }>('/engagement/feed/files', f)).id);
      const r = await api<{ status: string }>('/engagement/feed', { method: 'POST', body: JSON.stringify({ ...form, title: form.title || null, fileIds }) });
      toast(r.status === 'PUBLISHED' ? t('en.postedToast') : t('en.pendingToast'));
      setOpen(false); if (r.status !== 'PUBLISHED') setTab('pending'); else load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const act = async (r: Report, action: 'HIDE' | 'DISMISS') => {
    try { await api(`/engagement/feed/reports/${r.id}`, { method: 'POST', body: JSON.stringify({ action }) }); toast(t(action === 'HIDE' ? 'en.rep.hidden' : 'en.rep.dismissed')); load(); } catch (x) { toast(apiErrors(x).message ?? t('en.failed')); }
  };
  const tabs: Tab[] = ['feed', 'pending', ...(moderator ? ['reports' as Tab] : [])];

  return (
    <>
      <PageHeader eyebrow={t('nav.engagement')} title={t('en.news.title')} description={t('en.news.desc')}
        actions={canPost && <button type="button" className="btn btn-primary" onClick={start}><Icon name="plus" /> {t('en.write')}</button>} />
      <div className="tabs" role="tablist" aria-label={t('en.news.title')}>
        {tabs.map((x) => <button key={x} type="button" role="tab" id={`tab-${x}`} aria-selected={tab === x} aria-controls={`panel-${x}`} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(`en.tab.${x}` as MessageKey)}</button>)}
      </div>
      <section role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="ac-panel feed-col">
        {tab === 'reports' ? (
          !reports ? <SkeletonRows rows={3} /> : !reports.length ? <EmptyState icon="shield" title={t('en.rep.none')} /> : (
            <ul className="sm-list">
              {reports.map((r) => (
                <li key={r.id} className="card report-card">
                  <span className="hw-subject">{t(`en.why.${r.reason}` as MessageKey)} · {t(r.kind === 'POST' ? 'en.rep.post' : 'en.rep.comment')}</span>
                  <p className="report-text">“{r.text}”</p>
                  <p className="muted small">{t('en.rep.by', { name: r.reportedBy })}{r.details ? ` — ${r.details}` : ''}</p>
                  <span className="row-actions"><button type="button" className="btn btn-sm btn-primary" onClick={() => void act(r, 'HIDE')}>{t('en.rep.hide')}</button><button type="button" className="btn btn-sm" onClick={() => void act(r, 'DISMISS')}>{t('en.rep.dismiss')}</button></span>
                </li>
              ))}
            </ul>
          )
        ) : !posts ? <SkeletonRows rows={4} /> : !posts.length ? <EmptyState icon="mail" title={t(tab === 'pending' ? 'en.noPending' : 'en.none')} text={tab === 'feed' && canPost ? t('en.noneHint') : undefined} /> : (
          posts.map((p) => <PostCard key={p.id} p={p} base="/engagement/feed" moderator={moderator} onChanged={load} />)
        )}
      </section>
      <Modal open={open} onClose={() => setOpen(false)} title={t('en.write')} subtitle={moderator ? undefined : t('en.writeSub')} onSubmit={save} submitLabel={t('en.publish')} busy={busy} error={error} wide>
        <div className="grid-2">
          <Field id="np-type" label={t('en.kind')}><select id="np-type" value={form.postType} onChange={(e) => setForm((f) => ({ ...f, postType: e.target.value }))}>{POST_TYPES.map((x) => <option key={x} value={x}>{t(`en.type.${x}` as MessageKey)}</option>)}</select></Field>
          <Field id="np-title" label={t('en.titleLabel')} error={errors.title}><input id="np-title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></Field>
        </div>
        <Field id="np-body" label={t('en.bodyLabel')} error={errors.body}><textarea id="np-body" rows={5} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} placeholder={t('en.bodyPh')} /></Field>
        <Field id="np-files" label={t('en.files')} hint={t('en.filesHint')}><input id="np-files" type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 10))} /></Field>
        {sections && <AudiencePicker sections={sections} value={form.targets} onChange={(targets) => setForm((f) => ({ ...f, targets }))} error={errors.targets} />}
        <label className="check"><input type="checkbox" checked={form.allowComments} onChange={(e) => setForm((f) => ({ ...f, allowComments: e.target.checked }))} /> {t('en.allowComments')}</label>
      </Modal>
    </>
  );
}
