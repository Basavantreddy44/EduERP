'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field } from '@/components/Modal';
import type { FieldErrors } from '@/lib/form';

/** Phase 16 campus life: shared bits for library, health and discipline screens. */

export interface Person { type: 'STUDENT' | 'EMPLOYEE'; id: string; name: string; code: string; campusId: string; detail: string | null }

/** Person picker on a module's own search (librarians, nurses and teachers need no student-record rights). */
export function PeoplePicker({ endpoint, value, onPick, inputId, placeholder }: { endpoint: string; value: Person | null; onPick: (p: Person | null) => void; inputId: string; placeholder: string }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Person[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const h = window.setTimeout(() => { api<Person[]>(`${endpoint}?q=${encodeURIComponent(q)}`).then(setHits).catch(() => setHits([])); }, 250);
    return () => window.clearTimeout(h);
  }, [q, endpoint]);
  if (value) {
    return (
      <div className="leave-picked">
        <span><strong>{value.name}</strong><span className="sub-line muted small">{value.type === 'EMPLOYEE' ? t('cl.staff') : t('cl.student')} · {value.code}{value.detail ? ` · ${value.detail}` : ''}</span></span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => onPick(null)}><Icon name="x" size={14} /> {t('leave.change')}</button>
      </div>
    );
  }
  return (
    <div className="leave-search">
      <input id={inputId} className="input" type="search" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      {hits.length > 0 && (
        <ul className="leave-hits" role="listbox" aria-label={t('leave.results')}>
          {hits.map((h) => <li key={`${h.type}-${h.id}`}><button type="button" role="option" aria-selected={false} onClick={() => { onPick(h); setQ(''); }}><strong>{h.name}</strong><span className="muted small">{h.type === 'EMPLOYEE' ? t('cl.staff') : t('cl.student')} · {h.code}{h.detail ? ` · ${h.detail}` : ''}</span></button></li>)}
        </ul>
      )}
    </div>
  );
}

const TONE: Record<string, string> = { AVAILABLE: 'pill-ok', ISSUED: 'pill-info', ON_HOLD: 'pill-warn', LOST: 'pill-bad', DAMAGED: 'pill-warn', WITHDRAWN: 'pill-muted', RETURNED: 'pill-ok', WAITING: 'pill-warn', READY: 'pill-ok', REPORTED: 'pill-warn', UNDER_REVIEW: 'pill-info', ACTION_TAKEN: 'pill-info', CLOSED: 'pill-ok', LOW: 'pill-muted', MEDIUM: 'pill-info', HIGH: 'pill-warn', CRITICAL: 'pill-bad', SENT_HOME: 'pill-warn', HOSPITAL_REFERRED: 'pill-bad', REST: 'pill-info', RETURNED_TO_CLASS: 'pill-ok' };

/** Status pill with a translated label (key prefix + status). */
export function ClPill({ prefix, status }: { prefix: string; status: string }) {
  const { t } = useI18n();
  return <span className={`pill ${TONE[status] ?? 'pill-muted'}`}><span className="pill-dot" />{t(`${prefix}.${status}` as MessageKey)}</span>;
}

export const nowLocal = () => { const d = new Date(Date.now() + 330 * 60_000); return d.toISOString().slice(0, 16); };
/** A datetime-local value (India time) as an ISO string with offset. */
export const istIso = (local: string) => `${local}:00+05:30`;

export const blankBook = { title: '', authors: '', isbn: '', publisher: '', edition: '', publishYear: '', language: '', subject: '', callNo: '' };

/** Book details form (catalogue and book page). */
export function BookFields({ f, setF, errors }: { f: typeof blankBook; setF: (fn: (x: typeof blankBook) => typeof blankBook) => void; errors: FieldErrors }) {
  const { t } = useI18n();
  const field = (k: keyof typeof blankBook, label: string, opts: { hint?: string; mode?: 'numeric' } = {}) => (
    <Field id={`bk-${k}`} label={label} hint={opts.hint} error={errors[k]}><input id={`bk-${k}`} inputMode={opts.mode} value={f[k]} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} /></Field>
  );
  return (
    <>
      {field('title', t('lib.cat.titleLabel'))}
      <div className="grid-2">{field('authors', t('lib.cat.authors'))}{field('isbn', 'ISBN', { hint: t('lib.cat.isbnHint') })}</div>
      <div className="grid-3">{field('publisher', t('lib.cat.publisher'))}{field('edition', t('lib.cat.edition'))}{field('publishYear', t('lib.cat.year'), { mode: 'numeric' })}</div>
      <div className="grid-3">{field('subject', t('lib.cat.subject'))}{field('language', t('lib.cat.language'))}{field('callNo', t('lib.cat.callNo'), { hint: t('lib.cat.callNoHint') })}</div>
    </>
  );
}
