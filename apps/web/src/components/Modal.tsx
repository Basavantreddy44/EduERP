'use client';

import { FormEvent, ReactNode, useEffect, useRef } from 'react';
import { Icon } from './Icon';
import { useI18n } from '@/lib/i18n';

/**
 * Form dialog on the native <dialog> (focus trap, Esc to close, backdrop). The parent controls `open`.
 * Children are the fields; the footer has Cancel + the primary action.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  onSubmit,
  submitLabel,
  busy = false,
  error,
  danger = false,
  wide = false,
  hideCancel = false,
  submitDisabled = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  onSubmit: (e: FormEvent) => void;
  submitLabel?: string;
  busy?: boolean;
  error?: string | null;
  danger?: boolean;
  wide?: boolean;
  /** Read-only views: only the primary (Close) button. */
  hideCancel?: boolean;
  /** The action is not allowed right now (the reason is shown in the dialog). */
  submitDisabled?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useI18n();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="modal-title" className={wide ? 'wide' : ''}>
      <form className="card" onSubmit={(e) => { e.preventDefault(); onSubmit(e); }} noValidate>
        <div className="modal-head">
          <div>
            <h2 id="modal-title" className="dialog-title">{title}</h2>
            {subtitle && <p className="dialog-sub">{subtitle}</p>}
          </div>
          <button type="button" className="btn btn-ghost icon-btn" aria-label={t('common.close')} onClick={onClose}><Icon name="x" /></button>
        </div>
        {error && <div className="alert" role="alert"><Icon name="alert" />{error}</div>}
        {children}
        <div className="dialog-actions">
          {!hideCancel && <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>}
          <button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy || submitDisabled}>
            {busy ? t('common.saving') : submitLabel ?? t('common.save')}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** Small labelled field wrapper with error text. */
export function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="err">{error}</span>}
    </div>
  );
}
