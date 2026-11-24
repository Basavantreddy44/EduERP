'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { formatINR, toPaise } from '@eduerp/shared';
import { useI18n } from '@/lib/i18n';
import { logoUrl } from '@/lib/session';
import { Icon } from '@/components/Icon';

interface View {
  status: 'ACTIVE' | 'PAID' | 'EXPIRED' | 'CANCELLED' | 'NOTHING_DUE';
  school: string; schoolLocal: string | null; campus: string;
  brand?: { slug: string; logoVersion: string | null } | null;
  student: { name: string; admissionNo: string };
  bills: { invoiceNo: string; description: string; dueDate: string; balance: string }[];
  amount: string; expiresAt: string; gateway: 'razorpay' | 'simulated' | 'off';
  receipt: { id: string; receiptNo: string; amount: string; paymentDate: string } | null;
}
interface Order { orderId: string; amountPaise: number; currency: string; keyId: string; gateway: string; description: string; prefill: { name: string; email: string; contact: string } }
type Confirm = { status: 'PAID'; receiptNo: string; amount: string } | { status: 'PENDING'; message: string };

declare global {
  interface Window { Razorpay?: new (o: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (r: { error?: { description?: string } }) => void) => void } }
}

/** Public JSON calls: no session, no sign-in redirects. */
async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1/public/pay/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((json as { detail?: string }).detail ?? 'Something went wrong'), { status: res.status, type: (json as { type?: string }).type });
  return json as T;
}
const inr = (v: string | number) => formatINR(typeof v === 'number' ? v : toPaise(v));
const loadCheckout = () =>
  new Promise<void>((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the payment window'));
    document.body.appendChild(s);
  });

