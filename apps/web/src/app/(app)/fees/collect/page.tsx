'use client';

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { MODES_WITH_REFERENCE, PAYMENT_MODES, PaymentMode, allocate, collectSchema, formatINR } from '@eduerp/shared';
import { api, newIdempotencyKey } from '@/lib/api';
import { apiErrors, FieldErrors, validate } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { todayIST, useDay } from '@/components/admissions';
import { amountOk, paiseOf } from '@/components/fees';
import { initials, studentName } from '@/components/students';

interface Session { id: string; campusId: string; openedAt: string; openingCash: string; expectedCash: string; byMode: Record<string, { amount: string; count: number }>; cancelledCount: number }
interface Receipt { id: string; receiptNo: string; amount: string; paymentMode: string; status: string; createdAt: string; payerName: string; student: { id: string; firstName: string; lastName: string | null; admissionNo: string } }
interface Counter { session: Session | null; receipts?: Receipt[]; campuses: { id: string; code: string; name: string }[] }
interface Hit { id: string; admissionNo: string; firstName: string; lastName: string | null; levelName: string | null; sectionName: string | null; guardianName: string | null; guardianPhone: string | null; status: string }
interface Bill { id: string; invoiceNo: string; description: string; dueDate: string; status: string; netAmount: string; balanceAmount: string; yearLabel?: string; isEarlier?: boolean; isOpening?: boolean }
interface Account { student: { id: string; firstName: string; lastName: string | null; admissionNo: string }; invoices: Bill[]; totals: { balance: string; overdue: string; earlier?: string }; credit?: { available: string } }

const inr = (p: number) => formatINR(p, { paise: p % 100 !== 0 });

