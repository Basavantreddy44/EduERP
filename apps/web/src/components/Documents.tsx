'use client';

import { useCallback, useEffect, useState } from 'react';
import { FILE_DOC_TYPES, PERMISSIONS } from '@eduerp/shared';
import { ApiError, api, downloadFile, uploadFile } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from './Icon';
import { useToast } from './ui';

interface Doc { id: string; docType: string; fileName: string; sizeBytes: number; createdAt: string }
type Source = { entityType: 'APPLICATION' | 'STUDENT'; entityId: string; label?: string };

const DOC_TYPES = FILE_DOC_TYPES.filter((d) => d !== 'LOGO');

/**
 * Documents attached to a record (Files service). Lists one or more sources — e.g. a student's own
 * files and those from the admission application — and uploads to the first one when allowed.
 */
export function Documents({ sources, campusId, canAttach, title }: { sources: Source[]; campusId: string; canAttach: boolean; title?: string }) {
  const { can } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const canRead = can(PERMISSIONS.FILES_FILE_READ);
  const canUpload = canAttach && can(PERMISSIONS.FILES_FILE_UPLOAD);
  const [docs, setDocs] = useState<(Doc & { from?: string })[] | null>(null);
  const [docType, setDocType] = useState<string>('BIRTH_CERT');
  const [uploading, setUploading] = useState(false);
  const key = sources.map((s) => `${s.entityType}:${s.entityId}`).join('|');

  const load = useCallback(() => {
    if (!canRead) return;
    Promise.all(sources.map((s) => api<Doc[]>(`/files?entityType=${s.entityType}&entityId=${s.entityId}`).then((d) => d.map((x) => ({ ...x, from: s.label }))).catch(() => [])))
      .then((all) => setDocs(all.flat()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, canRead]);
  useEffect(load, [load]);

  if (!canRead) return null;

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      await uploadFile('/files', file, { entityType: sources[0].entityType, entityId: sources[0].entityId, docType, campusId });
      toast(t('app.docs.uploaded', { name: file.name }));
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Upload failed', 'bad');
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <h3 className="module-group-name">{title ?? t('app.docs.title')} · {docs?.length ?? 0}</h3>
      {docs && docs.length > 0 && (
        <ul className="doc-list">
          {docs.map((d) => (
            <li key={d.id}>
              <Icon name="file" size={16} />
              <span>
                <strong>{t(`doc.${d.docType}` as MessageKey)}</strong>
                <span className="sub-line muted">{d.fileName} · {Math.max(1, Math.round(d.sizeBytes / 1024))} KB{d.from ? ` · ${d.from}` : ''}</span>
              </span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => downloadFile(`/files/${d.id}/content`).catch(() => toast(t('app.docs.openFailed'), 'bad'))}>
                <Icon name="download" size={15} /> {t('common.open')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {docs && docs.length === 0 && <p className="muted small">{t('app.docs.none')}</p>}
      {canUpload && (
        <div className="doc-upload">
          <select aria-label={t('app.docs.type')} value={docType} onChange={(e) => setDocType(e.target.value)}>
            {DOC_TYPES.map((d) => <option key={d} value={d}>{t(`doc.${d}` as MessageKey)}</option>)}
          </select>
          <label className={`btn btn-sm ${uploading ? 'disabled' : ''}`}>
            <Icon name="upload" size={15} /> {uploading ? t('common.saving') : t('app.docs.upload')}
            <input type="file" className="sr-only" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={uploading} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <span className="muted small">{t('app.docs.hint')}</span>
        </div>
      )}
    </>
  );
}