/** The page a parent opens from a fee payment link. */
export default function PayPage() {
  const { token } = useParams<{ token: string }>();
  const { t, lang, setLang, locale } = useI18n();
  const [v, setV] = useState<View | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [testOrder, setTestOrder] = useState<Order | null>(null);
  const polls = useRef(0);

  const load = useCallback(() => call<View>(token).then(setV).catch(() => setMissing(true)), [token]);
  useEffect(() => { void load(); }, [load]);

  // While a payment is being confirmed, look again every 5 s for up to a minute.
  useEffect(() => {
    if (!pending) return;
    polls.current = 0;
    const h = setInterval(async () => {
      polls.current += 1;
      const nv = await call<View>(token).catch(() => null);
      if (nv) setV(nv);
      if (nv?.status === 'PAID' || polls.current >= 12) { clearInterval(h); if (nv?.status === 'PAID') setPending(null); }
    }, 5000);
    return () => clearInterval(h);
  }, [pending, token]);

  async function confirm(orderId: string, paymentId: string, signature: string) {
    const r = await call<Confirm>(`${token}/confirm`, { orderId, paymentId, signature });
    if (r.status === 'PAID') { setPending(null); await load(); }
    else setPending(r.message);
  }

  async function pay() {
    setBusy(true); setError(null); setPending(null);
    try {
      const o = await call<Order>(`${token}/order`, {});
      if (o.gateway === 'simulated') { setTestOrder(o); return; }
      await loadCheckout();
      const rz = new window.Razorpay!({
        key: o.keyId, amount: o.amountPaise, currency: o.currency, order_id: o.orderId, name: v?.school ?? 'School fees', description: o.description, prefill: o.prefill,
        theme: { color: '#13285a' },
        handler: (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          setPending(t('pay.confirming'));
          confirm(r.razorpay_order_id, r.razorpay_payment_id, r.razorpay_signature).catch((e: Error) => setError(e.message));
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rz.on('payment.failed', (r) => setError(r.error?.description ?? t('pay.failed')));
      rz.open();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function simulate(outcome: 'success' | 'failure') {
    if (!testOrder) return;
    setBusy(true); setError(null);
    try {
      const r = await call<{ orderId: string; paymentId: string; signature: string; error: string | null }>(`${token}/simulate`, { orderId: testOrder.orderId, outcome });
      setTestOrder(null);
      if (outcome === 'failure') setError(r.error ?? t('pay.failed'));
      await confirm(r.orderId, r.paymentId, r.signature);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const day = (d: string) => new Date(d).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

  return (
    <div className="pay-shell">
      <header className="pay-top">
        <span className="pay-brand"><span className="side-mark" aria-hidden><Icon name="cap" size={18} /></span> {t('pay.secure')}</span>
        <div className="pay-lang" role="group" aria-label={t('common.language')}>
          <button type="button" className={lang === 'en' ? 'on' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
          <button type="button" className={lang === 'kn' ? 'on' : ''} aria-pressed={lang === 'kn'} onClick={() => setLang('kn')} lang="kn">ಕನ್ನಡ</button>
        </div>
      </header>

      <main className="pay-card card">
        {missing ? (
          <div className="pay-state"><Icon name="alert" size={30} /><h1>{t('pay.notFound')}</h1><p className="muted">{t('pay.notFoundText')}</p></div>
        ) : !v ? (
          <div className="skeleton-wrap" aria-busy="true"><div className="skeleton" /><div className="skeleton" /></div>
        ) : (
          <>
            <div className="pay-school">
              {logoUrl(v.brand) && <img className="doc-logo pay-logo" src={logoUrl(v.brand)!} alt="" width={56} height={56} />}
              <h1>{v.school}</h1>
              {v.schoolLocal && <p lang="kn">{v.schoolLocal}</p>}
              <p className="muted small">{v.campus}</p>
            </div>
            <dl className="pay-who">
              <div><dt>{t('stu.col.student')}</dt><dd>{v.student.name}</dd></div>
              <div><dt>{t('stu.col.admNo')}</dt><dd className="mono">{v.student.admissionNo}</dd></div>
            </dl>

            {v.status === 'PAID' && v.receipt ? (
              <div className="pay-state ok">
                <span className="done-icon"><Icon name="check" size={28} strokeWidth={2.4} /></span>
                <h2>{t('pay.paidTitle')}</h2>
                <p className="pay-big">{inr(v.receipt.amount)}</p>
                <p>{t('pay.receiptNo')} <strong className="mono">{v.receipt.receiptNo}</strong> · {day(v.receipt.paymentDate)}</p>
                <p className="muted small">{t('pay.paidText')}</p>
                <button type="button" className="btn no-print" onClick={() => window.print()}><Icon name="receipt" size={16} /> {t('pay.print')}</button>
              </div>
            ) : v.status === 'EXPIRED' || v.status === 'CANCELLED' ? (
              <div className="pay-state"><Icon name="clock" size={28} /><h2>{t('pay.closed')}</h2><p className="muted">{t('pay.closedText')}</p></div>
            ) : v.status === 'NOTHING_DUE' ? (
              <div className="pay-state ok"><Icon name="check" size={28} /><h2>{t('pay.nothingDue')}</h2><p className="muted">{t('pay.nothingDueText')}</p></div>
            ) : (
              <>
                <ul className="pay-bills">
                  {v.bills.map((b) => (
                    <li key={b.invoiceNo}><span><strong>{b.description}</strong><span className="sub-line muted small">{b.invoiceNo} · {t('fee.acct.dueOn', { date: day(b.dueDate) })}</span></span><strong>{inr(b.balance)}</strong></li>
                  ))}
                </ul>
                <div className="pay-total"><span>{t('pay.toPay')}</span><strong>{inr(v.amount)}</strong></div>
                {error && <div className="alert" role="alert"><Icon name="alert" />{error}</div>}
                {pending && <p className="note-info" role="status"><Icon name="clock" size={15} /> {pending}</p>}
                {v.gateway === 'off' ? <p className="note-warn">{t('pay.off')}</p> : testOrder ? (
                  <div className="test-pay" role="group" aria-label={t('pay.testMode')}>
                    <p><Icon name="info" size={15} /> <strong>{t('pay.testMode')}</strong> — {t('pay.testText')}</p>
                    <div className="paid-actions">
                      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void simulate('success')}>{t('pay.testSuccess')}</button>
                      <button type="button" className="btn" disabled={busy} onClick={() => void simulate('failure')}>{t('pay.testFailure')}</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => void pay()}><Icon name="lock" size={16} /> {busy ? t('pay.opening') : t('pay.payNow', { v: inr(v.amount) })}</button>
                )}
                <p className="muted small pay-foot">{t('pay.methods')} · {t('pay.validTill', { date: day(v.expiresAt) })}</p>
              </>
            )}
          </>
        )}
      </main>
      <p className="pay-powered muted small">{t('pay.powered')}</p>
    </div>
  );
}
