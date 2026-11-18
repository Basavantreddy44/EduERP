'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PERMISSIONS, VEHICLE_DOC_TYPES, VEHICLE_STATUSES } from '@eduerp/shared';
import { api, downloadFile, uploadFile } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { useDay } from '@/components/admissions';
import { ExpiryPill, ExpiryState, SeatBar, fmtVehicleNo } from '@/components/transport';

interface Doc { id: string; docType: string; docNo: string; validFrom: string | null; validTo: string; fileId: string | null; state: ExpiryState; createdAt: string }
interface Vehicle {
  id: string; campusId: string; vehicleNo: string; vehicleType: string; makeModel: string | null; seatingCapacity: number; ownership: string; ownerName: string | null; status: string;
  seatsUsed: number; documents: Doc[]; routes: { id: string; routeNo: string; name: string; status: string }[];
}

/** One vehicle (M6.1): documents in force and their history, renewals, seats and status. */
export default function VehiclePage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const { t } = useI18n();
  const day = useDay();
  const toast = useToast();
  const manage = can(PERMISSIONS.TRANSPORT_MANAGE);
  const [v, setV] = useState<Vehicle | null>(null);
  const [dialog, setDialog] = useState<'doc' | 'edit' | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Vehicle>(`/transport/vehicles/${id}`).then(setV).catch(() => setV(null)); }, [id]);
  useEffect(load, [load]);
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (!v) return <SkeletonRows rows={6} />;
  const current = VEHICLE_DOC_TYPES.map((tp) => ({ type: tp, doc: v.documents.find((d) => d.docType === tp) ?? null }));
  const older = v.documents.filter((d) => current.every((c) => c.doc?.id !== d.id));

  const openDoc = (type: string) => { setForm({ docType: type, docNo: '', validFrom: '', validTo: '' }); setFile(null); setErrors({}); setError(null); setDialog('doc'); };
  const openEdit = () => { setForm({ seatingCapacity: String(v.seatingCapacity), status: v.status, makeModel: v.makeModel ?? '' }); setErrors({}); setError(null); setDialog('edit'); };
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try {
      if (dialog === 'doc') {
        let fileId: string | null = null;
        if (file) fileId = (await uploadFile<{ id: string }>('/files', file, { entityType: 'VEHICLE', entityId: v.id, docType: 'OTHER', campusId: v.campusId })).id;
        await api(`/transport/vehicles/${v.id}/documents`, { method: 'POST', body: JSON.stringify({ docType: form.docType, docNo: form.docNo, validFrom: form.validFrom || null, validTo: form.validTo, fileId }) });
        toast(t('tr.docSaved'));
      } else {
        await api(`/transport/vehicles/${v.id}`, { method: 'PATCH', body: JSON.stringify({ seatingCapacity: Number(form.seatingCapacity), status: form.status, makeModel: form.makeModel.trim() || null }) });
        toast(t('tr.busSaved'));
      }
      setDialog(null); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };

  return (
    <>
      <Link href="/transport" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('tr.title')}</Link>
      <PageHeader
        eyebrow={t(`tr.type.${v.vehicleType}` as MessageKey)}
        title={fmtVehicleNo(v.vehicleNo)}
        description={[v.makeModel, v.ownership === 'HIRED' ? `${t('tr.hired')}${v.ownerName ? ` · ${v.ownerName}` : ''}` : t('tr.own.OWN')].filter(Boolean).join(' · ')}
        actions={manage ? <button type="button" className="btn" onClick={openEdit}><Icon name="edit" /> {t('tr.editBus')}</button> : undefined}
      />
      <div className="tr-facts">
        <div className="card"><span className="muted small">{t('tr.col.seats')}</span><SeatBar used={v.seatsUsed} seats={v.seatingCapacity} /></div>
        <div className="card"><span className="muted small">{t('common.status')}</span><StatusBadge status={v.status} label={t(`tr.vstatus.${v.status}` as MessageKey)} /></div>
        <div className="card"><span className="muted small">{t('tr.col.routes')}</span><span>{v.routes.length ? v.routes.map((r) => <Link key={r.id} href={`/transport/routes/${r.id}`} className="tr-chip">{r.routeNo} · {r.name}</Link>) : <span className="muted">{t('tr.noRoute')}</span>}</span></div>
      </div>

      <h2 className="section-title">{t('tr.documents')}</h2>
      <ul className="tr-docs">
        {current.map(({ type, doc }) => (
          <li key={type} className="card">
            <div className="tr-doc-head"><strong>{t(`tr.doc.${type}` as MessageKey)}</strong><ExpiryPill state={doc?.state ?? 'MISSING'} daysLeft={doc ? Math.round((Date.parse(`${doc.validTo}T00:00:00Z`) - Date.parse(`${new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)}T00:00:00Z`)) / 86_400_000) : null} /></div>
            {doc ? <p className="muted small">{doc.docNo} · {t('tr.validTill', { date: day(doc.validTo) })}</p> : <p className="muted small">{t('tr.notAdded')}</p>}
            <div className="tr-doc-actions">
              {doc?.fileId && <button type="button" className="btn btn-sm btn-ghost" onClick={() => downloadFile(`/files/${doc.fileId}/content`)}><Icon name="download" size={14} /> {t('tr.copy')}</button>}
              {manage && <button type="button" className="btn btn-sm" onClick={() => openDoc(type)}><Icon name={doc ? 'swap' : 'plus'} size={14} /> {doc ? t('tr.renew') : t('tr.add')}</button>}
            </div>
          </li>
        ))}
      </ul>
      {older.length > 0 && (
        <>
          <h3 className="section-title">{t('tr.history')}</h3>
          <div className="table-wrap card">
            <table className="table">
              <thead><tr><th>{t('tr.docType')}</th><th>{t('tr.docNo')}</th><th>{t('tr.validTo')}</th></tr></thead>
              <tbody>{older.map((d) => <tr key={d.id}><td>{t(`tr.doc.${d.docType}` as MessageKey)}</td><td className="mono small">{d.docNo}</td><td>{day(d.validTo)}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}

      <Modal open={dialog === 'doc'} onClose={() => setDialog(null)} title={t(`tr.doc.${form.docType ?? 'RC'}` as MessageKey)} subtitle={t('tr.docSub')} onSubmit={save} submitLabel={t('tr.save')} busy={busy} error={error}>
        <Field id="d-no" label={t('tr.docNo')} error={errors.docNo}><input id="d-no" value={form.docNo ?? ''} onChange={set('docNo')} /></Field>
        <div className="grid-2">
          <Field id="d-from" label={t('tr.validFrom')} error={errors.validFrom}><input id="d-from" type="date" value={form.validFrom ?? ''} onChange={set('validFrom')} /></Field>
          <Field id="d-to" label={t('tr.validTo')} error={errors.validTo}><input id="d-to" type="date" value={form.validTo ?? ''} onChange={set('validTo')} /></Field>
        </div>
        <Field id="d-file" label={t('tr.scan')} hint={t('tr.scanHint')}><input id="d-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
      </Modal>
      <Modal open={dialog === 'edit'} onClose={() => setDialog(null)} title={t('tr.editBus')} onSubmit={save} submitLabel={t('tr.save')} busy={busy} error={error}>
        <div className="grid-2">
          <Field id="e-seats" label={t('tr.seats')} error={errors.seatingCapacity}><input id="e-seats" type="number" min={1} max={120} value={form.seatingCapacity ?? ''} onChange={set('seatingCapacity')} /></Field>
          <Field id="e-status" label={t('common.status')} error={errors.status}>
            <select id="e-status" value={form.status} onChange={set('status')}>{VEHICLE_STATUSES.map((x) => <option key={x} value={x}>{t(`tr.vstatus.${x}` as MessageKey)}</option>)}</select>
          </Field>
        </div>
        <Field id="e-model" label={t('tr.makeModel')} error={errors.makeModel}><input id="e-model" value={form.makeModel ?? ''} onChange={set('makeModel')} /></Field>
      </Modal>
    </>
  );
}
