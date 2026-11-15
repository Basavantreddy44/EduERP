import type { SessionPayload } from './api';

/** Where a freshly logged-in user lands. */
export function homeFor(s: SessionPayload): string {
  if (s.tenantId) return '/dashboard';
  if (s.memberships.length > 0) return '/select-institution';
  if (s.user.platformRole) return '/platform/tenants';
  return '/select-institution';
}
