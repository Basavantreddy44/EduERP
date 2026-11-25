'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { bmiOf, campEntriesSchema } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { useDay } from '@/components/admissions';

interface Entry { heightCm: number | null; weightKg: number | null; bmi: number | null; vision: string | null; dental: string | null; skin: string | null; haemoglobin: number | null; findings: string | null; referred: boolean }
interface SheetRow { studentId: string; name: string; admissionNo: string; gender: string; entry: Entry | null }
interface Camp {
  id: string; campusId: string; campus: string; campDate: string; title: string; conductedBy: string | null; notes: string | null; status: string; canEdit: boolean;
  summary: { students: number; screened: number; referred: number; notScreened: number };
  classes: { id: string; name: string; students: number; screened: number }[];
  referredList: { studentId: string; name: string; admissionNo: string; findings: string }[];
  sheet: SheetRow[] | null;
}
type Draft = { heightCm: string; weightKg: string; vision: string; dental: string; skin: string; haemoglobin: string; findings: string; referred: boolean };
const toDraft = (e: Entry | null): Draft => ({
  heightCm: e?.heightCm?.toString() ?? '', weightKg: e?.weightKg?.toString() ?? '', vision: e?.vision ?? '', dental: e?.dental ?? '', skin: e?.skin ?? '',
  haemoglobin: e?.haemoglobin?.toString() ?? '', findings: e?.findings && e.findings !== 'Screened at the camp' ? e.findings : '', referred: !!e?.referred,
});

