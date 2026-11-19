'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, StatTile, useToast } from '@/components/ui';
import { ReportData, ReportTable, rupees, todayIST } from '@/components/accounts';
import { PayPill, saveText, toCsv, useMonthLabel } from '@/components/payroll';

interface Slip { id: string; employeeId: string; name: string; code: string; designation: string | null; monthDays: number; employedDays: number; lopDays: number; paidDays: number; gross: string; deductions: string; employer: string; net: string; bank: string | null; items: { itemType: string; code: string; name: string; amount: string }[] }
interface View {
  id: string; runNo: string; campus: string; month: number; year: number; status: string; totalGross: string; totalDeductions: string; totalNet: string; totalEmployer: string;
  preparedBy: string | null; approvedBy: string | null; approvedAt: string | null; journalNo: string | null; paymentJournalNo: string | null; paidOn: string | null; paidBy: string | null; paidFrom: string | null;
  missing: string[]; mine: boolean; can: { prepare: boolean; pay: boolean; reports: boolean };
  payslips: Slip[]; adjustments: { id: string; employeeId: string; name: string; itemType: string; label: string; amount: string; isTaxable: boolean }[];
}
type Kind = 'register' | 'pf' | 'esi' | 'pt' | 'tds';
interface Statement { runNo: string; label: string; kind: Kind; columns: ReportData['columns']; rows: ReportData['rows']; totals: Record<string, string>; ecr: string | null; notes: string[] }

