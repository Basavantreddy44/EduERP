'use client';

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { FEE_TYPES, FINE_TYPES, PERMISSIONS, createFeeHeadSchema, formatINR, lateFeeRuleSchema } from '@eduerp/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { apiErrors, FieldErrors, validate } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { Column, DataTable } from '@/components/DataTable';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { FeeHead, FeeOptions, Money, amountOk, paiseOf, useFeeOptions } from '@/components/fees';

type Tab = 'structures' | 'heads' | 'late';
interface StructureRow {
  id: string; name: string; feeGroup: string | null; status: string; totalAmount: string; revisionOfId: string | null;
  campus: { code: string; name: string }; academicYear: { id: string; name: string };
  level: { id: string; name: string; sequence: number; program: { id: string; name: string } };
  instalments: { instalmentNo: number; name: string; dueDate: string }[]; _count: { items: number };
}
interface Rule {
  id: string; name: string; campusId: string | null; feeHeadId: string | null; graceDays: number; fineType: string; fineValue: string; maxFine: string | null; status: string;
  campus: { code: string; name: string } | null; feeHead: { name: string; code: string } | null;
}

function SetupInner() {
  const { can } = useSession();
  const { t } = useI18n();
  const params = useSearchParams();
  const path = usePathname();
  const tab = (params.get('tab') as Tab) || 'structures';
  const setTab = (x: Tab) => window.history.replaceState(null, '', x === 'structures' ? path : `${path}?tab=${x}`);
  const { opts, reload } = useFeeOptions();
  const canManage = can(PERMISSIONS.FEE_SETUP_MANAGE);
  const activeHeads = (opts?.heads ?? []).filter((h) => h.status === 'ACTIVE').length;

  const TABS: { key: Tab; label: string; icon: 'layers' | 'rupee' | 'clock' }[] = [
    { key: 'structures', label: t('fee.tab.structures'), icon: 'layers' },
    { key: 'heads', label: t('fee.tab.heads'), icon: 'rupee' },
    { key: 'late', label: t('fee.tab.late'), icon: 'clock' },
  ];

  return (
    <>
      <PageHeader
        eyebrow={t('nav.fees')}
        title={t('fee.setup.title')}
        description={t('fee.setup.desc')}
        actions={canManage && (
          <>
            <Link className="btn" href="/imports" title={t('cr.importHint')}><Icon name="upload" /> {t('cr.importOpening')}</Link>
            {tab === 'structures' && activeHeads > 0 && <Link className="btn btn-primary" href="/fees/structures/new"><Icon name="plus" /> {t('fee.struct.new')}</Link>}
          </>
        )}
      />
      <div className="tabs scroll" role="tablist" aria-label={t('fee.setup.title')}>
        {TABS.map((x) => (
          <button key={x.key} role="tab" type="button" aria-selected={tab === x.key} className={`tab ${tab === x.key ? 'on' : ''}`} onClick={() => setTab(x.key)}>
            {x.label}
            {x.key === 'heads' && opts && <span className="tab-count">{activeHeads}</span>}
          </button>
        ))}
      </div>
      <div className="tab-panel">
        {!opts ? <SkeletonRows rows={5} /> : tab === 'structures' ? <Structures opts={opts} canManage={canManage} onNeedHeads={() => setTab('heads')} /> : tab === 'heads' ? <Heads opts={opts} canManage={canManage} reload={reload} /> : <LateFees opts={opts} canManage={canManage} />}
      </div>
    </>
  );
}

// ───────────── Structures ─────────────

