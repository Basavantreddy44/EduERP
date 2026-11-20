'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { PageHeader, SkeletonRows, StatTile, useToast } from '@/components/ui';

interface Check { open: { id: string; startedOn: string; scanned: number; expected: number; out: number; missingCount: number; missing: { id: string; accessionNo: string; title: string; rackLocation: string | null }[] } | null; lastClosed: { startedOn: string; closedAt: string } | null }
interface Settings { studentLoanDays: number; staffLoanDays: number; studentMaxBooks: number; staffMaxBooks: number; maxRenewals: number; finePerDay: string; graceDays: number; holdDays: number; nextAccession: number }

/** Library → Manage (M16.1, M16.2): stock verification and library rules. */
export default function LibraryManagePage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [tab, setTab] = useState<'stock' | 'settings'>('stock');
  const [campuses, setCampuses] = useState<{ id: string; name: string }[]>([]);
  const [campusId, setCampusId] = useState('');
  const [ck, setCk] = useState<Check | null>(null);
  const [code, setCode] = useState('');
  const [last, setLast] = useState<{ text: string; warn: boolean } | null>(null);
  const [closing, setClosing] = useState(false);
  const [markLost, setMarkLost] = useState(false);
  const [s, setS] = useState<Settings | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  useEffect(() => { api<{ id: string; name: string }[]>('/campuses').then((c) => { setCampuses(c); setCampusId((x) => x || c[0]?.id || ''); }).catch(() => setCampuses([])); api<Settings>('/library/settings').then(setS).catch(() => setS(null)); }, []);
  const load = useCallback(() => { if (campusId) api<Check>(`/library/stock-check?campusId=${campusId}`).then(setCk).catch(() => setCk(null)); }, [campusId]);
  useEffect(load, [load]);
  const start = async () => {
    setBusy(true);
    try { setCk(await api<Check>('/library/stock-check', { method: 'POST', body: JSON.stringify({ campusId }) })); toast(t('lib.st.started')); window.setTimeout(() => scanRef.current?.focus(), 50); }
    catch (x) { toast(apiErrors(x).message ?? t('en.failed'), 'bad'); } finally { setBusy(false); }
  };
  const scan = async (e: FormEvent) => {
    e.preventDefault();
    if (!ck?.open || !code.trim()) return;
    setBusy(true);
    try {
      const r = await api<{ accessionNo: string; title: string; already: boolean; note: string | null } & NonNullable<Check['open']>>(`/library/stock-check/${ck.open.id}/scan`, { method: 'POST', body: JSON.stringify({ code }) });
      setCk((c) => (c ? { ...c, open: { id: r.id, startedOn: r.startedOn, scanned: r.scanned, expected: r.expected, out: r.out, missingCount: r.missingCount, missing: r.missing } } : c));
      setLast({ text: `${r.accessionNo} · ${r.title}${r.already ? ` — ${t('lib.st.already')}` : ''}${r.note ? ` — ${r.note}` : ''}`, warn: !!r.note || r.already });
      setCode('');
    } catch (x) { setLast({ text: apiErrors(x).message ?? t('en.failed'), warn: true }); } finally { setBusy(false); scanRef.current?.focus(); }
  };
  const close = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!ck?.open) return;
    setBusy(true); setError(null);
    try { const r = await api<{ scanned: number; missing: number; markedLost: number }>(`/library/stock-check/${ck.open.id}/close`, { method: 'POST', body: JSON.stringify({ markLost }) }); toast(t('lib.st.closedToast', { s: r.scanned, m: r.missing, l: r.markedLost })); setClosing(false); setLast(null); load(); }
    catch (x) { setError(apiErrors(x).message); } finally { setBusy(false); }
  };
  const saveSettings = async (e: FormEvent) => {
    e.preventDefault();
    if (!s) return;
    setBusy(true); setErrors({});
    try { setS(await api<Settings>('/library/settings', { method: 'PUT', body: JSON.stringify(s) })); toast(t('lib.saved')); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); if (a.message) toast(a.message, 'bad'); } finally { setBusy(false); }
  };
  const d = (x: string) => new Date(x.length === 10 ? `${x}T00:00:00Z` : x).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: x.length === 10 ? 'UTC' : 'Asia/Kolkata' });
  const num = (k: keyof Settings, label: string, hint?: string) => (
    <Field id={`ls-${k}`} label={label} hint={hint} error={errors[k]}><input id={`ls-${k}`} inputMode="decimal" value={String(s?.[k] ?? '')} onChange={(e) => setS((x) => (x ? { ...x, [k]: e.target.value } as Settings : x))} /></Field>
  );
  return (
    <>
      <PageHeader eyebrow={t('nav.library')} title={t('lib.mg.title')} description={t('lib.mg.desc')} />
      <div className="tabs" role="tablist" aria-label={t('lib.mg.title')}>
        <button role="tab" aria-selected={tab === 'stock'} className={tab === 'stock' ? 'on' : ''} onClick={() => setTab('stock')}>{t('lib.mg.stock')}</button>
        <button role="tab" aria-selected={tab === 'settings'} className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>{t('lib.mg.settings')}</button>
      </div>
      {tab === 'stock' && (
        <>
          {campuses.length > 1 && <div className="filter-bar"><label htmlFor="st-campus" className="sr-only">{t('lib.campus')}</label><select id="st-campus" value={campusId} onChange={(e) => setCampusId(e.target.value)}>{campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
          {!ck ? <SkeletonRows rows={3} /> : !ck.open ? (
            <section className="card p12-block">
              <h2 className="section-title">{t('lib.st.title')}</h2>
              <p className="muted">{t('lib.st.how')}</p>
              {ck.lastClosed && <p className="muted small">{t('lib.st.last', { d: d(ck.lastClosed.closedAt) })}</p>}
              <button type="button" className="btn btn-primary" disabled={busy || !campusId} onClick={() => void start()}><Icon name="clipboard" /> {t('lib.st.start')}</button>
            </section>
          ) : (
            <>
              <div className="stats pay-stats">
                <StatTile icon="check" label={t('lib.st.scanned')} value={`${ck.open.scanned} / ${ck.open.expected}`} />
                <StatTile icon="alert" label={t('lib.st.notFound')} value={ck.open.missingCount} />
                <StatTile icon="book" label={t('lib.st.out')} value={ck.open.out} />
              </div>
              <section className="card p12-block" aria-labelledby="st-scan">
                <h2 id="st-scan" className="section-title">{t('lib.st.scanTitle', { d: d(ck.open.startedOn) })}</h2>
                <form onSubmit={scan} className="lib-scan">
                  <label htmlFor="st-code" className="sr-only">{t('lib.scanLabel')}</label>
                  <input id="st-code" ref={scanRef} className="input mono" placeholder={t('lib.scanLabel')} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
                  <button type="submit" className="btn btn-primary" disabled={busy || !code.trim()}>{t('lib.st.found')}</button>
                </form>
                {last && <p className={`notice ${last.warn ? 'notice-warn' : ''}`} role="status"><Icon name={last.warn ? 'alert' : 'check'} size={16} /> {last.text}</p>}
                <button type="button" className="btn" onClick={() => { setMarkLost(false); setError(null); setClosing(true); }}>{t('lib.st.finish')}</button>
              </section>
              {ck.open.missing.length > 0 && (
                <section className="card p12-block" aria-labelledby="st-miss">
                  <h2 id="st-miss" className="section-title">{t('lib.st.missingTitle', { n: ck.open.missingCount })}</h2>
                  <ul className="p12-action-list">{ck.open.missing.map((m) => <li key={m.id}><span><span className="mono">{m.accessionNo}</span> · {m.title}</span><span className="muted small">{m.rackLocation ?? ''}</span></li>)}</ul>
                </section>
              )}
            </>
          )}
        </>
      )}
      {tab === 'settings' && (!s ? <SkeletonRows rows={4} /> : (
        <form className="card p12-block" onSubmit={saveSettings}>
          <h2 className="section-title">{t('lib.set.title')}</h2>
          <div className="grid-3">{num('studentLoanDays', t('lib.set.studentDays'))}{num('studentMaxBooks', t('lib.set.studentMax'))}{num('maxRenewals', t('lib.set.renewals'))}</div>
          <div className="grid-3">{num('staffLoanDays', t('lib.set.staffDays'))}{num('staffMaxBooks', t('lib.set.staffMax'))}{num('holdDays', t('lib.set.holdDays'), t('lib.set.holdHint'))}</div>
          <div className="grid-3">{num('finePerDay', t('lib.set.fine'), t('lib.set.fineHint'))}{num('graceDays', t('lib.set.grace'), t('lib.set.graceHint'))}<Field id="ls-next" label={t('lib.set.next')} hint={t('lib.set.nextHint')}><input id="ls-next" value={s.nextAccession} disabled /></Field></div>
          <button type="submit" className="btn btn-primary" disabled={busy}>{t('lib.cat.save')}</button>
        </form>
      ))}
      <Modal open={closing} onClose={() => setClosing(false)} title={t('lib.st.finishTitle')} subtitle={t('lib.st.finishSub', { n: ck?.open?.missingCount ?? 0 })} onSubmit={close} submitLabel={t('lib.st.finish')} busy={busy} error={error}>
        <label className="check"><input type="checkbox" checked={markLost} onChange={(e) => setMarkLost(e.target.checked)} /> {t('lib.st.markLost')}</label>
      </Modal>
    </>
  );
}
