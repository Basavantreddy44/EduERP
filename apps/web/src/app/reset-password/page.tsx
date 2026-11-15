'use client';

import { FormEvent, Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PASSWORD_RULE, resetPasswordSchema } from '@eduerp/shared';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { LanguageSwitch, useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';

type LinkInfo = { purpose: 'INVITE' | 'RESET'; email: string | null; name: string };

const rules: { label: MessageKey; test: (p: string) => boolean }[] = [
  { label: 'reset.rule1', test: (p: string) => p.length >= 10 },
  { label: 'reset.rule2', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'reset.rule3', test: (p: string) => /[a-z]/.test(p) },
  { label: 'reset.rule4', test: (p: string) => /\d/.test(p) },
];

function ResetForm() {
  const params = useSearchParams();
  const { t } = useI18n();
  // Read the token once: we strip it from the address bar, which would otherwise re-render with no token.
  const [token] = useState(() => params.get('token') ?? '');
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return setInvalid(true);
    // Remove the token from the address bar and history as soon as it has been read.
    window.history.replaceState(null, '', '/reset-password');
    api<LinkInfo>('/auth/reset-password/check', { method: 'POST', body: JSON.stringify({ token }) })
      .then(setInfo)
      .catch(() => setInvalid(true));
  }, [token]);

  const passed = useMemo(() => rules.map((r) => r.test(password)), [password]);
  const isInvite = info?.purpose === 'INVITE';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError(t('reset.mismatch'));
    const v = resetPasswordSchema.safeParse({ token, password });
    if (!v.success) return setError(PASSWORD_RULE);
    setError(null);
    setBusy(true);
    try {
      await api('/auth/reset-password', { method: 'POST', body: JSON.stringify(v.data) });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.type === 'link-invalid') setInvalid(true);
      else setError(err instanceof ApiError ? err.message : t('login.unreachable'));
    } finally {
      setBusy(false);
    }
  }

  if (invalid) {
    return (
      <>
        <span className="auth-mark"><Icon name="clock" size={22} /></span>
        <h1 className="auth-title">{t('reset.expiredTitle')}</h1>
        <p className="muted lead-text">{t('reset.expiredLead')}</p>
        <Link href="/forgot-password" className="btn btn-primary btn-block">{t('reset.newLink')}</Link>
        <p className="auth-foot"><Link href="/login">{t('forgot.back')}</Link></p>
      </>
    );
  }
  if (done) {
    return (
      <>
        <span className="auth-mark"><Icon name="check" size={22} /></span>
        <h1 className="auth-title">{isInvite ? t('reset.doneInvite') : t('reset.doneReset')}</h1>
        <p className="muted lead-text">{isInvite ? t('reset.doneInviteLead') : t('reset.doneResetLead')}</p>
        <Link href="/login" className="btn btn-primary btn-block"><Icon name="arrowRight" /> {t('login.submit')}</Link>
      </>
    );
  }
  if (!info) return <div className="skeleton-wrap" aria-busy="true"><div className="skeleton" /><div className="skeleton" style={{ width: '70%' }} /></div>;

  return (
    <form method="post" onSubmit={submit} noValidate>
      <div className="auth-top"><span className="auth-mark"><Icon name={isInvite ? 'sparkle' : 'lock'} size={22} /></span><LanguageSwitch /></div>
      <h1 className="auth-title">{isInvite ? t('reset.welcome', { name: info.name.split(' ')[0] }) : t('reset.resetTitle')}</h1>
      <p className="muted lead-text">{isInvite ? t('reset.inviteLead') : t('reset.for')} {info.email && <strong>{info.email}</strong>}</p>
      {error && <div className="alert" role="alert"><Icon name="alert" />{error}</div>}
      <div className="field">
        <label htmlFor="pw">{t('reset.new')}</label>
        <div className="pw-wrap">
          <input id="pw" type={show ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          <button type="button" className="btn btn-ghost icon-btn" aria-label={show ? t('login.hide') : t('login.show')} onClick={() => setShow((s) => !s)}><Icon name={show ? 'eyeOff' : 'eye'} size={16} /></button>
        </div>
      </div>
      <ul className="pw-rules">
        {rules.map((r, i) => (
          <li key={r.label} className={passed[i] ? 'ok' : ''}><Icon name={passed[i] ? 'check' : 'x'} size={14} strokeWidth={2.4} />{t(r.label)}</li>
        ))}
      </ul>
      <div className="field">
        <label htmlFor="pw2">{t('reset.again')}</label>
        <input id="pw2" type={show ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={!!confirm && confirm !== password} />
        {confirm && confirm !== password && <span className="err">{t('reset.noMatch')}</span>}
      </div>
      <button className="btn btn-primary btn-block" type="submit" disabled={busy || !passed.every(Boolean) || password !== confirm}>
        {busy ? t('common.saving') : isInvite ? t('reset.setPassword') : t('reset.change')}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="center-page">
      <div className="card auth-card">
        <Suspense fallback={null}>
          <ResetForm />
        </Suspense>
      </div>
    </main>
  );
}