function Structures({ opts, canManage, onNeedHeads }: { opts: FeeOptions; canManage: boolean; onNeedHeads: () => void }) {
  const { t } = useI18n();
  const { campusId } = useSession();
  const current = opts.years.find((y) => y.isCurrent)?.id ?? opts.years[0]?.id ?? '';
  const [yearId, setYearId] = useState(current);
  const [rows, setRows] = useState<StructureRow[] | null>(null);
  useEffect(() => {
    if (!yearId) return setRows([]);
    setRows(null);
    const q = new URLSearchParams({ academicYearId: yearId, ...(campusId ? { campusId } : {}) });
    api<StructureRow[]>(`/fees/structures?${q}`).then(setRows).catch(() => setRows([]));
  }, [yearId, campusId]);

  if (opts.heads.filter((h) => h.status === 'ACTIVE').length === 0) {
    return (
      <EmptyState icon="rupee" title={t('fee.struct.noHeadsTitle')} text={t('fee.struct.noHeadsText')}
        action={canManage ? <button type="button" className="btn btn-primary" onClick={onNeedHeads}><Icon name="plus" /> {t('fee.head.new')}</button> : undefined} />
    );
  }
  const shown = rows ?? [];
  const live = shown.filter((r) => r.status === 'ACTIVE');
  const classesWithFees = new Set(live.map((r) => r.level.id)).size;
  const allClasses = opts.programs.filter((p) => !campusId || p.campusId === campusId).reduce((a, p) => a + p.levels.length, 0);

  const columns: Column<StructureRow>[] = [
    {
      key: 'class', header: t('stu.col.class'), sort: (r) => `${r.level.program.name}|${String(r.level.sequence).padStart(3, '0')}`,
      cell: (r) => <span><strong>{r.level.name}</strong><span className="sub-line muted">{r.level.program.name}{opts.campuses.length > 1 ? ` · ${r.campus.code}` : ''}</span></span>,
    },
    {
      key: 'name', header: t('fee.struct.name'), sort: (r) => r.name,
      cell: (r) => (
        <Link href={`/fees/structures/${r.id}`} className="cell-link">
          <strong>{r.name}</strong>
          <span className="sub-line">{r.feeGroup && <span className="chip chip-sm">{r.feeGroup}</span>}{r.revisionOfId && r.status === 'DRAFT' && <span className="chip chip-sm chip-gold">{t('fee.struct.revision')}</span>}</span>
        </Link>
      ),
    },
    { key: 'inst', header: t('fee.struct.instalments'), cell: (r) => <span>{r.instalments.length}<span className="sub-line muted small">{r.instalments.length ? t('fee.struct.firstDue', { date: new Date(r.instalments[0].dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }) }) : ''}</span></span> },
    { key: 'total', header: t('fee.struct.total'), align: 'right', sort: (r) => paiseOf(r.totalAmount), cell: (r) => <Money value={r.totalAmount} className="strong" /> },
    { key: 'status', header: t('common.status'), sort: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'go', header: <span className="sr-only">{t('common.open')}</span>, align: 'right', cell: (r) => <Link className="btn btn-sm btn-ghost" href={`/fees/structures/${r.id}`} aria-label={`${t('common.open')} ${r.name}`}><Icon name="chevronRight" size={16} /></Link> },
  ];

  return (
    <>
      <div className="toolbar">
        <label className="filter">
          <span>{t('adm.year')}</span>
          <select value={yearId} onChange={(e) => setYearId(e.target.value)}>
            {opts.years.map((y) => <option key={y.id} value={y.id}>{y.name}{y.isCurrent ? ` · ${t('stu.current')}` : ''}</option>)}
          </select>
        </label>
        {rows && (
          <p className="toolbar-note muted">
            <Icon name="info" size={15} /> {t('fee.struct.coverage', { n: classesWithFees, total: allClasses })}
          </p>
        )}
      </div>
      {rows === null ? <SkeletonRows rows={5} /> : rows.length === 0 ? (
        <EmptyState icon="layers" title={t('fee.struct.emptyTitle')} text={t('fee.struct.emptyText')}
          action={canManage ? <Link className="btn btn-primary" href={`/fees/structures/new?year=${yearId}`}><Icon name="plus" /> {t('fee.struct.new')}</Link> : undefined} />
      ) : (
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} initialSort={{ key: 'class', dir: 'asc' }} rowClass={(r) => (r.status === 'CLOSED' ? 'row-muted' : undefined)} caption={t('fee.tab.structures')} />
      )}
    </>
  );
}

// ───────────── Fee heads ─────────────