/** One check-up camp (Phase 21 R5): summary, classes, and the class sheet to enter each child. */
export default function HealthCampPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const toast = useToast();
  const day = useDay();
  const [camp, setCamp] = useState<Camp | null>(null);
  const [missing, setMissing] = useState(false);
  const [sectionId, setSectionId] = useState('');
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback((sec: string) => {
    api<Camp>(`/health/camps/${id}${sec ? `?sectionId=${sec}` : ''}`).then((c) => {
      setCamp(c);
      setDraft(Object.fromEntries((c.sheet ?? []).map((r) => [r.studentId, toDraft(r.entry)])));
    }).catch(() => setMissing(true));
  }, [id]);
  useEffect(() => { load(sectionId); }, [load, sectionId]);

  const set = (sid: string, k: keyof Draft, v: string | boolean) => setDraft((d) => ({ ...d, [sid]: { ...d[sid], [k]: v } }));

  async function save() {
    if (!camp?.sheet) return;
    const entries = camp.sheet.map((r) => ({ studentId: r.studentId, ...draft[r.studentId] }));
    const parsed = campEntriesSchema.safeParse({ entries });
    if (!parsed.success) {
      const i = parsed.error.issues[0];
      const who = typeof i.path[1] === 'number' ? camp.sheet[i.path[1]]?.name : '';
      return setErr(`${who ? `${who}: ` : ''}${i.message}`);
    }
    setBusy(true);
    try {
      const r = await api<{ saved: number }>(`/health/camps/${id}/entries`, { method: 'PUT', body: JSON.stringify(parsed.data) });
      setErr(null);
      toast(t('hc.savedN', { n: r.saved }));
      load(sectionId);
    } catch (e) {
      setErr(apiErrors(e).message);
    } finally {
      setBusy(false);
    }
  }
  async function setStatus(status: 'OPEN' | 'CLOSED') {
    try {
      await api(`/health/camps/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      toast(status === 'CLOSED' ? t('hc.closedToast') : t('hc.openedToast'));
      load(sectionId);
    } catch (e) {
      toast(apiErrors(e).message ?? t('hc.failed'), 'bad');
    }
  }

  if (missing) return <EmptyState icon="shield" title={t('hc.notFound')} action={<Link href="/health/camps" className="btn">{t('hc.back')}</Link>} />;
  if (!camp) return <SkeletonRows />;
  const s = camp.summary;
  return (
    <>
      <Link href="/health/camps" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('hc.title')}</Link>
      <PageHeader eyebrow={`${camp.campus} · ${day(camp.campDate)}`} title={camp.title} description={camp.conductedBy ? t('hc.byLine', { by: camp.conductedBy }) : undefined}
        actions={<><StatusBadge status={camp.status === 'OPEN' ? 'ACTIVE' : 'CLOSED'} label={camp.status === 'OPEN' ? t('hc.open') : t('hc.closed')} />
          {camp.status === 'OPEN' && camp.canEdit && <button type="button" className="btn" onClick={() => setStatus('CLOSED')}><Icon name="lock" /> {t('hc.close')}</button>}
          {camp.status === 'CLOSED' && <button type="button" className="btn" onClick={() => setStatus('OPEN')}>{t('hc.reopen')}</button>}</>} />
      <div className="stats">
        <div className="stat"><span className="stat-icon"><Icon name="users" size={20} /></span><span className="stat-text"><span className="stat-label">{t('hc.students')}</span><span className="stat-value">{s.students}</span></span></div>
        <div className="stat stat-ok"><span className="stat-icon"><Icon name="check" size={20} /></span><span className="stat-text"><span className="stat-label">{t('hc.screened')}</span><span className="stat-value">{s.screened}</span></span></div>
        <div className={`stat ${s.referred ? 'stat-bad' : ''}`}><span className="stat-icon"><Icon name="alert" size={20} /></span><span className="stat-text"><span className="stat-label">{t('hc.referred')}</span><span className="stat-value">{s.referred}</span></span></div>
        <div className="stat"><span className="stat-icon"><Icon name="clock" size={20} /></span><span className="stat-text"><span className="stat-label">{t('hc.notScreened')}</span><span className="stat-value">{s.notScreened}</span></span></div>
      </div>

      <div className="hc-layout">
        <section className="card" aria-labelledby="hc-classes">
          <h2 id="hc-classes" className="card-title">{t('hc.classes')}</h2>
          {!camp.classes.length ? <p className="muted small">{t('hc.noClasses')}</p> : (
            <ul className="hc-classes">
              {camp.classes.map((c) => (
                <li key={c.id}>
                  <button type="button" className={`hc-class ${sectionId === c.id ? 'on' : ''}`} aria-pressed={sectionId === c.id} onClick={() => setSectionId(c.id)}>
                    <span>{c.name}</span><span className="muted small">{t('hc.done', { n: c.screened, of: c.students })}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {camp.referredList.length > 0 && (
            <>
              <h3 className="section-title">{t('hc.referredList')}</h3>
              <ul className="hd-list">{camp.referredList.map((r) => <li key={r.studentId}><Link href={`/students/${r.studentId}`}><strong>{r.name}</strong></Link> <span className="muted small">{r.admissionNo}</span><span className="small">{r.findings}</span></li>)}</ul>
            </>
          )}
        </section>

        <section className="card hc-sheet-card" aria-labelledby="hc-sheet">
          <h2 id="hc-sheet" className="card-title">{camp.sheet ? camp.classes.find((c) => c.id === sectionId)?.name : t('hc.sheet')}</h2>
          {!camp.sheet ? <p className="muted">{t('hc.pickClass')}</p> : !camp.sheet.length ? <p className="muted">{t('hc.noStudents')}</p> : (
            <>
              <p className="muted small">{camp.canEdit ? t('hc.sheetHint') : camp.status === 'CLOSED' ? t('hc.closedHint') : t('hc.readOnly')}</p>
              <div className="table-wrap" role="region" aria-labelledby="hc-sheet" tabIndex={0}>
                <table className="hc-table">
                  <thead><tr>
                    <th scope="col">{t('hc.child')}</th><th scope="col">{t('hc.height')}</th><th scope="col">{t('hc.weight')}</th><th scope="col">{t('hc.bmi')}</th>
                    <th scope="col">{t('hc.vision')}</th><th scope="col">{t('hc.teeth')}</th><th scope="col">{t('hc.skin')}</th><th scope="col">{t('hc.hb')}</th><th scope="col">{t('hc.findings')}</th><th scope="col">{t('hc.refer')}</th>
                  </tr></thead>
                  <tbody>
                    {camp.sheet.map((r) => {
                      const d = draft[r.studentId] ?? toDraft(null);
                      const bmi = bmiOf(Number(d.heightCm) || null, Number(d.weightKg) || null);
                      const ro = !camp.canEdit;
                      const lbl = (k: string) => `${t(k as never)} — ${r.name}`;
                      return (
                        <tr key={r.studentId}>
                          <th scope="row"><span className="hc-name">{r.name}</span><span className="sub-line muted small">{r.admissionNo}</span></th>
                          <td><input className="hc-num" inputMode="decimal" value={d.heightCm} disabled={ro} aria-label={lbl('hc.height')} onChange={(e) => set(r.studentId, 'heightCm', e.target.value)} /></td>
                          <td><input className="hc-num" inputMode="decimal" value={d.weightKg} disabled={ro} aria-label={lbl('hc.weight')} onChange={(e) => set(r.studentId, 'weightKg', e.target.value)} /></td>
                          <td className="num">{bmi ?? '—'}</td>
                          <td><input className="hc-short" value={d.vision} disabled={ro} aria-label={lbl('hc.vision')} placeholder="6/6" onChange={(e) => set(r.studentId, 'vision', e.target.value)} /></td>
                          <td><input className="hc-text" value={d.dental} disabled={ro} aria-label={lbl('hc.teeth')} onChange={(e) => set(r.studentId, 'dental', e.target.value)} /></td>
                          <td><input className="hc-text" value={d.skin} disabled={ro} aria-label={lbl('hc.skin')} onChange={(e) => set(r.studentId, 'skin', e.target.value)} /></td>
                          <td><input className="hc-num" inputMode="decimal" value={d.haemoglobin} disabled={ro} aria-label={lbl('hc.hb')} onChange={(e) => set(r.studentId, 'haemoglobin', e.target.value)} /></td>
                          <td><input className="hc-text wide" value={d.findings} disabled={ro} aria-label={lbl('hc.findings')} onChange={(e) => set(r.studentId, 'findings', e.target.value)} /></td>
                          <td className="center"><input type="checkbox" checked={d.referred} disabled={ro} aria-label={lbl('hc.refer')} onChange={(e) => set(r.studentId, 'referred', e.target.checked)} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {err && <p className="err" role="alert">{err}</p>}
              {camp.canEdit && <div className="form-actions"><button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy ? t('common.saving') : t('hc.saveSheet')}</button></div>}
            </>
          )}
        </section>
      </div>
    </>
  );
}
