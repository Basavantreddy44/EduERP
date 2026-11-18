'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useI18n } from '@/lib/i18n';

/** Certificates (Phase 10) shared pieces: the printed certificate with its QR code. */

export interface CertView {
  id: string; school: string; campus: string; student: string; admissionNo: string; certificateType: string; language: string;
  title: string; body: string | null; purpose: string; certificateNo: string | null; issueDate: string | null; verificationCode: string | null;
  status: string; cancelReason: string | null; cancelledAt: string | null;
}

/** The verification link printed under the QR code. */
export const verifyUrl = (code: string) => `${typeof window === 'undefined' ? '' : window.location.origin}/verify/${code}`;

/** A QR code (SVG) of the verification link — drawn in the browser, nothing is sent anywhere. */
export function VerifyQr({ code, size = 112 }: { code: string; size?: number }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => { QRCode.toString(verifyUrl(code), { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#0a1430', light: '#ffffff' } }).then(setSvg).catch(() => setSvg(null)); }, [code]);
  return <div className="cert-qr" style={{ width: size, height: size }} role="img" aria-label={`QR: ${verifyUrl(code)}`} dangerouslySetInnerHTML={svg ? { __html: svg } : undefined} />;
}

/** The certificate as printed on A4: school, title, text, number, date, QR, signature. */
export function CertificateSheet({ c }: { c: CertView }) {
  const { t } = useI18n();
  const lang = c.language;
  const date = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString(lang === 'kn' ? 'kn-IN' : 'en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—');
  return (
    <article className={`cert${c.status === 'CANCELLED' ? ' cancelled' : ''}`} lang={lang} aria-label={c.title}>
      {c.status === 'CANCELLED' && <p className="cert-void" role="status">{t('ct.status.CANCELLED')}{c.cancelReason ? ` — ${c.cancelReason}` : ''}</p>}
      <header className="cert-head">
        <div className="rc-crest" aria-hidden="true">{c.school.slice(0, 1)}</div>
        <div><h2 className="rc-school">{c.school}</h2><p className="rc-sub">{c.campus}</p></div>
      </header>
      <p className="cert-meta"><span>{t('ct.number')}: <strong>{c.certificateNo ?? '—'}</strong></span><span>{t('ct.date')}: <strong>{date(c.issueDate)}</strong></span></p>
      <h1 className="cert-title">{c.title}</h1>
      <div className="cert-body">{(c.body ?? '').split('\n\n').map((p, i) => <p key={i}>{p}</p>)}</div>
      <footer className="cert-foot">
        {c.verificationCode && (
          <div className="cert-verify">
            <VerifyQr code={c.verificationCode} />
            <p className="small">{t('ct.verifyAt')}<br /><strong className="code">{c.verificationCode}</strong></p>
          </div>
        )}
        <div className="cert-sign"><span>{t('ex.card.principal')}</span><span className="muted small">{t('ct.seal')}</span></div>
      </footer>
    </article>
  );
}
