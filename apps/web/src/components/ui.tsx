'use client';

import { createContext, ReactNode, useCallback, useContext, useState } from 'react';
import Link from 'next/link';
import { Icon, IconName } from './Icon';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';

/** Page title block: small gold eyebrow, serif title, one-line description, actions on the right. */
export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-desc">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon = 'sparkle', title, text, action }: { icon?: IconName; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon name={icon} size={26} /></span>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

const TONES: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'muted'> = {
  ACTIVE: 'ok', APPROVED: 'ok', SENT: 'ok', CURRENT: 'ok', PAID: 'ok',
  TRIAL: 'info', PLANNING: 'info', PENDING: 'warn', GRACE: 'warn', INVITED: 'warn',
  SUSPENDED: 'bad', REJECTED: 'bad', FAILED: 'bad', CLOSED: 'muted', INACTIVE: 'muted', CANCELLED: 'muted', REMOVED: 'muted',
  // admissions
  NEW: 'info', FOLLOW_UP: 'warn', INTERESTED: 'info', CONVERTED: 'ok', LOST: 'muted',
  SUBMITTED: 'info', UNDER_REVIEW: 'info', WAITLISTED: 'warn', ENROLLED: 'ok',
  // students & fees
  DROPPED: 'bad', TRANSFERRED: 'muted', PASSED_OUT: 'muted', MOVED: 'muted', LEFT: 'muted', PROMOTED: 'ok', DETAINED: 'warn', COMPLETED: 'muted', ISSUED: 'ok', ON_LEAVE: 'warn', RESIGNED: 'muted', TERMINATED: 'bad',
  DRAFT: 'info', UNPAID: 'warn', PARTIAL: 'info', WAIVED: 'ok', EXPIRED: 'muted', BOUNCED: 'bad', OVERDUE: 'bad',
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const { t } = useI18n();
  const tone = TONES[status] ?? 'muted';
  const key = `status.${status}` as MessageKey;
  const text = label ?? (t(key) !== key ? t(key) : status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' '));
  return <span className={`pill pill-${tone}`}><span className="pill-dot" />{text}</span>;
}

export function StatTile({ icon, label, value, hint, href }: { icon: IconName; label: string; value: ReactNode; hint?: string; href?: string }) {
  const body = (
    <>
      <span className="stat-icon"><Icon name={icon} size={20} /></span>
      <span className="stat-text">
        <span className="stat-label">{label}</span>
        <span className="stat-value">{value}</span>
        {hint && <span className="stat-hint">{hint}</span>}
      </span>
      {href && <Icon name="chevronRight" className="stat-go" />}
    </>
  );
  return href ? <Link href={href} className="stat">{body}</Link> : <div className="stat">{body}</div>;
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  const { t } = useI18n();
  return (
    <div className="skeleton-wrap" aria-busy="true" aria-label={t('common.loading')} role="status">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ width: `${92 - i * 9}%` }} />)}
    </div>
  );
}

// ───────────── Toasts ─────────────

type Toast = { id: number; text: string; tone: 'ok' | 'bad' };
const ToastCtx = createContext<(text: string, tone?: 'ok' | 'bad') => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: 'ok' | 'bad' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <Icon name={t.tone === 'ok' ? 'check' : 'alert'} size={16} />
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
