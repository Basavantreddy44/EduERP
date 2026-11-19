'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { DATE_FORMATS, formatINR, toPaise } from '@eduerp/shared';
import { api, uploadFile } from '@/lib/api';
import { apiErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { AccountSelect, rupees, todayIST, useBanks, useChart } from '@/components/accounts';

interface Suggestion { journalLineId: string; entryNo: string; date: string; narration: string; refMatch: boolean }
interface SLine { id: string; txnDate: string; description: string; referenceNo: string | null; debit: string; credit: string; balance: string | null; suggestions: Suggestion[] }
interface BLine { id: string; entryNo: string; date: string; narration: string; debit: string; credit: string }
interface Bench { bank: { id: string; name: string; accountId: string }; matchedCount: number; statementLines: SLine[]; bookLines: BLine[] }
interface Preview { headers: string[]; sample: string[][]; rowCount: number; suggested: Record<string, string | null> }
interface Stmt { bank: string; asOn: string; bookBalance: string; depositsNotCredited: { total: string; items: { entryNo: string; date: string; narration: string; amount: string }[] }; paymentsNotPresented: { total: string; items: { entryNo: string; date: string; narration: string; amount: string }[] }; bankOnly: { moneyIn: string; moneyOut: string; items: { date: string; description: string; debit: string; credit: string }[] }; expectedBankBalance: string; statementBalance: { amount: string; on: string } | null; difference: string | null }
type Tab = 'match' | 'import' | 'statement';
const MAP_KEYS = ['dateColumn', 'descriptionColumn', 'referenceColumn', 'debitColumn', 'creditColumn', 'balanceColumn'] as const;
const OPTIONAL = new Set(['referenceColumn', 'balanceColumn']);

/** Accounts → Bank reconciliation (M13.4): import statements, match to the books, explain the difference. */
export default function BankReconPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const banks = useBanks();
  const chart = useChart();
  const [bankId, setBankId] = useState('');
  const [tab, setTab] = useState<Tab>('match');
  const [bench, setBench] = useState<Bench | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ lines: number; added: number; skipped: number; problems: string[] } | null>(null);
  const [asOn, setAsOn] = useState(todayIST());
  const [stmt, setStmt] = useState<Stmt | null>(null);
  const [manual, setManual] = useState<SLine | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [postLine, setPostLine] = useState<SLine | null>(null);
  const [post, setPost] = useState({ accountId: '', narration: '' });
  const [ignore, setIgnore] = useState<SLine | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (banks && !bankId) setBankId(banks.find((b) => b.isActive)?.id ?? ''); }, [banks, bankId]);
  const load = useCallback(() => { if (bankId) { setBench(null); api<Bench>(`/accounts/bank/${bankId}/workbench`).then(setBench).catch(() => setBench(null)); } }, [bankId]);
  useEffect(load, [load]);
  useEffect(() => { if (tab === 'statement' && bankId) { setStmt(null); api<Stmt>(`/accounts/bank/${bankId}/statement?asOn=${asOn}`).then(setStmt).catch(() => setStmt(null)); } }, [tab, bankId, asOn, bench]);
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true); setError(null);
    try { await fn(); toast(done); load(); return true; } catch (x) { const m = apiErrors(x).message ?? t('en.failed'); setError(m); toast(m); return false; } finally { setBusy(false); }
  };
  const pickFile = async (f: File | null) => {
    setFile(f); setPreview(null); setResult(null);
    if (!f) return;
    try { const p = await uploadFile<Preview>('/accounts/bank/statements/preview', f); setPreview(p); setMapping(Object.fromEntries(Object.entries(p.suggested).map(([k, v]) => [k, v ?? '']))); }
    catch (x) { toast(apiErrors(x).message ?? t('en.failed')); }
  };
  const doImport = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await uploadFile<{ lines: number; added: number; skipped: number; problems: string[] }>('/accounts/bank/statements', file, { mapping: JSON.stringify({ bankAccountId: bankId, ...Object.fromEntries(Object.entries(mapping).map(([k, v]) => [k, v || null])) }) });
      setResult(r); toast(t('ac2.bank.imported', { n: r.added })); load();
    } catch (x) { toast(apiErrors(x).message ?? t('en.failed')); } finally { setBusy(false); }
  };
  const d = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const amt = (l: { debit: string; credit: string }) => (Number(l.credit) > 0 ? l.credit : l.debit);
  const pickedSum = (bench?.bookLines ?? []).filter((b) => picked.includes(b.id)).reduce((s, b) => s + (manual && Number(manual.credit) > 0 ? toPaise(b.debit) - toPaise(b.credit) : toPaise(b.credit) - toPaise(b.debit)), 0);
  if (banks && !banks.length) return <><PageHeader eyebrow={t('nav.accounts')} title={t('ac2.bank.title')} description={t('ac2.bank.desc')} /><EmptyState icon="building" title={t('ac2.bank.noBanks')} action={<Link href="/accounts/setup" className="btn">{t('ac2.setup.title')}</Link>} /></>;
  return (
    <>
      <PageHeader eyebrow={t('nav.accounts')} title={t('ac2.bank.title')} description={t('ac2.bank.desc')} />
      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label={t('ac2.bank.title')}>
          {(['match', 'import', 'statement'] as Tab[]).map((x) => <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(`ac2.bank.tab.${x}` as MessageKey)}</button>)}
        </div>
        <label className="p12-inline">{t('ac2.bank.account')} <select value={bankId} onChange={(e) => setBankId(e.target.value)}>{banks?.map((b) => <option key={b.id} value={b.id}>{b.ledger}</option>)}</select></label>
      </div>
      {tab === 'match' && (!bench ? <SkeletonRows rows={5} /> : (
        <>
          <div className="panel-head">
            <p className="muted">{t('ac2.bank.counts', { open: bench.statementLines.length, done: bench.matchedCount, book: bench.bookLines.length })}</p>
            <button type="button" className="btn btn-primary" disabled={busy || !bench.statementLines.length} onClick={() => void act(async () => { const r = await api<{ matched: number }>(`/accounts/bank/${bankId}/auto-match`, { method: 'POST', body: '{}' }); toast(t('ac2.bank.autoDone', { n: r.matched })); }, t('ac2.bank.autoChecked'))}><Icon name="sparkle" /> {t('ac2.bank.auto')}</button>
          </div>
          {!bench.statementLines.length ? <EmptyState icon="check" title={t('ac2.bank.allMatched')} text={t('ac2.bank.allMatchedHint')} /> : (
            <ul className="acc-recon">
              {bench.statementLines.map((l) => (
                <li key={l.id} className="card">
                  <div className="acc-recon-line">
                    <span><strong>{l.description}</strong><span className="sub-line muted small">{d(l.txnDate)}{l.referenceNo ? ` · ${l.referenceNo}` : ''}</span></span>
                    <span className={`acc-amt ${Number(l.credit) > 0 ? 'in' : 'out'}`}>{Number(l.credit) > 0 ? '+' : '−'} {rupees(amt(l), { paise: true })}</span>
                  </div>
                  {l.suggestions.length > 0 && (
                    <ul className="acc-suggest" aria-label={t('ac2.bank.suggestions')}>
                      {l.suggestions.slice(0, 3).map((s) => (
                        <li key={s.journalLineId}><span>{s.refMatch && <span className="pill pill-ok">{t('ac2.bank.refMatch')}</span>} <span className="code">{s.entryNo}</span> {d(s.date)} · {s.narration}</span>
                          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void act(() => api('/accounts/bank/match', { method: 'POST', body: JSON.stringify({ statementLineId: l.id, journalLineIds: [s.journalLineId] }) }), t('ac2.bank.matched'))}><Icon name="check" size={14} /> {t('ac2.bank.match')}</button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="row-actions">
                    <button type="button" className="btn btn-sm" onClick={() => { setPicked([]); setError(null); setManual(l); }}>{t('ac2.bank.pickEntries')}</button>
                    <button type="button" className="btn btn-sm" onClick={() => { setPost({ accountId: '', narration: l.description }); setError(null); setPostLine(l); }}>{t('ac2.bank.post')}</button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setReason(''); setError(null); setIgnore(l); }}>{t('ac2.bank.ignore')}</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ))}
      {tab === 'import' && (
        <section className="card p12-block">
          <h2 className="section-title">{t('ac2.bank.importTitle')}</h2>
          <p className="muted small">{t('ac2.bank.importHint')}</p>
          <label className="btn" htmlFor="bk-file"><Icon name="upload" /> {file ? file.name : t('ac2.bank.chooseFile')}</label>
          <input id="bk-file" type="file" accept=".csv,.xlsx" className="sr-only" onChange={(e) => void pickFile(e.target.files?.[0] ?? null)} />
          {preview && (
            <>
              <p className="muted small">{t('ac2.bank.rows', { n: preview.rowCount })}</p>
              <div className="grid-3 acc-map">
                {MAP_KEYS.map((k) => (
                  <Field key={k} id={`bk-${k}`} label={t(`ac2.bank.map.${k}` as MessageKey) + (OPTIONAL.has(k) ? ` (${t('ac2.optional')})` : '')}>
                    <select id={`bk-${k}`} value={mapping[k] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [k]: e.target.value }))}><option value="">—</option>{preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}</select>
                  </Field>
                ))}
                <Field id="bk-fmt" label={t('ac2.bank.map.dateFormat')}><select id="bk-fmt" value={mapping.dateFormat ?? 'DD/MM/YYYY'} onChange={(e) => setMapping((m) => ({ ...m, dateFormat: e.target.value }))}>{DATE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}</select></Field>
              </div>
              <div className="table-wrap acc-sample">
                <table className="table"><caption className="sr-only">{t('ac2.bank.sample')}</caption><thead><tr>{preview.headers.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{preview.sample.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>
              </div>
              <button type="button" className="btn btn-primary" disabled={busy || !mapping.dateColumn || !mapping.descriptionColumn || !mapping.debitColumn || !mapping.creditColumn} onClick={() => void doImport()}><Icon name="upload" /> {t('ac2.bank.import')}</button>
            </>
          )}
          {result && (
            <p className="notice" role="status"><Icon name="check" /> {t('ac2.bank.result', { lines: result.lines, added: result.added, skipped: result.skipped })}{result.problems.length ? ` ${t('ac2.bank.problems', { list: result.problems.slice(0, 3).join('; ') })}` : ''}</p>
          )}
        </section>
      )}
      {tab === 'statement' && (
        <>
          <div className="panel-head"><label className="p12-inline">{t('ac2.bank.asOn')} <input type="date" value={asOn} max={todayIST()} onChange={(e) => setAsOn(e.target.value || todayIST())} /></label></div>
          {!stmt ? <SkeletonRows rows={5} /> : (
            <div className="card p12-block acc-stmt">
              <h2 className="section-title">{t('ac2.bank.stmtTitle', { bank: stmt.bank, d: d(stmt.asOn) })}</h2>
              <table className="table">
                <tbody>
                  <tr><th scope="row">{t('ac2.bank.bookBal')}</th><td className="num">{rupees(stmt.bookBalance, { paise: true })}</td></tr>
                  <tr><th scope="row">{t('ac2.bank.lessDeposits', { n: stmt.depositsNotCredited.items.length })}</th><td className="num">− {rupees(stmt.depositsNotCredited.total, { paise: true })}</td></tr>
                  <tr><th scope="row">{t('ac2.bank.addPayments', { n: stmt.paymentsNotPresented.items.length })}</th><td className="num">+ {rupees(stmt.paymentsNotPresented.total, { paise: true })}</td></tr>
                  <tr><th scope="row">{t('ac2.bank.bankOnly', { n: stmt.bankOnly.items.length })}</th><td className="num">{formatINR(toPaise(stmt.bankOnly.moneyIn) - toPaise(stmt.bankOnly.moneyOut), { paise: true })}</td></tr>
                  <tr className="acc-subtotal"><th scope="row">{t('ac2.bank.expected')}</th><td className="num">{rupees(stmt.expectedBankBalance, { paise: true })}</td></tr>
                  {stmt.statementBalance && <tr><th scope="row">{t('ac2.bank.stmtBal', { d: d(stmt.statementBalance.on) })}</th><td className="num">{rupees(stmt.statementBalance.amount, { paise: true })}</td></tr>}
                  {stmt.difference != null && <tr className={Number(stmt.difference) === 0 ? '' : 'text-bad'}><th scope="row">{t('ac2.bank.diff')}</th><td className="num">{rupees(stmt.difference, { paise: true })}</td></tr>}
                </tbody>
              </table>
              {stmt.difference != null && <p className={Number(stmt.difference) === 0 ? 'muted small' : 'notice'}><Icon name={Number(stmt.difference) === 0 ? 'check' : 'info'} size={14} /> {Number(stmt.difference) === 0 ? t('ac2.bank.reconciled') : t('ac2.bank.notReconciled')}</p>}
              {[['depositsNotCredited', 'ac2.bank.depList'], ['paymentsNotPresented', 'ac2.bank.payList']].map(([k, label]) => {
                const items = (stmt[k as 'depositsNotCredited'] as Stmt['depositsNotCredited']).items;
                return items.length ? <details key={k}><summary>{t(label as MessageKey)} ({items.length})</summary><ul className="p12-action-list">{items.map((i, n) => <li key={n}><span><span className="code">{i.entryNo}</span> {d(i.date)} · {i.narration}</span><span>{rupees(i.amount, { paise: true })}</span></li>)}</ul></details> : null;
              })}
            </div>
          )}
        </>
      )}
      <Modal open={!!manual} onClose={() => setManual(null)} title={t('ac2.bank.pickTitle')} subtitle={manual ? `${manual.description} · ${rupees(amt(manual), { paise: true })}` : undefined} onSubmit={(e) => { e.preventDefault(); void act(() => api('/accounts/bank/match', { method: 'POST', body: JSON.stringify({ statementLineId: manual!.id, journalLineIds: picked }) }), t('ac2.bank.matched')).then((ok) => ok && setManual(null)); }} submitLabel={t('ac2.bank.match')} busy={busy} error={error} submitDisabled={!manual || pickedSum !== toPaise(amt(manual))} wide>
        {bench && manual && (
          <>
            <p className={manual && pickedSum === toPaise(amt(manual)) ? 'muted small' : 'small'} role="status">{t('ac2.bank.picked', { sum: formatINR(pickedSum, { paise: true }), of: rupees(amt(manual), { paise: true }) })}</p>
            <div className="p12-staff-list acc-pick">
              {bench.bookLines.filter((b) => (Number(manual.credit) > 0 ? Number(b.debit) > 0 : Number(b.credit) > 0)).map((b) => (
                <label key={b.id} className="check"><input type="checkbox" checked={picked.includes(b.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, b.id] : p.filter((x) => x !== b.id)))} /> <span><span className="code">{b.entryNo}</span> {d(b.date)} · {rupees(Number(b.debit) > 0 ? b.debit : b.credit, { paise: true })}<span className="sub-line muted small">{b.narration}</span></span></label>
              ))}
            </div>
          </>
        )}
      </Modal>
      <Modal open={!!postLine} onClose={() => setPostLine(null)} title={t('ac2.bank.postTitle')} subtitle={postLine ? `${postLine.description} · ${rupees(amt(postLine), { paise: true })}` : undefined} onSubmit={(e: FormEvent) => { e.preventDefault(); void act(() => api(`/accounts/bank/lines/${postLine!.id}/post`, { method: 'POST', body: JSON.stringify(post) }), t('ac2.bank.posted')).then((ok) => ok && setPostLine(null)); }} submitLabel={t('ac2.bank.post')} busy={busy} error={error} submitDisabled={!post.accountId}>
        {chart && postLine && <Field id="bk-acc" label={Number(postLine.credit) > 0 ? t('ac2.bank.incomeAcc') : t('ac2.bank.expenseAcc')} hint={t('ac2.bank.postHint')}><AccountSelect id="bk-acc" chart={chart} value={post.accountId} onChange={(v) => setPost((p) => ({ ...p, accountId: v }))} types={Number(postLine.credit) > 0 ? ['INCOME', 'LIABILITY', 'EQUITY', 'ASSET'] : ['EXPENSE', 'ASSET', 'LIABILITY']} only={(a) => a.id !== bench?.bank.accountId} /></Field>}
        <Field id="bk-nar" label={t('ac2.narration')}><input id="bk-nar" value={post.narration} onChange={(e) => setPost((p) => ({ ...p, narration: e.target.value }))} /></Field>
      </Modal>
      <Modal open={!!ignore} onClose={() => setIgnore(null)} title={t('ac2.bank.ignoreTitle')} subtitle={ignore ? `${ignore.description} · ${rupees(amt(ignore), { paise: true })}` : undefined} onSubmit={(e: FormEvent) => { e.preventDefault(); void act(() => api(`/accounts/bank/lines/${ignore!.id}/ignore`, { method: 'POST', body: JSON.stringify({ reason }) }), t('ac2.bank.ignored')).then((ok) => ok && setIgnore(null)); }} submitLabel={t('ac2.bank.ignore')} busy={busy} error={error} submitDisabled={reason.trim().length < 3}>
        <Field id="bk-reason" label={t('ac2.reason')} hint={t('ac2.bank.ignoreHint')}><input id="bk-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>
    </>
  );
}
