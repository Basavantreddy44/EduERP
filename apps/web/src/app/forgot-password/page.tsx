'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { forgotPasswordSchema } from '@eduerp/shared';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { useHydrated } from '@/lib/hydrated';
import { LanguageSwitch, useI18n } from '@/lib/i18n';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const ready = useHydrated();
  const { t } = useI18n();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = forgotPasswordSchema.safeParse({ email });
    if (!v.success) return setError(t('forgot.invalid'));
    setError(null);
    setBusy(true);
    try {
      await api('/auth/forgot-password', { method: 'POST', body: JSON.stringify(v.data) });
      setSent(true);
    } catch {
      setError(t('login.unreachable'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="center-page">
      <div className="card auth-card">
        <div className="auth-top"><span className="auth-mark"><Icon name={sent ? 'mail' : 'lock'} size={22} /></span><LanguageSwitch /></div>
        {sent ? (
          <>
            <h1 className="auth-title">{t('forgot.sentTitle')}</h1>
            <p className="muted lead-text">
              {t('forgot.sentLead', { email })}
            </p>
            <div className="notice"><Icon name="info" />{t('forgot.spam')}</div>
            <Link href="/login" className="btn btn-primary btn-block"><Icon name="arrowRight" /> {t('forgot.back')}</Link>
          </>
        ) : (
          <form method="post" onSubmit={submit} noValidate>
            <h1 className="auth-title">{t('forgot.title')}</h1>
            <p className="muted lead-text">{t('forgot.lead')}</p>
            {error && <div className="alert" role="alert"><Icon name="alert" />{error}</div>}
            <div className="field">
              <label htmlFor="email">{t('forgot.email')}</label>
              <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </div>
            <button className="btn btn-primary btn-block" type="submit" disabled={busy || !ready}>{busy ? t('forgot.sending') : t('forgot.send')}</button>
            <p className="auth-foot"><Link href="/login">{t('forgot.back')}</Link></p>
          </form>
        )}
      </div>
    </main>
  );
}
