import type { PermissionCode } from '@eduerp/shared';

/** Campus scope for one permission: every campus, or only the listed ones. */
export type CampusScope = { all: true } | { all: false; campusIds: string[] };

/** Identity from a verified access token (set by AuthGuard). */
export interface TokenIdentity {
  userId: string;
  tenantId: string | null;
  sessionId: string; // refresh-token family id
}

/** Fully resolved request context (set by AccessGuard for tenant routes). */
export interface AuthContext extends TokenIdentity {
  platformRole: string | null;
  tenantStatus: string | null;
  permissions: Map<PermissionCode, CampusScope>;
  /** Portal routes only: students this login may see (own children as a guardian, and themself as a student). */
  portalStudentIds?: string[];
}

export function scopeFor(auth: AuthContext, code: PermissionCode): CampusScope | null {
  return auth.permissions.get(code) ?? null;
}

/** Prisma `where` fragment for a campus-scoped list; `id` is the campus id column name. */
export function campusFilter(scope: CampusScope, field = 'id'): Record<string, unknown> {
  return scope.all ? {} : { [field]: { in: scope.campusIds } };
}

export function canAccessCampus(scope: CampusScope, campusId: string): boolean {
  return scope.all || scope.campusIds.includes(campusId);
}
