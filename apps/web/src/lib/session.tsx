'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { PermissionCode, PortalMe } from '@eduerp/shared';
import { api, refreshSession, setAccessToken, setSessionLostHandler, SessionPayload } from './api';
import { hasDeviceChoice, useI18n } from './i18n';

interface PermissionEntry {
  code: PermissionCode;
  allCampuses: boolean;
  campusIds: string[];
}

export interface PlanInfo {
  plan: { name: string; code: string };
  status: string;
  startDate: string;
  endDate: string;
}

interface SessionState {
  loading: boolean;
  /** Enabled module codes of the current institution (core modules always included). */
  modules: string[];
  plan: PlanInfo | null;
  hasModule: (code: string) => boolean;
  /** Parent & student app: the children this login can see (null before loading or outside an institution). */
  portal: PortalMe | null;
  refreshPortal: () => Promise<void>;
  session: SessionPayload | null;
  permissions: PermissionEntry[];
  can: (code: PermissionCode, opts?: { allCampuses?: boolean }) => boolean;
  campusId: string | null; // current campus selector value (null = all permitted)
  setCampusId: (id: string | null) => void;
  applySession: (s: SessionPayload) => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [permissions, setPermissions] = useState<PermissionEntry[]>([]);
  const [modules, setModules] = useState<string[]>([]);
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [portal, setPortal] = useState<PortalMe | null>(null);
  const [campusId, setCampusId] = useState<string | null>(null);
  const { lang, setLang } = useI18n();

  // Language: a choice made on this device wins (and is saved to the account, which also sets the email
  // language); otherwise the account's saved language is used.
  useEffect(() => {
    const pref = session?.user.preferredLanguage;
    if (!session || !pref || pref === lang) return;
    if (hasDeviceChoice()) {
      api('/me/preferences', { method: 'PATCH', body: JSON.stringify({ preferredLanguage: lang }) })
        .then(() => setSession((s) => (s ? { ...s, user: { ...s.user, preferredLanguage: lang } } : s)))
        .catch(() => undefined);
    } else if (pref === 'en' || pref === 'kn') {
      setLang(pref);
    }
  }, [session, lang, setLang]);

  const applySession = useCallback(async (s: SessionPayload) => {
    setAccessToken(s.accessToken);
    setSession(s);
    setCampusId(null);
    if (s.tenantId) {
      const [p, m, pm] = await Promise.all([
        api<{ permissions: PermissionEntry[] }>('/me/permissions'),
        api<{ enabled: string[]; subscription: PlanInfo | null }>('/me/modules').catch(() => ({ enabled: [], subscription: null })),
        api<PortalMe>('/portal/me').catch(() => null),
      ]);
      setPermissions(p.permissions);
      setPortal(pm);
      setModules(m.enabled);
      setPlan(m.subscription);
    } else {
      setPermissions([]);
      setModules([]);
      setPlan(null);
      setPortal(null);
    }
  }, []);
  const refreshPortal = useCallback(async () => { setPortal(await api<PortalMe>('/portal/me').catch(() => null)); }, []);

  useEffect(() => {
    setSessionLostHandler(() => {
      setAccessToken(null);
      setSession(null);
      router.replace('/login');
    });
    refreshSession()
      .then(async (s) => {
        if (s) await applySession(s);
      })
      .then(() => setLoading(false))
      .catch(() => {
        // No network (the request itself failed): show the offline page rather than "signed out".
        if (!navigator.onLine) window.location.replace('/offline.html');
        else setLoading(false);
      });
  }, [applySession, router]);

  const value = useMemo<SessionState>(
    () => ({
      loading,
      session,
      permissions,
      modules,
      plan,
      hasModule: (code) => modules.includes(code),
      portal,
      refreshPortal,
      campusId,
      setCampusId,
      applySession,
      can: (code, opts) => permissions.some((p) => p.code === code && (!opts?.allCampuses || p.allCampuses)),
      switchTenant: async (tenantId) => {
        const s = await api<SessionPayload>('/auth/switch-tenant', { method: 'POST', body: JSON.stringify({ tenantId }) });
        await applySession(s);
      },
      logout: async () => {
        await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
        setAccessToken(null);
        setSession(null);
        setPermissions([]);
        router.replace('/login');
      },
    }),
    [loading, session, permissions, modules, plan, portal, refreshPortal, campusId, applySession, router],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
