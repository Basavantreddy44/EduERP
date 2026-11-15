'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PERMISSIONS } from '@eduerp/shared';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Icon } from '@/components/Icon';
import { PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

interface Row {
  key: string;
  label: string;
  description: string;
  group: string;
  scopes: ('TENANT' | 'CAMPUS')[];
  defaultValue: unknown;
  institutionValue: unknown;
  campusValue: unknown;
  value: unknown;
  source: 'CAMPUS' | 'INSTITUTION' | 'DEFAULT';
}

type Quiet = { start: string; end: string } | null;

const SOURCE_LABEL = { CAMPUS: 'Campus value', INSTITUTION: 'Institution value', DEFAULT: 'Default' } as const;

/** Editor for one value, chosen from the shape of the registry default. */
function Editor({ row, value, onChange, disabled }: { row: Row; value: unknown; onChange: (v: unknown) => void; disabled: boolean }) {
  const id = `set-${row.key}`;
  if (row.key === 'general.default_language') {
    return (
      <select id={id} value={String(value)} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="en">English</option>
        <option value="kn">ಕನ್ನಡ (Kannada)</option>
      </select>
    );
  }
  if (row.key === 'notifications.quiet_hours') {
    const q = value as Quiet;
    return (
      <div className="quiet">
        <label className="check">
          <input id={id} type="checkbox" checked={!!q} disabled={disabled} onChange={(e) => onChange(e.target.checked ? { start: '21:00', end: '07:00' } : null)} /> Hold messages during quiet hours
        </label>
        {q && (
          <span className="quiet-times">
            <input type="time" aria-label="Quiet hours start" value={q.start} disabled={disabled} onChange={(e) => onChange({ ...q, start: e.target.value })} />
            <span className="muted">to</span>
            <input type="time" aria-label="Quiet hours end" value={q.end} disabled={disabled} onChange={(e) => onChange({ ...q, end: e.target.value })} />
          </span>
        )}
      </div>
    );
  }
  if (typeof row.defaultValue === 'number') {
    return <input id={id} type="number" inputMode="numeric" value={value === null || value === undefined ? '' : String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />;
  }
  return <input id={id} type="text" value={String(value ?? '')} maxLength={300} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
}

export default function SettingsPage() {
  const { can, campusId } = useSession();
  const canEdit = can(PERMISSIONS.ORG_SETTINGS_UPDATE);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const toast = useToast();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Row[]>(`/settings${campusId ? `?campusId=${campusId}` : ''}`)
      .then((r) => {
        setRows(r);
        setDrafts({});
        setErrors({});
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load settings'));
  }, [campusId]);
  useEffect(load, [load]);

  const groups = useMemo(() => {
    const visible = (rows ?? []).filter((r) => (campusId ? r.scopes.includes('CAMPUS') : r.scopes.includes('TENANT')));
    return [...new Set(visible.map((r) => r.group))].map((g) => ({ group: g, items: visible.filter((r) => r.group === g) }));
  }, [rows, campusId]);

  async function save(row: Row) {
    setErrors((e) => ({ ...e, [row.key]: '' }));
    try {
      await api(`/settings/${row.key}`, { method: 'PUT', body: JSON.stringify({ campusId: campusId ?? null, value: drafts[row.key] }) });
      toast(`Saved “${row.label}”`);
      load();
    } catch (e) {
      const msg = e instanceof ApiError ? (e.errors?.[0]?.message ?? e.message) : 'Could not save';
      setErrors((x) => ({ ...x, [row.key]: msg }));
    }
  }

  async function reset(row: Row) {
    await api(`/settings/${row.key}${campusId ? `?campusId=${campusId}` : ''}`, { method: 'DELETE' }).catch(() => undefined);
    load();
  }

  return (
    <>
      <PageHeader
        eyebrow={t('nav.setup')}
        title={t('nav.settings')}
        description={campusId ? t('settings.descCampus') : t('settings.descInst')}
      />
      {error && <div className="alert" role="alert"><Icon name="alert" />{error}</div>}

      {rows === null ? (
        <SkeletonRows />
      ) : (
        groups.map(({ group, items }) => (
          <section key={group} className="card settings-group">
            <h2 className="card-title">{group}</h2>
            {items.map((row) => {
              const dirty = row.key in drafts;
              const value = dirty ? drafts[row.key] : row.value;
              const ownLevel = campusId ? row.source === 'CAMPUS' : row.source !== 'DEFAULT' && row.source === 'INSTITUTION';
              return (
                <div key={row.key} className="setting-row">
                  <div className="setting-text">
                    <label className="setting-label" htmlFor={`set-${row.key}`}>{row.label}</label>
                    <span className="muted">{row.description}</span>
                    <span className={`badge ${row.source === 'DEFAULT' ? '' : 'ok'}`}>{SOURCE_LABEL[row.source]}</span>
                  </div>
                  <div className="setting-edit">
                    <Editor row={row} value={value} disabled={!canEdit} onChange={(v) => setDrafts((d) => ({ ...d, [row.key]: v }))} />
                    {canEdit && (
                      <div className="setting-buttons">
                        {ownLevel && !dirty && (
                          <button className="btn-link btn" onClick={() => reset(row)}>{campusId ? 'Use institution value' : 'Use default'}</button>
                        )}
                        {dirty && <button className="btn" onClick={() => setDrafts(({ [row.key]: _drop, ...rest }) => rest)}>Cancel</button>}
                        {dirty && <button className="btn btn-primary" onClick={() => save(row)}>Save</button>}
                      </div>
                    )}
                    {errors[row.key] && <span className="err">{errors[row.key]}</span>}
                  </div>
                </div>
              );
            })}
          </section>
        ))
      )}
    </>
  );
}
