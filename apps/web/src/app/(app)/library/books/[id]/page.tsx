'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { rupees } from '@/components/accounts';
import { BookFields, ClPill, PeoplePicker, Person, blankBook } from '@/components/campuslife';

interface Copy { id: string; accessionNo: string; barcode: string | null; campusId: string; campus: string; rackLocation: string | null; price: string | null; purchaseDate: string | null; status: string; remarks: string | null; issuedTo: string | null; dueDate: string | null }
interface View { id: string; title: string; authors: string | null; isbn: string | null; publisher: string | null; edition: string | null; publishYear: number | null; language: string | null; subject: string | null; callNo: string | null; canManage: boolean; copies: Copy[]; queue: { id: string; name: string; status: string; campus: string; expiresOn: string | null }[] }

/** One book: its copies (where, status, who has it), the reservation queue, add copies, reserve. */
export default function BookPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const { t, locale } = useI18n();
  const toast = useToast();
  const circ = can(PERMISSIONS.LIB_CIRCULATE);
  const [v, setV] = useState<View | null>(null);
  const [missing, setMissing] = useState(false);
  const [campuses, setCampuses] = useState<{ id: string; name: string }[]>([]);
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState(blankBook);
  const [add, setAdd] = useState(false);
  const [cp, setCp] = useState({ campusId: '', count: '1', accessionNo: '', barcode: '', price: '', rackLocation: '' });
  const [reserve, setReserve] = useState(false);
  const [who, setWho] = useState<Person | null>(null);
  const [resCampus, setResCampus] = useState('');
  const [withdraw, setWithdraw] = useState<Copy | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<View>(`/library/books/${id}`).then(setV).catch(() => setMissing(true)); }, [id]);
  useEffect(load, [load]);
  useEffect(() => { api<{ id: string; name: string }[]>('/campuses').then((c) => { setCampuses(c); setResCampus((x) => x || c[0]?.id || ''); setCp((x) => ({ ...x, campusId: x.campusId || c[0]?.id || '' })); }).catch(() => setCampuses([])); }, []);
  const call = async (path: string, method: string, body: unknown, done: string, close: () => void) => {
    setBusy(true); setErrors({}); setError(null);
    try { await api(path, { method, body: JSON.stringify(body) }); toast(done); close(); load(); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  if (missing) return <EmptyState icon="book" title={t('lib.book.notFound')} action={<Link href="/library/catalogue" className="btn">{t('nav.libCatalogue')}</Link>} />;
  if (!v) return <SkeletonRows rows={5} />;
  const d = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
  const live = v.copies.filter((c) => c.status !== 'WITHDRAWN');
  return (
    <>
      <Link href="/library/catalogue" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('nav.libCatalogue')}</Link>
      <PageHeader eyebrow={[v.authors, v.publisher, v.publishYear].filter(Boolean).join(' · ')} title={v.title}
        actions={<>
          {circ && <button type="button" className="btn" onClick={() => { setWho(null); setErrors({}); setError(null); setReserve(true); }}><Icon name="star" /> {t('lib.book.reserve')}</button>}
          {v.canManage && <button type="button" className="btn" onClick={() => { setF({ title: v.title, authors: v.authors ?? '', isbn: v.isbn ?? '', publisher: v.publisher ?? '', edition: v.edition ?? '', publishYear: v.publishYear ? String(v.publishYear) : '', language: v.language ?? '', subject: v.subject ?? '', callNo: v.callNo ?? '' }); setErrors({}); setError(null); setEdit(true); }}><Icon name="edit" /> {t('lib.book.edit')}</button>}
          {v.canManage && <button type="button" className="btn btn-primary" onClick={() => { setErrors({}); setError(null); setAdd(true); }}><Icon name="plus" /> {t('lib.book.addCopies')}</button>}
        </>} />
      <dl className="kv">
        <div><dt>ISBN</dt><dd className="mono">{v.isbn ?? '—'}</dd></div>
        <div><dt>{t('lib.cat.subject')}</dt><dd>{v.subject ?? '—'}</dd></div>
        <div><dt>{t('lib.cat.callNo')}</dt><dd className="mono">{v.callNo ?? '—'}</dd></div>
        <div><dt>{t('lib.cat.language')}</dt><dd>{v.language ?? '—'}</dd></div>
        <div><dt>{t('lib.cat.edition')}</dt><dd>{v.edition ?? '—'}</dd></div>
        <div><dt>{t('lib.cat.copies')}</dt><dd>{t('lib.book.copiesLine', { n: live.length, a: live.filter((c) => c.status === 'AVAILABLE').length })}</dd></div>
      </dl>
      <section className="card p12-block" aria-labelledby="bk-copies">
        <h2 id="bk-copies" className="section-title">{t('lib.book.copies')}</h2>
        {!v.copies.length ? <p className="muted">{t('lib.book.noCopies')}</p> : (
          <div className="table-wrap" role="region" aria-label={t('lib.book.copies')} tabIndex={0}>
            <table className="table">
              <thead><tr><th scope="col">{t('lib.book.accession')}</th><th scope="col">{t('lib.campus')}</th><th scope="col">{t('lib.book.rack')}</th><th scope="col">{t('lib.status')}</th><th scope="col" className="num">{t('lib.cat.price')}</th>{v.canManage && <th scope="col"><span className="sr-only">{t('lib.actions')}</span></th>}</tr></thead>
              <tbody>{v.copies.map((c) => (
                <tr key={c.id} className={c.status === 'WITHDRAWN' ? 'muted' : undefined}>
                  <td className="mono">{c.accessionNo}{c.barcode && <span className="sub-line muted small">{c.barcode}</span>}</td>
                  <td>{c.campus}</td>
                  <td>{c.rackLocation ?? '—'}</td>
                  <td><ClPill prefix="lib.cs" status={c.status} />{c.issuedTo && <span className="sub-line muted small">{t('lib.book.with', { name: c.issuedTo, d: d(c.dueDate) })}</span>}{c.remarks && c.status !== 'ISSUED' && <span className="sub-line muted small">{c.remarks}</span>}</td>
                  <td className="num">{c.price ? rupees(c.price) : '—'}</td>
                  {v.canManage && <td>{!['ISSUED', 'ON_HOLD', 'WITHDRAWN'].includes(c.status) && <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setError(null); setWithdraw(c); }} aria-label={t('lib.book.withdrawNamed', { no: c.accessionNo })}>{t('lib.book.withdraw')}</button>}</td>}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      {v.queue.length > 0 && (
        <section className="card p12-block" aria-labelledby="bk-queue">
          <h2 id="bk-queue" className="section-title">{t('lib.book.queue')}</h2>
          <ol className="p12-action-list">{v.queue.map((r) => (
            <li key={r.id}><span><strong>{r.name}</strong><span className="sub-line muted small">{r.campus}{r.expiresOn ? ` · ${t('lib.book.keptUntil', { d: d(r.expiresOn) })}` : ''}</span></span>
              <span className="row-actions"><ClPill prefix="lib.rs" status={r.status} />{circ && <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void call(`/library/reservations/${r.id}/cancel`, 'POST', {}, t('lib.book.resCancelled'), () => undefined)}>{t('lib.book.cancelRes')}</button>}</span></li>
          ))}</ol>
        </section>
      )}
      <Modal open={edit} onClose={() => setEdit(false)} title={t('lib.book.edit')} onSubmit={(e: FormEvent) => { e.preventDefault(); void call(`/library/books/${id}`, 'PUT', { ...f, publishYear: f.publishYear || null }, t('lib.saved'), () => setEdit(false)); }} submitLabel={t('lib.cat.save')} busy={busy} error={error} wide>
        <BookFields f={f} setF={setF} errors={errors} />
      </Modal>
      <Modal open={add} onClose={() => setAdd(false)} title={t('lib.book.addCopies')} subtitle={t('lib.book.addCopiesSub')} onSubmit={(e: FormEvent) => { e.preventDefault(); void call(`/library/books/${id}/copies`, 'POST', { campusId: cp.campusId, count: Number(cp.count || 1), accessionNo: cp.accessionNo || null, barcode: cp.barcode || null, price: cp.price || null, rackLocation: cp.rackLocation || null }, t('lib.book.copiesAdded'), () => setAdd(false)); }} submitLabel={t('lib.book.addCopies')} busy={busy} error={error}>
        <div className="grid-2">
          <Field id="cp-campus" label={t('lib.campus')}><select id="cp-campus" value={cp.campusId} onChange={(e) => setCp((x) => ({ ...x, campusId: e.target.value }))}>{campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field id="cp-count" label={t('lib.cat.howMany')} error={errors.count}><input id="cp-count" inputMode="numeric" value={cp.count} onChange={(e) => setCp((x) => ({ ...x, count: e.target.value }))} /></Field>
        </div>
        <div className="grid-2">
          <Field id="cp-acc" label={t('lib.book.accession')} hint={t('lib.book.accessionHint')} error={errors.accessionNo}><input id="cp-acc" className="mono" value={cp.accessionNo} onChange={(e) => setCp((x) => ({ ...x, accessionNo: e.target.value }))} /></Field>
          <Field id="cp-bc" label={t('lib.book.barcode')} error={errors.barcode}><input id="cp-bc" className="mono" value={cp.barcode} onChange={(e) => setCp((x) => ({ ...x, barcode: e.target.value }))} /></Field>
        </div>
        <div className="grid-2">
          <Field id="cp-price" label={t('lib.cat.price')} error={errors.price}><input id="cp-price" inputMode="decimal" value={cp.price} onChange={(e) => setCp((x) => ({ ...x, price: e.target.value }))} /></Field>
          <Field id="cp-rack" label={t('lib.book.rack')}><input id="cp-rack" value={cp.rackLocation} onChange={(e) => setCp((x) => ({ ...x, rackLocation: e.target.value }))} /></Field>
        </div>
      </Modal>
      <Modal open={reserve} onClose={() => setReserve(false)} title={t('lib.book.reserveTitle', { title: v.title })} subtitle={t('lib.book.reserveSub')} onSubmit={(e: FormEvent) => { e.preventDefault(); if (who) void call('/library/reservations', 'POST', { memberType: who.type, memberId: who.id, bookId: id, campusId: resCampus }, t('lib.book.reserved'), () => setReserve(false)); }} submitLabel={t('lib.book.reserve')} busy={busy} error={error}>
        <Field id="rs-who" label={t('lib.borrower')}><PeoplePicker endpoint="/library/members" value={who} onPick={setWho} inputId="rs-who" placeholder={t('lib.findBorrower')} /></Field>
        <Field id="rs-campus" label={t('lib.campus')}><select id="rs-campus" value={resCampus} onChange={(e) => setResCampus(e.target.value)}>{campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      </Modal>
      <Modal open={!!withdraw} onClose={() => setWithdraw(null)} title={t('lib.book.withdrawTitle', { no: withdraw?.accessionNo ?? '' })} subtitle={t('lib.book.withdrawSub')} onSubmit={(e: FormEvent) => { e.preventDefault(); if (withdraw) void call(`/library/copies/${withdraw.id}/withdraw`, 'POST', { remarks: null }, t('lib.book.withdrawn'), () => setWithdraw(null)); }} submitLabel={t('lib.book.withdraw')} busy={busy} error={error} danger>
        <p className="muted small">{t('lib.book.withdrawNote')}</p>
      </Modal>
    </>
  );
}
