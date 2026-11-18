'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CERTIFICATE_TYPES, CERT_LANGUAGES, CERT_PLACEHOLDERS, PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { PersonSearch } from '@/components/leave';

interface Cert { id: string; studentId: string; student: string; admissionNo: string; certificateType: string; title: string; language: string; purpose: string; certificateNo: string | null; issueDate: string | null; status: string; createdAt: string }
interface Template { id: string; certificateType: string; name: string; language: string; title: string; body: string; requiresApproval: boolean }
type Pick = { id: string; label: string; sub: string };

/** Students → Certificates (M10.3): bonafide, study, character and conduct certificates; templates. */
export default function CertificatesPage() {
  const { can } = useSession();
  const { t } = useI18n();
  const [tab, setTab] = useState<'issued' | 'templates'>('issued');
  return (
    <>
      <PageHeader eyebrow={t('nav.students')} title={t('ct.title')} description={t('ct.desc')} />
      <div className="tabs" role="tablist" aria-label={t('ct.title')}>
        {(['issued', 'templates'] as const).map((x) => <button key={x} type="button" role="tab" id={`tab-${x}`} aria-selected={tab === x} aria-controls={`panel-${x}`} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(`ct.tab.${x}` as MessageKey)}</button>)}
      </div>
      <section role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="ac-panel">
        {tab === 'issued' ? <Issued canIssue={can(PERMISSIONS.CERT_ISSUE)} /> : <Templates canSetup={can(PERMISSIONS.CERT_SETUP)} />}
      </section>
    </>
  );
}

function Issued({ canIssue }: { canIssue: boolean }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [rows, setRows] = useState<Cert[] | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [open, setOpen] = useState(false);
  const [student, setStudent] = useState<Pick | null>(null);
  const [form, setForm] = useState({ templateId: '', purpose: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Cert[]>('/certificates').then(setRows).catch(() => setRows([])); api<Template[]>('/certificates/templates').then(setTemplates).catch(() => setTemplates([])); }, []);
  useEffect(load, [load]);
  const start = () => { setStudent(null); setForm({ templateId: templates[0]?.id ?? '', purpose: '' }); setErrors({}); setError(null); setOpen(true); };
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!student) { setErrors({ studentId: t('ct.pickStudent') }); return; }
    setBusy(true); setErrors({}); setError(null);
    try {
      const r = await api<{ id: string; status: string; certificateNo?: string }>('/certificates', { method: 'POST', body: JSON.stringify({ studentId: student.id, ...form }) });
      toast(r.status === 'ISSUED' ? t('ct.issuedToast', { no: r.certificateNo ?? '' }) : t('ct.waitingToast'));
      setOpen(false); load();
      if (r.status === 'ISSUED') window.location.href = `/certificates/${r.id}`;
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const d = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
  const tpl = templates.find((x) => x.id === form.templateId);
  if (!rows) return <SkeletonRows rows={5} />;
  return (
    <>
      <div className="panel-head">
        <p className="muted">{t('ct.hint')}</p>
        {canIssue && <button type="button" className="btn btn-primary" onClick={start} disabled={!templates.length}><Icon name="plus" /> {t('ct.new')}</button>}
      </div>
      {!templates.length && <p className="notice"><Icon name="info" /> {t('ct.noTemplates')}</p>}
      {!rows.length ? <EmptyState icon="file" title={t('ct.none')} text={canIssue ? t('ct.noneHint') : undefined} /> : (
        <div className="table-wrap card">
          <table className="table">
            <thead><tr><th scope="col">{t('ct.number')}</th><th scope="col">{t('ex.card.student')}</th><th scope="col">{t('ct.certificate')}</th><th scope="col">{t('ct.purpose')}</th><th scope="col">{t('ct.issued')}</th><th scope="col">{t('common.status')}</th><th scope="col"><span className="sr-only">{t('common.actions')}</span></th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className={c.status === 'CANCELLED' ? 'row-dim' : undefined}>
                  <td><span className="code">{c.certificateNo ?? '—'}</span></td>
                  <td><Link href={`/students/${c.studentId}`}>{c.student}</Link><span className="sub-line muted">{c.admissionNo}</span></td>
                  <td>{c.title}{c.language === 'kn' && <span className="sub-line muted">{t('ct.lang.kn')}</span>}</td>
                  <td>{c.purpose}</td>
                  <td>{d(c.issueDate)}</td>
                  <td><StatusBadge status={c.status} label={t(`ct.status.${c.status}` as MessageKey)} /></td>
                  <td className="row-actions">{c.status !== 'REQUESTED' && c.status !== 'REJECTED' && <Link href={`/certificates/${c.id}`} className="btn btn-sm" aria-label={t('ct.openNamed', { name: c.student })}><Icon name="file" /> {t('ct.open')}</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('ct.new')} onSubmit={save} submitLabel={tpl?.requiresApproval ? t('ct.request') : t('ct.issue')} busy={busy} error={error}>
        <Field id="ct-student" label={t('ex.card.student')} error={errors.studentId}><PersonSearch kind="STUDENT" value={student} onPick={setStudent} /></Field>
        <Field id="ct-tpl" label={t('ct.certificate')} error={errors.templateId}>
          <select id="ct-tpl" value={form.templateId} onChange={(e) => setForm((f) => ({ ...f, templateId: e.target.value }))}>{templates.map((x) => <option key={x.id} value={x.id}>{x.name}{x.language === 'kn' ? ` (${t('ct.lang.kn')})` : ''}</option>)}</select>
        </Field>
        <Field id="ct-purpose" label={t('ct.purpose')} hint={t('ct.purposeHint')} error={errors.purpose}><input id="ct-purpose" value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))} placeholder={t('ct.purposePh')} /></Field>
        {tpl?.requiresApproval && <p className="notice"><Icon name="info" /> {t('ct.needsApproval')}</p>}
      </Modal>
    </>
  );
}

