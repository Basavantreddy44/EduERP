'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ENQUIRY_SOURCES, FOLLOWUP_MODES, PERMISSIONS, addFollowupSchema, createEnquirySchema } from '@eduerp/shared';
import { api, newIdempotencyKey } from '@/lib/api';
import { useSession } from '@/lib/session';
import { apiErrors, FieldErrors, validate } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { DataTable } from '@/components/DataTable';
import { EmptyState, PageHeader, SkeletonRows, StatTile, StatusBadge, useToast } from '@/components/ui';
import { ClassSelect, todayIST, useAdmissionOptions, useDay } from '@/components/admissions';

interface Row {
  id: string; enquiryNo: string; studentName: string; parentName: string; phone: string; source: string; status: string;
  nextFollowUp: string | null; createdAt: string; campusId: string;
  level: { name: string; program: { name: string } }; campus: { code: string }; _count: { followups: number };
}
interface Detail extends Omit<Row, '_count'> {
  dob: string | null; email: string | null; notes: string | null;
  academicYear: { name: string };
  followups: { id: string; mode: string; remarks: string; status: string; nextFollowUp: string | null; createdAt: string }[];
  applications: { id: string; applicationNo: string; status: string }[];
}
type Filter = 'ALL' | 'DUE' | 'NEW' | 'FOLLOW_UP' | 'INTERESTED' | 'CONVERTED' | 'LOST';
const FILTERS: Filter[] = ['ALL', 'DUE', 'NEW', 'FOLLOW_UP', 'INTERESTED', 'CONVERTED', 'LOST'];
const OPEN = (s: string) => s !== 'CONVERTED' && s !== 'LOST';

