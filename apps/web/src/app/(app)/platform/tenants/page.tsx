'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { MODULES, EDITIONS, EDITION_CODES, EditionCode, INSTITUTION_TYPES, assignPlanSchema, changeEditionSchema, createTenantSchema, termEnd } from '@eduerp/shared';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { apiErrors, FieldErrors, validate } from '@/lib/form';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';

interface Tenant { id: string; name: string; slug: string; institutionType: string; city: string | null; status: string; edition: EditionCode; createdAt: string }
interface EditionPreview { from: EditionCode; to: EditionCode; followsPlan: boolean; switchOn: { code: string; name: string }[]; switchOff: { code: string; name: string }[]; rolesAdded: { code: string; name: string }[] }
interface Plan { id: string; name: string; code: string; pricePerStudent: number; billingCycle: string; priceMonthly: number | null; priceYearly: number | null; edition: EditionCode | null; maxStudents: number | null; isActive: boolean }
interface Entitlements {
  subscription: { plan: { name: string; code: string }; status: string; startDate: string; endDate: string; studentCount: number; amount: number; billingCycle: 'MONTHLY' | 'YEARLY'; nextCycle: string | null; rate: number } | null;
  modules: { code: string; name: string; group: string; core: boolean; isEnabled: boolean; source: string }[];
}

const TYPE_LABEL: Record<string, string> = { SCHOOL: 'School', PU_COLLEGE: 'PU college', DEGREE_COLLEGE: 'Degree college', UNIVERSITY: 'University', GROUP: 'Group of institutions' };
const EMPTY = { name: '', slug: '', institutionType: 'SCHOOL', edition: 'STANDARD' as EditionCode, city: '', adminName: '', adminEmail: '', adminPassword: '' };
const EditionBadge = ({ code }: { code: EditionCode }) => <span className={`edition-badge ed-${code.toLowerCase()}`}>{EDITIONS[code]?.name ?? code}</span>;
const MODULE_NAME: Record<string, string> = Object.fromEntries(MODULES.map((m) => [m.code, m.name]));
const inr = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
const yearFromToday = () => {
  const s = new Date();
  const e = new Date(s);
  e.setFullYear(e.getFullYear() + 1);
  e.setDate(e.getDate() - 1);
  return { startDate: s.toISOString().slice(0, 10), endDate: e.toISOString().slice(0, 10) };
};

