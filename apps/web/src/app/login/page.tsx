'use client';

import { FormEvent, KeyboardEvent, ReactNode, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { loginSchema } from '@eduerp/shared';
import { api, ApiError, SessionPayload } from '@/lib/api';
import { useSession } from '@/lib/session';
import { homeFor } from '@/lib/routes';
import { useHydrated } from '@/lib/hydrated';
import { LanguageSwitch, useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import s from './login.module.css';


const Svg = ({ children, size = 20, className }: { children: ReactNode; size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
    {children}
  </svg>
);

const CAP = <><path d="M22 10 12 5 2 10l10 5 10-5z" /><path d="M6 12v5c0 1.1 2.7 3 6 3s6-1.9 6-3v-5" /></>;

const FEATURES = [
  { k: 'login.f1', i: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /><path d="M8 14h3M8 17h6" /></> },
  { k: 'login.f2', i: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></> },
  { k: 'login.f3', i: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /><path d="M6 15h4" /></> },
  { k: 'login.f4', i: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="m9 15 2 2 4-4" /></> },
  { k: 'login.f5', i: <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="M8 9h8M8 13h5" /></> },
  { k: 'login.f6', i: <><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z" /></> },
];

export default function LoginPage() {
  const router = useRouter();
  const { applySession } = useSession();
  const { t } = useI18n();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  // Enabled only after hydration: a click before JavaScript is ready must never fall back to a native submit.
  const ready = useHydrated();

  function fail(message: string) {
    setError(message);
    setShake((k) => k + 1);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = loginSchema.safeParse({ identifier, password });
    if (!parsed.success) {
      fail(t('login.missing'));
      return;
    }
    setBusy(true);
    try {
      const session = await api<SessionPayload>('/auth/login', { method: 'POST', body: JSON.stringify(parsed.data) });
      await applySession(session);
      router.replace(homeFor(session));
    } catch (err) {
      // Known server answers get translated; anything else shows the server's own message.
      const known: Record<string, MessageKey> = { 'invalid-credentials': 'login.invalid', 'account-locked': 'login.locked', unreachable: 'login.unreachable', offline: 'login.unreachable', 'server-busy': 'login.unreachable' };
      fail(err instanceof ApiError ? (known[err.type] ? t(known[err.type]) : err.message) : t('login.unreachable'));
    } finally {
      setBusy(false);
    }
  }

  const trackCaps = (e: KeyboardEvent<HTMLInputElement>) => setCapsOn(e.getModifierState('CapsLock'));

  return (
    <div className={s.page}>
      {/* ---------- Brand & features ---------- */}
      <section className={s.brandside} aria-label="EduERP">
        <span className={`${s.glow} ${s.glowA}`} aria-hidden />
        <span className={`${s.glow} ${s.glowB}`} aria-hidden />
        <span className={s.grain} aria-hidden />

        <div className={s.logo}>
          <span className={s.mark}><Svg size={22}>{CAP}</Svg></span>
          <span className={s.wordmark}>Edu<em>ERP</em></span>
        </div>

        <div className={s.intro}>
          <p className={s.eyebrow}><span />{t('login.eyebrow')}</p>
          <h2 className={s.headline}>
            {t('login.headlineA')} <em>{t('login.headlineB')}</em>
          </h2>
          <p className={s.lead}>{t('login.lead')}</p>
        </div>

        <ul className={s.features}>
          {FEATURES.map((f, i) => (
            <li key={f.k} style={{ animationDelay: `${0.25 + i * 0.08}s` }}>
              <span className={s.fIcon}><Svg size={20}>{f.i}</Svg></span>
              <span>
                <strong>{t(`${f.k}.t` as MessageKey)}</strong>
                <small>{t(`${f.k}.d` as MessageKey)}</small>
              </span>
            </li>
          ))}
        </ul>

        <div className={s.brandFoot}>
          <span><Svg size={14}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></Svg>{t('shell.privacy')}</span>
        </div>
      </section>

      {/* ---------- Sign in ---------- */}
      <section className={s.formside}>
        <form key={shake} method="post" className={`${s.card} ${shake ? s.shake : ''}`} onSubmit={submit} noValidate>
          <div className={s.cardTop}>
            <span className={s.cardMark}><Svg size={22}>{CAP}</Svg></span>
            <LanguageSwitch />
          </div>
          <h1 className={s.title}>{t('login.welcome')}</h1>
          <p className={s.sub}>{t('login.sub')}</p>

          {error && (
            <div className={`alert ${s.error}`} role="alert">
              <Svg size={18}><circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" /></Svg>
              <span>{error}</span>
            </div>
          )}

          <div className={s.field}>
            <Svg size={18} className={s.fieldIcon}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></Svg>
            <input
              id="identifier"
              className={s.input}
              autoComplete="username"
              placeholder=" "
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              aria-invalid={!!error}
            />
            <label className={s.label} htmlFor="identifier">{t('login.identifier')}</label>
          </div>

          <div className={s.field}>
            <Svg size={18} className={s.fieldIcon}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></Svg>
            <input
              id="password"
              className={s.input}
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder=" "
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={trackCaps}
              onKeyUp={trackCaps}
              onBlur={() => setCapsOn(false)}
              aria-invalid={!!error}
            />
            <label className={s.label} htmlFor="password">{t('login.password')}</label>
            <button
              type="button"
              className={s.eye}
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? t('login.hide') : t('login.show')}
              aria-pressed={showPassword}
            >
              {showPassword ? (
                <Svg size={18}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><path d="M1 1l22 22" /></Svg>
              ) : (
                <Svg size={18}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></Svg>
              )}
            </button>
          </div>
          {capsOn && <p className={s.caps} role="status">{t('login.caps')}</p>}
          <div className={s.forgotRow}>
            <Link href="/forgot-password" className={s.forgot}>{t('login.forgot')}</Link>
          </div>

          <button className={s.submit} type="submit" disabled={busy || !ready}>
            <span className={s.sheen} aria-hidden />
            {busy ? (
              <><span className={s.spinner} aria-hidden /> {t('login.submitting')}</>
            ) : (
              <>{t('login.submit')} <Svg size={18} className={s.arrow}><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></Svg></>
            )}
          </button>

          <div className={s.divider}><span>{t('login.needHelp')}</span></div>
          <p className={s.help}>{t('login.help')}</p>
        </form>

        <p className={s.legal}>
          <Svg size={13}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></Svg>
          {t('login.secure')}
        </p>
      </section>
    </div>
  );
}
