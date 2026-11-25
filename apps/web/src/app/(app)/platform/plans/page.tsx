'use client';

import { useCallback, useEffect, useState } from 'react';
import { EDITIONS, EDITION_CODES, EditionCode, MODULES, createPlanSchema, updatePlanSchema } from '@eduerp/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { apiErrors, FieldErrors, validate } from '@/lib/form';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';

interface Plan {
  id: string;
  name: string;
  code: string;
  description: string | null;
  pricePerStudent: number;
  billingCycle: 'MONTHLY' | 'YEARLY';
  priceMonthly: number | null;
  priceYearly: number | null;
  edition: EditionCode | null;
  maxStudents: number | null;
  isActive: boolean;
  modules: string[];
  activeInstitutions: number;
}

const OPTIONAL = MODULES.filter((m) => !('core' in m));
const GROUPS = [...new Set(OPTIONAL.map((m) => m.group))];
const inr = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n);

export default function PlansPage() {
  const { session } = useSession();
  const toast = useToast();
  const isSuper = session?.user.platformRole === 'SUPER_ADMIN';
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [open, setOpen] = useState(false);
  const EMPTY = { name: '', code: '', description: '', priceMonthly: '', priceYearly: '', edition: '', maxStudents: '', modules: [] as string[] };
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api<Plan[]>('/platform/plans').then(setPlans).catch(() => setPlans([]));
  }, []);
  useEffect(load, [load]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY);
    setErrors({});
    setFormError(null);
    setOpen(true);
  }

  const toggle = (code: string) => setForm((f) => ({ ...f, modules: f.modules.includes(code) ? f.modules.filter((m) => m !== code) : [...f.modules, code] }));

  function openEdit(p: Plan) {
    setEditing(p);
    setForm({ name: p.name, code: p.code, description: p.description ?? '', priceMonthly: p.priceMonthly == null ? '' : String(p.priceMonthly), priceYearly: p.priceYearly == null ? '' : String(p.priceYearly), edition: p.edition ?? '', maxStudents: p.maxStudents == null ? '' : String(p.maxStudents), modules: p.modules });
    setErrors({});
    setFormError(null);
    setOpen(true);
  }

  async function save() {
    const price = (x: string) => (x === '' ? null : Number(x));
    const common = { name: form.name, description: form.description || null, priceMonthly: price(form.priceMonthly), priceYearly: price(form.priceYearly), edition: (form.edition || null) as EditionCode | null, maxStudents: form.maxStudents === '' ? null : Number(form.maxStudents) };
    const v = editing ? validate(updatePlanSchema, common) : validate(createPlanSchema, { ...common, code: form.code, modules: form.modules });
    if (!v.ok) return setErrors(v.errors);
    if (common.priceMonthly == null && common.priceYearly == null) return setErrors({ priceYearly: 'Enter a monthly or a yearly price' });
    setSaving(true);
    try {
      if (editing) await api(`/platform/plans/${editing.id}`, { method: 'PATCH', body: JSON.stringify(v.data) });
      else await api('/platform/plans', { method: 'POST', body: JSON.stringify(v.data) });
      setOpen(false);
      toast(editing ? `${form.name} saved — new prices apply from each institution's next term` : `${form.name} plan created`);
      load();
    } catch (e) {
      const { fields, message } = apiErrors(e);
      setErrors(fields);
      setFormError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Platform console"
        title="Plans"
        description="What each plan costs and which modules it includes. Core modules come with every plan."
        actions={isSuper && <button className="btn btn-primary" onClick={openCreate}><Icon name="plus" /> New plan</button>}
      />

      {plans === null ? (
        <SkeletonRows />
      ) : plans.length === 0 ? (
        <EmptyState icon="layers" title="No plans yet" text="Create plans like Basic, Standard and Premium, then assign them to institutions." action={isSuper && <button className="btn btn-primary" onClick={openCreate}><Icon name="plus" /> New plan</button>} />
      ) : (
        <div className="plan-grid">
          {plans.map((p) => (
            <article key={p.id} className={`card plan-tile ${p.isActive ? '' : 'row-dim'}`}>
              <div className="plan-tile-head">
                <div>
                  <h2 className="plan-name">{p.name}</h2>
                  <span className="code">{p.code}</span>
                </div>
                <div className="plan-price">
                  {p.priceYearly != null && <><strong>{inr(p.priceYearly)}</strong><span>per student / year</span></>}
                  {p.priceMonthly != null && <span className={p.priceYearly != null ? 'plan-price-alt' : ''}>{p.priceYearly != null ? `or ${inr(p.priceMonthly)} / month` : <><strong>{inr(p.priceMonthly)}</strong> per student / month</>}</span>}
                </div>
              </div>
              <p className="plan-ed"><span className={`edition-badge ${p.edition ? `ed-${p.edition.toLowerCase()}` : 'ed-any'}`}>{p.edition ? EDITIONS[p.edition].name : 'Any edition'}</span>{!p.isActive && <span className="tag">Not offered</span>}</p>
              {p.description && <p className="muted">{p.description}</p>}
              <p className="plan-facts">
                <span><Icon name="layers" size={15} /> {p.modules.length} optional modules</span>
                <span><Icon name="users" size={15} /> {p.maxStudents ? `Up to ${p.maxStudents} students` : 'Any number of students'}</span>
                <span><Icon name="building" size={15} /> {p.activeInstitutions} institution{p.activeInstitutions === 1 ? '' : 's'}</span>
              </p>
              <div className="chip-row">
                {p.modules.map((m) => <span key={m} className="chip">{MODULES.find((x) => x.code === m)?.name ?? m}</span>)}
              </div>
              {isSuper && <div className="plan-actions"><button className="btn btn-sm" onClick={() => openEdit(p)} aria-label={`Edit ${p.name}`}><Icon name="edit" size={14} /> Edit prices</button></div>}
            </article>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} wide title={editing ? `Edit ${editing.name}` : 'New plan'} subtitle={editing ? 'New prices apply to new terms; running terms keep their rate. Modules stay as they are.' : 'Core modules (setup, users, communication, documents, reports, audit) are always included.'} onSubmit={save} submitLabel={editing ? 'Save plan' : 'Create plan'} busy={saving} error={formError}>
        <div className="grid-2">
          <Field id="p-name" label="Name" error={errors.name}>
            <input id="p-name" value={form.name} placeholder="Standard" onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </Field>
          <Field id="p-code" label="Code" error={errors.code} hint="Capital letters, e.g. STANDARD">
            <input id="p-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={!!editing} />
          </Field>
        </div>
        <Field id="p-desc" label="Description (optional)" error={errors.description}>
          <input id="p-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <p className="muted small">Each institution chooses monthly or yearly. Leave a price empty if the plan is not sold that way.</p>
        <div className="grid-2">
          <Field id="p-month" label="Per student per month (₹)" error={errors.priceMonthly}>
            <input id="p-month" type="number" min={0} step="0.01" value={form.priceMonthly} onChange={(e) => setForm({ ...form, priceMonthly: e.target.value })} />
          </Field>
          <Field id="p-year" label="Per student per year (₹)" error={errors.priceYearly}>
            <input id="p-year" type="number" min={0} step="0.01" value={form.priceYearly} onChange={(e) => setForm({ ...form, priceYearly: e.target.value })} />
          </Field>
        </div>
        <div className="grid-2">
          <Field id="p-ed" label="Edition">
            <select id="p-ed" value={form.edition} onChange={(e) => setForm({ ...form, edition: e.target.value })}>
              <option value="">Any edition</option>
              {EDITION_CODES.map((c) => <option key={c} value={c}>{EDITIONS[c].name}</option>)}
            </select>
          </Field>
          <Field id="p-max" label="Max students" error={errors.maxStudents} hint="Leave empty for no limit">
            <input id="p-max" type="number" min={1} value={form.maxStudents} onChange={(e) => setForm({ ...form, maxStudents: e.target.value })} />
          </Field>
        </div>
        {!editing && <h3 className="section-title">Included modules <span className="muted">· {form.modules.length} selected</span></h3>}
        {!editing && GROUPS.map((g) => (
          <div key={g} className="module-group">
            <span className="module-group-name">{g}</span>
            <div className="module-grid">
              {OPTIONAL.filter((m) => m.group === g).map((m) => (
                <label key={m.code} className={`module-toggle ${form.modules.includes(m.code) ? 'on' : ''}`}>
                  <input type="checkbox" checked={form.modules.includes(m.code)} onChange={() => toggle(m.code)} />
                  <span className="switch" aria-hidden />
                  <span className="module-name">{m.name}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </Modal>
    </>
  );
}