function CollectInner() {
  const { t } = useI18n();
  const toast = useToast();
  const day = useDay();
  const params = useSearchParams();
  const [counter, setCounter] = useState<Counter | null>(null);
  const [opening, setOpening] = useState({ campusId: '', cash: '0' });
  const [closing, setClosing] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [picked, setPicked] = useState<Hit | null>(null);
  const [acc, setAcc] = useState<Account | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [form, setForm] = useState({ amount: '', mode: 'CASH' as PaymentMode, payerName: '', referenceNo: '', bankName: '', chequeDate: todayIST(), notes: '' });
  const [key, setKey] = useState(newIdempotencyKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [keepCredit, setKeepCredit] = useState(false);
  const [done, setDone] = useState<{ id: string; receiptNo: string; amount: string } | null>(null);

  const loadCounter = useCallback(() => {
    api<Counter>('/fees/counter').then((c) => { setCounter(c); setOpening((o) => ({ ...o, campusId: o.campusId || c.campuses[0]?.id || '' })); }).catch(() => setCounter({ session: null, campuses: [] }));
  }, []);
  useEffect(loadCounter, [loadCounter]);

  // Search as you type (name, admission no. or parent mobile).
  useEffect(() => {
    if (q.trim().length < 2) return setHits(null);
    const h = setTimeout(() => api<{ items: Hit[] }>(`/students?q=${encodeURIComponent(q.trim())}&pageSize=8`).then((r) => setHits(r.items)).catch(() => setHits([])), 250);
    return () => clearTimeout(h);
  }, [q]);

  const pick = useCallback(async (h: Hit) => {
    setPicked(h); setHits(null); setQ(''); setDone(null); setError(null); setErrors({});
    const a = await api<Account>(`/fees/students/${h.id}`);
    setAcc(a);
    const open = a.invoices.filter((i) => ['UNPAID', 'PARTIAL'].includes(i.status) && paiseOf(i.balanceAmount) > 0).sort((x, y) => x.dueDate.localeCompare(y.dueDate));
    setSelected(open.map((i) => i.id));
    const due = open.reduce((s, i) => s + paiseOf(i.balanceAmount), 0);
    setForm((f) => ({ ...f, amount: due ? String(due / 100) : '', payerName: h.guardianName ?? '', referenceNo: '', bankName: '', notes: '' }));
    setKey(newIdempotencyKey());
  }, []);

  // Opened from a student's Fees tab: /fees/collect?student=<id>
  useEffect(() => {
    const id = params.get('student');
    if (!id || picked) return;
    api<Account>(`/fees/students/${id}`)
      .then((a) => void pick({ ...a.student, levelName: null, sectionName: null, guardianName: null, guardianPhone: null, status: 'ACTIVE' }))
      .catch(() => undefined);
  }, [params, picked, pick]);

  const openBills = useMemo(() => (acc?.invoices ?? []).filter((i) => ['UNPAID', 'PARTIAL'].includes(i.status) && paiseOf(i.balanceAmount) > 0).sort((x, y) => x.dueDate.localeCompare(y.dueDate)), [acc]);
  const chosen = openBills.filter((b) => selected.includes(b.id));
  const duePaise = chosen.reduce((s, b) => s + paiseOf(b.balanceAmount), 0);
  const amountPaise = amountOk(form.amount) ? paiseOf(form.amount.replace(/,/g, '')) : 0;
  const preview = allocate(amountPaise, chosen.map((b) => ({ id: b.id, duePaise: paiseOf(b.balanceAmount) }))).allocations;
  const cashBlocked = form.mode === 'CASH' && !counter?.session;

  async function collect(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!acc) return;
    if (!amountOk(form.amount) || !amountPaise) return setErrors({ amount: t('fee.amountInvalid') });
    if (amountPaise > duePaise && !keepCredit) return setErrors({ amount: t('fee.col.moreThanDue', { v: inr(duePaise) }) });
    const body = {
      studentId: acc.student.id, amount: form.amount.replace(/,/g, '').trim(), mode: form.mode, payerName: form.payerName.trim(), invoiceIds: chosen.map((b) => b.id), keepCredit: amountPaise > duePaise && keepCredit,
      referenceNo: MODES_WITH_REFERENCE.includes(form.mode) ? form.referenceNo.trim() || null : null,
      bankName: ['CHEQUE', 'DD'].includes(form.mode) ? form.bankName.trim() || null : null,
      chequeDate: ['CHEQUE', 'DD'].includes(form.mode) ? form.chequeDate || null : null,
      notes: form.notes.trim() || null,
    };
    const r = validate(collectSchema, body);
    if (!r.ok) return setErrors(r.errors);
    setBusy(true);
    try {
      const p = await api<{ id: string; receiptNo: string; amount: string }>('/fees/payments', { method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': key } });
      setDone(p);
      toast(t('fee.col.collected', { no: p.receiptNo, v: inr(paiseOf(p.amount)) }));
      setKey(newIdempotencyKey());
      setAcc(await api<Account>(`/fees/students/${acc.student.id}`));
      loadCounter();
    } catch (err) {
      const x = apiErrors(err); setErrors(x.fields); setError(x.message);
    } finally { setBusy(false); }
  }

  async function openCounter(e: FormEvent) {
    e.preventDefault();
    if (!amountOk(opening.cash)) return setError(t('fee.amountInvalid'));
    setBusy(true); setError(null);
    try { await api('/fees/counter/open', { method: 'POST', body: JSON.stringify({ campusId: opening.campusId, openingCash: opening.cash.replace(/,/g, '') || '0' }) }); toast(t('fee.col.opened')); loadCounter(); }
    catch (err) { setError(apiErrors(err).message); } finally { setBusy(false); }
  }

  if (!counter) return <SkeletonRows rows={6} />;
  const s = counter.session;

  return (
    <>
      <PageHeader eyebrow={t('nav.fees')} title={t('fee.col.title')} description={t('fee.col.desc')} />

      <section className={`card counter-bar ${s ? 'open' : ''}`}>
        {s ? (
          <>
            <span className="counter-dot" aria-hidden />
            <div className="counter-main">
              <strong>{t('fee.col.counterOpen', { time: new Date(s.openedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) })}</strong>
              <span className="muted small">{t('fee.col.drawer', { v: inr(paiseOf(s.expectedCash)) })}{Object.entries(s.byMode).map(([m, v]) => ` · ${t(`fee.mode.${m}` as MessageKey)} ${inr(paiseOf(v.amount))} (${v.count})`).join('')}</span>
            </div>
            <button type="button" className="btn" onClick={() => { setError(null); setClosing(true); }}><Icon name="lock" size={16} /> {t('fee.col.close')}</button>
          </>
        ) : (
          <form className="counter-open-form" onSubmit={openCounter}>
            <div className="counter-main">
              <strong>{t('fee.col.counterClosed')}</strong>
              <span className="muted small">{t('fee.col.counterClosedHint')}</span>
            </div>
            {counter.campuses.length > 1 && (
              <label className="filter"><span>{t('common.campus')}</span>
                <select value={opening.campusId} onChange={(e) => setOpening({ ...opening, campusId: e.target.value })}>{counter.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              </label>
            )}
            <label className="filter"><span>{t('fee.col.openingCash')}</span>
              <div className="input-affix"><span aria-hidden>₹</span><input className="input" inputMode="decimal" value={opening.cash} onChange={(e) => setOpening({ ...opening, cash: e.target.value })} /></div>
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy}><Icon name="check" size={16} /> {t('fee.col.open')}</button>
          </form>
        )}
      </section>

      <div className="collect-grid">
        <section className="card">
          <h2 className="card-title">{t('fee.col.student')}</h2>
          <label className="search-box">
            <Icon name="search" size={18} />
            <span className="sr-only">{t('common.search')}</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('stu.search')} autoComplete="off" />
          </label>
          {hits && (
            <ul className="hit-list" aria-label={t('fee.col.results')}>
              {hits.length === 0 && <li className="muted small">{t('common.noMatches')}</li>}
              {hits.map((h) => (
                <li key={h.id}>
                  <button type="button" className="hit" onClick={() => void pick(h)}>
                    <span className="avatar avatar-sm" aria-hidden>{initials(h)}</span>
                    <span><strong>{studentName(h)}</strong><span className="sub-line muted">{h.admissionNo}{h.levelName ? ` · ${h.levelName} – ${h.sectionName}` : ''}{h.guardianName ? ` · ${h.guardianName}` : ''}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {picked && !acc && <SkeletonRows rows={3} />}
          {acc && (
            <>
              <div className="picked">
                <span className="avatar" aria-hidden>{initials(acc.student)}</span>
                <span><strong>{studentName(acc.student)}</strong><span className="sub-line muted mono">{acc.student.admissionNo}</span></span>
                <Link className="btn btn-sm btn-ghost" href={`/students/${acc.student.id}`}>{t('stu.openStudent')}</Link>
              </div>
              <h3 className="module-group-name">{t('fee.col.openBills')} · {openBills.length}</h3>
              {openBills.length === 0 ? <p className="note-info"><Icon name="check" size={15} /> {t('fee.col.nothingDue')}</p> : (
                <ul className="bill-picks">
                  {openBills.map((b) => {
                    const on = selected.includes(b.id);
                    const late = b.dueDate.slice(0, 10) < todayIST();
                    const a = preview.find((x) => x.id === b.id)?.amountPaise ?? 0;
                    return (
                      <li key={b.id} className={on ? 'on' : ''}>
                        <label>
                          <input type="checkbox" checked={on} onChange={() => setSelected((sel) => (sel.includes(b.id) ? sel.filter((x) => x !== b.id) : [...sel, b.id]))} />
                          <span className="bill-pick-main">
                            <strong>{b.description}</strong>
                            <span className={`sub-line ${late ? 'overdue-text' : 'muted'}`}>{b.isEarlier && <span className="chip chip-sm chip-gold year-chip">{b.isOpening ? t('cr.openingDueOf', { y: b.yearLabel ?? '' }) : b.yearLabel}</span>}{b.invoiceNo} · {t('fee.acct.dueOn', { date: day(b.dueDate) })}{late ? ` · ${t('fee.acct.overdueShort')}` : ''}</span>
                          </span>
                          <span className="bill-pick-amt">
                            <strong>{inr(paiseOf(b.balanceAmount))}</strong>
                            {on && a > 0 && <span className="sub-line small applies">{a >= paiseOf(b.balanceAmount) ? t('fee.col.fullyPaid') : t('fee.col.partPaid', { v: inr(a) })}</span>}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
          {!picked && !hits && <EmptyState icon="search" title={t('fee.col.pickTitle')} text={t('fee.col.pickText')} />}
        </section>

        <section className="card pay-card">
          <h2 className="card-title">{t('fee.col.payment')}</h2>
          {done ? (
            <div className="paid-panel">
              <span className="done-icon"><Icon name="check" size={26} strokeWidth={2.4} /></span>
              <strong className="paid-amount">{inr(paiseOf(done.amount))}</strong>
              <span className="mono">{done.receiptNo}</span>
              <div className="paid-actions">
                <a className="btn btn-primary" href={`/fees/receipts/${done.id}`} target="_blank" rel="noreferrer"><Icon name="receipt" size={16} /> {t('fee.col.print')}</a>
                <button type="button" className="btn" onClick={() => { setDone(null); setPicked(null); setAcc(null); setKeepCredit(false); }}>{t('fee.col.next')}</button>
              </div>
              {acc && paiseOf(acc.totals.balance) > 0 && <p className="muted small">{t('fee.col.stillDue', { v: inr(paiseOf(acc.totals.balance)) })}</p>}
            </div>
          ) : !acc || openBills.length === 0 ? (
            <p className="muted">{t('fee.col.payHint')}</p>
          ) : (
            <form onSubmit={collect} noValidate>
              {error && <div className="alert" role="alert"><Icon name="alert" />{error}</div>}
              <Field id="p-amount" label={t('fee.col.amount')} error={errors.amount} hint={t('fee.col.dueSelected', { v: inr(duePaise) })}>
                <div className="input-affix big"><span aria-hidden>₹</span><input id="p-amount" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
              </Field>
              {amountPaise !== duePaise && duePaise > 0 && <button type="button" className="btn btn-sm btn-ghost full-due" onClick={() => setForm({ ...form, amount: String(duePaise / 100) })}>{t('fee.col.payFull', { v: inr(duePaise) })}</button>}
              {amountPaise > duePaise && duePaise > 0 && (
                <label className="check keep-credit"><input type="checkbox" checked={keepCredit} onChange={(e) => setKeepCredit(e.target.checked)} /> {t('cr.keepExtra', { v: inr(amountPaise - duePaise) })}</label>
              )}
              {acc.credit && paiseOf(acc.credit.available) > 0 && <p className="note-info"><Icon name="info" size={15} /> {t('cr.counterHas', { v: inr(paiseOf(acc.credit.available)) })}</p>}
              <div className="field">
                <span className="label">{t('fee.col.mode')}</span>
                <div className="segmented" role="radiogroup" aria-label={t('fee.col.mode')}>
                  {PAYMENT_MODES.map((m) => <button key={m} type="button" role="radio" aria-checked={form.mode === m} className={form.mode === m ? 'on' : ''} onClick={() => setForm({ ...form, mode: m })}>{t(`fee.mode.${m}` as MessageKey)}</button>)}
                </div>
              </div>
              {cashBlocked && <p className="note-warn"><Icon name="lock" size={15} /> {t('fee.col.openFirst')}</p>}
              {MODES_WITH_REFERENCE.includes(form.mode) && (
                <div className="grid-2">
                  <Field id="p-ref" label={t(`fee.col.ref.${['CHEQUE', 'DD'].includes(form.mode) ? 'cheque' : 'txn'}` as MessageKey)} error={errors.referenceNo}><input id="p-ref" className="mono" value={form.referenceNo} onChange={(e) => setForm({ ...form, referenceNo: e.target.value })} /></Field>
                  {['CHEQUE', 'DD'].includes(form.mode) && <Field id="p-date" label={t('fee.col.chequeDate')} error={errors.chequeDate}><input id="p-date" type="date" value={form.chequeDate} onChange={(e) => setForm({ ...form, chequeDate: e.target.value })} /></Field>}
                </div>
              )}
              {['CHEQUE', 'DD'].includes(form.mode) && <Field id="p-bank" label={t('fee.col.bank')} error={errors.bankName}><input id="p-bank" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} placeholder={t('fee.col.bankPh')} /></Field>}
              <Field id="p-payer" label={t('fee.col.payer')} error={errors.payerName}><input id="p-payer" value={form.payerName} onChange={(e) => setForm({ ...form, payerName: e.target.value })} /></Field>
              <Field id="p-notes" label={t('fee.col.notes')} error={errors.notes}><input id="p-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
              <button type="submit" className="btn btn-primary btn-block" disabled={busy || cashBlocked || !chosen.length || !amountPaise}>
                <Icon name="receipt" size={16} /> {busy ? t('common.saving') : t('fee.col.collect', { v: amountPaise ? inr(amountPaise) : '' })}
              </button>
            </form>
          )}
        </section>
      </div>

      {s && (counter.receipts ?? []).length > 0 && (
        <>
          <h2 className="section-title">{t('fee.col.today')}</h2>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">{t('fee.col.today')}</caption>
              <thead><tr><th scope="col">{t('fee.col.receipt')}</th><th scope="col">{t('fee.col.student')}</th><th scope="col">{t('fee.col.mode')}</th><th scope="col" className="num">{t('fee.col.amount')}</th><th scope="col">{t('common.status')}</th><th scope="col"><span className="sr-only">{t('fee.col.print')}</span></th></tr></thead>
              <tbody>
                {(counter.receipts ?? []).map((r) => (
                  <tr key={r.id} className={r.status !== 'SUCCESS' ? 'row-muted' : undefined}>
                    <td><span className="mono">{r.receiptNo}</span><span className="sub-line muted small">{new Date(r.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span></td>
                    <td>{studentName(r.student)}<span className="sub-line muted mono">{r.student.admissionNo}</span></td>
                    <td>{t(`fee.mode.${r.paymentMode}` as MessageKey)}</td>
                    <td className="num strong">{inr(paiseOf(r.amount))}</td>
                    <td><StatusBadge status={r.status === 'SUCCESS' ? 'PAID' : r.status} label={r.status === 'SUCCESS' ? t('fee.col.received') : undefined} /></td>
                    <td className="num"><a className="btn btn-sm btn-ghost" href={`/fees/receipts/${r.id}`} target="_blank" rel="noreferrer" aria-label={`${t('fee.col.print')} ${r.receiptNo}`}><Icon name="receipt" size={15} /></a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {closing && s && <CloseDialog s={s} onClose={() => setClosing(false)} onDone={() => { setClosing(false); loadCounter(); }} />}
    </>
  );
}

function CloseDialog({ s, onClose, onDone }: { s: Session; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [counted, setCounted] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expected = paiseOf(s.expectedCash);
  const diff = amountOk(counted) && counted ? paiseOf(counted.replace(/,/g, '')) - expected : null;
  return (
    <Modal open onClose={onClose} title={t('fee.col.closeTitle')} subtitle={t('fee.col.closeSub')} submitLabel={t('fee.col.close')} busy={busy} error={error}
      onSubmit={async (e) => {
        e.preventDefault();
        if (diff === null) return setError(t('fee.amountInvalid'));
        if (diff !== 0 && remarks.trim().length < 3) return setError(t('fee.col.explainDiff'));
        setBusy(true);
        try { await api(`/fees/counter/${s.id}/close`, { method: 'POST', body: JSON.stringify({ countedCash: counted.replace(/,/g, ''), remarks: remarks.trim() || null }) }); toast(t('fee.col.closed')); onDone(); }
        catch (err) { setError(apiErrors(err).message); } finally { setBusy(false); }
      }}>
      <dl className="kv">
        <div><dt>{t('fee.col.openingCash')}</dt><dd>{inr(paiseOf(s.openingCash))}</dd></div>
        {Object.entries(s.byMode).map(([m, v]) => <div key={m}><dt>{t(`fee.mode.${m}` as MessageKey)}</dt><dd>{inr(paiseOf(v.amount))} <span className="muted small">({v.count})</span></dd></div>)}
        <div><dt>{t('fee.col.expected')}</dt><dd className="strong">{inr(expected)}</dd></div>
      </dl>
      <Field id="c-counted" label={t('fee.col.counted')}>
        <div className="input-affix big"><span aria-hidden>₹</span><input id="c-counted" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} /></div>
      </Field>
      {diff !== null && (
        <p className={diff === 0 ? 'note-info' : 'note-warn'}><Icon name={diff === 0 ? 'check' : 'alert'} size={15} /> {diff === 0 ? t('fee.col.matches') : diff > 0 ? t('fee.col.over', { v: inr(diff) }) : t('fee.col.short', { v: inr(-diff) })}</p>
      )}
      <Field id="c-remarks" label={diff ? t('fee.col.remarksNeeded') : t('fee.col.remarks')}><input id="c-remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
    </Modal>
  );
}

export default function CollectPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={6} />}>
      <CollectInner />
    </Suspense>
  );
}

