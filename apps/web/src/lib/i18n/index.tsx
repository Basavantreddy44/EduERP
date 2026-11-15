'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { en, kn, MessageKey } from './messages';

export type Lang = 'en' | 'kn';
const STORE = 'eduerp.lang';
const DICTS: Record<Lang, Record<MessageKey, string>> = { en, kn };

type Vars = Record<string, string | number>;
export type T = (key: MessageKey, vars?: Vars) => string;

interface I18n {
  lang: Lang;
  t: T;
  /** Locale for dates and numbers ('kn-IN' gives Kannada month names). */
  locale: string;
  setLang: (l: Lang) => void;
}

const Ctx = createContext<I18n | null>(null);

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`)) : s);

/** True when this device has an explicit language choice (made on the sign-in page or in the menu). */
export function hasDeviceChoice(): boolean {
  return stored() !== null;
}

function stored(): Lang | null {
  try {
    const v = localStorage.getItem(STORE);
    return v === 'kn' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}

/**
 * Screen language. Order: the signed-in person's saved preference (applied by SessionProvider via
 * setLang) → the choice made on this device (localStorage) → English. Changing it here updates
 * <html lang> immediately; SessionProvider also saves it to the account.
 */
export function I18nProvider({ children, onChange }: { children: ReactNode; onChange?: (l: Lang) => void }) {
  const [lang, setLangState] = useState<Lang>('en');

  useEffect(() => {
    const s = stored();
    if (s) setLangState(s);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback(
    (l: Lang) => {
      setLangState(l);
      try {
        localStorage.setItem(STORE, l);
      } catch {
        /* private mode: the choice lasts for this visit */
      }
      onChange?.(l);
    },
    [onChange],
  );

  const value = useMemo<I18n>(() => {
    const dict = DICTS[lang];
    return { lang, setLang, locale: lang === 'kn' ? 'kn-IN' : 'en-IN', t: (key, vars) => fill(dict[key] ?? en[key] ?? key, vars) };
  }, [lang, setLang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}

/** Compact two-option switch used on the sign-in page and in the account menu. */
export function LanguageSwitch({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <div className={`lang-switch ${className ?? ''}`} role="group" aria-label={t('common.language')}>
      <button type="button" aria-pressed={lang === 'en'} className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>English</button>
      <button type="button" aria-pressed={lang === 'kn'} className={lang === 'kn' ? 'on' : ''} onClick={() => setLang('kn')} lang="kn">ಕನ್ನಡ</button>
    </div>
  );
}
