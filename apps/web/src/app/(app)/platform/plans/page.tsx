'use client';

import { useCallback, useEffect, useState } from 'react';
import { MODULES, createPlanSchema } from '@eduerp/shared';
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
  const [form, setForm] = useState({ name: '', code: '', description: '', pricePerStudent: '', billingCycle: 'YEARLY', maxStudents: '', modules: [] as string[] });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api<Plan[]>('/platform/plans').then(setPlans).catch(() => setPlans([]));
  }, []);
  useEffect(load, [load]);

  function openCreate() {
    setForm({ name: '', code: '', description: '', pricePerStudent: '', billingCycle: 'YEARLY', maxStudents: '', modules: [] });
    setErrors({});
    setFormError(null);
    setOpen(true);
  }

  const toggle = (code: string) => setForm((f) => ({ ...f, modules: f.modules.includes(code) ? f.modules.filter((m) => m !== code) : [...f.modules, code] }));

  async function save() {
    const v = validate(createPlanSchema, {
      ...form,
      description: form.description || null,
      pricePerStudent: form.pricePerStudent === '' ? NaN : Number(form.pricePerStudent),
      maxStudents: form.maxStudents === '' ? null : Number(form.maxStudents),
    });
    if (!v.ok) return setErrors(v.errors);
    setSaving(true);
    try {
      await api('/platform/plans', { method: 'POST', body: JSON.stringify(v.data) });
      setOpen(false);
      toast(`${v.data.name} plan created`);
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
                  <strong>{inr(p.pricePerStudent)}</strong>
                  <span>per student / {p.billingCycle === 'YEARLY' ? 'year' : 'month'}</span>
                </div>
              </div>
              {p.description && <p className="muted">{p.description}</p>}
              <p className="plan-facts">
                <span><Icon name="layers" size={15} /> {p.modules.length} optional modules</span>
                <span><Icon name="users" size={15} /> {p.maxStudents ? `Up to ${p.maxStudents} students` : 'Any number of students'}</span>
                <span><Icon name="building" size={15} /> {p.activeInstitutions} institution{p.activeInstitutions === 1 ? '' : 's'}</span>
              </p>
              <div className="chip-row">
                {p.modules.map((m) => <span key={m} className="chip">{MODULES.find((x) => x.code === m)?.name ?? m}</span>)}
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} wide title="New plan" subtitle="Core modules (setup, users, communication, documents, reports, audit) are always included." onSubmit={save} submitLabel="Create plan" busy={saving} error={formError}>
        <div className="grid-2">
          <Field id="p-name" label="Name" error={errors.name}>
            <input id="p-name" value={form.name} placeholder="Standard" onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </Field>
          <Field id="p-code" label="Code" error={errors.code} hint="Capital letters, e.g. STANDARD">
            <input id="p-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </Field>
        </div>
        <Field id="p-desc" label="Description (optional)" error={errors.description}>
          <input id="p-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="grid-3">
          <Field id="p-price" label="Price per student (₹)" error={errors.pricePerStudent}>
            <input id="p-price" type="number" min={0} step="0.01" value={form.pricePerStudent} onChange={(e) => setForm({ ...form, pricePerStudent: e.target.value })} />
          </Field>
          <Field id="p-cycle" label="Billed">
            <select id="p-cycle" value={form.billingCycle} onChange={(e) => setForm({ ...form, billingCycle: e.target.value })}>
              <option value="YEARLY">Yearly</option>
              <option value="MONTHLY">Monthly</option>
            </select>
          </Field>
          <Field id="p-max" label="Max students" error={errors.maxStudents} hint="Leave empty for no limit">
            <input id="p-max" type="number" min={1} value={form.maxStudents} onChange={(e) => setForm({ ...form, maxStudents: e.target.value })} />
          </Field>
        </div>
        <h3 className="section-title">Included modules <span className="muted">· {form.modules.length} selected</span></h3>
        {GROUPS.map((g) => (
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
