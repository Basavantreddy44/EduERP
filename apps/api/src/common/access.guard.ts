import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { PermissionCode } from '@eduerp/shared';
import { CORE_MODULES, PORTAL_STUDENT_STATUSES } from '@eduerp/shared';
import { ACCESS_KEY, AccessRule, MODULE_KEY } from './decorators';
import { AuthContext, CampusScope, TokenIdentity } from './auth-context';
import { Db, Tx } from './prisma.service';
import { Forbidden, Unauthorized } from './problem';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Single global guard. Order: classify route → verify token → re-check session, user, membership,
 * tenant status and permissions against the DB on EVERY request (no stale grants: a removed
 * membership or a logout takes effect immediately, not at token expiry).
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly db: Db,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!rule) throw Forbidden('route-not-classified', 'Route has no access rule'); // fail closed
    if (rule.kind === 'public') return true;

    const req = ctx.switchToHttp().getRequest();
    const identity = await this.verifyToken(req.headers.authorization);
    const moduleCode = this.reflector.getAllAndOverride<string | undefined>(MODULE_KEY, [ctx.getHandler(), ctx.getClass()]);
    const auth = await this.resolve(identity, rule, req.method, moduleCode);
    req.auth = auth;
    return true;
  }

  private async verifyToken(header: string | undefined): Promise<TokenIdentity> {
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw Unauthorized();
    try {
      const p = await this.jwt.verifyAsync<{ sub: string; tid?: string | null; sid: string }>(token, { algorithms: ['HS256'] });
      return { userId: p.sub, tenantId: p.tid ?? null, sessionId: p.sid };
    } catch {
      throw Unauthorized('token-invalid', 'Session expired. Please log in again.');
    }
  }

  private async resolve(id: TokenIdentity, rule: AccessRule, method: string, moduleCode?: string): Promise<AuthContext> {
    return this.db.run({ userId: id.userId, tenantId: id.tenantId }, async (tx) => {
      const [user, liveSession] = await Promise.all([
        tx.user.findUnique({ where: { id: id.userId }, select: { status: true, platformRole: true } }),
        tx.refreshToken.findFirst({
          where: { familyId: id.sessionId, userId: id.userId, revokedAt: null, expiresAt: { gt: new Date() } },
          select: { id: true },
        }),
      ]);
      if (!user || user.status !== 'ACTIVE' || !liveSession) throw Unauthorized('session-ended', 'Session ended. Please log in again.');

      const auth: AuthContext = { ...id, platformRole: user.platformRole, tenantStatus: null, permissions: new Map() };

      if (rule.kind === 'authenticated') return auth;
      if (rule.kind === 'platform') {
        if (!user.platformRole || !rule.roles.includes(user.platformRole)) throw Forbidden();
        return auth;
      }

      // Tenant route
      if (rule.kind !== 'permission' && rule.kind !== 'member' && rule.kind !== 'portal') throw Forbidden('route-not-classified', 'Route has no access rule');
      if (!id.tenantId) throw Forbidden('tenant-required', 'Choose an institution first');
      const membership = await tx.userTenant.findFirst({
        where: { tenantId: id.tenantId, userId: id.userId },
        select: { status: true, tenant: { select: { status: true } } },
      });
      if (!membership || membership.status !== 'ACTIVE') throw Forbidden('membership-inactive', 'You no longer have access to this institution');
      auth.tenantStatus = membership.tenant.status;
      if (auth.tenantStatus === 'CLOSED') throw Forbidden('tenant-closed', 'This institution account is closed');
      if (auth.tenantStatus === 'SUSPENDED' && !READ_METHODS.has(method)) {
        throw Forbidden('tenant-read-only', 'This institution account is suspended; data is read-only');
      }

      if (rule.kind === 'portal') {
        // Never staff roles: only the person's own links, and only while the student is still here.
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT s.id FROM students s
           WHERE s.status = ANY(${[...PORTAL_STUDENT_STATUSES]}::text[])
             AND (s.user_id = ${id.userId}::uuid
                  OR s.id IN (SELECT sg.student_id FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE g.user_id = ${id.userId}::uuid))`;
        auth.portalStudentIds = rows.map((r) => r.id);
        await this.requireModule(tx, moduleCode);
        return auth;
      }

      const roles = await tx.userRole.findMany({
        where: { userId: id.userId },
        select: { campusId: true, role: { select: { rolePermissions: { select: { permission: { select: { code: true } } } } } } },
      });
      auth.permissions = buildPermissionMap(roles);
      if (rule.kind === 'permission' && !auth.permissions.has(rule.code)) throw Forbidden();
      await this.requireModule(tx, moduleCode);
      return auth;
    });
  }

  private async requireModule(tx: Tx, moduleCode?: string) {
    if (moduleCode && !(CORE_MODULES as string[]).includes(moduleCode)) {
      const on = await tx.tenantModule.findFirst({ where: { moduleCode, isEnabled: true }, select: { id: true } });
      if (!on) throw Forbidden('module-not-enabled', "This module is not part of your institution's plan");
    }
  }
}

type RoleRow = { campusId: string | null; role: { rolePermissions: { permission: { code: string } }[] } };

export function buildPermissionMap(rows: RoleRow[]): Map<PermissionCode, CampusScope> {
  const map = new Map<PermissionCode, CampusScope>();
  for (const r of rows) {
    for (const rp of r.role.rolePermissions) {
      const code = rp.permission.code as PermissionCode;
      const cur = map.get(code);
      if (r.campusId === null) map.set(code, { all: true });
      else if (!cur) map.set(code, { all: false, campusIds: [r.campusId] });
      else if (!cur.all && !cur.campusIds.includes(r.campusId)) cur.campusIds.push(r.campusId);
    }
  }
  return map;
}