function Heads({ opts, canManage, reload }: { opts: FeeOptions; canManage: boolean; reload: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [edit, setEdit] = useState<FeeHead | 'new' | null>(null);
  const [v, setV] = useState({ name: '', code: '', feeType: 'ACADEMIC', incomeAccountId: '', isRefundable: false, gstApplicable: false, active: true });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = (h: FeeHead | 'new') => {
    setErrors({}); setError(null); setEdit(h);
    setV(h === 'new'
      ? { name: '', code: '', feeType: 'ACADEMIC', incomeAccountId: '', isRefundable: false, gstApplicable: false, active: true }
      : { name: h.name, code: h.code, feeType: h.feeType, incomeAccountId: h.incomeAccount.id, isRefundable: h.isRefundable, gstApplicable: h.gstApplicable, active: h.status === 'ACTIVE' });
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = { name: v.name.trim(), code: v.code.trim(), feeType: v.feeType, incomeAccountId: v.incomeAccountId || null, isRefundable: v.isRefundable, gstApplicable: v.gstApplicable };
    const r = validate(createFeeHeadSchema, body);
    if (!r.ok) return setErrors(r.errors);
    setBusy(true); setError(null);
    try {
      if (edit === 'new') await api('/fees/heads', { method: 'POST', body: JSON.stringify(body) });
      else if (edit) await api(`/fees/heads/${edit.id}`, { method: 'PATCH', body: JSON.stringify({ ...body, code: undefined, status: v.active ? 'ACTIVE' : 'INACTIVE' }) });
      toast(t('fee.head.saved', { name: body.name }));
      setEdit(null);
      reload();
    } catch (err) {
      const x = apiErrors(err); setErrors(x.fields); setError(x.message);
    } finally { setBusy(false); }
  }

  const columns: Column<FeeHead>[] = [
    { key: 'name', header: t('common.name'), sort: (h) => h.name, cell: (h) => <span><strong>{h.name}</strong><span className="sub-line muted mono">{h.code}</span></span> },
    { key: 'type', header: t('common.type'), sort: (h) => h.feeType, cell: (h) => t(`fee.type.${h.feeType}` as MessageKey) },
    { key: 'acc', header: t('fee.head.postsTo'), cell: (h) => <span>{h.incomeAccount.name}<span className="sub-line muted mono">{h.incomeAccount.code}</span></span> },
    { key: 'flags', header: t('fee.head.flags'), cell: (h) => <span className="chip-row">{h.isRefundable && <span className="chip chip-sm">{t('fee.head.refundable')}</span>}{h.gstApplicable && <span className="chip chip-sm">GST</span>}{!h.isRefundable && !h.gstApplicable && <span className="muted">—</span>}</span> },
    { key: 'status', header: t('common.status'), cell: (h) => <StatusBadge status={h.status} /> },
    ...(canManage ? [{ key: 'edit', header: <span className="sr-only">{t('stu.editParent')}</span>, align: 'right' as const, cell: (h: FeeHead) => <button type="button" className="btn btn-sm btn-ghost" onClick={() => open(h)} aria-label={`${t('stu.editParent')} ${h.name}`}><Icon name="edit" size={15} /></button> }] : []),
  ];

  return (
    <>
      <div className="toolbar">
        <p className="toolbar-note muted"><Icon name="info" size={15} /> {t('fee.head.hint')}</p>
        {canManage && <button type="button" className="btn btn-primary" onClick={() => open('new')}><Icon name="plus" /> {t('fee.head.new')}</button>}
      </div>
      {opts.heads.length === 0 ? <EmptyState icon="rupee" title={t('fee.head.emptyTitle')} text={t('fee.head.emptyText')} /> : (
        <DataTable rows={opts.heads} columns={columns} rowKey={(h) => h.id} rowClass={(h) => (h.status !== 'ACTIVE' ? 'row-muted' : undefined)} caption={t('fee.tab.heads')} />
      )}
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit === 'new' ? t('fee.head.new') : t('fee.head.edit')} subtitle={edit === 'new' ? t('fee.head.newSub') : edit.code} onSubmit={submit} submitLabel={t('common.save')} busy={busy} error={error}>
          <div className="grid-2">
            <Field id="h-name" label={t('common.name')} error={errors.name}><input id="h-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder={t('fee.head.namePh')} /></Field>
            <Field id="h-code" label={t('common.code')} error={errors.code} hint={edit === 'new' ? t('fee.head.codeHint') : undefined}><input id="h-code" className="mono" value={v.code} disabled={edit !== 'new'} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} placeholder="TUITION" /></Field>
          </div>
          <Field id="h-type" label={t('common.type')} error={errors.feeType}>
            <select id="h-type" value={v.feeType} onChange={(e) => setV({ ...v, feeType: e.target.value, incomeAccountId: edit === 'new' ? '' : v.incomeAccountId })}>
              {FEE_TYPES.map((x) => <option key={x} value={x}>{t(`fee.type.${x}` as MessageKey)}</option>)}
            </select>
          </Field>
          <Field id="h-acc" label={t('fee.head.postsTo')} hint={t('fee.head.accountHint')} error={errors.incomeAccountId}>
            <select id="h-acc" value={v.incomeAccountId} onChange={(e) => setV({ ...v, incomeAccountId: e.target.value })}>
              {edit === 'new' && <option value="">{t('fee.head.accountAuto')}</option>}
              {(['INCOME', 'LIABILITY'] as const).map((g) => (
                <optgroup key={g} label={t(`fee.acc.${g}` as MessageKey)}>
                  {opts.accounts.filter((a) => a.accountType === g).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>
          <label className="check"><input type="checkbox" checked={v.isRefundable} onChange={(e) => setV({ ...v, isRefundable: e.target.checked })} /> {t('fee.head.refundableCheck')}</label>
          <label className="check"><input type="checkbox" checked={v.gstApplicable} onChange={(e) => setV({ ...v, gstApplicable: e.target.checked })} /> {t('fee.head.gstCheck')}</label>
          {edit !== 'new' && <label className="check"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> {t('fee.head.activeCheck')}</label>}
        </Modal>
      )}
    </>
  );
}

// ───────────── Late fees ─────────────

function LateFees({ opts, canManage }: { opts: FeeOptions; canManage: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [edit, setEdit] = useState<Rule | 'new' | null>(null);
  const blank = { name: '', campusId: '', feeHeadId: '', graceDays: '7', fineType: 'FIXED', fineValue: '', maxFine: '', active: true };
  const [v, setV] = useState(blank);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Rule[]>('/fees/late-fee-rules').then(setRules).catch(() => setRules([])); }, []);
  useEffect(load, [load]);

  const describe = (r: { fineType: string; fineValue: string; maxFine: string | null; graceDays: number }) => {
    const base = r.fineType === 'PERCENT' ? t('fee.late.descPercent', { v: Number(r.fineValue) }) : r.fineType === 'PER_DAY' ? t('fee.late.descPerDay', { v: formatINR(paiseOf(r.fineValue)) }) : t('fee.late.descFixed', { v: formatINR(paiseOf(r.fineValue)) });
    return `${base}${r.maxFine ? ` · ${t('fee.late.capAt', { v: formatINR(paiseOf(r.maxFine)) })}` : ''}`;
  };
  const open = (r: Rule | 'new') => {
    setErrors({}); setError(null); setEdit(r);
    setV(r === 'new' ? blank : { name: r.name, campusId: r.campusId ?? '', feeHeadId: r.feeHeadId ?? '', graceDays: String(r.graceDays), fineType: r.fineType, fineValue: r.fineValue, maxFine: r.maxFine ?? '', active: r.status === 'ACTIVE' });
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!amountOk(v.fineValue) || !amountOk(v.maxFine)) return setErrors({ ...(amountOk(v.fineValue) ? {} : { fineValue: t('fee.amountInvalid') }), ...(amountOk(v.maxFine) ? {} : { maxFine: t('fee.amountInvalid') }) });
    const body = { name: v.name.trim(), campusId: v.campusId || null, feeHeadId: v.feeHeadId || null, graceDays: Number(v.graceDays || 0), fineType: v.fineType, fineValue: v.fineValue.trim() || '0', maxFine: v.maxFine.trim() || null };
    const r = validate(lateFeeRuleSchema, body);
    if (!r.ok) return setErrors(r.errors);
    setBusy(true); setError(null);
    try {
      if (edit === 'new') await api('/fees/late-fee-rules', { method: 'POST', body: JSON.stringify(body) });
      else if (edit) await api(`/fees/late-fee-rules/${edit.id}`, { method: 'PATCH', body: JSON.stringify({ ...body, status: v.active ? 'ACTIVE' : 'INACTIVE' }) });
      toast(t('fee.late.saved'));
      setEdit(null);
      load();
    } catch (err) {
      const x = apiErrors(err); setErrors(x.fields); setError(x.message);
    } finally { setBusy(false); }
  }
  const preview = useMemo(() => {
    if (!v.fineValue || !amountOk(v.fineValue) || (v.maxFine && !amountOk(v.maxFine))) return null;
    return describe({ fineType: v.fineType, fineValue: v.fineValue.replace(/,/g, ''), maxFine: v.maxFine ? v.maxFine.replace(/,/g, '') : null, graceDays: Number(v.graceDays || 0) });
  }, [v]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns: Column<Rule>[] = [
    { key: 'name', header: t('common.name'), cell: (r) => <strong>{r.name}</strong> },
    { key: 'applies', header: t('fee.late.appliesTo'), cell: (r) => <span>{r.feeHead?.name ?? t('fee.late.allHeads')}<span className="sub-line muted">{r.campus?.name ?? t('common.allCampuses')}</span></span> },
    { key: 'grace', header: t('fee.late.grace'), cell: (r) => t('fee.late.days', { n: r.graceDays }) },
    { key: 'fine', header: t('fee.late.fine'), cell: (r) => describe(r) },
    { key: 'status', header: t('common.status'), cell: (r) => <StatusBadge status={r.status} /> },
    ...(canManage ? [{ key: 'edit', header: <span className="sr-only">{t('stu.editParent')}</span>, align: 'right' as const, cell: (r: Rule) => <button type="button" className="btn btn-sm btn-ghost" onClick={() => open(r)} aria-label={`${t('stu.editParent')} ${r.name}`}><Icon name="edit" size={15} /></button> }] : []),
  ];
  const activeHeads = opts.heads.filter((h) => h.status === 'ACTIVE');

  return (
    <>
      <div className="toolbar">
        <p className="toolbar-note muted"><Icon name="info" size={15} /> {t('fee.late.hint')}</p>
        {canManage && <button type="button" className="btn btn-primary" onClick={() => open('new')}><Icon name="plus" /> {t('fee.late.new')}</button>}
      </div>
      {rules === null ? <SkeletonRows rows={3} /> : rules.length === 0 ? <EmptyState icon="clock" title={t('fee.late.emptyTitle')} text={t('fee.late.emptyText')} /> : (
        <DataTable rows={rules} columns={columns} rowKey={(r) => r.id} rowClass={(r) => (r.status !== 'ACTIVE' ? 'row-muted' : undefined)} caption={t('fee.tab.late')} />
      )}
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit === 'new' ? t('fee.late.new') : t('fee.late.edit')} onSubmit={submit} submitLabel={t('common.save')} busy={busy} error={error}>
          <Field id="l-name" label={t('common.name')} error={errors.name}><input id="l-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder={t('fee.late.namePh')} /></Field>
          <div className="grid-2">
            <Field id="l-head" label={t('fee.late.feeHead')} error={errors.feeHeadId}>
              <select id="l-head" value={v.feeHeadId} onChange={(e) => setV({ ...v, feeHeadId: e.target.value })}>
                <option value="">{t('fee.late.allHeads')}</option>
                {activeHeads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </Field>
            <Field id="l-campus" label={t('common.campus')} error={errors.campusId}>
              <select id="l-campus" value={v.campusId} onChange={(e) => setV({ ...v, campusId: e.target.value })}>
                <option value="">{t('common.allCampuses')}</option>
                {opts.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="field">
            <span className="label">{t('fee.late.howCharged')}</span>
            <div className="segmented" role="radiogroup" aria-label={t('fee.late.howCharged')}>
              {FINE_TYPES.map((x) => <button key={x} type="button" role="radio" aria-checked={v.fineType === x} className={v.fineType === x ? 'on' : ''} onClick={() => setV({ ...v, fineType: x })}>{t(`fee.late.type.${x}` as MessageKey)}</button>)}
            </div>
          </div>
          <div className="grid-3">
            <Field id="l-value" label={v.fineType === 'PERCENT' ? t('fee.late.percent') : t('fee.late.amount')} error={errors.fineValue}>
              <div className={`input-affix ${v.fineType === 'PERCENT' ? 'suffix' : ''}`}>
                <span aria-hidden>{v.fineType === 'PERCENT' ? '%' : '₹'}</span>
                <input id="l-value" inputMode="decimal" value={v.fineValue} onChange={(e) => setV({ ...v, fineValue: e.target.value })} />
              </div>
            </Field>
            <Field id="l-grace" label={t('fee.late.grace')} hint={t('fee.late.graceHint')} error={errors.graceDays}><input id="l-grace" type="number" min={0} max={365} value={v.graceDays} onChange={(e) => setV({ ...v, graceDays: e.target.value })} /></Field>
            <Field id="l-max" label={t('fee.late.max')} error={errors.maxFine}>
              <div className="input-affix"><span aria-hidden>₹</span><input id="l-max" inputMode="decimal" value={v.maxFine} onChange={(e) => setV({ ...v, maxFine: e.target.value })} /></div>
            </Field>
          </div>
          {preview && <p className="note-info"><Icon name="info" size={15} /> {t('fee.late.preview', { grace: Number(v.graceDays || 0), rule: preview })}</p>}
          {edit !== 'new' && <label className="check"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> {t('fee.late.activeCheck')}</label>}
        </Modal>
      )}
    </>
  );
}

export default function FeeSetupPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={5} />}>
      <SetupInner />
    </Suspense>
  );
}
