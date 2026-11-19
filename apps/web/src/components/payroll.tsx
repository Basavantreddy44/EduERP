'use client';

import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { rupees } from '@/components/accounts';

/** Phase 15 payroll: shared bits for the payroll screens. */

export const RUN_TONE: Record<string, string> = { DRAFT: 'pill-muted', CALCULATED: 'pill-info', PENDING_APPROVAL: 'pill-warn', APPROVED: 'pill-info', PAID: 'pill-ok', CANCELLED: 'pill-muted', ACTIVE: 'pill-info', CLOSED: 'pill-ok', REJECTED: 'pill-bad' };

export function PayPill({ status }: { status: string }) {
  const { t } = useI18n();
  return <span className={`pill ${RUN_TONE[status] ?? 'pill-muted'}`}><span className="pill-dot" />{t(`pay.st.${status}` as MessageKey)}</span>;
}

/** "November 2026" in the reader's language. */
export function useMonthLabel() {
  const { locale } = useI18n();
  return (m: number, y: number) => new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Saves text the browser already has (CSV, ECR) as a file. */
export function saveText(fileName: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSV from report columns and rows (money as plain numbers). */
export function toCsv(columns: { key: string; label: string }[], rows: Record<string, string | number | null>[], totals?: Record<string, string | number | null>) {
  const cell = (v: string | number | null | undefined) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const out = [columns.map((c) => cell(c.label)).join(',')];
  for (const r of rows) out.push(columns.map((c) => cell(r[c.key])).join(','));
  if (totals) out.push(columns.map((c, i) => cell(i === 0 ? 'Total' : totals[c.key])).join(','));
  return `﻿${out.join('\r\n')}\r\n`;
}

export interface Breakdown { items: { itemType: string; code: string; name: string; amount: string }[]; gross: string; deductions: string; employer: string; net: string; ctcMonthly: string; ctcYearly: string; taxYear: string }

/** Earnings / deductions / employer contributions of a salary, side by side. */
export function BreakdownView({ b }: { b: Breakdown }) {
  const { t } = useI18n();
  const part = (type: string) => b.items.filter((i) => i.itemType === type);
  const block = (type: string, title: MessageKey, total: string) => (
    <div className="pay-col">
      <h3 className="pay-col-title">{t(title)}</h3>
      <dl className="pay-lines">
        {part(type).map((i) => <div key={`${i.code}-${i.name}`}><dt>{i.name}</dt><dd className="num">{rupees(i.amount, { paise: true })}</dd></div>)}
        {!part(type).length && <div><dt className="muted">{t('pay.none')}</dt><dd /></div>}
      </dl>
      <p className="pay-col-total"><span>{t('pay.total')}</span><strong className="num">{rupees(total, { paise: true })}</strong></p>
    </div>
  );
  return (
    <div className="pay-breakdown">
      {block('EARNING', 'pay.earnings', b.gross)}
      {block('DEDUCTION', 'pay.deductions', b.deductions)}
      {block('EMPLOYER', 'pay.employer', b.employer)}
      <div className="pay-net">
        <span>{t('pay.netMonth')}</span><strong>{rupees(b.net, { paise: true })}</strong>
        <span className="muted small">{t('pay.ctcLine', { m: rupees(b.ctcMonthly), y: rupees(b.ctcYearly) })}</span>
        {Number(b.taxYear) > 0 && <span className="muted small">{t('pay.taxYearLine', { amt: rupees(b.taxYear) })}</span>}
      </div>
    </div>
  );
}
