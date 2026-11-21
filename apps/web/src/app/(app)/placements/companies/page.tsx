'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { PlcPill, usePlcOptions } from '@/components/placements';

interface Company { id: string; name: string; industry: string | null; website: string | null; hrName: string | null; hrEmail: string | null; hrPhone: string | null; address: string | null; status: string; blacklistReason: string | null; drives: number; offers: number }
const blank = { name: '', industry: '', website: '', hrName: '', hrEmail: '', hrPhone: '', address: '', status: 'ACTIVE', blacklistReason: '' };

/** Placements → Companies (M19.1): recruiters with their HR contact; blacklisted ones get no new drives. */
export default function CompaniesPage() {
  const { t } = useI18n();
  const toast = useToast();
  const [reload, setReload] = useState(0);
  const opts = usePlcOptions(reload);
  const [rows, setRows] = useState<Company[] | null>(null);
  const [form, setForm] = useState<(typeof blank & { id?: string }) | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<Company[]>('/placements/companies').then(setRows).catch(() => setRows([])); }, [reload]);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const { id, ...f } = form;
    setBusy(true); setErrors({}); setError(null);
    try {
      await api(id ? `/placements/companies/${id}` : '/placements/companies', { method: id ? 'PUT' : 'POST', body: JSON.stringify({ ...f, blacklistReason: f.status === 'BLACKLISTED' ? f.blacklistReason : null }) });
      toast(t('act.saved')); setForm(null); setReload((n) => n + 1);
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const manage = !!opts?.can.manage;
  const f = <K extends keyof typeof blank>(k: K, v: string) => setForm((x) => (x ? { ...x, [k]: v } : x));
  return (
    <>
      <PageHeader eyebrow={t('nav.placements')} title={t('plc.co.title')} description={t('plc.co.desc')}
        actions={manage && <button type="button" className="btn btn-primary" onClick={() => { setErrors({}); setError(null); setForm({ ...blank }); }}><Icon name="plus" /> {t('plc.co.new')}</button>} />
      {!rows ? <SkeletonRows rows={4} /> : !rows.length ? <EmptyState icon="building" title={t('plc.co.none')} text={t('plc.co.noneHint')} /> : (
        <div className="table-wrap card" role="region" aria-label={t('plc.co.title')} tabIndex={0}>
          <table className="table">
            <thead><tr><th scope="col">{t('plc.company')}</th><th scope="col">{t('plc.co.hr')}</th><th scope="col" className="num">{t('plc.co.drives')}</th><th scope="col" className="num">{t('plc.co.offers')}</th><th scope="col">{t('act.status')}</th>{manage && <th scope="col"><span className="sr-only">{t('common.actions')}</span></th>}</tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id}>
                <td><strong>{c.name}</strong><span className="sub-line muted small">{[c.industry, c.website].filter(Boolean).join(' · ')}</span></td>
                <td>{c.hrName ?? '—'}<span className="sub-line muted small">{[c.hrEmail, c.hrPhone].filter(Boolean).join(' · ')}</span></td>
                <td className="num">{c.drives}</td>
                <td className="num">{c.offers}</td>
                <td><PlcPill prefix="plc.cs" status={c.status} />{c.blacklistReason && <span className="sub-line muted small">{c.blacklistReason}</span>}</td>
                {manage && <td><button type="button" className="btn btn-sm btn-ghost icon-btn" aria-label={t('act.editNamed', { n: c.name })} onClick={() => { setErrors({}); setError(null); setForm({ id: c.id, name: c.name, industry: c.industry ?? '', website: c.website ?? '', hrName: c.hrName ?? '', hrEmail: c.hrEmail ?? '', hrPhone: c.hrPhone ?? '', address: c.address ?? '', status: c.status, blacklistReason: c.blacklistReason ?? '' }); }}><Icon name="edit" size={14} /></button></td>}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? t('plc.co.edit') : t('plc.co.new')} onSubmit={save} busy={busy} error={error} wide>
        {form && <>
          <div className="grid-2">
            <Field id="co-name" label={t('plc.co.name')} error={errors.name}><input id="co-name" value={form.name} onChange={(e) => f('name', e.target.value)} /></Field>
            <Field id="co-ind" label={t('plc.co.industry')} error={errors.industry}><input id="co-ind" value={form.industry} placeholder={t('plc.co.industryPh')} onChange={(e) => f('industry', e.target.value)} /></Field>
          </div>
          <Field id="co-web" label={t('plc.co.website')} error={errors.website}><input id="co-web" value={form.website} placeholder="https://" onChange={(e) => f('website', e.target.value)} /></Field>
          <div className="grid-3">
            <Field id="co-hr" label={t('plc.co.hrName')} error={errors.hrName}><input id="co-hr" value={form.hrName} onChange={(e) => f('hrName', e.target.value)} /></Field>
            <Field id="co-mail" label={t('plc.co.hrEmail')} error={errors.hrEmail}><input id="co-mail" type="email" value={form.hrEmail} onChange={(e) => f('hrEmail', e.target.value)} /></Field>
            <Field id="co-ph" label={t('plc.co.hrPhone')} error={errors.hrPhone}><input id="co-ph" inputMode="tel" value={form.hrPhone} onChange={(e) => f('hrPhone', e.target.value)} /></Field>
          </div>
          <Field id="co-addr" label={t('plc.co.address')} error={errors.address}><input id="co-addr" value={form.address} onChange={(e) => f('address', e.target.value)} /></Field>
          <div className="grid-2">
            <Field id="co-st" label={t('act.status')} error={errors.status}><select id="co-st" value={form.status} onChange={(e) => f('status', e.target.value)}><option value="ACTIVE">{t('plc.cs.ACTIVE')}</option><option value="BLACKLISTED">{t('plc.cs.BLACKLISTED')}</option></select></Field>
            {form.status === 'BLACKLISTED' && <Field id="co-why" label={t('plc.co.why')} error={errors.blacklistReason}><input id="co-why" value={form.blacklistReason} onChange={(e) => f('blacklistReason', e.target.value)} /></Field>}
          </div>
        </>}
      </Modal>
    </>
  );
}
