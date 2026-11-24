'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { logoUrl, useSession } from '@/lib/session';
import { Icon } from '@/components/Icon';
import { StatusBadge } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

export default function SelectInstitution() {
  const { loading, session, switchTenant, logout } = useSession();
  const router = useRouter();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !session) router.replace('/login');
  }, [loading, session, router]);
  if (!session) return null;

  async function choose(tenantId: string) {
    setBusy(tenantId);
    setError(null);
    try {
      await switchTenant(tenantId);
      router.replace('/dashboard');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not open this institution');
      setBusy(null);
    }
  }

  return (
    <main className="center-page">
      <div className="card auth-card">
        <span className="auth-mark"><Icon name="cap" size={22} /></span>
        <h1 className="auth-title">{t('picker.title')}</h1>
        <p className="muted lead-text">{t('picker.lead', { name: session.user.fullName.split(' ')[0] })}</p>
        {error && <div className="alert" role="alert"><Icon name="alert" />{error}</div>}
        {session.memberships.length === 0 && <div className="notice"><Icon name="info" />{t('picker.none')}</div>}
        {session.memberships.map((m) => (
          <button key={m.tenantId} className="choice" disabled={!!busy} onClick={() => choose(m.tenantId)}>
            {logoUrl({ slug: m.slug, logoVersion: m.logoVersion ?? null }) ? <img className="choice-logo" src={logoUrl({ slug: m.slug, logoVersion: m.logoVersion ?? null })!} alt="" width={36} height={36} /> : <span className="choice-icon"><Icon name="building" size={20} /></span>}
            <span className="choice-text">
              <strong>{m.name}</strong>
              <span>{busy === m.tenantId ? t('picker.opening') : m.slug}</span>
            </span>
            {m.status !== 'ACTIVE' ? <StatusBadge status={m.status} /> : <Icon name="chevronRight" className="muted" />}
          </button>
        ))}
        <div className="auth-foot split">
          {session.user.platformRole ? <Link href="/platform/tenants">{t('shell.platformConsole')}</Link> : <span />}
          <button className="btn-link" onClick={logout}>{t('shell.signOut')}</button>
        </div>
      </div>
    </main>
  );
}
