'use client';

import { FormEvent, Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { REACTIONS, REPORT_REASONS } from '@eduerp/shared';
import { api, blobUrl, downloadFile } from '@/lib/api';
import { apiErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { useToast } from '@/components/ui';
import { AcadSection } from '@/components/academics';

/** Engagement (Phase 11) shared pieces: the audience picker and a news post card. */

export type Target = { targetType: 'ALL' | 'CAMPUS' | 'LEVEL' | 'SECTION'; targetId?: string | null };
export const REACTION_ICON: Record<string, string> = { LIKE: '👍', LOVE: '❤️', CLAP: '👏', CELEBRATE: '🎉' };

/** Choose who something is for: everyone, campuses, classes or sections (from the current year). */
export function AudiencePicker({ sections, value, onChange, error }: { sections: AcadSection[]; value: Target[]; onChange: (v: Target[]) => void; error?: string }) {
  const { t } = useI18n();
  const campuses = useMemo(() => [...new Map(sections.map((s) => [s.campusId, s.campus])).entries()], [sections]);
  const levels = useMemo(() => [...new Map(sections.map((s) => [s.programLevelId, `${s.name.split(' – ')[0]}${campuses.length > 1 ? ` · ${s.campus}` : ''}`])).entries()], [sections, campuses.length]);
  const all = value.some((x) => x.targetType === 'ALL');
  const has = (type: Target['targetType'], id: string) => value.some((x) => x.targetType === type && x.targetId === id);
  const toggle = (type: Target['targetType'], id: string | null, on: boolean) => {
    if (type === 'ALL') return onChange(on ? [{ targetType: 'ALL' }] : []);
    onChange(on ? [...value.filter((x) => x.targetType !== 'ALL'), { targetType: type, targetId: id }] : value.filter((x) => !(x.targetType === type && x.targetId === id)));
  };
  return (
    <fieldset className="check-group audience" aria-describedby={error ? 'aud-err' : undefined}>
      <legend>{t('en.aud.title')}</legend>
      <label className="check"><input type="checkbox" checked={all} onChange={(e) => toggle('ALL', null, e.target.checked)} /> <strong>{t('en.aud.all')}</strong></label>
      {!all && (
        <div className="audience-groups">
          {campuses.length > 1 && <div><span className="audience-h">{t('common.campus')}</span>{campuses.map(([id, n]) => <label key={id} className="check"><input type="checkbox" checked={has('CAMPUS', id)} onChange={(e) => toggle('CAMPUS', id, e.target.checked)} /> {n}</label>)}</div>}
          <div><span className="audience-h">{t('en.aud.classes')}</span>{levels.map(([id, n]) => <label key={id} className="check"><input type="checkbox" checked={has('LEVEL', id)} onChange={(e) => toggle('LEVEL', id, e.target.checked)} /> {n}</label>)}</div>
          <div><span className="audience-h">{t('en.aud.sections')}</span>{sections.map((s) => <label key={s.id} className="check"><input type="checkbox" checked={has('SECTION', s.id)} onChange={(e) => toggle('SECTION', s.id, e.target.checked)} /> {s.name}</label>)}</div>
        </div>
      )}
      {error && <span id="aud-err" className="field-error">{error}</span>}
    </fieldset>
  );
}

export interface Post {
  id: string; postType: string; title: string | null; body: string; allowComments: boolean; isPinned: boolean; status: string; publishedAt: string | null; createdAt: string; eventId: string | null;
  author: string; mine: boolean; media: { id: string; name: string; kind: 'IMAGE' | 'PDF' }[]; audience: string[];
  reactions: Record<string, number>; reactionTotal: number; myReaction: string | null; comments: number;
}
interface Comment { id: string; parentCommentId: string | null; comment: string; status: string; createdAt: string; author: string; mine: boolean }

/** A photo of a post, loaded with the user's session. */
function PostImage({ base, postId, file }: { base: string; postId: string; file: { id: string; name: string } }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    blobUrl(`${base}/${postId}/files/${file.id}`).then((u) => { url = u; setSrc(u); }).catch(() => setSrc(null));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [base, postId, file.id]);
  return src ? <img src={src} alt={file.name} className="post-img" loading="lazy" /> : <div className="post-img placeholder" aria-hidden="true" />;
}

/**
 * A news post: author, audience, text, photos / PDFs, reactions, comments and "report".
 * `base` is the API path (/engagement/feed for staff, /portal/feed in the parent app).
 */
export function PostCard({ p, base, moderator = false, onChanged }: { p: Post; base: string; moderator?: boolean; onChanged?: () => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [mine, setMine] = useState(p.myReaction);
  const [total, setTotal] = useState(p.reactionTotal);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [report, setReport] = useState<{ postId?: string; commentId?: string } | null>(null);
  const [reason, setReason] = useState('SPAM');
  const [details, setDetails] = useState('');
  const [count, setCount] = useState(p.comments);
  const loadComments = useCallback(() => { api<Comment[]>(`${base}/${p.id}/comments`).then(setComments).catch(() => setComments([])); }, [base, p.id]);
  useEffect(() => { if (showComments) loadComments(); }, [showComments, loadComments]);
  const react = async (r: string) => {
    const next = mine === r ? null : r;
    try { const x = await api<{ myReaction: string | null; reactionTotal: number }>(`${base}/${p.id}/react`, { method: 'POST', body: JSON.stringify({ reaction: next }) }); setMine(x.myReaction); setTotal(x.reactionTotal); } catch (e) { toast(apiErrors(e).message ?? t('en.failed')); }
  };
  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim()) return;
    try { await api(`${base}/${p.id}/comments`, { method: 'POST', body: JSON.stringify({ comment: text, parentCommentId: replyTo?.id ?? null }) }); setText(''); setReplyTo(null); setCount((c) => c + 1); loadComments(); } catch (x) { toast(apiErrors(x).message ?? t('en.failed')); }
  };
  const sendReport = async (e?: FormEvent) => {
    e?.preventDefault();
    try { await api(`${base}/reports`, { method: 'POST', body: JSON.stringify({ ...report, reason, details: details || null }) }); toast(t('en.reported')); setReport(null); } catch (x) { toast(apiErrors(x).message ?? t('en.failed')); }
  };
  const moderate = async (action: string) => {
    try { await api(`${base}/${p.id}/moderate`, { method: 'POST', body: JSON.stringify({ action }) }); toast(t(`en.mod.${action}` as MessageKey)); onChanged?.(); } catch (x) { toast(apiErrors(x).message ?? t('en.failed')); }
  };
  const hideComment = async (c: Comment) => {
    try { await api(`${base}/comments/${c.id}/hide`, { method: 'POST', body: JSON.stringify({ hide: c.status !== 'HIDDEN' }) }); loadComments(); } catch (x) { toast(apiErrors(x).message ?? t('en.failed')); }
  };
  const when = (s: string | null) => (s ? new Date(s).toLocaleString(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '');
  const images = p.media.filter((m) => m.kind === 'IMAGE');
  const pdfs = p.media.filter((m) => m.kind === 'PDF');
  const top = (comments ?? []).filter((c) => !c.parentCommentId);
  const replies = (id: string) => (comments ?? []).filter((c) => c.parentCommentId === id);
  const commentRow = (c: Comment) => (
    <li key={c.id} className={c.status === 'HIDDEN' ? 'hidden-comment' : undefined}>
      <strong>{c.author}</strong> <span className="muted small">{when(c.createdAt)}</span>{c.status === 'HIDDEN' && <span className="pill pill-muted">{t('en.hidden')}</span>}
      <p>{c.comment}</p>
      <span className="comment-actions">
        {!c.parentCommentId && p.allowComments && p.status === 'PUBLISHED' && <button type="button" className="link-btn" onClick={() => setReplyTo(c)}>{t('en.reply')}</button>}
        {!c.mine && <button type="button" className="link-btn muted-link" onClick={() => { setReason('ABUSIVE'); setDetails(''); setReport({ commentId: c.id }); }}>{t('en.report')}</button>}
        {moderator && <button type="button" className="link-btn muted-link" onClick={() => void hideComment(c)}>{c.status === 'HIDDEN' ? t('en.showComment') : t('en.hideComment')}</button>}
      </span>
    </li>
  );
  return (
    <article className={`card post${p.isPinned ? ' pinned' : ''}${p.status !== 'PUBLISHED' ? ' not-live' : ''}`} aria-labelledby={`post-${p.id}`}>
      <header className="post-head">
        <span className="post-avatar" aria-hidden="true">{p.author.slice(0, 1)}</span>
        <span className="post-who"><strong>{p.author}</strong><span className="muted small">{when(p.publishedAt ?? p.createdAt)} · {p.audience.map((a) => (a === 'ALL' ? t('en.aud.everyone') : a)).join(', ')}</span></span>
        <span className="post-tags">
          {p.isPinned && <span className="pill pill-info"><Icon name="star" size={12} /> {t('en.pinned')}</span>}
          <span className="pill pill-muted">{t(`en.type.${p.postType}` as MessageKey)}</span>
          {p.status !== 'PUBLISHED' && <span className="pill pill-warn">{t(`en.status.${p.status}` as MessageKey)}</span>}
        </span>
      </header>
      {p.title && <h3 id={`post-${p.id}`} className="post-title">{p.title}</h3>}
      <p id={p.title ? undefined : `post-${p.id}`} className="post-body">{p.body}</p>
      {images.length > 0 && <div className={`post-images n${Math.min(images.length, 3)}`}>{images.map((m) => <PostImage key={m.id} base={base} postId={p.id} file={m} />)}</div>}
      {pdfs.length > 0 && <ul className="post-files">{pdfs.map((m) => <li key={m.id}><button type="button" className="link-btn" onClick={() => void downloadFile(`${base}/${p.id}/files/${m.id}`)}><Icon name="file" size={14} /> {m.name}</button></li>)}</ul>}
      {p.status === 'PUBLISHED' && (
        <div className="post-actions">
          <span className="reactions" role="group" aria-label={t('en.react')}>
            {REACTIONS.map((r) => <button key={r} type="button" className={mine === r ? 'on' : ''} aria-pressed={mine === r} aria-label={t(`en.reaction.${r}` as MessageKey)} title={t(`en.reaction.${r}` as MessageKey)} onClick={() => void react(r)}><span aria-hidden="true">{REACTION_ICON[r]}</span></button>)}
            <span className="muted small">{total ? t('en.reactionsN', { n: total }) : ''}</span>
          </span>
          {p.allowComments && <button type="button" className="link-btn" aria-expanded={showComments} onClick={() => setShowComments((x) => !x)}><Icon name="mail" size={14} /> {t('en.commentsN', { n: count })}</button>}
          {!p.mine && <button type="button" className="link-btn muted-link" onClick={() => { setReason('SPAM'); setDetails(''); setReport({ postId: p.id }); }}>{t('en.report')}</button>}
        </div>
      )}
      {moderator && (
        <div className="row-actions post-mod">
          {p.status === 'PENDING_APPROVAL' && <><button type="button" className="btn btn-sm btn-primary" onClick={() => void moderate('APPROVE')}><Icon name="check" /> {t('en.approve')}</button><button type="button" className="btn btn-sm" onClick={() => void moderate('REJECT')}>{t('en.reject')}</button></>}
          {p.status === 'PUBLISHED' && <><button type="button" className="btn btn-sm" onClick={() => void moderate(p.isPinned ? 'UNPIN' : 'PIN')}>{p.isPinned ? t('en.unpin') : t('en.pin')}</button><button type="button" className="btn btn-sm btn-ghost" onClick={() => void moderate('HIDE')}>{t('en.hidePost')}</button></>}
          {p.status === 'HIDDEN' && <button type="button" className="btn btn-sm" onClick={() => void moderate('SHOW')}>{t('en.showPost')}</button>}
        </div>
      )}
      {showComments && (
        <div className="post-comments">
          {!comments ? <p className="muted small">{t('en.loading')}</p> : (
            <ul className="comment-list">{top.map((c) => <Fragment key={c.id}>{commentRow(c)}{replies(c.id).length > 0 && <li className="replies"><ul className="comment-list">{replies(c.id).map(commentRow)}</ul></li>}</Fragment>)}</ul>
          )}
          {p.allowComments && (
            <form className="comment-form" onSubmit={send}>
              {replyTo && <p className="muted small">{t('en.replyingTo', { name: replyTo.author })} <button type="button" className="link-btn" onClick={() => setReplyTo(null)}>{t('common.cancel')}</button></p>}
              <label className="sr-only" htmlFor={`c-${p.id}`}>{t('en.writeComment')}</label>
              <input id={`c-${p.id}`} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder={t('en.writeComment')} />
              <button type="submit" className="btn btn-sm btn-primary" disabled={!text.trim()}>{t('en.send')}</button>
            </form>
          )}
        </div>
      )}
      <Modal open={!!report} onClose={() => setReport(null)} title={t('en.reportTitle')} subtitle={t('en.reportSub')} onSubmit={sendReport} submitLabel={t('en.report')}>
        <Field id={`rr-${p.id}`} label={t('en.reason')}><select id={`rr-${p.id}`} value={reason} onChange={(e) => setReason(e.target.value)}>{REPORT_REASONS.map((r) => <option key={r} value={r}>{t(`en.why.${r}` as MessageKey)}</option>)}</select></Field>
        <Field id={`rd-${p.id}`} label={t('en.details')}><input id={`rd-${p.id}`} value={details} maxLength={500} onChange={(e) => setDetails(e.target.value)} /></Field>
      </Modal>
    </article>
  );
}