export default function PlatformTenants() {
  const { session } = useSession();
  const toast = useToast();
  const isSuper = session?.user.platformRole === 'SUPER_ADMIN';
  const [rows, setRows] = useState<Tenant[] | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [query, setQuery] = useState('');
  const [edFilter, setEdFilter] = useState<'' | EditionCode>('');
  const [edTo, setEdTo] = useState<EditionCode | ''>('');
  const [edPreview, setEdPreview] = useState<EditionPreview | null>(null);
  const [edReason, setEdReason] = useState('');
  const [edError, setEdError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [managing, setManaging] = useState<Tenant | null>(null);
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [sub, setSub] = useState({ planId: '', status: 'ACTIVE', startDate: '', endDate: '', studentCount: '0', billingCycle: 'YEARLY' as 'MONTHLY' | 'YEARLY', raiseInvoice: true });
  const [subErrors, setSubErrors] = useState<FieldErrors>({});

  const load = useCallback(() => {
    api<Tenant[]>('/platform/tenants').then(setRows).catch(() => setRows([]));
    api<Plan[]>('/platform/plans').then((p) => setPlans(p.filter((x) => x.isActive))).catch(() => setPlans([]));
  }, []);
  useEffect(load, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((t) => (!edFilter || t.edition === edFilter) && (!q || t.name.toLowerCase().includes(q) || t.slug.includes(q) || (t.city ?? '').toLowerCase().includes(q)));
  }, [rows, query, edFilter]);

  if (!session?.user.platformRole) return <div className="alert">Platform staff only.</div>;

  async function create() {
    const payload = { name: form.name, slug: form.slug, institutionType: form.institutionType, edition: form.edition, city: form.city || undefined, admin: { fullName: form.adminName, email: form.adminEmail, password: form.adminPassword } };
    const v = validate(createTenantSchema, payload);
    if (!v.ok) return setErrors(v.errors);
    setSaving(true);
    try {
      await api('/platform/tenants', { method: 'POST', body: JSON.stringify(v.data) });
      setOpen(false);
      toast(v.data.edition === 'STANDARD' ? `${v.data.name} created — trial with every module` : `${v.data.name} created — ${EDITIONS[v.data.edition].name} trial`);
      load();
    } catch (err) {
      const { fields, message } = apiErrors(err);
      setErrors(fields);
      setFormError(message);
    } finally {
      setSaving(false);
    }
  }

  async function manage(t: Tenant) {
    setManaging(t);
    setEnt(null);
    setEdTo('');
    setEdPreview(null);
    setEdReason('');
    setEdError(null);
    setSubErrors({});
    const e = await api<Entitlements>(`/platform/tenants/${t.id}/entitlements`);
    setEnt(e);
    const plan = e.subscription ? plans.find((p) => p.code === e.subscription!.plan.code) : undefined;
    const fits = plans.filter((p) => !p.edition || p.edition === t.edition);
    const pick = plan ?? fits[0] ?? plans[0];
    const cycle = (e.subscription?.billingCycle ?? (pick?.priceYearly != null ? 'YEARLY' : 'MONTHLY')) as 'MONTHLY' | 'YEARLY';
    setSub({ planId: pick?.id ?? '', status: e.subscription?.status === 'TRIAL' ? 'TRIAL' : 'ACTIVE', ...(e.subscription ? { startDate: e.subscription.startDate, endDate: e.subscription.endDate } : yearFromToday()), studentCount: String(e.subscription?.studentCount ?? 0), billingCycle: cycle, raiseInvoice: !e.subscription });
  }

  async function saveSubscription() {
    if (!managing) return;
    const v = validate(assignPlanSchema, { ...sub, studentCount: Number(sub.studentCount), raiseInvoice: sub.status === 'ACTIVE' && sub.raiseInvoice });
    if (!v.ok) return setSubErrors(v.errors);
    setSaving(true);
    try {
      setEnt(await api<Entitlements>(`/platform/tenants/${managing.id}/subscription`, { method: 'POST', body: JSON.stringify(v.data) }));
      toast(`${managing.name} is now on ${plans.find((p) => p.id === sub.planId)?.name}`);
    } catch (e) {
      const { fields, message } = apiErrors(e);
      setSubErrors({ ...fields, ...(message ? { form: message } : {}) });
    } finally {
      setSaving(false);
    }
  }

  async function previewEdition(to: EditionCode | '') {
    setEdTo(to);
    setEdPreview(null);
    setEdError(null);
    if (!managing || !to) return;
    try {
      setEdPreview(await api<EditionPreview>(`/platform/tenants/${managing.id}/edition-preview?edition=${to}`));
    } catch (e) {
      setEdError(e instanceof ApiError ? e.message : 'Could not load the changes');
    }
  }

  async function changeEdition() {
    if (!managing || !edTo) return;
    const v = validate(changeEditionSchema, { edition: edTo, reason: edReason });
    if (!v.ok) return setEdError(v.errors.reason ?? 'Check the form');
    setSaving(true);
    try {
      const t = await api<Tenant>(`/platform/tenants/${managing.id}/edition`, { method: 'PATCH', body: JSON.stringify(v.data) });
      toast(`${managing.name} is now ${EDITIONS[t.edition].name}`);
      setManaging({ ...managing, edition: t.edition });
      setEnt(await api<Entitlements>(`/platform/tenants/${managing.id}/entitlements`));
      setEdTo('');
      setEdPreview(null);
      setEdReason('');
      load();
    } catch (e) {
      setEdError(e instanceof ApiError ? e.message : 'Could not change the edition');
    } finally {
      setSaving(false);
    }
  }

  async function toggleModule(code: string, isEnabled: boolean) {
    if (!managing) return;
    try {
      setEnt(await api<Entitlements>(`/platform/tenants/${managing.id}/modules`, { method: 'PUT', body: JSON.stringify({ moduleCode: code, isEnabled }) }));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not change module', 'bad');
    }
  }

  async function setStatus(status: 'ACTIVE' | 'SUSPENDED') {
    if (!managing) return;
    const reason = window.prompt(status === 'SUSPENDED' ? 'Reason for suspending (shown in the audit log):' : 'Reason for reactivating:');
    if (!reason || reason.trim().length < 3) return;
    try {
      await api(`/platform/tenants/${managing.id}/status`, { method: 'PATCH', body: JSON.stringify({ status, reason }) });
      toast(`${managing.name} ${status === 'SUSPENDED' ? 'suspended (read-only)' : 'reactivated'}`);
      setManaging({ ...managing, status });
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not change status', 'bad');
    }
  }

  const price = plans.find((p) => p.id === sub.planId);
  const rateOf = (p: Plan | undefined, c: 'MONTHLY' | 'YEARLY') => (p ? (c === 'MONTHLY' ? p.priceMonthly : p.priceYearly) : null);
  const rate = rateOf(price, sub.billingCycle);
  const setTerm = (patch: Partial<typeof sub>) => {
    const n = { ...sub, ...patch };
    if (n.startDate && (patch.startDate !== undefined || patch.billingCycle !== undefined)) n.endDate = termEnd(n.startDate, n.billingCycle);
    setSub(n);
  };
  const groups = ent ? [...new Set(ent.modules.map((m) => m.group))] : [];

  return (
    <>
      <PageHeader
        eyebrow="Platform console"
        title="Institutions"
        description="Every school or college group using EduERP: their plan, modules and status."
        actions={isSuper && <button className="btn btn-primary" onClick={() => { setForm(EMPTY); setErrors({}); setFormError(null); setOpen(true); }}><Icon name="plus" /> Add institution</button>}
      />

      {rows === null ? (
        <SkeletonRows />
      ) : rows.length === 0 ? (
        <EmptyState icon="building" title="No institutions yet" text="Create the first institution. It starts as a free trial with every module." />
      ) : (
        <>
          <div className="toolbar">
            <label className="search">
              <Icon name="search" size={16} />
              <input placeholder="Search by name, short name or city" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search institutions" />
            </label>
            <select value={edFilter} onChange={(e) => setEdFilter(e.target.value as '' | EditionCode)} aria-label="Edition">
              <option value="">All editions</option>
              {EDITION_CODES.map((c) => <option key={c} value={c}>{EDITIONS[c].name}</option>)}
            </select>
            <span className="muted">{shown.length} of {rows.length}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Institution</th><th>Edition</th><th>Type</th><th>City</th><th>Status</th><th>Created</th><th /></tr></thead>
              <tbody>
                {shown.map((t) => (
                  <tr key={t.id}>
                    <td><strong>{t.name}</strong><span className="muted sub-line">{t.slug}</span></td>
                    <td><EditionBadge code={t.edition} /></td>
                    <td>{TYPE_LABEL[t.institutionType] ?? t.institutionType}</td>
                    <td>{t.city ?? <span className="muted">—</span>}</td>
                    <td><StatusBadge status={t.status} /></td>
                    <td className="muted">{new Date(t.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                    <td className="num"><button className="btn btn-sm" onClick={() => manage(t)}>Manage</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add institution" subtitle="Creates the institution, its starting roles and its first administrator." onSubmit={create} submitLabel="Create institution" busy={saving} error={formError}>
        <Field id="t-name" label="Institution name" error={errors.name}>
          <input id="t-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
        </Field>
        <div className="grid-2">
          <Field id="t-slug" label="Short name" error={errors.slug} hint="Lower-case, used in links: abc-school">
            <input id="t-slug" value={form.slug} placeholder="abc-school" onChange={(e) => setForm({ ...form, slug: e.target.value })} />
          </Field>
          <Field id="t-type" label="Type">
            <select id="t-type" value={form.institutionType} onChange={(e) => setForm({ ...form, institutionType: e.target.value })}>
              {INSTITUTION_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t] ?? t}</option>)}
            </select>
          </Field>
        </div>
        <fieldset className="edition-pick">
          <legend>Edition</legend>
          {EDITION_CODES.map((c) => (
            <label key={c} className={`edition-card ${form.edition === c ? 'on' : ''}`}>
              <input type="radio" name="t-edition" value={c} checked={form.edition === c} onChange={() => setForm({ ...form, edition: c })} />
              <span className="edition-card-name">{EDITIONS[c].name}</span>
              <span className="edition-card-desc">{EDITIONS[c].description}</span>
              {EDITIONS[c].modulesOff.length > 0 && <span className="edition-card-off">Starts without: {EDITIONS[c].modulesOff.map((m) => MODULE_NAME[m] ?? m).join(', ')}</span>}
            </label>
          ))}
        </fieldset>
        <Field id="t-city" label="City" error={errors.city}>
          <input id="t-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        </Field>
        <h3 className="section-title">First administrator</h3>
        <Field id="t-admin" label="Full name" error={errors['admin.fullName']}>
          <input id="t-admin" value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} />
        </Field>
        <div className="grid-2">
          <Field id="t-email" label="Email" error={errors['admin.email']}>
            <input id="t-email" type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} />
          </Field>
          <Field id="t-pass" label="Temporary password" error={errors['admin.password']}>
            <input id="t-pass" type="password" autoComplete="new-password" value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} />
          </Field>
        </div>
      </Modal>

      <Modal open={!!managing} onClose={() => setManaging(null)} wide title={managing?.name ?? ''} subtitle={managing && <span className="manage-sub"><StatusBadge status={managing.status} /> <EditionBadge code={managing.edition} /> {TYPE_LABEL[managing.institutionType]} · {managing.slug}</span>} onSubmit={saveSubscription} submitLabel="Save plan" busy={saving} error={subErrors.form}>
        {!ent ? (
          <div className="skeleton-wrap"><div className="skeleton" /><div className="skeleton" style={{ width: '60%' }} /></div>
        ) : (
          <>
            <h3 className="section-title first">Plan</h3>
            {ent.subscription && (
              <div className="notice"><Icon name="info" />Now on <strong>&nbsp;{ent.subscription.plan.name}&nbsp;</strong> until {new Date(ent.subscription.endDate).toLocaleDateString('en-IN')} · {ent.subscription.studentCount} students · {inr(ent.subscription.amount)}</div>
            )}
            {plans.length === 0 ? (
              <p className="muted">Create a plan first under <strong>Plans</strong>.</p>
            ) : (
              <>
                <div className="grid-3">
                  <Field id="s-plan" label="Plan" error={subErrors.planId}>
                    <select id="s-plan" value={sub.planId} onChange={(e) => setSub({ ...sub, planId: e.target.value })} disabled={!isSuper}>
                      {plans.filter((p) => !p.edition || p.edition === managing?.edition || p.id === sub.planId).map((p) => <option key={p.id} value={p.id}>{p.name}{p.edition ? '' : ' (any edition)'}</option>)}
                    </select>
                  </Field>
                  <Field id="s-status" label="Status">
                    <select id="s-status" value={sub.status} onChange={(e) => setSub({ ...sub, status: e.target.value })} disabled={!isSuper}>
                      <option value="TRIAL">Trial</option>
                      <option value="ACTIVE">Active (paid)</option>
                    </select>
                  </Field>
                  <Field id="s-count" label="Students" error={subErrors.studentCount} hint={price?.maxStudents ? `Up to ${price.maxStudents}` : undefined}>
                    <input id="s-count" type="number" min={0} value={sub.studentCount} onChange={(e) => setSub({ ...sub, studentCount: e.target.value })} disabled={!isSuper} />
                  </Field>
                </div>
                <div className="grid-3">
                  <Field id="s-cycle" label="Billed" error={subErrors.billingCycle}>
                    <select id="s-cycle" value={sub.billingCycle} onChange={(e) => setTerm({ billingCycle: e.target.value as 'MONTHLY' | 'YEARLY' })} disabled={!isSuper}>
                      <option value="YEARLY" disabled={rateOf(price, 'YEARLY') == null}>Yearly{rateOf(price, 'YEARLY') != null ? ` · ${inr(rateOf(price, 'YEARLY')!)}/student` : ' (not offered)'}</option>
                      <option value="MONTHLY" disabled={rateOf(price, 'MONTHLY') == null}>Monthly{rateOf(price, 'MONTHLY') != null ? ` · ${inr(rateOf(price, 'MONTHLY')!)}/student` : ' (not offered)'}</option>
                    </select>
                  </Field>
                  <Field id="s-start" label="From" error={subErrors.startDate}>
                    <input id="s-start" type="date" value={sub.startDate} onChange={(e) => setTerm({ startDate: e.target.value })} disabled={!isSuper} />
                  </Field>
                  <Field id="s-end" label="Until" error={subErrors.endDate}>
                    <input id="s-end" type="date" value={sub.endDate} onChange={(e) => setSub({ ...sub, endDate: e.target.value })} disabled={!isSuper} />
                  </Field>
                </div>
                {price && rate != null && <p className="muted small">Amount per {sub.billingCycle === 'YEARLY' ? 'year' : 'month'}: <strong>{inr(rate * Number(sub.studentCount || 0))}</strong> + GST</p>}
                {price && rate == null && <p className="err">{price.name} is not sold {sub.billingCycle === 'YEARLY' ? 'yearly' : 'monthly'}.</p>}
                {sub.status === 'ACTIVE' && (
                  <label className="check-line">
                    <input type="checkbox" checked={sub.raiseInvoice} onChange={(e) => setSub({ ...sub, raiseInvoice: e.target.checked })} disabled={!isSuper} />
                    <span>Raise the tax invoice for this term now <span className="muted small">(the term must be one {sub.billingCycle === 'YEARLY' ? 'year' : 'month'}; later terms are billed automatically before they start)</span></span>
                  </label>
                )}
                {subErrors.raiseInvoice && <p className="err">{subErrors.raiseInvoice}</p>}
                {managing && <p className="small"><Link href={`/platform/billing/${managing.id}`}><Icon name="receipt" size={14} /> Bills, payments, grace period and statement</Link></p>}
              </>
            )}

            <h3 className="section-title">Modules</h3>
            <p className="muted small">Switching a module here overrides the plan for this institution only (for example a paid add-on).</p>
            {groups.map((g) => (
              <div key={g} className="module-group">
                <span className="module-group-name">{g}</span>
                <div className="module-grid">
                  {ent.modules.filter((m) => m.group === g).map((m) => (
                    <label key={m.code} className={`module-toggle ${m.isEnabled ? 'on' : ''} ${m.core ? 'core' : ''}`}>
                      <input type="checkbox" checked={m.isEnabled} disabled={m.core || !isSuper} onChange={(e) => toggleModule(m.code, e.target.checked)} />
                      <span className="switch" aria-hidden />
                      <span className="module-name">{m.name}</span>
                      {m.core ? <span className="tag">Core</span> : m.source === 'OVERRIDE' ? <span className="tag gold">Add-on</span> : null}
                    </label>
                  ))}
                </div>
              </div>
            ))}

            <h3 className="section-title">Edition</h3>
            <p className="muted small">The edition is the starting set-up: modules, starting roles, the names on screens and the menu order. Changing it never deletes data or roles.</p>
            {managing && (
              <div className="edition-change">
                <Field id="ed-to" label={`Now ${EDITIONS[managing.edition].name} — change to`}>
                  <select id="ed-to" value={edTo} onChange={(e) => previewEdition(e.target.value as EditionCode | '')} disabled={!isSuper}>
                    <option value="">Keep the current edition</option>
                    {EDITION_CODES.filter((c) => c !== managing.edition).map((c) => <option key={c} value={c}>{EDITIONS[c].name}</option>)}
                  </select>
                </Field>
                {edPreview && (
                  <div className="edition-preview" aria-live="polite">
                    {edPreview.followsPlan ? (
                      <p><Icon name="info" /> Modules stay as the plan sets them; switch single modules below if needed.</p>
                    ) : edPreview.switchOn.length + edPreview.switchOff.length === 0 ? (
                      <p><Icon name="check" /> No module changes.</p>
                    ) : (
                      <>
                        {edPreview.switchOn.length > 0 && <p><strong>Switches on:</strong> {edPreview.switchOn.map((m) => m.name).join(', ')}</p>}
                        {edPreview.switchOff.length > 0 && <p><strong>Switches off:</strong> {edPreview.switchOff.map((m) => m.name).join(', ')} <span className="muted">(their data is kept and comes back when switched on)</span></p>}
                      </>
                    )}
                    {edPreview.rolesAdded.length > 0 && <p><strong>Adds roles:</strong> {edPreview.rolesAdded.map((r) => r.name).join(', ')}</p>}
                    <p className="muted small">Add-ons switched on or off by the platform stay as they are.</p>
                    <Field id="ed-reason" label="Reason (kept in the audit log)" error={edError ?? undefined}>
                      <input id="ed-reason" value={edReason} onChange={(e) => setEdReason(e.target.value)} />
                    </Field>
                    <button type="button" className="btn btn-primary" onClick={changeEdition} disabled={saving}>Change to {EDITIONS[edPreview.to].name}</button>
                  </div>
                )}
                {!edPreview && edError && <p className="err">{edError}</p>}
              </div>
            )}

            {isSuper && managing && (
              <div className="danger-zone">
                <div>
                  <strong>{managing.status === 'SUSPENDED' ? 'Reactivate institution' : 'Suspend institution'}</strong>
                  <span className="muted">{managing.status === 'SUSPENDED' ? 'Users can make changes again.' : 'Users can still sign in and view, but cannot change anything.'}</span>
                </div>
                {managing.status === 'SUSPENDED' ? (
                  <button type="button" className="btn" onClick={() => setStatus('ACTIVE')}>Reactivate</button>
                ) : (
                  <button type="button" className="btn btn-danger" onClick={() => setStatus('SUSPENDED')}>Suspend</button>
                )}
              </div>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
