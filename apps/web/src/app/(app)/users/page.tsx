'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PERMISSIONS, inviteUserSchema } from '@eduerp/shared';
import { api, newIdempotencyKey, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { apiErrors, FieldErrors, validate } from '@/lib/form';
import { Icon } from '@/components/Icon';
import { ExportButton } from '@/components/ExportButton';
import { Field, Modal } from '@/components/Modal';
import { CampusPicker } from '@/components/CampusPicker';
import { DataTable } from '@/components/DataTable';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';

interface Member {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  lastLoginAt: string | null;
  membershipStatus: string;
  roles: { code: string; name: string; campusId: string | null }[];
}
interface Role { id: string; code: string; name: string; isSystem: boolean }

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
const lastSeen = (iso: string | null, locale: string, never: string) => (iso ? new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : never);

export default function UsersPage() {
  const { can, session } = useSession();
  const toast = useToast();
  const { t, locale } = useI18n();
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);
  const canInvite = can(PERMISSIONS.IAM_USER_INVITE);
  const allScope = can(PERMISSIONS.IAM_USER_INVITE, { allCampuses: true });
  const [rows, setRows] = useState<Member[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [campusNames, setCampusNames] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [form, setForm] = useState({ fullName: '', email: '', roleCode: '', campusId: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<Member[]>('/users').then(setRows).catch(() => setRows([]));
  }, []);
  useEffect(() => {
    load();
    api<Role[]>('/users/roles').then(setRoles).catch(() => setRoles([]));
    api<{ id: string; name: string }[]>('/campuses').then((c) => setCampusNames(Object.fromEntries(c.map((x) => [x.id, x.name])))).catch(() => undefined);
  }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((m) => m.membershipStatus !== 'REMOVED' && (!q || m.fullName.toLowerCase().includes(q) || (m.email ?? '').includes(q)));
  }, [rows, query]);

  function openInvite() {
    setIdemKey(newIdempotencyKey());
    setForm({ fullName: '', email: '', roleCode: roles.find((r) => !r.isSystem)?.code ?? roles[0]?.code ?? '', campusId: '' });
    setErrors({});
    setFormError(null);
    setOpen(true);
  }

  async function invite() {
    const v = validate(inviteUserSchema, { ...form, campusId: form.campusId || null });
    if (!v.ok) return setErrors(v.errors);
    setBusy(true);
    try {
      await api('/users/invite', { method: 'POST', headers: { 'Idempotency-Key': idemKey }, body: JSON.stringify(v.data) });
      setOpen(false);
      toast(t('users.sent', { email: v.data.email }));
      load();
    } catch (e) {
      const { fields, message } = apiErrors(e);
      setErrors(fields);
      setFormError(message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api(`/users/${removing.id}/remove`, { method: 'POST' });
      toast(t('users.removed', { name: removing.fullName }));
      setRemoving(null);
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not remove access', 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={t('nav.setup')}
        title={t('nav.users')}
        description={t('users.desc')}
        actions={<><ExportButton type="USERS" />{canInvite && <button className="btn btn-primary" onClick={openInvite}><Icon name="plus" /> {t('users.invite')}</button>}</>}
      />

      {rows === null ? (
        <SkeletonRows />
      ) : (
        <>
          <div className="toolbar">
            <label className="search">
              <Icon name="search" size={16} />
              <input placeholder={t('users.search')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('users.search')} />
            </label>
            <span className="muted">{shown.length === 1 ? t('users.countOne') : t('users.count', { n: shown.length })}</span>
          </div>
          {shown.length === 0 ? (
            <EmptyState icon="users" title={query ? t('common.noMatches') : t('users.emptyTitle')} text={query ? undefined : t('users.emptyText')} />
          ) : (
            <DataTable
              rows={shown}
              rowKey={(m) => m.id}
              caption={t('nav.users')}
              initialSort={{ key: 'person', dir: 'asc' }}
              columns={[
                {
                  key: 'person',
                  header: t('users.person'),
                  sort: (m) => m.fullName,
                  cell: (m) => (
                    <div className="person">
                      <span className="avatar small" aria-hidden>{initials(m.fullName)}</span>
                      <span>
                        <strong>{m.fullName}</strong>
                        <span className="muted sub-line">{m.email ?? m.phone}</span>
                      </span>
                    </div>
                  ),
                },
                {
                  key: 'role',
                  header: t('users.role'),
                  sort: (m) => m.roles[0]?.name ?? '',
                  cell: (m) => m.roles.map((r, i) => <span key={i} className="role-tag">{r.name}{r.campusId && <em> · {campusNames[r.campusId] ?? ''}</em>}</span>),
                },
                { key: 'last', header: t('users.lastSignIn'), sort: (m) => (m.lastLoginAt ? new Date(m.lastLoginAt).getTime() : null), cell: (m) => <span className="muted">{lastSeen(m.lastLoginAt, locale, t('users.never'))}</span> },
                { key: 'status', header: t('common.status'), sort: (m) => m.membershipStatus, cell: (m) => <StatusBadge status={m.membershipStatus} /> },
                ...(allScope
                  ? [{ key: 'actions', header: <span className="sr-only">{t('users.remove')}</span>, align: 'right' as const, cell: (m: Member) => (m.id !== session?.user.id ? <button className="btn btn-sm btn-ghost" onClick={() => setRemoving(m)}>{t('users.remove')}</button> : null) }]
                  : []),
              ]}
            />
          )}
        </>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={t('users.invite')} subtitle={t('users.inviteSub')} onSubmit={invite} submitLabel={t('users.send')} busy={busy} error={formError}>
        <Field id="inv-name" label={t('users.fullName')} error={errors.fullName}>
          <input id="inv-name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} aria-invalid={!!errors.fullName} autoFocus />
        </Field>
        <Field id="inv-email" label={t('users.email')} error={errors.email}>
          <input id="inv-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} aria-invalid={!!errors.email} />
        </Field>
        <div className="grid-2">
          <Field id="inv-role" label={t('users.role')} error={errors.roleCode}>
            <select id="inv-role" value={form.roleCode} onChange={(e) => setForm({ ...form, roleCode: e.target.value })}>
              {roles.map((r) => <option key={r.id} value={r.code}>{r.name}</option>)}
            </select>
          </Field>
          <Field id="inv-campus" label={t('users.accessTo')}>
            <CampusPicker id="inv-campus" value={form.campusId} allowInstitution={allScope} institutionLabel={t('common.allCampuses')} onChange={(v) => setForm((f) => ({ ...f, campusId: v }))} />
          </Field>
        </div>
      </Modal>

      <Modal open={!!removing} onClose={() => setRemoving(null)} title={t('users.removeTitle')} subtitle={removing ? t('users.removeSub', { name: removing.fullName }) : ''} onSubmit={remove} submitLabel={t('users.remove')} busy={busy} danger>
        <p className="muted">{t('users.removeNote')}</p>
      </Modal>
    </>
  );
}
