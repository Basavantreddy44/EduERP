import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '@eduerp/shared';
import type { AuthContext } from './auth-context';

/**
 * Every route handler MUST carry exactly one access decorator (enforced by test/route-access.spec.ts):
 *  @Public()              no login (login, refresh, health)
 *  @Authenticated()       any logged-in user, no tenant needed (/me, switch-tenant, logout)
 *  @PlatformRoute()       SaaS operator staff (users.platform_role)
 *  @TenantMember()        any active member of the token's institution (own inbox, own approvals queue)
 *  @RequirePermission(c)  tenant route; user must hold permission c in the token's tenant
 */
export const ACCESS_KEY = 'eduerp:access';
export type AccessRule =
  | { kind: 'public' }
  | { kind: 'authenticated' }
  | { kind: 'platform'; roles: string[] }
  | { kind: 'member' }
  | { kind: 'portal' }
  | { kind: 'permission'; code: PermissionCode };

export const Public = () => SetMetadata(ACCESS_KEY, { kind: 'public' } satisfies AccessRule);
export const Authenticated = () => SetMetadata(ACCESS_KEY, { kind: 'authenticated' } satisfies AccessRule);
export const PlatformRoute = (...roles: string[]) =>
  SetMetadata(ACCESS_KEY, { kind: 'platform', roles: roles.length ? roles : ['SUPER_ADMIN'] } satisfies AccessRule);
/** Route belongs to a plan module; the guard refuses it (403 module-not-enabled) when the institution does not have it. */
export const MODULE_KEY = 'eduerp:module';
export const RequireModule = (code: string) => SetMetadata(MODULE_KEY, code);

export const TenantMember = () => SetMetadata(ACCESS_KEY, { kind: 'member' } satisfies AccessRule);
/** Parent & student app (M5.1): a member of the institution; access comes only from guardian / student links (auth.portalStudentIds). */
export const PortalUser = () => SetMetadata(ACCESS_KEY, { kind: 'portal' } satisfies AccessRule);
export const RequirePermission = (code: PermissionCode) =>
  SetMetadata(ACCESS_KEY, { kind: 'permission', code } satisfies AccessRule);

/** The resolved AuthContext of the current request. */
export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  return ctx.switchToHttp().getRequest().auth;
});

/** Client metadata for audit / login history. */
export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}
export const Client = createParamDecorator((_: unknown, ctx: ExecutionContext): ClientInfo => {
  const req = ctx.switchToHttp().getRequest();
  return {
    ip: req.ip ?? null,
    userAgent: (req.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null,
    requestId: req.id ? String(req.id) : null,
  };
});
