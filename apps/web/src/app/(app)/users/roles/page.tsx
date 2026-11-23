'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { EmptyState, PageHeader, SkeletonRows } from '@/components/ui';
import type { RoleRow } from '@/components/access';

/** Users → Roles & rights (A1): built-in roles are fixed templates to copy; the institution's own roles are edited here. */
export default function RolesPage() {
  const { t } = useI18n();
  const { can } = useSession();
  const manage = can(PERMISSIONS.IAM_ROLE_MANAGE);
  const [rows, setRows] = useState<RoleRow[] | null>(null);
  useEffect(() => { api<RoleRow[]>('/users/roles').then(setRows).catch(() => setRows([])); }, []);
  const builtIn = (rows ?? []).filter((r) => r.isSystem);
  const own = (rows ?? []).filter((r) => !r.isSystem);

  const table = (list: RoleRow[], label: string, system: boolean) => (
    <div className="table-wrap" role="region" aria-label={label} tabIndex={0}>
      <table className="table">
        <thead><tr><th scope="col">{t('acc.role')}</th><th scope="col" className="num">{t('acc.rights')}</th><th scope="col" className="num">{t('acc.people')}</th><th scope="col"><span className="sr-only">{t('common.actions')}</span></th></tr></thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id}>
              <td><Link href={`/users/roles/${r.id}`}><strong>{r.name}</strong></Link>{system && <span className="sub-line muted small"><Icon name="lock" size={12} /> {t('acc.builtIn')}</span>}</td>
              <td className="num">{r.rights}</td>
              <td className="num">{r.users}</td>
              <td className="num acc-row-actions">
                <Link href={`/users/roles/${r.id}`} className="btn btn-sm btn-ghost">{system || !manage ? t('acc.view') : t('acc.edit')}</Link>
                {manage && <Link href={`/users/roles/new?copy=${r.id}`} className="btn btn-sm"><Icon name="copy" size={14} /> {t('acc.copy')}</Link>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <Link href="/users" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('nav.users')}</Link>
      <PageHeader eyebrow={t('nav.setup')} title={t('acc.rolesTitle')} description={t('acc.rolesDesc')}
        actions={manage ? <Link href="/users/roles/new" className="btn btn-primary"><Icon name="plus" /> {t('acc.newRole')}</Link> : undefined} />
      {rows === null ? <SkeletonRows /> : (
        <>
          <section className="card p12-block" aria-labelledby="own-roles">
            <h2 id="own-roles" className="section-title">{t('acc.ownRoles')}</h2>
            {own.length ? table(own, t('acc.ownRoles'), false) : (
              <EmptyState icon="shield" title={t('acc.noOwnTitle')} text={t('acc.noOwnText')}
                action={manage ? <Link href="/users/roles/new" className="btn btn-primary"><Icon name="plus" /> {t('acc.newRole')}</Link> : undefined} />
            )}
          </section>
          <section className="card p12-block" aria-labelledby="builtin-roles">
            <h2 id="builtin-roles" className="section-title">{t('acc.builtInRoles')}</h2>
            <p className="muted small">{t('acc.builtInNote')}</p>
            {table(builtIn, t('acc.builtInRoles'), true)}
          </section>
        </>
      )}
    </>
  );
}
