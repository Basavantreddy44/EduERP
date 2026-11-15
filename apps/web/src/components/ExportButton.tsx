'use client';

import { useEffect, useRef, useState } from 'react';
import { downloadFile, ApiError } from '@/lib/api';
import { Icon } from './Icon';
import { useToast } from './ui';
import { useI18n } from '@/lib/i18n';

/** "Export" with a small menu: Excel (default) or CSV. */
export function ExportButton({ type, label }: { type: string; label?: string }) {
  const toast = useToast();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  async function go(format: 'xlsx' | 'csv') {
    setOpen(false);
    setBusy(true);
    try {
      await downloadFile(`/exports/${type}?format=${format}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('common.exportFailed'), 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="user-menu" ref={box}>
      <button className="btn" aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={() => setOpen((v) => !v)}>
        <Icon name="download" /> {busy ? t('common.preparing') : label ?? t('common.export')}
      </button>
      {open && (
        <div className="dropdown" role="menu">
          <button className="dropdown-item" role="menuitem" onClick={() => go('xlsx')}><Icon name="file" /> Excel (.xlsx)</button>
          <button className="dropdown-item" role="menuitem" onClick={() => go('csv')}><Icon name="file" /> CSV</button>
        </div>
      )}
    </div>
  );
}