/** One payroll run: payslips, one-off lines, approval, bank file, payment and statements. */
export default function PayrollRunPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const toast = useToast();
  const label = useMonthLabel();
  const [v, setV] = useState<View | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<'slips' | 'adj' | 'statements'>('slips');
  const [kind, setKind] = useState<Kind>('register');
  const [st, setSt] = useState<Statement | null>(null);
  const [stErr, setStErr] = useState<string | null>(null);
  const [adjOpen, setAdjOpen] = useState(false);
  const [adj, setAdj] = useState({ employeeId: '', itemType: 'EARNING', label: '', amount: '', isTaxable: true });
  const [payOpen, setPayOpen] = useState(false);
  const [pay, setPay] = useState({ paidOn: todayIST(), bankAccountId: '' });
  const [banks, setBanks] = useState<{ id: string; label: string }[]>([]);
  const [others, setOthers] = useState<{ name: string; code: string; net: string }[] | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | 'submit' | 'cancel'>(null);
  const load = useCallback(() => { api<View>(`/payroll/runs/${id}`).then(setV).catch(() => setMissing(true)); }, [id]);
  useEffect(load, [load]);
  useEffect(() => {
    if (tab !== 'statements' || !v) return;
    setSt(null); setStErr(null);
    api<Statement>(`/payroll/runs/${id}/report?kind=${kind}`).then(setSt).catch((x) => setStErr(apiErrors(x).message ?? t('en.failed')));
  }, [tab, kind, id, v, t]);
  const act = async (path: string, body: unknown, done: string) => {
    setBusy(true); setError(null); setErrors({});
    try { await api(`/payroll/runs/${id}/${path}`, { method: 'POST', body: JSON.stringify(body) }); toast(done); load(); return true; }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message ?? t('en.failed')); if (!payOpen && !adjOpen && !confirm) toast(a.message ?? t('en.failed'), 'bad'); return false; }
    finally { setBusy(false); }
  };
  const bankFile = async () => {
    setBusy(true);
    try {
      const r = await api<{ fileName: string; csv: string; count: number; total: string; others: { name: string; code: string; net: string }[] }>(`/payroll/runs/${id}/bank-file`, { method: 'POST', body: '{}' });
      if (r.count) saveText(r.fileName, r.csv);
      setOthers(r.others);
      toast(t('pay.bank.saved', { n: r.count, amt: rupees(r.total) }));
    } catch (x) { toast(apiErrors(x).message ?? t('en.failed'), 'bad'); } finally { setBusy(false); }
  };
  const removeAdj = async (aid: string) => {
    setBusy(true);
    try { await api(`/payroll/runs/${id}/adjustments/${aid}`, { method: 'DELETE' }); toast(t('pay.adj.removed')); load(); }
    catch (x) { toast(apiErrors(x).message ?? t('en.failed'), 'bad'); } finally { setBusy(false); }
  };
  if (missing) return <EmptyState icon="rupee" title={t('pay.run.notFound')} action={<Link href="/payroll/runs" className="btn">{t('pay.run.title')}</Link>} />;
  if (!v) return <SkeletonRows rows={6} />;
  const editable = v.can.prepare && ['DRAFT', 'CALCULATED'].includes(v.status);
  const d = (s: string | null) => (s ? new Date(s.length === 10 ? `${s}T00:00:00Z` : s).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: s.length === 10 ? 'UTC' : 'Asia/Kolkata' }) : '—');
  return (
    <>
      <Link href="/payroll/runs" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('pay.run.title')}</Link>
      <PageHeader eyebrow={`${v.runNo} · ${v.campus}`} title={t('pay.run.heading', { m: label(v.month, v.year) })}
        actions={<>
          <PayPill status={v.status} />
          {editable && <button type="button" className="btn" disabled={busy} onClick={() => void act('calculate', {}, t('pay.run.recalculated'))}><Icon name="swap" /> {t('pay.run.recalc')}</button>}
          {editable && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setError(null); setConfirm('cancel'); }}>{t('pay.run.cancel')}</button>}
          {editable && v.status === 'CALCULATED' && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => { setError(null); setConfirm('submit'); }}><Icon name="arrowRight" /> {t('pay.run.submit')}</button>}
          {v.can.pay && ['APPROVED', 'PAID'].includes(v.status) && <button type="button" className="btn" disabled={busy} onClick={() => void bankFile()}><Icon name="download" /> {t('pay.bank.file')}</button>}
          {v.can.pay && v.status === 'APPROVED' && <button type="button" className="btn btn-primary" onClick={() => { setErrors({}); setError(null); setPayOpen(true); api<{ id: string; label: string }[]>('/payroll/bank-accounts').then((b) => { setBanks(b); setPay((p) => ({ ...p, bankAccountId: p.bankAccountId || b[0]?.id || '' })); }).catch(() => setBanks([])); }}><Icon name="check" /> {t('pay.pay.record')}</button>}
        </>} />
      <div className="stats pay-stats">
        <StatTile icon="users" label={t('pay.staff')} value={v.payslips.length} />
        <StatTile icon="rupee" label={t('pay.gross')} value={rupees(v.totalGross)} />
        <StatTile icon="layers" label={t('pay.deductions')} value={rupees(v.totalDeductions)} />
        <StatTile icon="receipt" label={t('pay.net')} value={rupees(v.totalNet)} hint={t('pay.employerHint', { amt: rupees(v.totalEmployer) })} />
      </div>
      <p className="muted small pay-trail">
        {v.preparedBy && t('pay.run.preparedBy', { name: v.preparedBy })}
        {v.status === 'PENDING_APPROVAL' && ` · ${t('pay.run.waiting')}`}
        {v.approvedBy && ` · ${t('pay.run.approvedBy', { name: v.approvedBy, d: d(v.approvedAt) })}`}
        {v.journalNo && ` · ${t('pay.run.journal', { no: v.journalNo })}`}
        {v.paidOn && ` · ${t('pay.run.paidLine', { d: d(v.paidOn), from: v.paidFrom ?? '', no: v.paymentJournalNo ?? '' })}`}
      </p>
      {v.missing.length > 0 && editable && <div className="notice notice-warn" role="status"><Icon name="alert" size={16} /> <span>{t('pay.run.missing', { names: v.missing.join(', ') })} <Link href="/payroll/salaries">{t('pay.run.setSalaries')}</Link></span></div>}
      {others && others.length > 0 && <div className="notice notice-info" role="status"><Icon name="info" size={16} /> <span>{t('pay.bank.others')} {others.map((o) => `${o.name} (${rupees(o.net)})`).join(', ')}</span></div>}

      <div className="tabs" role="tablist" aria-label={t('pay.run.heading', { m: label(v.month, v.year) })}>
        <button role="tab" aria-selected={tab === 'slips'} className={tab === 'slips' ? 'on' : ''} onClick={() => setTab('slips')}>{t('pay.tab.slips')}</button>
        <button role="tab" aria-selected={tab === 'adj'} className={tab === 'adj' ? 'on' : ''} onClick={() => setTab('adj')}>{t('pay.tab.adj')} {v.adjustments.length > 0 && <span className="count">{v.adjustments.length}</span>}</button>
        {v.can.reports && <button role="tab" aria-selected={tab === 'statements'} className={tab === 'statements' ? 'on' : ''} onClick={() => setTab('statements')}>{t('pay.tab.statements')}</button>}
      </div>

      {tab === 'slips' && (!v.payslips.length ? <EmptyState icon="users" title={t('pay.run.empty')} /> : (
        <div className="table-wrap card" role="region" aria-label={t('pay.tab.slips')} tabIndex={0}>
          <table className="table pay-slips">
            <thead><tr><th scope="col">{t('pay.name')}</th><th scope="col" className="num">{t('pay.paidDays')}</th><th scope="col" className="num">{t('pay.lop')}</th><th scope="col" className="num">{t('pay.gross')}</th><th scope="col" className="num">{t('pay.deductions')}</th><th scope="col" className="num">{t('pay.net')}</th><th scope="col"><span className="sr-only">{t('pay.open')}</span></th></tr></thead>
            <tbody>{v.payslips.map((s) => (
              <tr key={s.id}>
                <td><strong>{s.name}</strong><span className="sub-line muted small">{s.code}{s.designation ? ` · ${s.designation}` : ''}{s.employedDays < s.monthDays ? ` · ${t('pay.employedDays', { n: s.employedDays })}` : ''}</span></td>
                <td className="num">{s.paidDays}<span className="muted small"> / {s.monthDays}</span></td>
                <td className="num">{s.lopDays ? <span className="pill pill-warn">{s.lopDays}</span> : '—'}</td>
                <td className="num">{rupees(s.gross)}</td>
                <td className="num">{rupees(s.deductions)}</td>
                <td className="num"><strong>{rupees(s.net)}</strong>{!s.bank && <span className="sub-line muted small">{t('pay.noBankShort')}</span>}</td>
                <td><Link className="btn btn-sm" href={`/payroll/payslips/${s.id}`}>{t('pay.payslip')}</Link></td>
              </tr>
            ))}</tbody>
            <tfoot><tr><td>{t('pay.total')}</td><td /><td /><td className="num">{rupees(v.totalGross)}</td><td className="num">{rupees(v.totalDeductions)}</td><td className="num"><strong>{rupees(v.totalNet)}</strong></td><td /></tr></tfoot>
          </table>
        </div>
      ))}

      {tab === 'adj' && (
        <section className="card p12-block" aria-labelledby="adj-h">
          <div className="section-head"><h2 id="adj-h" className="section-title">{t('pay.adj.title')}</h2>{editable && <button type="button" className="btn btn-sm btn-primary" onClick={() => { setAdj({ employeeId: v.payslips[0]?.employeeId ?? '', itemType: 'EARNING', label: '', amount: '', isTaxable: true }); setErrors({}); setError(null); setAdjOpen(true); }}><Icon name="plus" /> {t('pay.adj.add')}</button>}</div>
          <p className="muted small">{t('pay.adj.hint')}</p>
          {!v.adjustments.length ? <p className="muted">{t('pay.adj.none')}</p> : (
            <ul className="p12-action-list">{v.adjustments.map((a) => (
              <li key={a.id}>
                <span><strong>{a.label}</strong><span className="sub-line muted small">{a.name} · {t(a.itemType === 'EARNING' ? 'pay.adj.addition' : 'pay.adj.deduction')}{a.itemType === 'EARNING' && !a.isTaxable ? ` · ${t('pay.adj.notTaxable')}` : ''}</span></span>
                <span className="row-actions"><strong className="num">{a.itemType === 'DEDUCTION' ? '− ' : '+ '}{rupees(a.amount, { paise: true })}</strong>{editable && <button type="button" className="btn btn-sm btn-ghost" disabled={busy} aria-label={t('pay.adj.removeLabel', { label: a.label, name: a.name })} onClick={() => void removeAdj(a.id)}><Icon name="trash" size={16} /></button>}</span>
              </li>
            ))}</ul>
          )}
        </section>
      )}

      {tab === 'statements' && (
        <>
          <div className="filter-bar pay-kinds" role="group" aria-label={t('pay.tab.statements')}>
            {(['register', 'pf', 'esi', 'pt', 'tds'] as Kind[]).map((k) => <button key={k} type="button" className={`chip ${kind === k ? 'on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{t(`pay.rep.${k}` as MessageKey)}</button>)}
            {st && <span className="row-actions">
              <button type="button" className="btn btn-sm" onClick={() => saveText(`${v.runNo.replace(/[^A-Za-z0-9-]+/g, '-')}-${kind}.csv`, toCsv(st.columns, st.rows, st.totals))}><Icon name="download" size={16} /> {t('pay.rep.csv')}</button>
              {st.ecr && <button type="button" className="btn btn-sm" onClick={() => saveText(`${v.runNo.replace(/[^A-Za-z0-9-]+/g, '-')}-ECR.txt`, st.ecr!, 'text/plain;charset=utf-8')}><Icon name="file" size={16} /> {t('pay.rep.ecr')}</button>}
            </span>}
          </div>
          {stErr ? <p className="field-error">{stErr}</p> : !st ? <SkeletonRows rows={4} /> : !st.rows.length ? <EmptyState icon="file" title={t('pay.rep.none')} text={st.notes.join(' ')} /> : <ReportTable r={{ title: t(`pay.rep.${kind}` as MessageKey), subtitle: `${label(v.month, v.year)} · ${v.campus}`, columns: st.columns, rows: st.rows, totals: { ...st.totals, [st.columns[0].key]: t('pay.total') }, notes: st.notes }} />}
        </>
      )}

      <Modal open={adjOpen} onClose={() => setAdjOpen(false)} title={t('pay.adj.add')} subtitle={t('pay.adj.sub')} onSubmit={(e: FormEvent) => { e.preventDefault(); void act('adjustments', { ...adj, amount: adj.amount }, t('pay.adj.added')).then((ok) => ok && setAdjOpen(false)); }} submitLabel={t('pay.adj.addBtn')} busy={busy} error={error}>
        <Field id="adj-who" label={t('pay.name')} error={errors.employeeId}><select id="adj-who" value={adj.employeeId} onChange={(e) => setAdj((a) => ({ ...a, employeeId: e.target.value }))}>{v.payslips.map((s) => <option key={s.employeeId} value={s.employeeId}>{s.name} · {s.code}</option>)}</select></Field>
        <div className="grid-2">
          <Field id="adj-type" label={t('pay.adj.kind')}><select id="adj-type" value={adj.itemType} onChange={(e) => setAdj((a) => ({ ...a, itemType: e.target.value }))}><option value="EARNING">{t('pay.adj.addition')}</option><option value="DEDUCTION">{t('pay.adj.deduction')}</option></select></Field>
          <Field id="adj-amt" label={t('pay.amount')} error={errors.amount}><input id="adj-amt" inputMode="decimal" value={adj.amount} onChange={(e) => setAdj((a) => ({ ...a, amount: e.target.value }))} /></Field>
        </div>
        <Field id="adj-label" label={t('pay.adj.label')} hint={t('pay.adj.labelHint')} error={errors.label}><input id="adj-label" value={adj.label} onChange={(e) => setAdj((a) => ({ ...a, label: e.target.value }))} /></Field>
        {adj.itemType === 'EARNING' && <label className="check"><input type="checkbox" checked={adj.isTaxable} onChange={(e) => setAdj((a) => ({ ...a, isTaxable: e.target.checked }))} /> {t('pay.adj.taxable')}</label>}
      </Modal>

      <Modal open={payOpen} onClose={() => setPayOpen(false)} title={t('pay.pay.title', { m: label(v.month, v.year) })} subtitle={t('pay.pay.sub', { amt: rupees(v.totalNet, { paise: true }) })} onSubmit={(e: FormEvent) => { e.preventDefault(); void act('pay', pay, t('pay.pay.done')).then((ok) => ok && setPayOpen(false)); }} submitLabel={t('pay.pay.record')} busy={busy} error={error}>
        <div className="grid-2">
          <Field id="pay-on" label={t('pay.pay.on')} error={errors.paidOn}><input id="pay-on" type="date" value={pay.paidOn} onChange={(e) => setPay((p) => ({ ...p, paidOn: e.target.value }))} /></Field>
          <Field id="pay-bank" label={t('pay.pay.from')} error={errors.bankAccountId}><select id="pay-bank" value={pay.bankAccountId} onChange={(e) => setPay((p) => ({ ...p, bankAccountId: e.target.value }))}>{!banks.length && <option value="">{t('pay.pay.noBanks')}</option>}{banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></Field>
        </div>
        <p className="muted small">{t('pay.pay.release')}</p>
      </Modal>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={confirm === 'submit' ? t('pay.run.submitTitle') : t('pay.run.cancelTitle')} subtitle={confirm === 'submit' ? t('pay.run.submitSub', { amt: rupees(v.totalNet, { paise: true }) }) : t('pay.run.cancelSub')} onSubmit={(e: FormEvent) => { e.preventDefault(); const c = confirm; void act(c === 'submit' ? 'submit' : 'cancel', {}, c === 'submit' ? t('pay.run.submitted') : t('pay.run.cancelled')).then((ok) => ok && setConfirm(null)); }} submitLabel={confirm === 'submit' ? t('pay.run.submit') : t('pay.run.cancel')} busy={busy} error={error} danger={confirm === 'cancel'}>
        {confirm === 'submit' && <p className="muted small">{t('pay.run.submitNote')}</p>}
      </Modal>
    </>
  );
}
