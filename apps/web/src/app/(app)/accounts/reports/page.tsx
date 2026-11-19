'use client';

import { useEffect, useState } from 'react';
import { REPORTS, ReportCode } from '@eduerp/shared';
import { api, downloadFile } from '@/lib/api';
import { apiErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { CampusPicker } from '@/components/CampusPicker';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { AccountSelect, ReportData, ReportTable, fyStart, isMoney, todayIST, useChart, useCostCentres } from '@/components/accounts';

const NEEDS_ACCOUNT: ReportCode[] = ['LEDGER'];
const OPTIONAL_ACCOUNT: ReportCode[] = ['CASH_BOOK', 'BANK_BOOK'];
const AS_ON: ReportCode[] = ['TRIAL_BALANCE', 'BALANCE_SHEET'];

/** Accounts → Reports (M13.5): books, statements and registers, with Excel export. */
export default function AccountsReportsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const chart = useChart();
  const ccs = useCostCentres();
  const [code, setCode] = useState<ReportCode>('TRIAL_BALANCE');
  const [q, setQ] = useState({ from: fyStart(), to: todayIST(), campusId: '', accountId: '', costCentreId: '' });
  const [r, setR] = useState<ReportData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const qs = () => new URLSearchParams(Object.entries({ ...q, ...(AS_ON.includes(code) ? { from: fyStart(q.to) } : {}) }).filter(([k, v]) => v && (k !== 'accountId' || NEEDS_ACCOUNT.includes(code) || OPTIONAL_ACCOUNT.includes(code)) && (k !== 'costCentreId' || code === 'LEDGER'))).toString();
  useEffect(() => {
    if (NEEDS_ACCOUNT.includes(code) && !q.accountId) { setR(null); setErr(null); return; }
    setLoading(true); setErr(null);
    api<ReportData>(`/accounts/reports/${code}?${qs()}`).then(setR).catch((x) => { setR(null); setErr(apiErrors(x).message ?? t('en.failed')); }).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, q]);
  const excel = async () => { try { await downloadFile(`/accounts/reports/${code}/excel?${qs()}`); } catch (x) { toast(apiErrors(x).message ?? t('common.exportFailed'), 'bad'); } };
  return (
    <>
      <PageHeader eyebrow={t('nav.accounts')} title={t('ac2.rep.title')} description={t('ac2.rep.desc')} actions={r && <button type="button" className="btn" onClick={() => void excel()}><Icon name="download" /> {t('ac2.rep.excel')}</button>} />
      <div className="acc-report-bar card">
        <label className="p12-inline">{t('ac2.rep.report')}
          <select value={code} onChange={(e) => setCode(e.target.value as ReportCode)}>{REPORTS.map((c) => <option key={c} value={c}>{t(`ac2.rep.${c}` as MessageKey)}</option>)}</select>
        </label>
        {!AS_ON.includes(code) && <label className="p12-inline">{t('ac2.rep.from')} <input type="date" value={q.from} max={q.to} onChange={(e) => setQ((x) => ({ ...x, from: e.target.value || fyStart() }))} /></label>}
        <label className="p12-inline">{AS_ON.includes(code) ? t('ac2.rep.asOn') : t('ac2.rep.to')} <input type="date" value={q.to} max={todayIST()} onChange={(e) => setQ((x) => ({ ...x, to: e.target.value || todayIST() }))} /></label>
        <label className="p12-inline">{t('common.campus')} <CampusPicker id="rp-campus" value={q.campusId} onChange={(v) => setQ((x) => ({ ...x, campusId: v }))} allowInstitution institutionLabel={t('common.allCampuses')} /></label>
        {(NEEDS_ACCOUNT.includes(code) || OPTIONAL_ACCOUNT.includes(code)) && chart && (
          <label className="p12-inline">{t('ac2.account')}
            {code === 'LEDGER'
              ? <select value={q.accountId} onChange={(e) => setQ((x) => ({ ...x, accountId: e.target.value }))}><option value="">—</option>{chart.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.isGroup ? `▸ ${a.name}` : `${a.code} · ${a.name}`}</option>)}</select>
              : <AccountSelect id="rp-acc" chart={chart} value={q.accountId} onChange={(v) => setQ((x) => ({ ...x, accountId: v }))} only={(a) => isMoney(a) && (code === 'CASH_BOOK' ? !a.bankAccountId && a.systemKey !== 'BANK' : !!a.bankAccountId || a.systemKey === 'BANK')} placeholder={t('ac2.rep.allOfThem')} />}
          </label>
        )}
        {code === 'LEDGER' && ccs.length > 0 && <label className="p12-inline">{t('ac2.costCentre')} <select value={q.costCentreId} onChange={(e) => setQ((x) => ({ ...x, costCentreId: e.target.value }))}><option value="">{t('ac2.rep.allOfThem')}</option>{ccs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      </div>
      <p className="muted small">{t(`ac2.rep.about.${code}` as MessageKey)}</p>
      {NEEDS_ACCOUNT.includes(code) && !q.accountId ? <EmptyState icon="book" title={t('ac2.rep.chooseAccount')} />
        : loading && !r ? <SkeletonRows rows={8} />
          : err ? <p className="notice"><Icon name="info" /> {err}</p>
            : r ? (
              <>
                <h2 className="section-title">{r.title} <span className="muted small">· {r.subtitle}</span></h2>
                {!r.rows.length ? <EmptyState icon="book" title={t('ac2.rep.empty')} /> : <ReportTable r={r} />}
              </>
            ) : null}
    </>
  );
}
