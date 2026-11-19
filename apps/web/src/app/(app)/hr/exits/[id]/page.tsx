'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { rupees } from '@/components/accounts';

interface View {
  id: string; status: string; exitType: string; resignationDate: string; lastWorkingDate: string; reason: string; remarks: string | null; settlementAmount: string | null; initiatedBy: string; closedBy: string | null; closedAt: string | null;
  employee: { id: string; name: string; code: string; designation: string | null; joiningDate: string; hasLogin: boolean };
  handoverTo: string | null;
  clearances: { section: string; status: string; dueAmount: string; remarks: string | null; clearedBy: string | null; clearedAt: string | null; canClear: boolean }[];
  canClose: boolean; canCancel: boolean;
}

/** One exit: no-dues by section, then closing (login removed, settlement kept for payroll). */
export default function ExitPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const toast = useToast();
  const [v, setV] = useState<View | null>(null);
  const [missing, setMissing] = useState(false);
  const [clear, setClear] = useState<string | null>(null);
  const [cf, setCf] = useState({ dueAmount: '0', remarks: '' });
  const [closing, setClosing] = useState(false);
  const [settle, setSettle] = useState({ settlementAmount: '', remarks: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ws, setWs] = useState<{ lines: { label: string; amount: string; sign: 1 | -1; note?: string }[]; total: string; notes: string[] } | null>(null);
  const load = useCallback(() => { api<View>(`/hr/exits/${id}`).then(setV).catch(() => setMissing(true)); api<NonNullable<typeof ws>>(`/payroll/settlement/${id}`).then(setWs).catch(() => setWs(null)); }, [id]);
  useEffect(load, [load]);
  const call = async (path: string, body: unknown, done: string) => {
    setBusy(true); setError(null);
    try { await api(`/hr/exits/${id}/${path}`, { method: 'POST', body: JSON.stringify(body) }); toast(done); load(); return true; }
    catch (x) { setError(apiErrors(x).message ?? t('en.failed')); return false; } finally { setBusy(false); }
  };
  if (missing) return <EmptyState icon="users" title={t('hr.x.notFound')} action={<Link href="/hr/exits" className="btn">{t('hr.x.title')}</Link>} />;
  if (!v) return <SkeletonRows rows={5} />;
  const d = (s: string | null) => (s ? new Date(s.length === 10 ? `${s}T00:00:00Z` : s).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: s.length === 10 ? 'UTC' : 'Asia/Kolkata' }) : '—');
  const pending = v.clearances.filter((c) => c.status !== 'CLEARED');
  return (
    <>
      <Link href="/hr/exits" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('hr.x.title')}</Link>
      <PageHeader eyebrow={`${v.employee.code}${v.employee.designation ? ` · ${v.employee.designation}` : ''}`} title={v.employee.name}
        actions={<><span className={`pill ${v.status === 'CLOSED' ? 'pill-muted' : v.status === 'CANCELLED' ? 'pill-muted' : 'pill-warn'}`}><span className="pill-dot" />{t(`hr.x.st.${v.status}` as MessageKey)}</span>{v.canCancel && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void call('cancel', {}, t('hr.x.cancelled'))}>{t('hr.x.cancel')}</button>}{v.canClose && <button type="button" className="btn btn-primary" onClick={() => { setSettle({ settlementAmount: '', remarks: '' }); setError(null); setClosing(true); }}><Icon name="check" /> {t('hr.x.close')}</button>}</>} />
      <dl className="kv">
        <div><dt>{t('hr.x.typeLabel')}</dt><dd>{t(`hr.x.type.${v.exitType}` as MessageKey)}</dd></div>
        <div><dt>{t('hr.x.notice')}</dt><dd>{d(v.resignationDate)}</dd></div>
        <div><dt>{t('hr.x.lastLabel')}</dt><dd>{d(v.lastWorkingDate)}</dd></div>
        <div><dt>{t('hr.joined')}</dt><dd>{d(v.employee.joiningDate)}</dd></div>
        <div><dt>{t('hr.x.handover')}</dt><dd>{v.handoverTo ?? '—'}</dd></div>
        <div><dt>{t('hr.x.startedBy')}</dt><dd>{v.initiatedBy}</dd></div>
        <div className="kv-wide"><dt>{t('ac2.reason')}</dt><dd>{v.reason}</dd></div>
        {v.status === 'CLOSED' && <div><dt>{t('hr.x.settlement')}</dt><dd>{v.settlementAmount ? rupees(v.settlementAmount, { paise: true }) : '—'}<span className="sub-line muted small">{t('hr.x.closedBy', { name: v.closedBy ?? '', d: d(v.closedAt) })}</span></dd></div>}
      </dl>
      <section className="card p12-block" aria-labelledby="x-nd">
        <h2 id="x-nd" className="section-title">{t('hr.x.noDues')} <span className="muted small">· {t('hr.x.clearedOf', { n: v.clearances.length - pending.length, of: v.clearances.length })}</span></h2>
        <ul className="p12-action-list">
          {v.clearances.map((c) => (
            <li key={c.section}>
              <span><strong>{t(`hr.sec.${c.section}` as MessageKey)}</strong><span className="sub-line muted small">{c.status === 'CLEARED' ? t('hr.x.clearedLine', { name: c.clearedBy ?? '', d: d(c.clearedAt) }) + (Number(c.dueAmount) > 0 ? ` · ${t('hr.x.dues', { amt: rupees(c.dueAmount, { paise: true }) })}` : '') + (c.remarks ? ` · ${c.remarks}` : '') : t('hr.x.waitingSection')}</span></span>
              <span className="row-actions"><span className={`pill ${c.status === 'CLEARED' ? 'pill-ok' : 'pill-warn'}`}><span className="pill-dot" />{t(`hr.x.cs.${c.status}` as MessageKey)}</span>{c.canClear && <button type="button" className="btn btn-sm btn-primary" onClick={() => { setCf({ dueAmount: '0', remarks: '' }); setError(null); setClear(c.section); }}>{t('hr.x.clear')}</button>}</span>
            </li>
          ))}
        </ul>
        {v.status === 'INITIATED' && !pending.length && !v.canClose && <p className="muted small">{t('hr.x.closeAfter', { d: d(v.lastWorkingDate) })}</p>}
      </section>
      {ws && v.status === 'INITIATED' && (
        <section className="card p12-block" aria-labelledby="x-ws">
          <h2 id="x-ws" className="section-title">{t('pay.ws.title')}</h2>
          <dl className="pay-lines">{ws.lines.map((l) => <div key={l.label}><dt>{l.label}{l.note && <span className="sub-line muted small">{l.note}</span>}</dt><dd className="num">{l.sign < 0 ? '− ' : ''}{rupees(l.amount, { paise: true })}</dd></div>)}</dl>
          <p className="pay-col-total"><span>{Number(ws.total) < 0 ? t('pay.ws.toRecover') : t('pay.ws.toPay')}</span><strong className="num">{rupees(String(Math.abs(Number(ws.total))), { paise: true })}</strong></p>
          {ws.notes.map((n) => <p key={n} className="muted small"><Icon name="info" size={14} /> {n}</p>)}
          {v.canClose && Number(ws.total) > 0 && <button type="button" className="btn btn-sm" onClick={() => { setSettle({ settlementAmount: ws.total, remarks: t('pay.ws.remark') }); setError(null); setClosing(true); }}>{t('pay.ws.use')}</button>}
        </section>
      )}
      <Modal open={!!clear} onClose={() => setClear(null)} title={t('hr.x.clearTitle', { s: clear ? t(`hr.sec.${clear}` as MessageKey) : '' })} subtitle={t('hr.x.clearSub')} onSubmit={(e: FormEvent) => { e.preventDefault(); void call(`clear/${clear}`, cf, t('hr.x.clearedToast')).then((ok) => ok && setClear(null)); }} submitLabel={t('hr.x.clear')} busy={busy} error={error}>
        <div className="grid-2"><Field id="cf-due" label={t('hr.x.dueAmount')} hint={t('hr.x.dueHint')}><input id="cf-due" inputMode="decimal" value={cf.dueAmount} onChange={(e) => setCf((f) => ({ ...f, dueAmount: e.target.value }))} /></Field><Field id="cf-rem" label={t('ac2.notes')}><input id="cf-rem" value={cf.remarks} onChange={(e) => setCf((f) => ({ ...f, remarks: e.target.value }))} /></Field></div>
      </Modal>
      <Modal open={closing} onClose={() => setClosing(false)} title={t('hr.x.closeTitle', { name: v.employee.name })} subtitle={v.employee.hasLogin ? t('hr.x.closeLogin') : t('hr.x.closeNoLogin')} onSubmit={(e: FormEvent) => { e.preventDefault(); void call('close', { settlementAmount: settle.settlementAmount || '0', remarks: settle.remarks || null }, t('hr.x.closedToast')).then((ok) => ok && setClosing(false)); }} submitLabel={t('hr.x.close')} busy={busy} error={error} danger>
        <div className="grid-2"><Field id="cl-amt" label={t('hr.x.settlement')} hint={t('hr.x.settlementHint')}><input id="cl-amt" inputMode="decimal" value={settle.settlementAmount} onChange={(e) => setSettle((s) => ({ ...s, settlementAmount: e.target.value }))} /></Field><Field id="cl-rem" label={t('ac2.notes')}><input id="cl-rem" value={settle.remarks} onChange={(e) => setSettle((s) => ({ ...s, remarks: e.target.value }))} /></Field></div>
      </Modal>
    </>
  );
}
