'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { MEALS, MESS_BILLING, PERMISSIONS, formatINR, toPaise } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { todayIST } from '@/components/admissions';
import { useStaffOptions } from '@/components/staff';
import { PersonPick, PersonSearch } from '@/components/leave';

interface Plan { id: string; campusId: string; name: string; mealsIncluded: string[]; billingType: string; amount: string; status: string; subscribers: number }
interface Counts { date: string; meals: { meal: string; students: number; staff: number; total: number; menu: string | null }[] }
interface Menu { effectiveFrom: string | null; items: { dayOfWeek: number; meal: string; items: string }[] }

/** Hostel → Mess (M7.4): plans, today's meal counts with the menu, the weekly menu, subscriptions. */
export default function MessPage() {
  const { can, campusId: sessionCampus } = useSession();
  const { t, locale } = useI18n();
  const toast = useToast();
  const opts = useStaffOptions();
  const manage = can(PERMISSIONS.MESS_MANAGE);
  const campuses = opts?.campuses ?? [];
  const campusId = sessionCampus ?? campuses[0]?.id ?? '';
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [dialog, setDialog] = useState<'plan' | 'sub' | 'menu' | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [meals, setMeals] = useState<string[]>(['BREAKFAST', 'LUNCH', 'DINNER']);
  const [grid, setGrid] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<'STUDENT' | 'EMPLOYEE'>('STUDENT');
  const [who, setWho] = useState<PersonPick | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    if (!campusId) return;
    api<Plan[]>(`/hostel/mess/plans?campusId=${campusId}`).then(setPlans).catch(() => setPlans([]));
    api<Counts>(`/hostel/mess/counts?campusId=${campusId}&date=${todayIST()}`).then(setCounts).catch(() => setCounts(null));
    api<Menu>(`/hostel/mess/menu?campusId=${campusId}&date=${todayIST()}`).then(setMenu).catch(() => setMenu(null));
  }, [campusId]);
  useEffect(load, [load]);
  const days = Array.from({ length: 7 }, (_, i) => ({ n: i + 1, label: new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(locale, { weekday: 'long', timeZone: 'UTC' }) }));

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try {
      if (dialog === 'plan') {
        await api('/hostel/mess/plans', { method: 'POST', body: JSON.stringify({ campusId, name: form.name, mealsIncluded: meals, billingType: form.billingType, amount: form.amount || '0' }) });
        toast(t('ms.planSaved'));
      } else if (dialog === 'sub') {
        if (!who) { setError(t('ms.choosePerson')); return; }
        const r = await api<{ billed: string | null }>('/hostel/mess/subscriptions', { method: 'POST', body: JSON.stringify({ [kind === 'STUDENT' ? 'studentId' : 'employeeId']: who.id, messPlanId: form.planId, fromDate: form.fromDate, bill: form.bill === 'yes' }) });
        toast(r.billed ? t('ms.subBilled', { amount: formatINR(toPaise(r.billed)) }) : t('ms.subSaved'));
      } else if (dialog === 'menu') {
        const items = Object.entries(grid).filter(([, v]) => v.trim().length >= 2).map(([k, v]) => ({ dayOfWeek: Number(k.split('-')[0]), meal: k.split('-')[1], items: v.trim() }));
        await api('/hostel/mess/menu', { method: 'PUT', body: JSON.stringify({ campusId, effectiveFrom: form.effectiveFrom, items }) });
        toast(t('ms.menuSaved'));
      }
      setDialog(null); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message ?? Object.values(a.fields)[0] ?? null); } finally { setBusy(false); }
  };

  return (
    <>
      <Link href="/hostel" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('hs.title')}</Link>
      <PageHeader eyebrow={t('nav.hostel')} title={t('ms.title')} description={t('ms.desc')}
        actions={manage ? <>
          <button type="button" className="btn" onClick={() => { setForm({ effectiveFrom: todayIST() }); setGrid(Object.fromEntries((menu?.items ?? []).map((i) => [`${i.dayOfWeek}-${i.meal}`, i.items]))); setErrors({}); setError(null); setDialog('menu'); }}><Icon name="calendar" /> {t('ms.editMenu')}</button>
          <button type="button" className="btn" disabled={!plans?.some((p) => p.status === 'ACTIVE')} onClick={() => { setForm({ planId: plans?.find((p) => p.status === 'ACTIVE')?.id ?? '', fromDate: todayIST(), bill: 'yes' }); setWho(null); setKind('STUDENT'); setErrors({}); setError(null); setDialog('sub'); }}><Icon name="plus" /> {t('ms.subscribe')}</button>
          <button type="button" className="btn btn-primary" onClick={() => { setForm({ name: '', billingType: 'FIXED', amount: '' }); setMeals(['BREAKFAST', 'LUNCH', 'DINNER']); setErrors({}); setError(null); setDialog('plan'); }}><Icon name="plus" /> {t('ms.addPlan')}</button>
        </> : undefined} />

      <h2 className="section-title">{t('ms.today')}</h2>
      {!counts ? <SkeletonRows rows={2} /> : (
        <ul className="meal-cards">
          {counts.meals.map((m) => (
            <li key={m.meal} className="card">
              <span className="muted small">{t(`ms.meal.${m.meal}` as MessageKey)}</span>
              <strong className="dash-big">{m.total}</strong>
              <span className="muted small">{t('ms.studentsStaff', { s: m.students, e: m.staff })}</span>
              <p className="meal-menu">{m.menu ?? <span className="muted">{t('ms.noMenu')}</span>}</p>
            </li>
          ))}
        </ul>
      )}

      <h2 className="section-title">{t('ms.plans')}</h2>
      {!plans ? <SkeletonRows rows={3} /> : plans.length === 0 ? <EmptyState icon="clipboard" title={t('ms.noPlans')} text={t('ms.noPlansHint')} /> : (
        <div className="table-wrap card">
          <table className="table">
            <thead><tr><th>{t('ms.plan')}</th><th>{t('ms.meals')}</th><th>{t('ms.price')}</th><th>{t('ms.people')}</th><th>{t('common.status')}</th></tr></thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong></td>
                  <td>{p.mealsIncluded.map((m) => t(`ms.meal.${m}` as MessageKey)).join(', ')}</td>
                  <td>{formatINR(toPaise(p.amount))} {p.billingType === 'FIXED' ? t('ms.perMonth') : t('ms.perMeal')}</td>
                  <td>{p.subscribers}</td>
                  <td><StatusBadge status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="section-title">{t('ms.week')}{menu?.effectiveFrom ? ` · ${t('ms.since', { date: menu.effectiveFrom })}` : ''}</h2>
      {!menu?.items.length ? <p className="muted">{t('ms.noMenuYet')}</p> : (
        <div className="table-wrap card" role="region" aria-label={t('ms.week')} tabIndex={0}>
          <table className="table menu-table">
            <thead><tr><th>{t('ms.day')}</th>{MEALS.map((m) => <th key={m}>{t(`ms.meal.${m}` as MessageKey)}</th>)}</tr></thead>
            <tbody>{days.map((d) => <tr key={d.n}><td><strong>{d.label}</strong></td>{MEALS.map((m) => <td key={m}>{menu.items.find((i) => i.dayOfWeek === d.n && i.meal === m)?.items ?? <span className="muted">—</span>}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}

      <Modal open={dialog === 'plan'} onClose={() => setDialog(null)} title={t('ms.addPlan')} onSubmit={save} submitLabel={t('tr.save')} busy={busy} error={error}>
        <Field id="mp-name" label={t('ms.plan')} error={errors.name}><input id="mp-name" value={form.name ?? ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Veg full board" /></Field>
        <fieldset className="check-group"><legend>{t('ms.meals')}</legend>
          {MEALS.map((m) => <label key={m} className="check"><input type="checkbox" checked={meals.includes(m)} onChange={(e) => setMeals((x) => (e.target.checked ? [...x, m] : x.filter((y) => y !== m)))} /> {t(`ms.meal.${m}` as MessageKey)}</label>)}
        </fieldset>
        <div className="grid-2">
          <Field id="mp-bill" label={t('ms.billing')}><select id="mp-bill" value={form.billingType} onChange={(e) => setForm((f) => ({ ...f, billingType: e.target.value }))}>{MESS_BILLING.map((b) => <option key={b} value={b}>{t(`ms.bill.${b}` as MessageKey)}</option>)}</select></Field>
          <Field id="mp-amt" label={form.billingType === 'FIXED' ? t('ms.amountMonth') : t('ms.amountMeal')} error={errors.amount}><input id="mp-amt" type="number" min={0} value={form.amount ?? ''} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} /></Field>
        </div>
      </Modal>

      <Modal open={dialog === 'sub'} onClose={() => setDialog(null)} title={t('ms.subscribe')} subtitle={t('ms.subscribeSub')} onSubmit={save} submitLabel={t('tr.save')} busy={busy} error={error}>
        <div className="tabs" role="tablist" aria-label={t('ms.who')}>
          {(['STUDENT', 'EMPLOYEE'] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => { setKind(k); setWho(null); }}>{k === 'STUDENT' ? t('tr.col.student') : t('ms.staff')}</button>)}
        </div>
        <Field id="lv-who" label={kind === 'STUDENT' ? t('tr.col.student') : t('ms.staff')}><PersonSearch kind={kind} value={who} onPick={setWho} /></Field>
        <div className="grid-2">
          <Field id="ms-plan" label={t('ms.plan')}><select id="ms-plan" value={form.planId} onChange={(e) => setForm((f) => ({ ...f, planId: e.target.value }))}>{(plans ?? []).filter((p) => p.status === 'ACTIVE').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field id="ms-from" label={t('tr.from')} error={errors.fromDate}><input id="ms-from" type="date" value={form.fromDate ?? ''} onChange={(e) => setForm((f) => ({ ...f, fromDate: e.target.value }))} /></Field>
        </div>
        {kind === 'STUDENT' && <label className="check"><input type="checkbox" checked={form.bill === 'yes'} onChange={(e) => setForm((f) => ({ ...f, bill: e.target.checked ? 'yes' : 'no' }))} /> {t('ms.billIt')}</label>}
      </Modal>

      <Modal open={dialog === 'menu'} onClose={() => setDialog(null)} title={t('ms.editMenu')} subtitle={t('ms.menuSub')} onSubmit={save} submitLabel={t('tr.save')} busy={busy} error={error} wide>
        <Field id="mn-from" label={t('ms.fromDate')}><input id="mn-from" type="date" value={form.effectiveFrom ?? ''} onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))} /></Field>
        <div className="table-wrap">
          <table className="table menu-edit">
            <thead><tr><th>{t('ms.day')}</th>{MEALS.map((m) => <th key={m}>{t(`ms.meal.${m}` as MessageKey)}</th>)}</tr></thead>
            <tbody>{days.map((d) => <tr key={d.n}><td><strong>{d.label}</strong></td>{MEALS.map((m) => <td key={m}><input aria-label={`${d.label} ${t(`ms.meal.${m}` as MessageKey)}`} value={grid[`${d.n}-${m}`] ?? ''} onChange={(e) => setGrid((g) => ({ ...g, [`${d.n}-${m}`]: e.target.value }))} /></td>)}</tr>)}</tbody>
          </table>
        </div>
      </Modal>
    </>
  );
}
