'use client';

import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Crest } from './DocLogo';

/** Exams & report cards (Phase 9) shared pieces. */

export interface CompMark { marks: number | null; max: number; code: string }
export interface Card {
  school: string; campus: string; year: string; term: string; termCode: string; version: number; status: string; publishedAt: string | null;
  student: { id: string; name: string; admissionNo: string; rollNo: string | null; dateOfBirth: string | null; parent: string | null };
  className: string;
  columns: { code: string; name: string; weight: number }[];
  scale: { grade: string; minPercent: number; description: string | null }[];
  subjects: { name: string; nameLocal: string | null; components: Record<string, CompMark | number>; percent: number; grade: string | null; isPass: boolean }[];
  total: number; maxTotal: number; percentage: number; grade: string | null; rank: number | null; attendance: number | null;
  remarks: string | null; resultStatus: string; passPercent: number;
  coScholastic: { area: string; grades: (string | null)[] }[]; coTerms: string[];
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ''));

/** One component cell: "18/20", "AB" (absent), "EX" (exempt), "MP" (malpractice), or a term %. */
export function MarkCell({ v }: { v: CompMark | number | undefined }) {
  const { t } = useI18n();
  if (v === undefined) return <span className="muted">—</span>;
  if (typeof v === 'number') return <>{fmt(v)}</>;
  if (v.code !== 'PRESENT') return <abbr title={t(`ex.code.${v.code}` as MessageKey)}>{t(`ex.codeShort.${v.code}` as MessageKey)}</abbr>;
  return <>{fmt(v.marks ?? 0)}<span className="muted">/{fmt(v.max)}</span></>;
}

/**
 * The report card: school and student, a line per subject with every component, the total,
 * percentage, grade, rank, attendance and remarks; co-scholastic grades and the grade key.
 * Prints on one A4 page (the app's menus are hidden when printing).
 */
export function ReportCard({ c }: { c: Card }) {
  const { t, locale } = useI18n();
  const isFinal = c.termCode === 'FINAL';
  const date = (d: string | null) => (d ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: d.length === 10 ? 'UTC' : 'Asia/Kolkata' }) : '—');
  return (
    <article className="rc" aria-label={t('ex.card.label', { name: c.student.name })}>
      <header className="rc-head">
        <Crest name={c.school} />
        <div>
          <h2 className="rc-school">{c.school}</h2>
          <p className="rc-sub">{c.campus} · {t('ex.card.title')} · {c.year}</p>
        </div>
        <p className="rc-term"><span>{c.term}</span>{c.status !== 'PUBLISHED' && <span className="pill pill-warn">{c.status === 'DRAFT' ? t('ex.card.draft') : t('ex.card.old', { v: c.version })}</span>}</p>
      </header>
      <dl className="rc-student">
        <div><dt>{t('ex.card.student')}</dt><dd>{c.student.name}</dd></div>
        <div><dt>{t('ex.card.class')}</dt><dd>{c.className}</dd></div>
        <div><dt>{t('ex.card.admission')}</dt><dd>{c.student.admissionNo}{c.student.rollNo ? ` · ${t('ac.hw.roll', { n: c.student.rollNo })}` : ''}</dd></div>
        <div><dt>{t('ex.card.dob')}</dt><dd>{date(c.student.dateOfBirth)}</dd></div>
        {c.student.parent && <div><dt>{t('ex.card.parent')}</dt><dd>{c.student.parent}</dd></div>}
      </dl>
      <div className="table-wrap" role="region" aria-label={t('ex.card.marks')} tabIndex={0}>
        <table className="table rc-table">
          <thead>
            <tr>
              <th scope="col">{t('ac.subject')}</th>
              {c.columns.map((col) => <th key={col.code} scope="col" className="num"><abbr title={col.name}>{col.code}</abbr><span className="rc-weight">{fmt(col.weight)}%</span></th>)}
              <th scope="col" className="num">{t('ex.card.percent')}</th>
              <th scope="col">{t('ex.card.grade')}</th>
            </tr>
          </thead>
          <tbody>
            {c.subjects.map((s) => (
              <tr key={s.name}>
                <th scope="row">{s.name}{locale === 'kn' && s.nameLocal ? <span className="sub-line muted" lang="kn">{s.nameLocal}</span> : null}</th>
                {c.columns.map((col) => <td key={col.code} className="num"><MarkCell v={s.components[col.code]} /></td>)}
                <td className="num"><strong>{fmt(s.percent)}</strong></td>
                <td><span className={`rc-grade${s.isPass ? '' : ' fail'}`}>{s.grade ?? '—'}</span>{!s.isPass && <span className="sr-only"> {t('ex.card.notPassed')}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="rc-summary">
        <div><dt>{t('ex.card.total')}</dt><dd>{fmt(c.total)} / {fmt(c.maxTotal)}</dd></div>
        <div><dt>{t('ex.card.percent')}</dt><dd>{fmt(c.percentage)}%</dd></div>
        <div><dt>{t('ex.card.grade')}</dt><dd>{c.grade ?? '—'}</dd></div>
        <div><dt>{t('ex.card.rank')}</dt><dd>{c.rank ?? '—'}</dd></div>
        <div><dt>{t('ex.card.attendance')}</dt><dd>{c.attendance === null ? '—' : `${fmt(c.attendance)}%`}</dd></div>
        <div className={`rc-result ${c.resultStatus === 'PASS' ? 'pass' : 'fail'}`}><dt>{t('ex.card.result')}</dt><dd>{t(`ex.status.${c.resultStatus}` as MessageKey)}</dd></div>
      </dl>
      {c.coScholastic.length > 0 && (
        <table className="table rc-co">
          <caption>{t('ex.card.co')}</caption>
          <thead><tr><th scope="col">{t('ex.card.area')}</th>{c.coTerms.map((x) => <th key={x} scope="col">{x}</th>)}</tr></thead>
          <tbody>{c.coScholastic.map((a) => <tr key={a.area}><th scope="row">{a.area}</th>{a.grades.map((g, i) => <td key={i}>{g ?? '—'}</td>)}</tr>)}</tbody>
        </table>
      )}
      <section className="rc-remarks"><h3>{t('ex.card.remarks')}</h3><p>{c.remarks || '—'}</p></section>
      <footer className="rc-foot">
        <p className="rc-key"><strong>{t('ex.card.key')}:</strong> {c.scale.map((s, i) => `${s.grade} ${fmt(s.minPercent)}${i === 0 ? '–100' : `–${fmt(c.scale[i - 1].minPercent)}`}%`).join(' · ')}{isFinal ? '' : ''}</p>
        <div className="rc-signs"><span>{t('ex.card.classTeacher')}</span><span>{t('ex.card.principal')}</span><span>{t('ex.card.parentSign')}</span></div>
        {c.publishedAt && <p className="muted small">{t('ex.card.published', { date: date(c.publishedAt) })}</p>}
      </footer>
    </article>
  );
}
