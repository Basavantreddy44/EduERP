'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { MATERIAL_TYPES } from '@eduerp/shared';
import { api, downloadFile, uploadFile } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { AcadSection, MATERIAL_ICON, SectionSelect, useAcadSections, useSectionParam } from '@/components/academics';

interface Item { id: string; title: string; description: string | null; materialType: string; url: string | null; body: string | null; file: { name: string; size: number } | null; forSection: boolean; topic: string | null; isPublished: boolean; publishedAt: string | null; viewed: number }
interface View { section: { id: string; name: string; programLevelId: string }; students: number; canAdd: boolean; items: Item[] }

/** Academics → Study material (M10.2): notes, links, videos and files for a class and subject. */
export default function MaterialsPage() {
  const { t } = useI18n();
  const sections = useAcadSections();
  const [sectionId, choose] = useSectionParam(sections);
  const section = sections?.find((s) => s.id === sectionId);
  return (
    <>
      <PageHeader eyebrow={t('nav.academics')} title={t('sm.title')} description={t('sm.desc')} />
      {!sections ? <SkeletonRows rows={5} /> : !sections.length ? <EmptyState icon="layers" title={t('ac.noSections')} text={t('ac.noSectionsHint')} /> : (
        <>
          <div className="panel-head"><SectionSelect sections={sections} value={sectionId} onChange={choose} /></div>
          {section && <SectionMaterials key={section.id} section={section} />}
        </>
      )}
    </>
  );
}

