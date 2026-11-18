'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PERMISSIONS, REQUEST_PRIORITIES } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { todayIST } from '@/components/admissions';
import { PRIORITY_TONE, Pill, REQUEST_TONE, priorityKey, useDue, useWhen } from '@/components/engagement2';

interface Row { id: string; requestNo: string; title: string; category: string; priority: string; status: string; fromDepartment: string; toDepartment: string; assignedTo: string | null; neededBy: string | null; dueAt: string; createdAt: string; overdue: boolean }
interface Category { id: string; name: string; toDepartmentId: string; toDepartment: string; requiresApproval: boolean; slaHours: number; isActive: boolean }
interface FormData { myDepartmentId: string | null; myCampusId: string | null; departments: { id: string; name: string }[]; campuses: { id: string; name: string }[] }
type Box = 'mine' | 'dept' | 'all';

/** Department requests (M12.4): requests I raised, requests to my department, and (setup) all of them and the request types. */
export default function RequestsPage() {
  const { can } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const w = useWhen();
  const due = useDue();
  const setup = can(PERMISSIONS.DEPT_REQ_SETUP);
  const handle = can(PERMISSIONS.DEPT_REQ_HANDLE);
  const raise = can(PERMISSIONS.DEPT_REQ_RAISE);
  const boxes: Box[] = [...(raise ? ['mine' as Box] : []), ...(handle ? ['dept' as Box] : []), ...(setup ? ['all' as Box] : [])];
  const [box, setBox] = useState<Box>(boxes[0] ?? 'mine');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [fd, setFd] = useState<FormData | null>(null);
  const [open, setOpen] = useState(false);
  const [showTypes, setShowTypes] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setRows(null); api<Row[]>(`/dept-requests?box=${box}`).then(setRows).catch(() => setRows([])); }, [box]);
  const loadCats = useCallback(() => { api<Category[]>('/dept-requests/categories').then(setCats).catch(() => setCats([])); }, []);
  useEffect(load, [load]);
  useEffect(loadCats, [loadCats]);
  useEffect(() => { api<FormData>('/dept-requests/form').then(setFd).catch(() => setFd({ myDepartmentId: null, myCampusId: null, departments: [], campuses: [] })); }, []);
  const active = cats.filter((c) => c.isActive);
  const start = () => {
    const from = fd?.myDepartmentId ?? fd?.departments[0]?.id ?? '';
    setForm({ campusId: fd?.myCampusId ?? fd?.campuses[0]?.id ?? '', fromDepartmentId: from, categoryId: active.find((c) => c.toDepartmentId !== from)?.id ?? '', title: '', description: '', priority: 'MEDIUM', neededBy: '' });
    setErrors({}); setError(null); setOpen(true);
  };
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try {
      const r = await api<{ id: string; requestNo: string; status: string }>('/dept-requests', { method: 'POST', body: JSON.stringify({ ...form, neededBy: form.neededBy || null }) });
      toast(r.status === 'PENDING_APPROVAL' ? t('rq.sentApproval', { no: r.requestNo }) : t('rq.sent', { no: r.requestNo })); setOpen(false); window.location.href = `/requests/${r.id}`;
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const cat = cats.find((c) => c.id === form.categoryId);
  return (
    <>
      <PageHeader eyebrow={t('nav.operations')} title={t('rq.title')} description={t('rq.desc')}
        actions={<>{setup && <button type="button" className="btn" onClick={() => setShowTypes(true)}><Icon name="settings" /> {t('rq.types')}</button>}{raise && <button type="button" className="btn btn-primary" onClick={start} disabled={!active.length || !fd}><Icon name="plus" /> {t('rq.new')}</button>}</>} />
      {boxes.length > 1 && (
        <div className="tabs" role="tablist" aria-label={t('rq.title')}>
          {boxes.map((x) => <button key={x} role="tab" aria-selected={box === x} className={box === x ? 'on' : ''} onClick={() => setBox(x)}>{t(`rq.box.${x}` as MessageKey)}</button>)}
        </div>
      )}
      {setup && !cats.length && <p className="notice"><Icon name="info" /> {t('rq.noTypes')}</p>}
      {box === 'dept' && fd && !fd.myDepartmentId && <p className="notice"><Icon name="info" /> {t('rq.noDept')}</p>}
      {!rows ? <SkeletonRows rows={5} /> : !rows.length ? <EmptyState icon="layers" title={t(`rq.none.${box}` as MessageKey)} /> : (
        <div className="table-wrap card p12-table">
          <table className="table">
            <thead><tr><th scope="col">{t('rq.number')}</th><th scope="col">{t('rq.request')}</th><th scope="col">{box === 'mine' ? t('rq.to') : t('rq.fromTo')}</th><th scope="col">{t('rq.assigned')}</th><th scope="col">{t('rq.due')}</th><th scope="col">{t('common.status')}</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const d = due(r.dueAt, !['OPEN', 'IN_PROGRESS'].includes(r.status));
                return (
                  <tr key={r.id} className={r.status === 'CLOSED' || r.status === 'REJECTED' ? 'row-dim' : undefined}>
                    <td><Link href={`/requests/${r.id}`} className="code">{r.requestNo}</Link><span className="sub-line muted small">{w.dt(r.createdAt)}</span></td>
                    <td><Link href={`/requests/${r.id}`}>{r.title}</Link><span className="sub-line muted small">{r.category} · <Pill tone={PRIORITY_TONE[r.priority]}>{t(priorityKey(r.priority))}</Pill></span></td>
                    <td>{box === 'mine' ? r.toDepartment : `${r.fromDepartment} → ${r.toDepartment}`}</td>
                    <td>{r.assignedTo ?? <span className="muted">—</span>}</td>
                    <td>{d ? <span className={d.late ? 'text-bad' : undefined}>{d.text}</span> : '—'}{r.neededBy && <span className="sub-line muted small">{t('rq.neededBy', { d: w.date(r.neededBy) })}</span>}</td>
                    <td><Pill tone={REQUEST_TONE[r.status]}>{t(`rq.status.${r.status}` as MessageKey)}</Pill></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('rq.new')} subtitle={t('rq.newSub')} onSubmit={save} submitLabel={cat?.requiresApproval ? t('rq.sendApproval') : t('rq.send')} busy={busy} error={error} wide>
        <div className="grid-2">
          <Field id="rq-from" label={t('rq.from')} error={errors.fromDepartmentId}><select id="rq-from" value={form.fromDepartmentId} onChange={set('fromDepartmentId')}>{fd?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
          <Field id="rq-type" label={t('rq.type')} error={errors.categoryId}><select id="rq-type" value={form.categoryId} onChange={set('categoryId')}>{active.map((c) => <option key={c.id} value={c.id} disabled={c.toDepartmentId === form.fromDepartmentId}>{c.name} → {c.toDepartment}</option>)}</select></Field>
        </div>
        {fd && !fd.myCampusId && fd.campuses.length > 1 && <Field id="rq-campus" label={t('common.campus')} error={errors.campusId}><select id="rq-campus" value={form.campusId ?? ''} onChange={set('campusId')}>{fd.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
        <Field id="rq-title" label={t('rq.what')} error={errors.title}><input id="rq-title" value={form.title ?? ''} onChange={set('title')} placeholder={t('rq.whatPh')} /></Field>
        <Field id="rq-desc" label={t('rq.details')} error={errors.description}><textarea id="rq-desc" rows={4} value={form.description ?? ''} onChange={set('description')} /></Field>
        <div className="grid-2">
          <Field id="rq-pr" label={t('cp.priority')}><select id="rq-pr" value={form.priority} onChange={set('priority')}>{REQUEST_PRIORITIES.map((p) => <option key={p} value={p}>{t(priorityKey(p))}</option>)}</select></Field>
          <Field id="rq-need" label={t('rq.neededByLabel')} error={errors.neededBy}><input id="rq-need" type="date" min={todayIST()} value={form.neededBy ?? ''} onChange={set('neededBy')} /></Field>
        </div>
        {cat && <p className={cat.requiresApproval ? 'notice' : 'muted small'}>{cat.requiresApproval && <Icon name="info" />} {cat.requiresApproval ? t('rq.needsApproval') : t('rq.slaNote', { h: cat.slaHours, d: cat.toDepartment })}</p>}
      </Modal>
      {showTypes && <Types cats={cats} departments={fd?.departments ?? []} onClose={() => setShowTypes(false)} onSaved={loadCats} />}
    </>
  );
}

function Types({ cats, departments, onClose, onSaved }: { cats: Category[]; departments: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [edit, setEdit] = useState<Category | 'new' | null>(null);
  const [form, setForm] = useState({ name: '', toDepartmentId: '', requiresApproval: false, slaHours: '48', isActive: true });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = (c: Category | 'new') => {
    setEdit(c); setErrors({}); setError(null);
    setForm(c === 'new' ? { name: '', toDepartmentId: departments[0]?.id ?? '', requiresApproval: false, slaHours: '48', isActive: true } : { name: c.name, toDepartmentId: c.toDepartmentId, requiresApproval: c.requiresApproval, slaHours: String(c.slaHours), isActive: c.isActive });
  };
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!edit) return;
    setBusy(true); setErrors({}); setError(null);
    try {
      const body = edit === 'new' ? { name: form.name, toDepartmentId: form.toDepartmentId, requiresApproval: form.requiresApproval, slaHours: form.slaHours } : form;
      await api(edit === 'new' ? '/dept-requests/categories' : `/dept-requests/categories/${edit.id}`, { method: edit === 'new' ? 'POST' : 'PUT', body: JSON.stringify(body) });
      toast(t('rq.typeSaved')); setEdit(null); onSaved();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  if (edit) {
    return (
      <Modal open onClose={() => setEdit(null)} title={edit === 'new' ? t('rq.typeAdd') : edit.name} onSubmit={save} submitLabel={t('common.save')} busy={busy} error={error}>
        <Field id="rt-name" label={t('common.name')} error={errors.name}><input id="rt-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t('rq.typeNamePh')} /></Field>
        <div className="grid-2">
          <Field id="rt-dept" label={t('rq.handledBy')} error={errors.toDepartmentId}><select id="rt-dept" value={form.toDepartmentId} onChange={(e) => setForm((f) => ({ ...f, toDepartmentId: e.target.value }))}>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
          <Field id="rt-sla" label={t('rq.sla')} hint={t('rq.slaHint')} error={errors.slaHours}><input id="rt-sla" type="number" min={1} max={1440} value={form.slaHours} onChange={(e) => setForm((f) => ({ ...f, slaHours: e.target.value }))} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={form.requiresApproval} onChange={(e) => setForm((f) => ({ ...f, requiresApproval: e.target.checked }))} /> {t('rq.typeApproval')}</label>
        <p className="muted small">{t('rq.typeApprovalHint')}</p>
        {edit !== 'new' && <label className="check"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} /> {t('rq.typeActive')}</label>}
      </Modal>
    );
  }
  return (
    <Modal open onClose={onClose} title={t('rq.types')} subtitle={t('rq.typesSub')} onSubmit={(e) => { e.preventDefault(); onClose(); }} submitLabel={t('common.close')} hideCancel wide>
      {!cats.length ? <EmptyState icon="layers" title={t('rq.noTypes')} /> : (
        <ul className="p12-committees">
          {cats.map((c) => (
            <li key={c.id} className={`card${c.isActive ? '' : ' row-dim'}`}>
              <span><strong>{c.name}</strong> → {c.toDepartment}
                <span className="sub-line small muted">{t('rq.typeLine', { h: c.slaHours })}{c.requiresApproval ? ` · ${t('rq.typeNeedsApproval')}` : ''}{c.isActive ? '' : ` · ${t('rq.typeOff')}`}</span>
              </span>
              <button type="button" className="btn btn-sm" onClick={() => open(c)}><Icon name="edit" /> {t('common.edit')}</button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn-primary" onClick={() => open('new')} disabled={!departments.length}><Icon name="plus" /> {t('rq.typeAdd')}</button>
    </Modal>
  );
}
