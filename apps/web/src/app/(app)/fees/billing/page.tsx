'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PERMISSIONS, formatINR } from '@eduerp/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { apiErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { todayIST, useDay } from '@/components/admissions';
import { paiseOf, useFeeOptions } from '@/components/fees';

interface Preview {
  students: number; alreadyBilled: number; withoutFees: number; grossAmount: string;
  classes: { programLevelId: string; className: string; programName: string; students: number; amount: string; alreadyBilled: number }[];
}
interface Run { id: string; instalmentNo: number; invoiceDate: string; billedCount: number; skippedCount: number; totalAmount: string; createdAt: string; programLevelId: string | null; academicYear: { name: string } }
interface StructureLite { instalments: { instalmentNo: number; name: string; dueDate: string }[] }

export default function BillingPage() {
  const { can, campusId } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const day = useDay();
  const { opts } = useFeeOptions();
  const canBill = can(PERMISSIONS.FEE_BILL);
  const [yearId, setYearId] = useState('');
  const [instNo, setInstNo] = useState(1);
  const [levelId, setLevelId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayIST());
  const [insts, setInsts] = useState<{ no: number; name: string; dueDate: string }[] | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (opts && !yearId) setYearId(opts.years.find((y) => y.isCurrent)?.id ?? opts.years[0]?.id ?? '');
  }, [opts, yearId]);

  // Instalments offered: those of the year's active structures (name of the first seen).
  useEffect(() => {
    if (!yearId) return;
    setInsts(null);
    api<StructureLite[]>(`/fees/structures?academicYearId=${yearId}&status=ACTIVE${campusId ? `&campusId=${campusId}` : ''}`).then((list) => {
      const m = new Map<number, { no: number; name: string; dueDate: string }>();
      for (const s of list) for (const i of s.instalments) if (!m.has(i.instalmentNo)) m.set(i.instalmentNo, { no: i.instalmentNo, name: i.name, dueDate: i.dueDate });
      const arr = [...m.values()].sort((a, b) => a.no - b.no);
      setInsts(arr);
      if (arr.length && !arr.some((i) => i.no === instNo)) setInstNo(arr[0].no);
    }).catch(() => setInsts([]));
  }, [yearId, campusId]); // eslint-disable-line react-hooks/exhaustive-deps

  const body = useMemo(() => ({ academicYearId: yearId, instalmentNo: instNo, campusId: campusId || null, programLevelId: levelId || null, invoiceDate }), [yearId, instNo, campusId, levelId, invoiceDate]);
  const loadPreview = useCallback(() => {
    if (!yearId || !insts?.length) return;
    setPreview(null);
    api<Preview>('/fees/billing/preview', { method: 'POST', body: JSON.stringify(body) }).then(setPreview).catch(() => setPreview(null));
  }, [body, yearId, insts]);
  useEffect(loadPreview, [loadPreview]);
  const loadRuns = useCallback(() => { if (yearId) api<Run[]>(`/fees/billing/runs?academicYearId=${yearId}`).then(setRuns).catch(() => setRuns([])); }, [yearId]);
  useEffect(loadRuns, [loadRuns]);

  async function create() {
    setBusy(true); setError(null);
    try {
      const r = await api<Run & { alreadyBilled: number }>('/fees/billing/runs', { method: 'POST', body: JSON.stringify(body) });
      toast(r.billedCount ? t('fee.bill.done', { n: r.billedCount, total: formatINR(paiseOf(r.totalAmount)) }) : t('fee.bill.nothing'));
      setConfirm(false);
      loadPreview(); loadRuns();
    } catch (e) { setError(apiErrors(e).message); } finally { setBusy(false); }
  }

  const programs = (opts?.programs ?? []).filter((p) => !campusId || p.campusId === campusId);
  const levelName = (id: string | null) => (id ? programs.flatMap((p) => p.levels).find((l) => l.id === id)?.name ?? '' : t('stu.allClasses'));
  const inst = insts?.find((i) => i.no === instNo);

  return (
    <>
      <PageHeader eyebrow={t('nav.fees')} title={t('fee.bill.title')} description={t('fee.bill.desc')} />
      {!opts || insts === null ? <SkeletonRows rows={5} /> : insts.length === 0 ? (
        <EmptyState icon="layers" title={t('fee.bill.noStructTitle')} text={t('fee.bill.noStructText')} action={<Link className="btn btn-primary" href="/fees/setup"><Icon name="rupee" /> {t('fee.setup.title')}</Link>} />
      ) : (
        <>
          <section className="card bill-card">
            <div className="bill-filters">
              <label className="filter"><span>{t('adm.year')}</span>
                <select value={yearId} onChange={(e) => setYearId(e.target.value)}>{opts.years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</select>
              </label>
              <label className="filter"><span>{t('fee.bill.instalment')}</span>
                <select value={instNo} onChange={(e) => setInstNo(Number(e.target.value))}>{insts.map((i) => <option key={i.no} value={i.no}>{i.no} · {i.name}</option>)}</select>
              </label>
              <label className="filter"><span>{t('stu.col.class')}</span>
                <select value={levelId} onChange={(e) => setLevelId(e.target.value)}>
                  <option value="">{t('stu.allClasses')}</option>
                  {programs.map((p) => <optgroup key={p.id} label={p.name}>{p.levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</optgroup>)}
                </select>
              </label>
              <label className="filter"><span>{t('fee.bill.date')}</span>
                <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
              </label>
            </div>
            {inst && <p className="muted small bill-due"><Icon name="calendar" size={14} /> {t('fee.bill.dueFromStructure', { date: day(inst.dueDate) })}</p>}

            {!preview ? <SkeletonRows rows={3} /> : (
              <>
                <div className="fee-tiles">
                  <div className="fee-tile"><span>{t('fee.bill.toBill')}</span><strong>{preview.students}</strong></div>
                  <div className="fee-tile"><span>{t('fee.bill.amount')}</span><strong>{formatINR(paiseOf(preview.grossAmount))}</strong><em className="muted">{t('fee.bill.beforeConc')}</em></div>
                  <div className="fee-tile"><span>{t('fee.bill.already')}</span><strong>{preview.alreadyBilled}</strong></div>
                  <div className={`fee-tile ${preview.withoutFees ? 'due has' : ''}`}><span>{t('fee.bill.withoutFees')}</span><strong>{preview.withoutFees}</strong>{preview.withoutFees > 0 && <em><Icon name="alert" size={13} /> {t('fee.bill.withoutFeesHint')}</em>}</div>
                </div>
                {preview.classes.length > 0 && (
                  <div className="table-wrap">
                    <table>
                      <caption className="sr-only">{t('fee.bill.byClass')}</caption>
                      <thead><tr><th scope="col">{t('stu.col.class')}</th><th scope="col" className="num">{t('fee.bill.toBill')}</th><th scope="col" className="num">{t('fee.bill.amount')}</th><th scope="col" className="num">{t('fee.bill.already')}</th></tr></thead>
                      <tbody>
                        {preview.classes.map((c) => (
                          <tr key={c.programLevelId}><td><strong>{c.className}</strong><span className="sub-line muted">{c.programName}</span></td><td className="num">{c.students}</td><td className="num strong">{formatINR(paiseOf(c.amount))}</td><td className="num muted">{c.alreadyBilled}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {canBill && (
                  <div className="action-row">
                    <span className="muted small">{preview.students ? t('fee.bill.safe') : t('fee.bill.allDone')}</span>
                    <span className="action-bar-spacer" />
                    <button type="button" className="btn btn-primary" disabled={!preview.students} onClick={() => { setError(null); setConfirm(true); }}><Icon name="receipt" size={16} /> {t('fee.bill.create', { n: preview.students })}</button>
                  </div>
                )}
              </>
            )}
          </section>

          <h2 className="section-title">{t('fee.bill.history')}</h2>
          {runs === null ? <SkeletonRows rows={2} /> : runs.length === 0 ? <p className="muted small">{t('fee.bill.noRuns')}</p> : (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">{t('fee.bill.history')}</caption>
                <thead><tr><th scope="col">{t('common.date')}</th><th scope="col">{t('fee.bill.instalment')}</th><th scope="col">{t('stu.col.class')}</th><th scope="col" className="num">{t('fee.bill.billed')}</th><th scope="col" className="num">{t('fee.bill.netTotal')}</th></tr></thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td>{day(r.invoiceDate)}<span className="sub-line muted small">{new Date(r.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span></td>
                      <td>{r.instalmentNo} · {r.academicYear.name}</td>
                      <td>{levelName(r.programLevelId)}</td>
                      <td className="num">{r.billedCount}{r.skippedCount > 0 && <span className="sub-line muted small">{t('fee.bill.skipped', { n: r.skippedCount })}</span>}</td>
                      <td className="num strong">{formatINR(paiseOf(r.totalAmount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {confirm && preview && (
        <Modal open onClose={() => setConfirm(false)} title={t('fee.bill.confirmTitle')} subtitle={`${inst?.name ?? instNo} · ${levelName(levelId || null)}`} submitLabel={t('fee.bill.create', { n: preview.students })} busy={busy} error={error}
          onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <p>{t('fee.bill.confirmText', { n: preview.students, total: formatINR(paiseOf(preview.grossAmount)), date: day(invoiceDate) })}</p>
          <p className="note-info"><Icon name="info" size={15} /> {t('fee.bill.confirmNote')}</p>
        </Modal>
      )}
    </>
  );
}