function SectionMaterials({ section }: { section: AcadSection }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [subjects, setSubjects] = useState<{ id: string; name: string }[] | null>(null);
  const [subjectId, setSubjectId] = useState('');
  const [v, setV] = useState<View | null>(null);
  const [topics, setTopics] = useState<{ id: string; title: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { api<{ subjects: { subject: { id: string; name: string } }[] }>(`/academics/sections/${section.id}/teachers`).then((r) => { setSubjects(r.subjects.map((s) => s.subject)); setSubjectId(r.subjects[0]?.subject.id ?? ''); }).catch(() => setSubjects([])); }, [section.id]);
  const load = useCallback(() => {
    if (!subjectId) return;
    setV(null);
    api<View>(`/academics/sections/${section.id}/subjects/${subjectId}/materials`).then(setV).catch(() => setV(null));
    api<{ units: { title: string; topics: { id: string; title: string }[] }[] }>(`/academics/classes/${section.programLevelId}/subjects/${subjectId}/units`).then((r) => setTopics(r.units.flatMap((u) => u.topics))).catch(() => setTopics([]));
  }, [section.id, section.programLevelId, subjectId]);
  useEffect(load, [load]);

  const start = () => { setForm({ materialType: 'NOTE', title: '', description: '', url: '', body: '', topicId: '', scope: 'CLASS', publish: true }); setFile(null); setErrors({}); setError(null); setOpen(true); };
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try {
      let fileId: string | null = null;
      if (form.materialType === 'FILE') {
        if (!file) { setErrors({ fileId: t('sm.chooseFile') }); return; }
        fileId = (await uploadFile<{ id: string }>('/academics/materials/files', file, { programLevelId: section.programLevelId, subjectId, ...(form.scope === 'SECTION' ? { sectionId: section.id } : {}) })).id;
      }
      await api('/academics/materials', { method: 'POST', body: JSON.stringify({
        programLevelId: section.programLevelId, sectionId: form.scope === 'SECTION' ? section.id : null, subjectId, topicId: form.topicId || null,
        title: form.title, description: form.description || null, materialType: form.materialType, url: form.url || null, body: form.body || null, fileId, publish: !!form.publish,
      }) });
      toast(form.publish ? t('sm.published') : t('sm.savedDraft')); setOpen(false); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const state = async (m: Item, s: 'PUBLISH' | 'UNPUBLISH' | 'ARCHIVE') => {
    try { await api(`/academics/materials/${m.id}/state`, { method: 'POST', body: JSON.stringify({ state: s }) }); toast(t(`sm.state.${s}` as MessageKey)); load(); } catch (x) { toast(apiErrors(x).message ?? t('lp.failed')); }
  };
  const when = (s: string | null) => (s ? new Date(s).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : '');
  const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  if (!subjects) return <SkeletonRows rows={4} />;
  if (!subjects.length) return <EmptyState icon="book" title={t('ac.teachers.noSyllabus')} text={t('ac.teachers.noSyllabusHint')} />;
  return (
    <>
      <div className="panel-head">
        <label className="ac-picker" htmlFor="sm-subject"><span>{t('ac.subject')}</span>
          <select id="sm-subject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </label>
        {v?.canAdd && <button type="button" className="btn btn-primary" onClick={start}><Icon name="plus" /> {t('sm.add')}</button>}
      </div>
      {!v ? <SkeletonRows rows={4} /> : !v.items.length ? <EmptyState icon="book" title={t('sm.none')} text={v.canAdd ? t('sm.noneHint') : undefined} /> : (
        <ul className="sm-list">
          {v.items.map((m) => (
            <li key={m.id} className={`card sm-card${m.isPublished ? '' : ' draft'}`}>
              <span className="sm-icon" aria-hidden="true"><Icon name={MATERIAL_ICON[m.materialType] ?? 'file'} /></span>
              <div className="sm-main">
                <span className="hw-subject">{t(`sm.type.${m.materialType}` as MessageKey)}{m.topic ? ` · ${m.topic}` : ''}{m.forSection ? ` · ${t('sm.onlySection', { name: v.section.name })}` : ''}</span>
                <strong className="hw-title">{m.title}</strong>
                {m.description && <p className="hw-desc">{m.description}</p>}
                {m.materialType === 'NOTE' && m.body && <details className="sm-note"><summary>{t('sm.readNotes')}</summary><p>{m.body}</p></details>}
                {m.url && <a href={m.url} target="_blank" rel="noopener noreferrer" className="sm-link">{m.url}<span className="sr-only"> {t('sm.newTab')}</span></a>}
                {m.file && <button type="button" className="link-btn" onClick={() => void downloadFile(`/academics/materials/${m.id}/file`)}><Icon name="download" size={14} /> {m.file.name} ({kb(m.file.size)})</button>}
              </div>
              <div className="sm-side">
                {m.isPublished ? <span className="pill pill-ok">{t('sm.publishedOn', { date: when(m.publishedAt) })}</span> : <span className="pill pill-warn">{t('sm.draft')}</span>}
                <span className="muted small">{t('sm.openedBy', { n: m.viewed, of: v.students })}</span>
                {v.canAdd && <span className="row-actions">
                  {m.isPublished ? <button type="button" className="btn btn-sm" onClick={() => void state(m, 'UNPUBLISH')}>{t('sm.unpublish')}</button> : <button type="button" className="btn btn-sm btn-primary" onClick={() => void state(m, 'PUBLISH')}>{t('sm.publish')}</button>}
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => void state(m, 'ARCHIVE')} aria-label={t('sm.archiveNamed', { name: m.title })}><Icon name="trash" /></button>
                </span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('sm.add')} subtitle={`${subjects.find((s) => s.id === subjectId)?.name ?? ''} · ${section.name}`} onSubmit={save} submitLabel={form.publish ? t('sm.publish') : t('sm.saveDraft')} busy={busy} error={error}>
        <fieldset className="check-group sm-types"><legend>{t('sm.kind')}</legend>
          {MATERIAL_TYPES.map((x) => <label key={x} className="check"><input type="radio" name="sm-type" checked={form.materialType === x} onChange={() => setForm((f) => ({ ...f, materialType: x }))} /> <Icon name={MATERIAL_ICON[x]} size={16} /> {t(`sm.type.${x}` as MessageKey)}</label>)}
        </fieldset>
        <Field id="sm-title" label={t('sm.titleLabel')} error={errors.title}><input id="sm-title" value={String(form.title ?? '')} onChange={set('title')} placeholder={t('sm.titlePh')} /></Field>
        {form.materialType === 'NOTE' && <Field id="sm-body" label={t('sm.notes')} error={errors.body}><textarea id="sm-body" rows={6} value={String(form.body ?? '')} onChange={set('body')} /></Field>}
        {(form.materialType === 'LINK' || form.materialType === 'VIDEO') && <Field id="sm-url" label={t('sm.link')} hint={t('sm.linkHint')} error={errors.url}><input id="sm-url" type="url" inputMode="url" value={String(form.url ?? '')} onChange={set('url')} placeholder="https://" /></Field>}
        {form.materialType === 'FILE' && <Field id="sm-file" label={t('sm.file')} hint={t('sm.fileHint')} error={errors.fileId}><input id="sm-file" ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>}
        <Field id="sm-desc" label={t('sm.about')} error={errors.description}><input id="sm-desc" value={String(form.description ?? '')} onChange={set('description')} /></Field>
        <div className="grid-2">
          <Field id="sm-topic" label={t('sm.topic')}><select id="sm-topic" value={String(form.topicId ?? '')} onChange={set('topicId')}><option value="">{t('sm.noTopic')}</option>{topics.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></Field>
          <Field id="sm-scope" label={t('sm.for')}><select id="sm-scope" value={String(form.scope)} onChange={set('scope')}><option value="CLASS">{t('sm.wholeClass')}</option><option value="SECTION">{t('sm.onlySection', { name: section.name })}</option></select></Field>
        </div>
        <label className="check"><input type="checkbox" checked={!!form.publish} onChange={(e) => setForm((f) => ({ ...f, publish: e.target.checked }))} /> {t('sm.publishNow')}</label>
      </Modal>
    </>
  );
}
