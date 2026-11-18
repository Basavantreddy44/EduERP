'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';

type Result = { valid: false } | { valid: true; status: string; student: string; title: string; certificateType: string; certificateNo: string | null; issueDate: string | null; school: string; campus: string; cancelledAt: string | null };

/** Public check of a certificate (the QR code opens this page). No sign-in; only the certificate's face is shown. */
export default function VerifyPage() {
  const { code } = useParams<{ code: string }>();
  const { t, locale, lang, setLang } = useI18n();
  const [r, setR] = useState<Result | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch(`/api/v1/public/verify/${encodeURIComponent(code)}`).then((x) => (x.ok ? x.json() : Promise.reject(new Error(String(x.status))))).then(setR).catch(() => setFailed(true));
  }, [code]);
  const d = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—');
  const ok = r?.valid && r.status === 'ISSUED';
  return (
    <div className="pay-shell">
      <header className="pay-top">
        <span className="pay-brand"><Icon name="cap" /> EduERP</span>
        <span className="pay-lang" role="group" aria-label={t('verify.language')}>
          <button type="button" className={lang === 'en' ? 'on' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
          <button type="button" className={lang === 'kn' ? 'on' : ''} aria-pressed={lang === 'kn'} onClick={() => setLang('kn')} lang="kn">ಕನ್ನಡ</button>
        </span>
      </header>
      <main className="card pay-card verify-card">
        <h1 className="verify-h">{t('verify.title')}</h1>
        <p className="muted small">{t('verify.code')}: <strong className="code">{code}</strong></p>
        {failed ? <p className="notice" role="alert"><Icon name="alert" /> {t('verify.error')}</p>
          : !r ? <p className="muted">{t('verify.checking')}</p>
          : !r.valid ? (
            <div className="verify-result bad" role="status"><Icon name="x" /><div><strong>{t('verify.notFound')}</strong><p>{t('verify.notFoundHint')}</p></div></div>
          ) : (
            <>
              <div className={`verify-result ${ok ? 'good' : 'bad'}`} role="status">
                <Icon name={ok ? 'check' : 'alert'} />
                <div><strong>{ok ? t('verify.genuine') : t('verify.cancelled')}</strong><p>{ok ? t('verify.genuineHint') : t('verify.cancelledHint', { date: d(r.cancelledAt) })}</p></div>
              </div>
              <dl className="verify-facts">
                <div><dt>{t('verify.certificate')}</dt><dd>{r.title}</dd></div>
                <div><dt>{t('verify.student')}</dt><dd>{r.student}</dd></div>
                <div><dt>{t('verify.number')}</dt><dd className="code">{r.certificateNo}</dd></div>
                <div><dt>{t('verify.date')}</dt><dd>{d(r.issueDate)}</dd></div>
                <div><dt>{t('verify.issuedBy')}</dt><dd>{r.school} · {r.campus}</dd></div>
              </dl>
              <p className="muted small">{t('verify.compare')}</p>
            </>
          )}
      </main>
    </div>
  );
}
