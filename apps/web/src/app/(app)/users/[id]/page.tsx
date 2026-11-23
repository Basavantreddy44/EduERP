'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { moduleLabel, rightLabel, type RoleRow } from '@/components/access';

interface Access {
  id: string; fullName: string; email: string | null; phone: string | null; accountStatus: string; membershipStatus: string; lastLoginAt: string | null; hasPassword: boolean; isMe: boolean;
  roles: { id: string; roleId: string; code: string; name: string; isSystem: boolean; campusId: string | null; campus: string | null; rights: number }[];
  links: { staff: { id: string; code: string; name: string; designation: string | null; campus: string } | null; student: { id: string; name: string; admissionNo: string } | null; children: { id: string; name: string; admissionNo: string }[] };
  rights: { module: string; name: string; permissions: { code: string; description: string; campuses: string[] | null }[] }[];
  campuses: { id: string; name: string }[];
  can: { manage: boolean; manageAll: boolean; campusIds: string[] };
}

/** Users → one person (A2): their roles for all campuses or one campus, the record they are linked to, and what they can do. */
export default function UserAccessPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const id = String(useParams().id);
  const [u, setU] = useState<Access | null>(null);
  const [missing, setMissing] = useState(false);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [give, setGive] = useState<{ roleId: string; campusId: string } | null>(null);
  const [taking, setTaking] = useState<Access['roles'][number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Access>(`/users/${id}`).then(setU).catch(() => setMissing(true)); }, [id]);
  useEffect(() => { load(); api<RoleRow[]>('/users/roles').then(setRoles).catch(() => setRoles([])); }, [load]);

  const run = async (e: FormEvent, fn: () => Promise<unknown>, msg: string, done: () => void) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await fn(); toast(msg); done(); load(); } catch (x) { setError(apiErrors(x).message); } finally { setBusy(false); }
  };
  const sendLink = async () => {
    try { await api(`/users/${id}/password-link`, { method: 'POST' }); toast(t('acc.linkSent', { email: u?.email ?? '' })); }
    catch (x) { toast(apiErrors(x).message ?? t('acc.linkFailed'), 'bad'); }
  };

  const back = <Link href="/users" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('nav.users')}</Link>;
  if (missing) return <>{back}<p className="notice notice-warn"><Icon name="alert" size={16} /> {t('acc.userMissing')}</p></>;
  if (!u) return <>{back}<SkeletonRows /></>;

  const nRights = u.rights.reduce((a, m) => a + m.permissions.length, 0);
  const own = roles.filter((r) => !r.isSystem);
  const builtIn = roles.filter((r) => r.isSystem);
  const chosen = roles.find((r) => r.id === give?.roleId);
  const where = (campus: string | null) => campus ?? t('common.allCampuses');
  return (
    <>
      {back}
      <PageHeader eyebrow={t('acc.personAccess')} title={u.fullName}
        description={[u.email, u.phone].filter(Boolean).join(' · ')}
        actions={<>
          <StatusBadge status={u.membershipStatus} />
          {u.can.manage && u.email && <button type="button" className="btn" onClick={sendLink}><Icon name="mail" /> {u.hasPassword ? t('acc.sendReset') : t('acc.resendInvite')}</button>}
          {u.can.manage && <button type="button" className="btn btn-primary" onClick={() => { setError(null); setGive({ roleId: '', campusId: u.can.manageAll ? '' : u.can.campusIds[0] ?? '' }); }}><Icon name="plus" /> {t('acc.giveRole')}</button>}
        </>} />

      <dl className="acc-facts card">
        <div><dt>{t('users.lastSignIn')}</dt><dd>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : t('users.never')}</dd></div>
        <div><dt>{t('acc.password')}</dt><dd>{u.hasPassword ? t('acc.passwordSet') : t('acc.passwordNotSet')}</dd></div>
        <div><dt>{t('acc.linkedTo')}</dt><dd>
          {u.links.staff && <Link href={`/staff/${u.links.staff.id}`}>{t('acc.staffLink', { name: u.links.staff.name, code: u.links.staff.code })}</Link>}
          {u.links.student && <Link href={`/students/${u.links.student.id}`}>{t('acc.studentLink', { name: u.links.student.name, no: u.links.student.admissionNo })}</Link>}
          {u.links.children.length > 0 && <span>{t('acc.parentOf')} {u.links.children.map((c, i) => <span key={c.id}>{i > 0 && ', '}<Link href={`/students/${c.id}`}>{c.name}</Link></span>)}</span>}
          {!u.links.staff && !u.links.student && !u.links.children.length && <span className="muted">{t('acc.notLinked')}</span>}
        </dd></div>
      </dl>

      <section className="card p12-block" aria-labelledby="acc-roles">
        <h2 id="acc-roles" className="section-title">{t('acc.rolesOf')}</h2>
        <p className="muted small">{t('acc.rolesOfHint')}</p>
        {!u.roles.length ? <p className="muted">{t('acc.noRoles')}</p> : (
          <div className="table-wrap" role="region" aria-label={t('acc.rolesOf')} tabIndex={0}>
            <table className="table">
              <thead><tr><th scope="col">{t('acc.role')}</th><th scope="col">{t('acc.where')}</th><th scope="col" className="num">{t('acc.rights')}</th><th scope="col"><span className="sr-only">{t('common.actions')}</span></th></tr></thead>
              <tbody>
                {u.roles.map((r) => (
                  <tr key={r.id}>
                    <td><Link href={`/users/roles/${r.roleId}`}><strong>{r.name}</strong></Link>{r.isSystem && <span className="sub-line muted small">{t('acc.builtIn')}</span>}</td>
                    <td><span className={`chip chip-sm ${r.campusId ? '' : 'chip-gold'}`}>{where(r.campus)}</span></td>
                    <td className="num">{r.rights}</td>
                    <td className="num">{u.can.manage && (r.campusId ? u.can.campusIds.includes(r.campusId) : u.can.manageAll) && <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setError(null); setTaking(r); }}>{t('acc.takeAway')}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card p12-block" aria-labelledby="acc-can">
        <h2 id="acc-can" className="section-title">{t('acc.canDo', { n: nRights })}</h2>
        <p className="muted small">{t('acc.canDoHint')}</p>
        {!u.rights.length ? <p className="muted">{t('acc.canNothing')}</p> : u.rights.map((m) => (
          <details key={m.module} className="acc-group">
            <summary>
              <Icon name="chevronRight" size={16} className="acc-caret" />
              <span className="acc-group-name">{moduleLabel(t, m.module, m.name)}</span>
              <span className="acc-count on">{m.permissions.length}</span>
            </summary>
            <ul className="acc-rights">
              {m.permissions.map((p) => (
                <li key={p.code} className="acc-eff">
                  <span><Icon name="check" size={15} /> {rightLabel(t, p.code, p.description)}</span>
                  <span className="chip-row">{p.campuses ? p.campuses.map((c) => <span key={c} className="chip chip-sm">{c}</span>) : <span className="chip chip-sm chip-gold">{t('common.allCampuses')}</span>}</span>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </section>

      <Modal open={!!give} onClose={() => setGive(null)} title={t('acc.giveRole')} subtitle={t('acc.giveSub', { name: u.fullName })}
        onSubmit={(e) => give && run(e, () => api(`/users/${id}/roles`, { method: 'POST', body: JSON.stringify({ roleId: give.roleId, campusId: give.campusId || null }) }), t('acc.given', { role: chosen?.name ?? '', name: u.fullName }), () => setGive(null))}
        submitLabel={t('acc.give')} busy={busy} error={error} submitDisabled={!give?.roleId}>
        {give && (
          <>
            <Field id="give-role" label={t('acc.role')}>
              <select id="give-role" value={give.roleId} onChange={(e) => setGive({ ...give, roleId: e.target.value })} autoFocus>
                <option value="">{t('acc.chooseRole')}</option>
                {own.length > 0 && <optgroup label={t('acc.ownRoles')}>{own.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</optgroup>}
                <optgroup label={t('acc.builtInRoles')}>{builtIn.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</optgroup>
              </select>
            </Field>
            <Field id="give-campus" label={t('acc.where')} hint={give.campusId ? t('acc.oneCampusHint') : t('acc.allCampusHint')}>
              <select id="give-campus" value={give.campusId} onChange={(e) => setGive({ ...give, campusId: e.target.value })}>
                {u.can.manageAll && <option value="">{t('common.allCampuses')}</option>}
                {u.campuses.filter((c) => u.can.campusIds.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            {chosen && <p className="muted small"><Link href={`/users/roles/${chosen.id}`} target="_blank">{t('acc.seeRights', { n: chosen.rights })}</Link></p>}
          </>
        )}
      </Modal>

      <Modal open={!!taking} onClose={() => setTaking(null)} title={t('acc.takeTitle')} subtitle={taking ? t('acc.takeSub', { role: taking.name, where: where(taking.campus), name: u.fullName }) : ''}
        onSubmit={(e) => taking && run(e, () => api(`/users/${id}/roles/${taking.id}/remove`, { method: 'POST' }), t('acc.taken', { role: taking.name }), () => setTaking(null))}
        submitLabel={t('acc.takeAway')} busy={busy} error={error} danger>
        <p className="muted">{t('acc.takeNote')}</p>
      </Modal>
    </>
  );
}
