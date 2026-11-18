'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import { SkeletonRows } from '@/components/ui';
import { Post, PostCard } from '@/components/engagement';

/** The parent app's school news: posts meant for any of the family's children. */
export function SchoolNews() {
  const { hasModule } = useSession();
  const { t } = useI18n();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [more, setMore] = useState(false);
  const load = useCallback((before?: string) => {
    api<Post[]>(`/portal/feed${before ? `?before=${encodeURIComponent(before)}` : ''}`).then((r) => { setPosts((p) => (before ? [...(p ?? []), ...r] : r)); setMore(r.length >= 30); }).catch(() => setPosts((p) => p ?? []));
  }, []);
  useEffect(() => { if (hasModule('NEWS_FEED')) load(); }, [hasModule, load]);
  if (!hasModule('NEWS_FEED')) return null;
  return (
    <section className="portal-news" aria-labelledby="news-h">
      <h2 id="news-h" className="section-title">{t('pt.news.title')}</h2>
      {!posts ? <SkeletonRows rows={2} /> : !posts.length ? <p className="muted">{t('pt.news.none')}</p> : (
        <>
          {posts.map((p) => <PostCard key={p.id} p={p} base="/portal/feed" />)}
          {more && <button type="button" className="btn" onClick={() => load(posts[posts.length - 1].createdAt)}>{t('pt.news.more')}</button>}
        </>
      )}
    </section>
  );
}
