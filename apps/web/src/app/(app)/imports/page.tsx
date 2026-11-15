'use client';

import { DragEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { IMPORT_MAX_MB, IMPORT_MAX_ROWS, ImportType } from '@eduerp/shared';
import { api, ApiError, downloadFile, newIdempotencyKey, uploadFile } from '@/lib/api';
import { Icon, IconName } from '@/components/Icon';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

interface Job { id: string; entityType: string; fileName: string; status: string; totalRows: number; validRows: number; errorRows: number; importedRows: number; createdAt: string; skippedRows?: number }
interface Row { rowNo: number; data: Record<string, string>; errors: string[] | null; status: string }

const ICON: Record<string, IconName> = { DEPARTMENTS: 'department', HOLIDAYS: 'holiday', USERS: 'users', STUDENTS: 'cap' };
const LINK: Record<string, string> = { DEPARTMENTS: '/departments', HOLIDAYS: '/holidays', USERS: '/users', STUDENTS: '/students' };

type Step = { kind: 'choose' } | { kind: 'review'; type: ImportType; job: Job } | { kind: 'done'; type: ImportType; job: Job };

export default function ImportsPage() {
  const toast = useToast();
  const { t } = useI18n();
  const [types, setTypes] = useState<ImportType[] | null>(null);
  const [history, setHistory] = useState<Job[]>([]);
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(() => {
    api<Job[]>('/imports').then(setHistory).catch(() => setHistory([]));
  }, []);
  useEffect(() => {
    api<ImportType[]>('/imports/types').then(setTypes).catch(() => setTypes([]));
    loadHistory();
  }, [loadHistory]);

  async function template(t: ImportType) {
    setBusy(`tpl-${t.type}`);
    try {
      await downloadFile(`/imports/templates/${t.type}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Download failed', 'bad');
    } finally {
      setBusy(null);
    }
  }

  async function upload(t: ImportType, file: File) {
    setError(null);
    if (file.size > IMPORT_MAX_MB * 1024 * 1024) return setError(`Files must be ${IMPORT_MAX_MB} MB or smaller.`);
    setBusy(`up-${t.type}`);
    try {
      const job = await uploadFile<Job>(`/imports/${t.type}`, file);
      setStep({ kind: 'review', type: t, job });
      loadHistory();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Upload failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={t('nav.setup')}
        title={t('nav.imports')}
        description={`${t('imports.desc')} (≤ ${IMPORT_MAX_ROWS.toLocaleString('en-IN')})`}
        actions={step.kind !== 'choose' && <button className="btn" onClick={() => setStep({ kind: 'choose' })}><Icon name="arrowRight" /> Start another import</button>}
      />
      {error && <div className="alert" role="alert"><Icon name="alert" />{error}</div>}

      {step.kind === 'choose' && (
        types === null ? <SkeletonRows /> : types.length === 0 ? (
          <EmptyState icon="upload" title="Nothing to import" text="Your role does not allow bulk imports. Ask your institution admin." />
        ) : (
          <>
            <ol className="how">
              <li><span>1</span>Download the template</li>
              <li><span>2</span>Fill it in Excel</li>
              <li><span>3</span>Upload and check the rows</li>
              <li><span>4</span>Import the good rows</li>
            </ol>
            <div className="import-grid">
              {types.map((t) => <ImportCard key={t.type} t={t} busy={busy} onTemplate={() => template(t)} onFile={(f) => upload(t, f)} />)}
            </div>
          </>
        )
      )}

      {step.kind === 'review' && <Review type={step.type} job={step.job} onCancel={() => { setStep({ kind: 'choose' }); loadHistory(); }} onDone={(job) => { setStep({ kind: 'done', type: step.type, job }); loadHistory(); }} />}

      {step.kind === 'done' && (
        <div className="card done-card">
          <span className="done-icon"><Icon name="check" size={28} strokeWidth={2.4} /></span>
          <h2 className="card-title">{step.job.importedRows} {step.type.label.toLowerCase()} imported</h2>
          <p className="muted">
            From <strong>{step.job.fileName}</strong>.
            {!!step.job.skippedRows && ` ${step.job.skippedRows} row(s) were skipped because the data changed after you uploaded.`}
            {step.job.errorRows > 0 && ` ${step.job.errorRows} row(s) needed fixing and were not imported.`}
            {step.type.type === 'USERS' && ' Each person has been emailed a link to set their password.'}
          </p>
          <div className="done-actions">
            <Link href={LINK[step.type.type] ?? '/dashboard'} className="btn btn-primary">See {step.type.label.toLowerCase()} <Icon name="arrowRight" /></Link>
            {step.job.errorRows > 0 && <button className="btn" onClick={() => downloadFile(`/imports/jobs/${step.job.id}/errors.xlsx`)}><Icon name="download" /> Rows to fix</button>}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <>
          <h3 className="section-title">Recent imports</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Type</th><th>File</th><th className="num">Rows</th><th className="num">Imported</th><th>Status</th></tr></thead>
              <tbody>
                {history.slice(0, 10).map((j) => (
                  <tr key={j.id}>
                    <td className="muted">{new Date(j.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{types?.find((t) => t.type === j.entityType)?.label ?? j.entityType}</td>
                    <td className="strong">{j.fileName}</td>
                    <td className="num">{j.totalRows}</td>
                    <td className="num">{j.status === 'COMMITTED' ? j.importedRows : '—'}</td>
                    <td><StatusBadge status={j.status === 'VALIDATED' ? 'PENDING' : j.status === 'COMMITTED' ? 'ACTIVE' : 'CANCELLED'} label={j.status === 'VALIDATED' ? 'Waiting for review' : j.status === 'COMMITTED' ? 'Imported' : 'Cancelled'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function ImportCard({ t, busy, onTemplate, onFile }: { t: ImportType; busy: string | null; onTemplate: () => void; onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };
  return (
    <article className="card import-card">
      <div className="import-head">
        <span className="choice-icon"><Icon name={ICON[t.type] ?? 'file'} size={20} /></span>
        <div>
          <h2 className="import-title">{t.label}</h2>
          <p className="muted">{t.description}</p>
        </div>
      </div>
      <p className="import-cols"><span className="muted">Columns:</span> {t.columns.map((c) => <span key={c.key} className={`col-chip ${c.required ? 'req' : ''}`}>{c.header}{c.required && ' *'}</span>)}</p>
      <div
        className={`dropzone ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        aria-label={`Upload ${t.label} file`}
      >
        <Icon name="upload" size={22} />
        <span>{busy === `up-${t.type}` ? 'Checking your file…' : <>Drop your file here or <u>browse</u></>}</span>
        <small className="muted">Excel (.xlsx) or CSV · up to {IMPORT_MAX_MB} MB</small>
        <input ref={input} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
      </div>
      <button className="btn btn-gold" onClick={onTemplate} disabled={busy === `tpl-${t.type}`}><Icon name="download" /> {busy === `tpl-${t.type}` ? 'Preparing…' : 'Download template'}</button>
    </article>
  );
}

function Review({ type, job, onCancel, onDone }: { type: ImportType; job: Job; onCancel: () => void; onDone: (j: Job) => void }) {
  const toast = useToast();
  const [tab, setTab] = useState<'INVALID' | 'VALID'>(job.errorRows ? 'INVALID' : 'VALID');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newIdempotencyKey);

  useEffect(() => {
    setRows(null);
    api<{ items: Row[] }>(`/imports/jobs/${job.id}/rows?status=${tab}&pageSize=200`).then((r) => setRows(r.items)).catch(() => setRows([]));
  }, [job.id, tab]);

  async function commit() {
    setBusy(true);
    try {
      const done = await api<Job>(`/imports/jobs/${job.id}/commit`, { method: 'POST', headers: { 'Idempotency-Key': key } });
      toast(`${done.importedRows} ${type.label.toLowerCase()} imported`);
      onDone(done);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Import failed', 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    await api(`/imports/jobs/${job.id}/cancel`, { method: 'POST' }).catch(() => undefined);
    onCancel();
  }

  return (
    <>
      <div className="stats">
        <div className="stat"><span className="stat-icon"><Icon name="file" size={20} /></span><span className="stat-text"><span className="stat-label">Rows in {job.fileName}</span><span className="stat-value">{job.totalRows}</span></span></div>
        <div className="stat stat-ok"><span className="stat-icon"><Icon name="check" size={20} /></span><span className="stat-text"><span className="stat-label">Ready to import</span><span className="stat-value">{job.validRows}</span></span></div>
        <div className={`stat ${job.errorRows ? 'stat-bad' : ''}`}><span className="stat-icon"><Icon name="alert" size={20} /></span><span className="stat-text"><span className="stat-label">Need fixing</span><span className="stat-value">{job.errorRows}</span></span></div>
      </div>

      <div className="review-bar">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'INVALID'} className={tab === 'INVALID' ? 'on' : ''} onClick={() => setTab('INVALID')}>Need fixing ({job.errorRows})</button>
          <button role="tab" aria-selected={tab === 'VALID'} className={tab === 'VALID' ? 'on' : ''} onClick={() => setTab('VALID')}>Ready ({job.validRows})</button>
        </div>
        {job.errorRows > 0 && <button className="btn btn-sm" onClick={() => downloadFile(`/imports/jobs/${job.id}/errors.xlsx`)}><Icon name="download" size={16} /> Download rows to fix</button>}
      </div>

      {rows === null ? <SkeletonRows rows={3} /> : rows.length === 0 ? (
        <div className="empty-state slim"><p>{tab === 'INVALID' ? 'No problems found — every row is ready.' : 'No rows are ready yet. Fix the file and upload it again.'}</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th className="num">Row</th>{type.columns.map((c) => <th key={c.key}>{c.header}</th>)}{tab === 'INVALID' && <th>What to fix</th>}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rowNo} className={r.errors ? 'row-error' : ''}>
                  <td className="num muted">{r.rowNo}</td>
                  {type.columns.map((c) => <td key={c.key}>{r.data[c.key] || <span className="muted">—</span>}</td>)}
                  {tab === 'INVALID' && <td className="fix-cell"><ul>{(r.errors ?? []).map((e, i) => <li key={i}>{e}</li>)}</ul></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="review-actions">
        <button className="btn btn-ghost" onClick={cancel} disabled={busy}>Cancel this import</button>
        <button className="btn btn-primary" onClick={commit} disabled={busy || job.validRows === 0}>
          {busy ? 'Importing…' : job.validRows === 0 ? 'Nothing to import' : <>Import {job.validRows} row{job.validRows === 1 ? '' : 's'}{job.errorRows ? `, skip ${job.errorRows}` : ''} <Icon name="arrowRight" /></>}
        </button>
      </div>
    </>
  );
}
