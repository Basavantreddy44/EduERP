'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { T, useI18n } from '@/lib/i18n';

interface Item {
  id: string;
  eventCode: string;
  title: string;
  message: string;
  entityType: string | null;
  readAt: string | null;
  createdAt: string;
}

const timeAgo = (iso: string, t: T, locale: string) => {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return t('time.justNow');
  if (s < 3600) return t('time.minutes', { n: Math.round(s / 60) });
  if (s < 86400) return t('time.hours', { n: Math.round(s / 3600) });
  return new Date(iso).toLocaleDateString(locale);
};

/** Topbar inbox: unread badge, latest 10, mark read. Polls every 60 s and when the tab regains focus. */
export function NotificationBell({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api<{ items: Item[]; unreadCount: number }>('/notifications?limit=10')
      .then((r) => {
        setItems(r.items);
        setUnread(r.unreadCount);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    window.addEventListener('focus', load);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', load);
    };
  }, [load, tenantId]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  async function openItem(n: Item) {
    if (!n.readAt) {
      await api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => undefined);
      load();
    }
    setOpen(false);
    if (n.entityType === 'APPROVAL_REQUEST') router.push('/approvals');
  }

  async function readAll() {
    await api('/notifications/read-all', { method: 'POST' }).catch(() => undefined);
    load();
  }

  return (
    <div className="bell" ref={box}>
      <button className="bell-btn" aria-label={unread ? t('bell.unread', { n: unread }) : t('bell.title')} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label={t('bell.title')}>
          <div className="bell-head">
            <strong>{t('bell.title')}</strong>
            {unread > 0 && <button className="btn-link btn" onClick={readAll}>{t('bell.markAll')}</button>}
          </div>
          {items.length === 0 ? (
            <div className="empty">{t('bell.empty')}</div>
          ) : (
            <ul className="bell-list">
              {items.map((n) => (
                <li key={n.id}>
                  <button className={`bell-item ${n.readAt ? '' : 'unread'}`} onClick={() => openItem(n)}>
                    <span className="bell-title">{n.title}</span>
                    {n.message && <span className="bell-msg">{n.message}</span>}
                    <span className="bell-time">{timeAgo(n.createdAt, t, locale)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
