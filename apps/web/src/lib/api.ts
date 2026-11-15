'use client';

/** Problem-details error from the API. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
    message: string,
    readonly errors?: { field: string; message: string }[],
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let onSessionLost: () => void = () => {};

export const setAccessToken = (t: string | null) => {
  accessToken = t;
};
export const setSessionLostHandler = (fn: () => void) => {
  onSessionLost = fn;
};

export interface SessionPayload {
  accessToken: string;
  expiresIn: number;
  tenantId: string | null;
  user: { id: string; fullName: string; platformRole: string | null; preferredLanguage?: string };
  memberships: { tenantId: string; name: string; slug: string; status: string }[];
}

let inflight: Promise<SessionPayload | null> | null = null;

/**
 * Uses the httpOnly refresh cookie to get a new access token. Single-flight within the tab;
 * if another tab rotated the cookie a moment earlier the API answers `refresh-stale`, and one
 * retry picks up the new cookie.
 */
export function refreshSession(): Promise<SessionPayload | null> {
  inflight ??= (async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'same-origin' });
      if (res.ok) {
        const body = (await res.json()) as SessionPayload;
        accessToken = body.accessToken;
        return body;
      }
      const problem = await res.json().catch(() => ({}));
      if (problem.type !== 'refresh-stale') return null;
    }
    return null;
  })().finally(() => (inflight = null));
  return inflight;
}

/** A fresh key for one "attempt" of a form: reuse it for retries, make a new one when the form reopens. */
export const newIdempotencyKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Authenticated file download (exports, templates, error reports): fetch → blob → save dialog. */
export async function downloadFile(path: string): Promise<void> {
  const go = () => fetch(`/api/v1${path}`, { credentials: 'same-origin', headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
  let res = await go();
  if (res.status === 401 && (await refreshSession())) res = await go();
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.type ?? 'error', body?.detail ?? 'Download failed');
  }
  const name = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get('content-disposition') ?? '')?.[1];
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name ? decodeURIComponent(name) : 'download' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Multipart upload (imports, files). */
export async function uploadFile<T>(path: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('file', file);
  const go = () => fetch(`/api/v1${path}`, { method: 'POST', body: form, credentials: 'same-origin', headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
  let res: Response;
  try {
    res = await go();
    if (res.status === 401 && (await refreshSession())) res = await go();
  } catch {
    throw new ApiError(0, 'unreachable', 'EduERP did not respond. Please try again in a moment.');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.type ?? 'server-busy', body?.detail ?? 'EduERP is busy right now. Please try again in a moment.', body?.errors);
  return body as T;
}

/**
 * JSON fetch with bearer token. On 401 it refreshes once and retries; if that fails the
 * session-lost handler sends the user to login. The access token lives only in memory.
 */
export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    throw new ApiError(0, offline ? 'offline' : 'unreachable', offline
      ? 'You seem to be offline. Check your internet connection and try again.'
      : 'EduERP did not respond. Please try again in a moment — if you were saving, check whether it was saved before trying again.');
  }

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refreshSession()) return api<T>(path, init, false);
    onSessionLost();
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // A non-JSON error (proxy or gateway page) means the server was busy or restarting, not that the input was wrong.
    if (!body) throw new ApiError(res.status, 'server-busy', 'EduERP is busy right now. Please try again in a moment — if you were saving, check whether it was saved before trying again.');
    throw new ApiError(res.status, body.type ?? 'error', body.detail ?? 'Request failed', body.errors);
  }
  return (body ?? {}) as T;
}
