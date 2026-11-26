'use client';

import { useEffect, useState } from 'react';
import { formatINR } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import { Icon } from './Icon';
import { EmptyState, SkeletonRows } from './ui';
import { useDay } from './admissions';
import { paiseOf } from './fees';

interface Carried {
  total: string; students: number;
  byYear: { yearLabel: string; balance: string }[];
  byClass: { programName: string | null; levelName: string | null; students: number; balance: string }[];
  items: { studentId: string; admissionNo: string; name: string; levelName: string | null; sectionName: string | null; invoiceNo: string; description: string; yearLabel: string; dueDate: string; balance: string; isOpening: boolean }[];
}
interface Advances {
  total: string; students: number; accountBalance: string | null; matchesAccounts: boolean | null;
  items: { studentId: string; admissionNo: string; name: string; levelName: string | null; sectionName: string | null; programName: string | null; credit: string }[];
}

const inr = (v: string) => formatINR(paiseOf(v), { paise: paiseOf(v) % 100 !== 0 });

function Total({ label, value, students }: { label: string; value: string; students: number }) {
  const { t } = useI18n();
  return (
    <section className="card report-total">
      <span className="muted small">{label}</span>
      <strong>{inr(value)}</strong>
      <span className="muted small">{t('fee.due.students', { n: students })}</span>
    </section>
  );
}

function Summary({ title, head, count, rows, total }: { title: string; head: string; count: string; rows: [string, number, string][]; total: string }) {
  const { t } = useI18n();
  return (
    <section className="card">
      <h2 className="card-title">{title}</h2>
      <table className="report-table">
        <caption className="sr-only">{title}</caption>
        <thead><tr><th scope="col">{head}</th><th scope="col" className="num">{count}</th><th scope="col" className="num">{t('fee.acct.amount')}</th></tr></thead>
        <tbody>{rows.map(([k, n, a]) => <tr key={k}><td>{k}</td><td className="num muted">{n}</td><td className="num">{inr(a)}</td></tr>)}</tbody>
        <tfoot><tr><th scope="row">{t('fee.struct.total')}</th><td className="num">{rows.reduce((s, r) => s + r[1], 0)}</td><td className="num">{inr(total)}</td></tr></tfoot>
      </table>
    </section>
  );
}

/** Phase 23: open bills from earlier academic years and opening dues. */
export function CarriedReport({ campusId }: { campusId: string | null }) {
  const { t } = useI18n();
  const day = useDay();
  const [r, setR] = useState<Carried | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setR(null); setError(null);
    api<Carried>('/fees/reports/carried-dues' + (campusId ? '?campusId=' + campusId : '')).then(setR).catch((e) => setError(apiErrors(e).message));
  }, [campusId]);
  if (error) return <div className="alert" role="alert"><Icon name="alert" />{error}</div>;
  if (!r) return <SkeletonRows rows={5} />;
  if (!r.items.length) return <EmptyState icon="check" title={t('cr.rep.noneCarried')} text={t('cr.rep.noneCarriedText')} />;
  return (
    <>
      <div className="report-grid">
        <Total label={t('cr.rep.carriedTotal')} value={r.total} students={r.students} />
        <Summary title={t('cr.rep.byYear')} head={t('cr.rep.year')} count={t('cr.rep.bills')} total={r.total}
          rows={r.byYear.map((y) => [y.yearLabel, r.items.filter((i) => i.yearLabel === y.yearLabel).length, y.balance])} />
        <Summary title={t('cr.rep.byClass')} head={t('stu.col.class')} count={t('fee.rep.withDues')} total={r.total}
          rows={r.byClass.map((c) => [c.levelName ? (c.programName ? c.programName + ' · ' : '') + c.levelName : t('fee.rep.noClass'), c.students, c.balance])} />
      </div>
      <section className="card">
        <h2 className="card-title">{t('cr.rep.list')}</h2>
        <div className="table-wrap">
          <table className="report-table">
            <caption className="sr-only">{t('cr.rep.list')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('stu.col.student')}</th><th scope="col" className="hide-sm">{t('stu.col.class')}</th><th scope="col">{t('fee.acct.bill')}</th>
                <th scope="col">{t('cr.rep.year')}</th><th scope="col" className="hide-sm">{t('fee.acct.due')}</th><th scope="col" className="num">{t('fee.acct.balance')}</th>
              </tr>
            </thead>
            <tbody>
              {r.items.map((i) => (
                <tr key={i.invoiceNo}>
                  <td><a href={'/students/' + i.studentId}><strong>{i.name}</strong></a><span className="sub-line muted mono">{i.admissionNo}</span></td>
                  <td className="hide-sm">{i.levelName ? i.levelName + ' – ' + i.sectionName : <span className="muted">—</span>}</td>
                  <td>{i.description}<span className="sub-line muted mono">{i.invoiceNo}</span></td>
                  <td><span className="chip chip-sm chip-gold">{i.yearLabel}</span>{i.isOpening && <span className="sub-line small muted">{t('cr.openingDue')}</span>}</td>
                  <td className="hide-sm">{day(i.dueDate)}</td>
                  <td className="num strong">{inr(i.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/** Phase 23: students holding credit, checked against the "Fees received in advance" account. */
export function AdvancesReport({ campusId }: { campusId: string | null }) {
  const { t } = useI18n();
  const [r, setR] = useState<Advances | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setR(null); setError(null);
    api<Advances>('/fees/reports/advances' + (campusId ? '?campusId=' + campusId : '')).then(setR).catch((e) => setError(apiErrors(e).message));
  }, [campusId]);
  if (error) return <div className="alert" role="alert"><Icon name="alert" />{error}</div>;
  if (!r) return <SkeletonRows rows={5} />;
  return (
    <>
      <div className="report-grid">
        <Total label={t('cr.rep.advTotal')} value={r.total} students={r.students} />
      </div>
      {r.matchesAccounts !== null && (r.matchesAccounts
        ? <p className="match ok"><Icon name="check" size={15} /> {t('fee.rep.matches')}</p>
        : <p className="match bad" role="alert"><Icon name="alert" size={15} /> {t('fee.rep.mismatch', { v: inr(r.accountBalance ?? '0') })}</p>)}
      {!r.items.length ? <EmptyState icon="check" title={t('cr.rep.noneAdv')} text={t('cr.rep.noneAdvText')} /> : (
        <section className="card">
          <h2 className="card-title">{t('cr.rep.advances')}</h2>
          <div className="table-wrap">
            <table className="report-table">
              <caption className="sr-only">{t('cr.rep.advances')}</caption>
              <thead><tr><th scope="col">{t('stu.col.student')}</th><th scope="col">{t('stu.col.class')}</th><th scope="col" className="num">{t('cr.balance')}</th></tr></thead>
              <tbody>
                {r.items.map((i) => (
                  <tr key={i.studentId}>
                    <td><a href={'/students/' + i.studentId}><strong>{i.name}</strong></a><span className="sub-line muted mono">{i.admissionNo}</span></td>
                    <td>{i.levelName ? i.levelName + ' – ' + i.sectionName : <span className="muted">—</span>}</td>
                    <td className={'num strong' + (paiseOf(i.credit) < 0 ? ' overdue-text' : '')}>{inr(i.credit)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><th scope="row" colSpan={2}>{t('fee.struct.total')}</th><td className="num">{inr(r.total)}</td></tr></tfoot>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