export default function EnquiriesPage() {
  const { can, campusId } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const day = useDay();
  const today = todayIST();
  const { opts, currentYear, campusOfLevel } = useAdmissionOptions();
  const canApply = can(PERMISSIONS.ADM_APPLICATION_MANAGE);

  const [data, setData] = useState<{ rows: Row[]; summary: { byStatus: Record<string, number>; dueOrOverdue: number } } | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [query, setQuery] = useState('');

  const load = useCallback(() => {
    api<typeof data>(`/admissions/enquiries${campusId ? `?campusId=${campusId}` : ''}`).then(setData).catch(() => setData({ rows: [], summary: { byStatus: {}, dueOrOverdue: 0 } }));
  }, [campusId]);
  useEffect(load, [load]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.rows ?? []).filter((r) => {
      if (filter === 'DUE' ? !(OPEN(r.status) && r.nextFollowUp && r.nextFollowUp.slice(0, 10) <= today) : filter !== 'ALL' && r.status !== filter) return false;
      return !q || [r.studentName, r.parentName, r.phone, r.enquiryNo].some((v) => v.toLowerCase().includes(q));
    });
  }, [data, filter, query, today]);
  const count = (f: Filter) => (f === 'ALL' ? data?.rows.length : f === 'DUE' ? data?.summary.dueOrOverdue : data?.summary.byStatus[f]) ?? 0;

  // ── new enquiry
  const blank = { levelId: '', academicYearId: '', studentName: '', dob: '', parentName: '', phone: '', email: '', source: 'WALK_IN', nextFollowUp: '', notes: '' };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);

  function openCreate() {
    setForm({ ...blank, academicYearId: currentYear, nextFollowUp: today });
    setErrors({});
    setFormError(null);
    setIdemKey(newIdempotencyKey());
    setOpen(true);
  }

  async function create() {
    const payload = {
      campusId: campusOfLevel.get(form.levelId) ?? '', academicYearId: form.academicYearId, programLevelId: form.levelId, studentName: form.studentName,
      dob: form.dob || null, parentName: form.parentName, phone: form.phone, email: form.email || null, source: form.source, nextFollowUp: form.nextFollowUp || null, notes: form.notes || null,
    };
    const v = validate(createEnquirySchema, payload);
    if (!v.ok) return setErrors({ ...v.errors, levelId: v.errors.programLevelId ?? v.errors.campusId });
    setBusy(true);
    try {
      const e = await api<{ enquiryNo: string }>('/admissions/enquiries', { method: 'POST', headers: { 'Idempotency-Key': idemKey }, body: JSON.stringify(v.data) });
      setOpen(false);
      toast(t('enq.created', { no: e.enquiryNo }));
      load();
    } catch (e) {
      const { fields, message } = apiErrors(e);
      setErrors(fields);
      setFormError(message);
    } finally {
      setBusy(false);
    }
  }

  // ── detail + follow-up
  const [detail, setDetail] = useState<Detail | null>(null);
  const [fu, setFu] = useState({ mode: 'CALL', status: 'FOLLOW_UP', remarks: '', nextFollowUp: '' });
  const [fuErrors, setFuErrors] = useState<FieldErrors>({});
  const [fuError, setFuError] = useState<string | null>(null);

  async function openDetail(id: string) {
    setFu({ mode: 'CALL', status: 'FOLLOW_UP', remarks: '', nextFollowUp: '' });
    setFuErrors({});
    setFuError(null);
    try {
      setDetail(await api<Detail>(`/admissions/enquiries/${id}`));
    } catch (e) {
      toast(apiErrors(e).message ?? 'Error', 'bad');
    }
  }

  async function saveFollowup() {
    if (!detail) return;
    if (detail.status === 'CONVERTED') return setDetail(null);
    const v = validate(addFollowupSchema, { ...fu, nextFollowUp: fu.status === 'LOST' ? null : fu.nextFollowUp || null });
    if (!v.ok) return setFuErrors(v.errors);
    setBusy(true);
    try {
      await api(`/admissions/enquiries/${detail.id}/followups`, { method: 'POST', body: JSON.stringify(v.data) });
      toast(t('enq.followupSaved'));
      setDetail(null);
      load();
    } catch (e) {
      const { fields, message } = apiErrors(e);
      setFuErrors(fields);
      setFuError(message);
    } finally {
      setBusy(false);
    }
  }

  const due = (r: { status: string; nextFollowUp: string | null }) => {
    if (!OPEN(r.status) || !r.nextFollowUp) return null;
    const d = r.nextFollowUp.slice(0, 10);
    return d < today ? 'overdue' : d === today ? 'today' : null;
  };
  const converted = detail?.status === 'CONVERTED';

  return (
    <>
      <PageHeader
        eyebrow={t('nav.admissions')}
        title={t('enq.title')}
        description={t('enq.desc')}
        actions={<button className="btn btn-primary" onClick={openCreate} disabled={!opts}><Icon name="plus" /> {t('enq.new')}</button>}
      />

      <div className="stats">
        <StatTile icon="clock" label={t('enq.tile.due')} value={data ? data.summary.dueOrOverdue : '–'} hint={t('enq.tile.dueHint')} />
        <StatTile icon="sparkle" label={t('enq.tile.new')} value={data ? count('NEW') : '–'} hint={t('enq.tile.newHint')} />
        <StatTile icon="star" label={t('enq.tile.interested')} value={data ? count('INTERESTED') : '–'} hint={t('enq.tile.interestedHint')} />
        <StatTile icon="check" label={t('enq.tile.converted')} value={data ? count('CONVERTED') : '–'} hint={t('enq.tile.convertedHint')} />
      </div>

      <div className="review-bar">
        <div className="tabs scroll" role="tablist" aria-label={t('common.status')}>
          {FILTERS.map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {t(`enq.filter.${f}` as MessageKey)} <span className="tab-count">{count(f)}</span>
            </button>
          ))}
        </div>
        <label className="search">
          <Icon name="search" size={16} />
          <input placeholder={t('enq.search')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('enq.search')} />
        </label>
      </div>

      {data === null ? (
        <SkeletonRows />
      ) : data.rows.length === 0 ? (
        <EmptyState icon="phone" title={t('enq.emptyTitle')} text={t('enq.emptyText')} action={<button className="btn btn-primary" onClick={openCreate} disabled={!opts}><Icon name="plus" /> {t('enq.new')}</button>} />
      ) : rows.length === 0 ? (
        <EmptyState icon="search" title={t('common.noMatches')} />
      ) : (
        <DataTable
          caption={t('enq.title')}
          rows={rows}
          rowKey={(r) => r.id}
          rowClass={(r) => (r.status === 'LOST' ? 'row-dim' : undefined)}
          columns={[
            { key: 'no', header: t('enq.col.no'), sort: (r) => r.enquiryNo, cell: (r) => <><span className="code">{r.enquiryNo}</span><span className="sub-line muted">{day(r.createdAt)}</span></> },
            { key: 'child', header: t('enq.col.child'), sort: (r) => r.studentName, cell: (r) => <><strong>{r.studentName}</strong><span className="sub-line muted">{r.parentName} · {r.phone}</span></> },
            { key: 'class', header: t('enq.col.class'), sort: (r) => r.level.name, cell: (r) => <>{r.level.name}<span className="sub-line muted">{r.level.program.name}</span></> },
            { key: 'source', header: t('enq.col.source'), sort: (r) => r.source, cell: (r) => t(`enq.source.${r.source}` as MessageKey) },
            {
              key: 'next', header: t('enq.col.next'), sort: (r) => (OPEN(r.status) ? r.nextFollowUp : null),
              cell: (r) => {
                const d = due(r);
                if (!OPEN(r.status)) return <span className="muted">—</span>;
                return <span className={d ? `due due-${d}` : ''}>{d === 'today' ? t('enq.today') : day(r.nextFollowUp)}{d === 'overdue' && <span className="sub-line">{t('enq.overdue')}</span>}</span>;
              },
            },
            { key: 'status', header: t('common.status'), sort: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
            { key: 'open', header: <span className="sr-only">{t('common.open')}</span>, align: 'right', cell: (r) => <button className="btn btn-sm" onClick={() => openDetail(r.id)}>{t('common.open')} <Icon name="chevronRight" size={14} /></button> },
          ]}
          initialSort={{ key: 'next', dir: 'asc' }}
        />
      )}

      <Modal open={open} onClose={() => setOpen(false)} wide title={t('enq.new')} subtitle={t('enq.newSub')} onSubmit={create} submitLabel={t('enq.save')} busy={busy} error={formError}>
        <div className="grid-2">
          <Field id="e-class" label={t('adm.class')} error={errors.levelId}>
            <ClassSelect id="e-class" value={form.levelId} onChange={(v) => setForm((f) => ({ ...f, levelId: v }))} programs={opts?.programs ?? []} invalid={!!errors.levelId} />
          </Field>
          <Field id="e-year" label={t('adm.year')} error={errors.academicYearId}>
            <select id="e-year" value={form.academicYearId} onChange={(e) => setForm({ ...form, academicYearId: e.target.value })}>
              {(opts?.years ?? []).map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
            </select>
          </Field>
          <Field id="e-student" label={t('enq.studentName')} error={errors.studentName}>
            <input id="e-student" value={form.studentName} onChange={(e) => setForm({ ...form, studentName: e.target.value })} autoFocus />
          </Field>
          <Field id="e-dob" label={t('adm.dobOptional')} error={errors.dob}>
            <input id="e-dob" type="date" max={today} value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} />
          </Field>
          <Field id="e-parent" label={t('enq.parentName')} error={errors.parentName}>
            <input id="e-parent" value={form.parentName} onChange={(e) => setForm({ ...form, parentName: e.target.value })} />
          </Field>
          <Field id="e-phone" label={t('adm.phone')} error={errors.phone}>
            <input id="e-phone" inputMode="numeric" maxLength={10} placeholder="98xxxxxxxx" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <Field id="e-email" label={t('adm.emailOptional')} error={errors.email}>
            <input id="e-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field id="e-next" label={t('enq.nextFollowUp')} error={errors.nextFollowUp}>
            <input id="e-next" type="date" min={today} value={form.nextFollowUp} onChange={(e) => setForm({ ...form, nextFollowUp: e.target.value })} />
          </Field>
        </div>
        <Field id="e-source" label={t('enq.source')}>
          <div className="segmented" role="radiogroup" aria-label={t('enq.source')}>
            {ENQUIRY_SOURCES.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={form.source === s} className={form.source === s ? 'on' : ''} onClick={() => setForm({ ...form, source: s })}>{t(`enq.source.${s}` as MessageKey)}</button>
            ))}
          </div>
        </Field>
        <Field id="e-notes" label={t('enq.notes')} error={errors.notes}>
          <textarea id="e-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </Modal>

      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        wide
        title={detail?.studentName ?? ''}
        subtitle={detail ? `${detail.enquiryNo} · ${detail.level.name}, ${detail.level.program.name} · ${detail.academicYear.name}` : ''}
        onSubmit={saveFollowup}
        submitLabel={detail && !converted ? t('enq.saveFollowup') : t('common.close')}
        busy={busy}
        hideCancel={converted}
        error={fuError}
      >
        {detail && (
          <>
            <div className="detail-head">
              <StatusBadge status={detail.status} />
              {converted && detail.applications[0] && (
                <Link className="btn btn-sm btn-gold" href={`/admissions/applications?open=${detail.applications[0].id}`}><Icon name="file" size={15} /> {detail.applications[0].applicationNo}</Link>
              )}
              {!converted && canApply && (
                <Link className="btn btn-sm btn-gold" href={`/admissions/applications?enquiry=${detail.id}`}><Icon name="arrowRight" size={15} /> {t('enq.convert')}</Link>
              )}
            </div>
            <dl className="kv">
              <div><dt>{t('enq.parentName')}</dt><dd>{detail.parentName}</dd></div>
              <div><dt>{t('adm.phone')}</dt><dd><a href={`tel:${detail.phone}`}>{detail.phone}</a></dd></div>
              {detail.email && <div><dt>{t('adm.email')}</dt><dd>{detail.email}</dd></div>}
              {detail.dob && <div><dt>{t('adm.dob')}</dt><dd>{day(detail.dob)}</dd></div>}
              <div><dt>{t('enq.source')}</dt><dd>{t(`enq.source.${detail.source}` as MessageKey)}</dd></div>
              <div><dt>{t('enq.col.next')}</dt><dd>{OPEN(detail.status) ? day(detail.nextFollowUp) : '—'}</dd></div>
              {detail.notes && <div className="kv-wide"><dt>{t('enq.notes')}</dt><dd>{detail.notes}</dd></div>}
            </dl>

            <h3 className="module-group-name">{t('enq.history')} · {detail.followups.length}</h3>
            {detail.followups.length === 0 ? (
              <p className="muted small">{t('enq.noFollowups')}</p>
            ) : (
              <ol className="timeline">
                {detail.followups.map((f) => (
                  <li key={f.id}>
                    <span className="timeline-dot" aria-hidden />
                    <div>
                      <p className="timeline-head"><strong>{t(`enq.mode.${f.mode}` as MessageKey)}</strong> · {day(f.createdAt)} <StatusBadge status={f.status} /></p>
                      <p>{f.remarks}</p>
                      {f.nextFollowUp && <p className="muted small">{t('enq.nextOn', { date: day(f.nextFollowUp) })}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}

            {!converted && (
              <fieldset className="subform">
                <legend>{t('enq.addFollowup')}</legend>
                <div className="grid-2">
                  <Field id="f-mode" label={t('enq.mode')}>
                    <div className="segmented" role="radiogroup" aria-label={t('enq.mode')}>
                      {FOLLOWUP_MODES.map((m) => (
                        <button key={m} type="button" role="radio" aria-checked={fu.mode === m} className={fu.mode === m ? 'on' : ''} onClick={() => setFu({ ...fu, mode: m })}>{t(`enq.mode.${m}` as MessageKey)}</button>
                      ))}
                    </div>
                  </Field>
                  <Field id="f-status" label={t('enq.outcome')}>
                    <select id="f-status" value={fu.status} onChange={(e) => setFu({ ...fu, status: e.target.value })}>
                      {(['FOLLOW_UP', 'INTERESTED', 'LOST'] as const).map((s) => <option key={s} value={s}>{t(`status.${s}` as MessageKey)}</option>)}
                    </select>
                  </Field>
                </div>
                <Field id="f-remarks" label={t('enq.remarks')} error={fuErrors.remarks}>
                  <textarea id="f-remarks" rows={2} value={fu.remarks} placeholder={t('enq.remarksHint')} onChange={(e) => setFu({ ...fu, remarks: e.target.value })} />
                </Field>
                {fu.status !== 'LOST' && (
                  <Field id="f-next" label={t('enq.nextFollowUp')} error={fuErrors.nextFollowUp}>
                    <input id="f-next" type="date" min={today} value={fu.nextFollowUp} onChange={(e) => setFu({ ...fu, nextFollowUp: e.target.value })} />
                  </Field>
                )}
              </fieldset>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