function Templates({ canSetup }: { canSetup: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const [rows, setRows] = useState<Template[] | null>(null);
  const [edit, setEdit] = useState<Template | 'new' | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Template[]>('/certificates/templates').then(setRows).catch(() => setRows([])); }, []);
  useEffect(load, [load]);
  const defaults = async () => { const r = await api<{ added: number }>('/certificates/templates/defaults', { method: 'POST', body: '{}' }); toast(t('ct.tpl.added', { n: r.added })); load(); };
  const open = (x: Template | 'new') => { setForm(x === 'new' ? { certificateType: 'BONAFIDE', name: '', language: 'en', title: '', body: '', requiresApproval: false } : { ...x }); setErrors({}); setError(null); setEdit(x); };
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    const body = { certificateType: form.certificateType, name: form.name, language: form.language, title: form.title, body: form.body, requiresApproval: !!form.requiresApproval };
    try { await api(edit === 'new' ? '/certificates/templates' : `/certificates/templates/${(edit as Template).id}`, { method: edit === 'new' ? 'POST' : 'PUT', body: JSON.stringify(body) }); toast(t('ct.tpl.saved', { name: String(form.name) })); setEdit(null); load(); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  if (!rows) return <SkeletonRows rows={4} />;
  return (
    <>
      <div className="panel-head">
        <p className="muted">{t('ct.tpl.hint')}</p>
        {canSetup && <span className="row-actions"><button type="button" className="btn" onClick={() => void defaults()}><Icon name="sparkle" /> {t('ct.tpl.defaults')}</button><button type="button" className="btn btn-primary" onClick={() => open('new')}><Icon name="plus" /> {t('ct.tpl.add')}</button></span>}
      </div>
      {!rows.length ? <EmptyState icon="file" title={t('ct.tpl.none')} text={t('ct.tpl.noneHint')} /> : (
        <ul className="ct-templates">
          {rows.map((x) => (
            <li key={x.id} className="card ct-template">
              <div className="scheme-head">
                <div><strong className="card-title" lang={x.language}>{x.name}</strong><p className="muted small">{t(`ct.type.${x.certificateType}` as MessageKey)} · {t(`ct.lang.${x.language}` as MessageKey)}{x.requiresApproval ? ` · ${t('ct.tpl.approval')}` : ''}</p></div>
                {canSetup && <button type="button" className="btn btn-sm" onClick={() => open(x)} aria-label={t('ac.editNamed', { name: x.name })}><Icon name="edit" /> {t('common.edit')}</button>}
              </div>
              <p className="ct-preview" lang={x.language}>{x.body.slice(0, 220)}{x.body.length > 220 ? '…' : ''}</p>
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? t('ct.tpl.add') : t('ct.tpl.edit')} onSubmit={save} submitLabel={t('tr.save')} busy={busy} error={error} wide>
        <div className="grid-2">
          <Field id="tp-type" label={t('ct.tpl.type')} error={errors.certificateType}><select id="tp-type" value={String(form.certificateType)} onChange={set('certificateType')}>{CERTIFICATE_TYPES.map((x) => <option key={x} value={x}>{t(`ct.type.${x}` as MessageKey)}</option>)}</select></Field>
          <Field id="tp-lang" label={t('ct.tpl.language')} error={errors.language}><select id="tp-lang" value={String(form.language)} onChange={set('language')}>{CERT_LANGUAGES.map((x) => <option key={x} value={x}>{t(`ct.lang.${x}` as MessageKey)}</option>)}</select></Field>
        </div>
        <div className="grid-2">
          <Field id="tp-name" label={t('ct.tpl.name')} error={errors.name}><input id="tp-name" value={String(form.name ?? '')} onChange={set('name')} /></Field>
          <Field id="tp-title" label={t('ct.tpl.heading')} error={errors.title}><input id="tp-title" lang={String(form.language)} value={String(form.title ?? '')} onChange={set('title')} /></Field>
        </div>
        <Field id="tp-body" label={t('ct.tpl.body')} hint={t('ct.tpl.bodyHint')} error={errors.body}><textarea id="tp-body" lang={String(form.language)} rows={10} value={String(form.body ?? '')} onChange={set('body')} /></Field>
        <p className="chip-row" aria-label={t('ct.tpl.placeholders')}>{CERT_PLACEHOLDERS.map((p) => <button key={p} type="button" className="chip chip-btn" onClick={() => setForm((f) => ({ ...f, body: `${f.body ?? ''}{{${p}}}` }))}>{`{{${p}}}`}</button>)}</p>
        <label className="check"><input type="checkbox" checked={!!form.requiresApproval} onChange={(e) => setForm((f) => ({ ...f, requiresApproval: e.target.checked }))} /> {t('ct.tpl.needsApproval')}</label>
      </Modal>
    </>
  );
}
