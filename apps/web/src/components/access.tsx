'use client';

import { useMemo, useState } from 'react';
import { useI18n, type T } from '@/lib/i18n';
import { en, type MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';

/** Access control (A1–A3): shared types, labels and the rights picker for the roles master and user access screens. */
export interface RightGroup { module: string; name: string; permissions: { code: string; description: string }[] }
export interface RoleRow { id: string; code: string; name: string; isSystem: boolean; users: number; rights: number }

export const rightLabel = (t: T, code: string, fallback: string) => (`right.${code}` in en ? t(`right.${code}` as MessageKey) : fallback);
export const moduleLabel = (t: T, code: string, fallback: string) => (`module.${code}` in en ? t(`module.${code}` as MessageKey) : fallback);

/**
 * Rights grouped by module, with a per-module "all" box and a search. `locked` rights cannot be ticked
 * (the actor does not hold them for all campuses); a locked right already in the role can still be removed.
 */
export function RightsPicker({ groups, value, onChange, readOnly, locked }: { groups: RightGroup[]; value: Set<string>; onChange?: (v: Set<string>) => void; readOnly?: boolean; locked?: (code: string) => boolean }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [openAll, setOpenAll] = useState<boolean | null>(null);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return groups
      .map((g) => ({ ...g, label: moduleLabel(t, g.module, g.name), permissions: g.permissions.map((p) => ({ ...p, label: rightLabel(t, p.code, p.description) })) }))
      .map((g) => (!s || g.label.toLowerCase().includes(s) ? g : { ...g, permissions: g.permissions.filter((p) => p.label.toLowerCase().includes(s) || p.code.includes(s)) }))
      .filter((g) => g.permissions.length && (!readOnly || g.permissions.some((p) => value.has(p.code))));
  }, [groups, q, t, readOnly, value]);
  const can = (code: string) => !readOnly && (value.has(code) || !locked?.(code));
  const toggle = (code: string) => {
    if (!onChange || !can(code)) return;
    const n = new Set(value);
    if (n.has(code)) n.delete(code); else n.add(code);
    onChange(n);
  };
  const toggleGroup = (codes: string[], on: boolean) => {
    if (!onChange) return;
    const n = new Set(value);
    for (const c of codes) if (on ? !locked?.(c) : true) { if (on) n.add(c); else n.delete(c); }
    onChange(n);
  };
  const total = groups.reduce((a, g) => a + g.permissions.length, 0);
  return (
    <div className="acc-picker">
      <div className="acc-picker-bar">
        <label className="search">
          <Icon name="search" size={16} />
          <input placeholder={t('acc.searchRights')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('acc.searchRights')} />
        </label>
        <span className="muted small" role="status">{t('acc.rightsChosen', { n: value.size, m: total })}</span>
        <span className="acc-picker-tools">
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpenAll(true)}>{t('acc.expandAll')}</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpenAll(false)}>{t('acc.collapseAll')}</button>
        </span>
      </div>
      {!shown.length && <p className="muted">{readOnly ? t('acc.noRightsYet') : t('common.noMatches')}</p>}
      {shown.map((g) => {
        const codes = g.permissions.map((p) => p.code);
        const on = codes.filter((c) => value.has(c)).length;
        const grantable = codes.filter((c) => !locked?.(c));
        const list = readOnly ? g.permissions.filter((p) => value.has(p.code)) : g.permissions;
        return (
          <details key={g.module} className="acc-group" open={openAll ?? (!!q || (readOnly ? true : on > 0))}>
            <summary>
              <Icon name="chevronRight" size={16} className="acc-caret" />
              <span className="acc-group-name">{g.label}</span>
              <span className={`acc-count ${on ? 'on' : ''}`}>{readOnly ? on : t('acc.nOfM', { n: on, m: codes.length })}</span>
            </summary>
            {!readOnly && (
              <label className="check acc-all">
                <input type="checkbox" checked={on === codes.length} ref={(el) => { if (el) el.indeterminate = on > 0 && on < codes.length; }}
                  disabled={!grantable.length && !on} onChange={(e) => toggleGroup(codes, e.target.checked)} />
                <span>{t('acc.allOfModule')}</span>
              </label>
            )}
            <ul className="acc-rights">
              {list.map((p) => (
                <li key={p.code}>
                  {readOnly ? (
                    <span className="acc-right-ro"><Icon name="check" size={15} /> {p.label}</span>
                  ) : (
                    <label className={`check ${!can(p.code) ? 'is-locked' : ''}`}>
                      <input type="checkbox" checked={value.has(p.code)} disabled={!can(p.code)} onChange={() => toggle(p.code)} />
                      <span>{p.label}{!can(p.code) && <span className="sub-line muted small"><Icon name="lock" size={12} /> {t('acc.notYours')}</span>}</span>
                    </label>
                  )}
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
