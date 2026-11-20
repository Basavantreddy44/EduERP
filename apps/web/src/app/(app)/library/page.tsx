'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PERMISSIONS } from '@eduerp/shared';
import { ApiError, api } from '@/lib/api';
import { apiErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { rupees } from '@/components/accounts';
import { PeoplePicker, Person } from '@/components/campuslife';

interface Loan { id: string; title: string; accessionNo: string; memberType: string; memberId: string; member: string; issueDate: string; dueDate: string; daysLate: number; renewCount: number }
interface MemberView { member: { name: string; code: string }; limit: number; out: number; overdue: number; loans: { id: string; title: string; accessionNo: string; dueDate: string; daysLate: number; fineSoFar: string; canRenew: boolean }[]; reservations: { id: string; title: string; status: string; expiresOn: string | null }[] }

/** Library → Desk (M16.2): issue and return by accession number or barcode scan, books out, overdue. */
export default function LibraryDeskPage() {
  const { can } = useSession();
  const { t, locale } = useI18n();
  const toast = useToast();
  const waive = can(PERMISSIONS.LIB_WAIVE);
  const [who, setWho] = useState<Person | null>(null);
  const [mv, setMv] = useState<MemberView | null>(null);
  const [code, setCode] = useState('');
  const [ret, setRet] = useState('');
  const [damaged, setDamaged] = useState(false);
  const [loans, setLoans] = useState<Loan[] | null>(null);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [fineAsk, setFineAsk] = useState<string | null>(null);
  const [lost, setLost] = useState<Loan | null>(null);
  const issueRef = useRef<HTMLInputElement>(null);
  const load = useCallback(() => { api<Loan[]>(`/library/loans?overdue=${overdueOnly}${q ? `&q=${encodeURIComponent(q)}` : ''}`).then(setLoans).catch(() => setLoans([])); }, [overdueOnly, q]);
  useEffect(load, [load]);
  const loadMember = useCallback((p: Person | null) => { setMv(null); if (p) api<MemberView>(`/library/members/${p.type}/${p.id}`).then(setMv).catch(() => setMv(null)); }, []);
  useEffect(() => { loadMember(who); if (who) window.setTimeout(() => issueRef.current?.focus(), 50); }, [who, loadMember]);
  const d = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const errText = (x: unknown) => { const a = apiErrors(x); return a.message ?? Object.values(a.fields)[0] ?? t('en.failed'); };
  const doIssue = async (e: FormEvent) => {
    e.preventDefault();
    if (!who || !code.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ title: string; accessionNo: string; dueDate: string }>('/library/issue', { method: 'POST', body: JSON.stringify({ code, memberType: who.type, memberId: who.id }) });
      setMsg({ tone: 'ok', text: t('lib.issued', { title: r.title, no: r.accessionNo, d: d(r.dueDate) }) }); setCode(''); loadMember(who); load();
    } catch (x) { setMsg({ tone: 'warn', text: errText(x) }); } finally { setBusy(false); issueRef.current?.focus(); }
  };
  const doReturn = async (e?: FormEvent, waiveFine = false) => {
    e?.preventDefault();
    if (!ret.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ title: string; daysLate: number; fine: string; fineStatus: string; heldFor: string | null }>('/library/return', { method: 'POST', body: JSON.stringify({ code: ret, condition: damaged ? 'DAMAGED' : 'GOOD', waive: waiveFine }) });
      const parts = [t('lib.returned', { title: r.title })];
      if (r.daysLate) parts.push(t('lib.lateBy', { n: r.daysLate }));
      if (r.fineStatus === 'CHARGED') parts.push(t('lib.fineBilled', { amt: rupees(r.fine) }));
      if (r.fineStatus === 'WAIVED') parts.push(t('lib.fineWaived', { amt: rupees(r.fine) }));
      if (r.heldFor) parts.push(t('lib.heldFor', { name: r.heldFor }));
      setMsg({ tone: 'ok', text: parts.join(' · ') }); setRet(''); setDamaged(false); setFineAsk(null); load(); if (who) loadMember(who);
    } catch (x) {
      const a = apiErrors(x);
      if (x instanceof ApiError && x.type === 'no-fine-head' && waive) setFineAsk(a.message ?? '');
      else setMsg({ tone: 'warn', text: errText(x) });
    } finally { setBusy(false); }
  };
  const act = async (path: string, body: unknown, done: string) => {
    setBusy(true);
    try { await api(path, { method: 'POST', body: JSON.stringify(body) }); toast(done); load(); if (who) loadMember(who); return true; }
    catch (x) { toast(apiErrors(x).message ?? t('en.failed'), 'bad'); return false; } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader eyebrow={t('nav.library')} title={t('lib.desk.title')} description={t('lib.desk.desc')} actions={<Link href="/library/catalogue" className="btn"><Icon name="book" /> {t('nav.libCatalogue')}</Link>} />
      {msg && <div className={`notice ${msg.tone === 'warn' ? 'notice-warn' : ''}`} role="status"><Icon name={msg.tone === 'warn' ? 'alert' : 'check'} size={16} /> <span>{msg.text}</span></div>}
      {fineAsk && <div className="notice notice-warn" role="alert"><Icon name="alert" size={16} /> <span>{fineAsk} <button type="button" className="btn btn-sm" onClick={() => void doReturn(undefined, true)}>{t('lib.waiveAndReturn')}</button></span></div>}
      <div className="lib-desk">
        <section className="card p12-block" aria-labelledby="lib-issue">
          <h2 id="lib-issue" className="section-title"><Icon name="arrowRight" size={18} /> {t('lib.issue')}</h2>
          <Field id="lib-who" label={t('lib.borrower')}><PeoplePicker endpoint="/library/members" value={who} onPick={setWho} inputId="lib-who" placeholder={t('lib.findBorrower')} /></Field>
          {mv && <p className="muted small">{t('lib.memberLine', { out: mv.out, limit: mv.limit })}{mv.overdue ? ` · ${t('lib.memberOverdue', { n: mv.overdue })}` : ''}</p>}
          {mv?.loans.length ? <ul className="lib-mini">{mv.loans.map((l) => <li key={l.id}><span>{l.title} <span className="muted small mono">{l.accessionNo}</span></span><span className={l.daysLate ? 'text-bad small' : 'muted small'}>{l.daysLate ? t('lib.daysLate', { n: l.daysLate }) : t('lib.due', { d: d(l.dueDate) })}</span></li>)}</ul> : null}
          {mv?.reservations.filter((r) => r.status === 'READY').map((r) => <p key={r.id} className="notice"><Icon name="star" size={16} /> {t('lib.readyForThem', { title: r.title })}</p>)}
          <form onSubmit={doIssue} className="lib-scan">
            <label htmlFor="lib-code" className="sr-only">{t('lib.scanLabel')}</label>
            <input id="lib-code" ref={issueRef} className="input mono" placeholder={t('lib.scanLabel')} value={code} disabled={!who} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
            <button type="submit" className="btn btn-primary" disabled={!who || !code.trim() || busy}>{t('lib.issueBtn')}</button>
          </form>
        </section>
        <section className="card p12-block" aria-labelledby="lib-return">
          <h2 id="lib-return" className="section-title"><Icon name="swap" size={18} /> {t('lib.return')}</h2>
          <p className="muted small">{t('lib.returnHint')}</p>
          <form onSubmit={(e) => void doReturn(e)} className="lib-scan">
            <label htmlFor="lib-ret" className="sr-only">{t('lib.scanLabel')}</label>
            <input id="lib-ret" className="input mono" placeholder={t('lib.scanLabel')} value={ret} onChange={(e) => setRet(e.target.value)} autoComplete="off" />
            <button type="submit" className="btn btn-primary" disabled={!ret.trim() || busy}>{t('lib.returnBtn')}</button>
          </form>
          <label className="check"><input type="checkbox" checked={damaged} onChange={(e) => setDamaged(e.target.checked)} /> {t('lib.damaged')}</label>
        </section>
      </div>

      <div className="section-head lib-out-head">
        <h2 className="section-title">{t('lib.out')}</h2>
        <div className="filter-bar">
          <label className="sr-only" htmlFor="lib-q">{t('lib.searchOut')}</label>
          <input id="lib-q" type="search" placeholder={t('lib.searchOut')} value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="check"><input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> {t('lib.overdueOnly')}</label>
        </div>
      </div>
      {!loans ? <SkeletonRows rows={4} /> : !loans.length ? <EmptyState icon="book" title={overdueOnly ? t('lib.noOverdue') : t('lib.noneOut')} /> : (
        <div className="table-wrap card" role="region" aria-label={t('lib.out')} tabIndex={0}>
          <table className="table">
            <thead><tr><th scope="col">{t('lib.book')}</th><th scope="col">{t('lib.borrower')}</th><th scope="col">{t('lib.issuedOn')}</th><th scope="col">{t('lib.dueOn')}</th><th scope="col"><span className="sr-only">{t('lib.actions')}</span></th></tr></thead>
            <tbody>{loans.map((l) => (
              <tr key={l.id}>
                <td><strong>{l.title}</strong><span className="sub-line muted small mono">{l.accessionNo}</span></td>
                <td>{l.member}<span className="sub-line muted small">{l.memberType === 'EMPLOYEE' ? t('cl.staff') : t('cl.student')}</span></td>
                <td>{d(l.issueDate)}</td>
                <td>{d(l.dueDate)}{l.daysLate > 0 && <span className="sub-line"><span className="pill pill-bad">{t('lib.daysLate', { n: l.daysLate })}</span></span>}</td>
                <td className="row-actions">
                  <button type="button" className="btn btn-sm" disabled={busy || l.daysLate > 0} onClick={() => void act(`/library/loans/${l.id}/renew`, {}, t('lib.renewed'))} aria-label={t('lib.renewNamed', { title: l.title })}>{t('lib.renew')}</button>
                  <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setLost(l)} aria-label={t('lib.lostNamed', { title: l.title })}>{t('lib.lost')}</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Modal open={!!lost} onClose={() => setLost(null)} title={t('lib.lostTitle', { title: lost?.title ?? '' })} subtitle={lost?.memberType === 'STUDENT' ? t('lib.lostSubStudent') : t('lib.lostSubStaff')} onSubmit={(e: FormEvent) => { e.preventDefault(); if (lost) void act(`/library/loans/${lost.id}/lost`, { remarks: null }, t('lib.lostDone')).then((ok) => ok && setLost(null)); }} submitLabel={t('lib.lostConfirm')} busy={busy} danger>
        <p className="muted small">{t('lib.lostNote')}</p>
      </Modal>
    </>
  );
}
