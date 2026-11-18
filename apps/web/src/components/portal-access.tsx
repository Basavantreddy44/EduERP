'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PortalAccessRow } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from './Icon';
import { Field, Modal } from './Modal';
import { StatusBadge, useToast } from './ui';

const TONE: Record<PortalAccessRow['login'], string> = { NONE: 'NONE', INVITED: 'INVITED', ACTIVE: 'ACTIVE' };

/**
 * Student profile → Parents (M5.1): who can use the parent & student app, with invite / resend /
 * remove. Sending the login by SMS needs the SMS provider (DEC-09) — shown as coming soon.
 */
export function AppAccess({ studentId, manage }: { studentId: string; manage: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const [rows, setRows] = useState<PortalAccessRow[] | null>(null);
  const [invite, setInvite] = useState<PortalAccessRow | null>(null);
  const [remove, setRemove] = useState<PortalAccessRow | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();

  const load = useCallback(() => { api<PortalAccessRow[]>(`/students/${studentId}/portal`).then(setRows).catch(() => setRows([])); }, [studentId]);
  useEffect(load, [load]);

  const path = (r: PortalAccessRow) => `/students/${studentId}/portal/${r.kind === 'GUARDIAN' ? `guardians/${r.id}` : 'student'}`;
  const openInvite = (r: PortalAccessRow) => { setInvite(r); setEmail(r.email ?? ''); setError(null); setFieldError(undefined); };
  const send = async () => {
    if (!invite) return;
    setBusy(true); setError(null); setFieldError(undefined);
    try {
      await api(path(invite), { method: 'POST', body: JSON.stringify(email.trim() ? { email: email.trim() } : {}) });
      toast(t('pa.invited', { email: email.trim() }));
      setInvite(null); load();
    } catch (e) {
      const x = apiErrors(e);
      setFieldError(x.fields.email); if (!x.fields.email) setError(x.message);
    } finally { setBusy(false); }
  };
  const revoke = async () => {
    if (!remove) return;
    setBusy(true); setError(null);
    try {
      await api(path(remove), { method: 'DELETE' });
      toast(t('pa.removed', { name: remove.name }));
      setRemove(null); load();
    } catch (e) { setError(apiErrors(e).message); } finally { setBusy(false); }
  };

  if (!rows) return null;
  return (
    <section className="app-access" aria-labelledby="app-access-h">
      <h3 id="app-access-h" className="section-title">{t('pa.title')}</h3>
      <p className="muted small">{t('pa.hint')}</p>
      <ul className="access-list">
        {rows.map((r) => (
          <li key={`${r.kind}-${r.id}`}>
            <span className="access-who">
              <strong>{r.name}</strong>
              <span className="muted small">{r.kind === 'STUDENT' ? t('pa.student') : t(`stu.rel.${r.relation}` as MessageKey)}{r.email ? ` · ${r.email}` : ''}</span>
            </span>
            <StatusBadge status={TONE[r.login]} label={t(`pa.login.${r.login}` as MessageKey)} />
            {manage && (
              <span className="access-actions">
                {r.login === 'NONE'
                  ? <button type="button" className="btn btn-sm" onClick={() => openInvite(r)}><Icon name="mail" size={14} /> {t('pa.invite')}</button>
                  : <>
                      {r.login === 'INVITED' && <button type="button" className="btn btn-sm btn-ghost" onClick={() => openInvite(r)}><Icon name="mail" size={14} /> {t('pa.resend')}</button>}
                      <button type="button" className="btn btn-sm btn-ghost danger-text" onClick={() => { setRemove(r); setError(null); }}><Icon name="x" size={14} /> {t('pa.remove')}</button>
                    </>}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="soon-line small">
        <Icon name="phone" size={14} /> {t('pa.bySms')} <span className="soon-badge">{t('common.comingSoon')}</span>
      </p>

      <Modal open={!!invite} onClose={() => setInvite(null)} title={t('pa.inviteTitle', { name: invite?.name ?? '' })} subtitle={t('pa.inviteSub')}
        onSubmit={send} submitLabel={t('pa.sendInvite')} busy={busy} error={error}>
        <Field id="app-email" label={t('pa.email')} error={fieldError} hint={t('pa.emailHint')}>
          <input id="app-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
      </Modal>
      <Modal open={!!remove} onClose={() => setRemove(null)} title={t('pa.removeTitle', { name: remove?.name ?? '' })} subtitle={t('pa.removeSub')}
        onSubmit={revoke} submitLabel={t('pa.remove')} busy={busy} error={error} danger>
        <></>
      </Modal>
    </section>
  );
}
