'use client';

import { FormEvent, Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { PERMISSIONS, type PermissionCode } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { RightsPicker, type RightGroup } from '@/components/access';

interface RoleDetail { id: string; code: string; name: string; isSystem: boolean; permissionCodes: string[]; holders: { userId: string; name: string; email: string | null; campus: string | null }[]; can: { edit: boolean } }

/** Users → Roles & rights → one role (A1): a new role, a copy of any role, or an own role to edit; built-in roles are read-only. */
function RoleEditor() {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const { can } = useSession();
  const id = String(useParams().id);
  const copyFrom = useSearchParams().get('copy');
  const isNew = id === 'new';
  const [groups, setGroups] = useState<RightGroup[] | null>(null);
  const [role, setRole] = useState<RoleDetail | null>(null);
  const [name, setName] = useState('');
  const [codes, setCodes] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    api<RightGroup[]>('/users/permissions').then(setGroups).catch(() => setGroups([]));
    const src = isNew ? copyFrom : id;
    if (!src) { setRole(null); setName(''); setCodes(new Set()); return; }
    api<RoleDetail>(`/users/roles/${src}`).then((r) => {
      setRole(isNew ? null : r);
      setName(isNew ? t('acc.copyName', { name: r.name }) : r.name);
      setCodes(new Set(r.permissionCodes));
    }).catch(() => setMissing(true));
  }, [id, isNew, copyFrom, t]);

  const editable = isNew ? can(PERMISSIONS.IAM_ROLE_MANAGE) : !!role?.can.edit;
  // Only rights held for all campuses can be put into a role (the role may be given for all campuses).
  const locked = (code: string) => !can(code as PermissionCode, { allCampuses: true });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try {
      const body = JSON.stringify({ name, permissionCodes: [...codes] });
      if (isNew) {
        const r = await api<{ id: string }>('/users/roles', { method: 'POST', body });
        toast(t('acc.roleCreated', { name }));
        router.replace(`/users/roles/${r.id}`);
      } else {
        await api(`/users/roles/${id}`, { method: 'PUT', body });
        toast(t('acc.roleSaved', { name }));
        setRole((r) => (r ? { ...r, name, permissionCodes: [...codes] } : r));
      }
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const remove = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api(`/users/roles/${id}/delete`, { method: 'POST' });
      toast(t('acc.roleDeleted', { name: role?.name ?? '' }));
      router.replace('/users/roles');
    } catch (x) { setError(apiErrors(x).message); } finally { setBusy(false); }
  };

  const back = <Link href="/users/roles" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('acc.rolesTitle')}</Link>;
  if (missing) return <>{back}<p className="notice notice-warn"><Icon name="alert" size={16} /> {t('acc.roleMissing')}</p></>;
  if (!groups || (!isNew && !role) || (isNew && copyFrom && !name)) return <>{back}<SkeletonRows /></>;

  const title = isNew ? (copyFrom ? t('acc.copyTitle') : t('acc.newRole')) : role!.name;
  const changed = !isNew && role && (name !== role.name || codes.size !== role.permissionCodes.length || role.permissionCodes.some((c) => !codes.has(c)));
  return (
    <>
      {back}
      <PageHeader eyebrow={role?.isSystem ? t('acc.builtIn') : t('acc.ownRole')} title={title}
        description={role?.isSystem ? t('acc.builtInReadOnly') : isNew ? t('acc.newRoleDesc') : t('acc.editRoleDesc')}
        actions={<>
          {role && can(PERMISSIONS.IAM_ROLE_MANAGE) && <Link href={`/users/roles/new?copy=${role.id}`} className="btn"><Icon name="copy" /> {t('acc.copyThis')}</Link>}
          {role && editable && <button type="button" className="btn btn-ghost" onClick={() => { setError(null); setDel(true); }}><Icon name="trash" /> {t('acc.deleteRole')}</button>}
        </>} />

      {editable ? (
        <form onSubmit={save} noValidate>
          <section className="card p12-block">
            <Field id="role-name" label={t('acc.roleName')} error={errors.name} hint={t('acc.roleNameHint')}>
              <input id="role-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} autoFocus={isNew} />
            </Field>
          </section>
          <section className="card p12-block" aria-labelledby="role-rights">
            <h2 id="role-rights" className="section-title">{t('acc.rightsTitle')}</h2>
            <p className="muted small">{t('acc.rightsHint')}</p>
            {errors.permissionCodes && <p className="notice notice-warn" role="alert"><Icon name="alert" size={16} /> {errors.permissionCodes}</p>}
            <RightsPicker groups={groups} value={codes} onChange={setCodes} locked={locked} />
          </section>
          {error && <p className="notice notice-warn" role="alert"><Icon name="alert" size={16} /> {error}</p>}
          <div className="acc-savebar">
            <span className="muted small">{t('acc.rightsChosen', { n: codes.size, m: groups.reduce((a, g) => a + g.permissions.length, 0) })}{role && role.holders.length > 0 && <> · {t('acc.affects', { n: role.holders.length })}</>}</span>
            <Link href="/users/roles" className="btn btn-ghost">{t('common.cancel')}</Link>
            <button type="submit" className="btn btn-primary" disabled={busy || (!isNew && !changed)}>{busy ? t('common.saving') : isNew ? t('acc.createRole') : t('common.save')}</button>
          </div>
        </form>
      ) : (
        <section className="card p12-block" aria-labelledby="role-rights">
          <h2 id="role-rights" className="section-title">{t('acc.rightsTitle')}</h2>
          <RightsPicker groups={groups} value={codes} readOnly />
        </section>
      )}

      {role && (
        <section className="card p12-block" aria-labelledby="role-holders">
          <h2 id="role-holders" className="section-title">{t('acc.holders', { n: role.holders.length })}</h2>
          {!role.holders.length ? <p className="muted">{t('acc.noHolders')}</p> : (
            <ul className="acc-holders">
              {role.holders.map((h, i) => (
                <li key={`${h.userId}-${i}`}>
                  <Link href={`/users/${h.userId}`}><strong>{h.name}</strong></Link>
                  <span className="muted small">{h.email}</span>
                  <span className="chip chip-sm">{h.campus ?? t('common.allCampuses')}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Modal open={del} onClose={() => setDel(false)} title={t('acc.deleteTitle')} subtitle={role ? t('acc.deleteSub', { name: role.name }) : ''} onSubmit={remove} submitLabel={t('acc.deleteRole')} busy={busy} error={error} danger>
        <p className="muted">{role?.holders.length ? t('acc.deleteHeld', { n: role.holders.length }) : t('acc.deleteNote')}</p>
      </Modal>
    </>
  );
}

export default function RoleEditorPage() {
  return <Suspense fallback={<SkeletonRows />}><RoleEditor /></Suspense>;
}
