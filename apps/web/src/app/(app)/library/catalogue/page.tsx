'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { BookFields, blankBook } from '@/components/campuslife';

interface Book { id: string; title: string; authors: string | null; isbn: string | null; publisher: string | null; subject: string | null; callNo: string | null; publishYear: number | null; copies: number; available: number }

/** Library → Catalogue (M16.1): search by title, author, ISBN or accession number; add books. */
export default function CataloguePage() {
  const { can } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const manage = can(PERMISSIONS.LIB_MANAGE);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Book[] | null>(null);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(blankBook);
  const [copies, setCopies] = useState({ campusId: '', count: '1', price: '' });
  const [campuses, setCampuses] = useState<{ id: string; name: string }[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setRows(null); api<Book[]>(`/library/books${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`).then(setRows).catch(() => setRows([])); }, [q]);
  useEffect(() => { const h = window.setTimeout(load, 250); return () => window.clearTimeout(h); }, [load]);
  useEffect(() => { if (manage) api<{ id: string; name: string }[]>('/campuses').then((c) => { setCampuses(c); setCopies((x) => ({ ...x, campusId: x.campusId || c[0]?.id || '' })); }).catch(() => setCampuses([])); }, [manage]);
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try {
      const b = await api<{ id: string }>('/library/books', { method: 'POST', body: JSON.stringify({ ...f, publishYear: f.publishYear || null }) });
      if (Number(copies.count) > 0) await api(`/library/books/${b.id}/copies`, { method: 'POST', body: JSON.stringify({ campusId: copies.campusId, count: Number(copies.count), price: copies.price || null }) });
      toast(t('lib.cat.added')); setOpen(false); router.push(`/library/books/${b.id}`);
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader eyebrow={t('nav.library')} title={t('lib.cat.title')} description={t('lib.cat.desc')} actions={<>{manage && <Link href="/imports" className="btn"><Icon name="upload" /> {t('lib.cat.import')}</Link>}{manage && <button type="button" className="btn btn-primary" onClick={() => { setF(blankBook); setErrors({}); setError(null); setOpen(true); }}><Icon name="plus" /> {t('lib.cat.add')}</button>}</>} />
      <div className="filter-bar">
        <label className="sr-only" htmlFor="cat-q">{t('lib.cat.search')}</label>
        <input id="cat-q" type="search" className="lib-search" placeholder={t('lib.cat.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!rows ? <SkeletonRows rows={5} /> : !rows.length ? <EmptyState icon="book" title={q ? t('lib.cat.noMatch') : t('lib.cat.empty')} text={!q && manage ? t('lib.cat.emptyHint') : undefined} /> : (
        <div className="table-wrap card" role="region" aria-label={t('lib.cat.title')} tabIndex={0}>
          <table className="table">
            <thead><tr><th scope="col">{t('lib.book')}</th><th scope="col">{t('lib.cat.subject')}</th><th scope="col">{t('lib.cat.callNo')}</th><th scope="col" className="num">{t('lib.cat.copies')}</th><th scope="col" className="num">{t('lib.cat.onShelf')}</th></tr></thead>
            <tbody>{rows.map((b) => (
              <tr key={b.id}>
                <td><Link href={`/library/books/${b.id}`}><strong>{b.title}</strong></Link><span className="sub-line muted small">{[b.authors, b.publisher, b.publishYear, b.isbn && `ISBN ${b.isbn}`].filter(Boolean).join(' · ')}</span></td>
                <td>{b.subject ?? '—'}</td>
                <td className="mono small">{b.callNo ?? '—'}</td>
                <td className="num">{b.copies}</td>
                <td className="num">{b.available ? <span className="pill pill-ok">{b.available}</span> : <span className="pill pill-muted">0</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('lib.cat.add')} subtitle={t('lib.cat.addSub')} onSubmit={save} submitLabel={t('lib.cat.save')} busy={busy} error={error} wide>
        <BookFields f={f} setF={setF} errors={errors} />
        <fieldset className="check-group"><legend>{t('lib.cat.copiesNow')}</legend>
          <div className="grid-3">
            <Field id="bk-campus" label={t('lib.campus')}><select id="bk-campus" value={copies.campusId} onChange={(e) => setCopies((c) => ({ ...c, campusId: e.target.value }))}>{campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field id="bk-count" label={t('lib.cat.howMany')} hint={t('lib.cat.howManyHint')}><input id="bk-count" inputMode="numeric" value={copies.count} onChange={(e) => setCopies((c) => ({ ...c, count: e.target.value }))} /></Field>
            <Field id="bk-price" label={t('lib.cat.price')}><input id="bk-price" inputMode="decimal" value={copies.price} onChange={(e) => setCopies((c) => ({ ...c, price: e.target.value }))} /></Field>
          </div>
        </fieldset>
      </Modal>
    </>
  );
}
