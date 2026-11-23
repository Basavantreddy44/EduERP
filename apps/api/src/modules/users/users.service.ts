import { Injectable } from '@nestjs/common';
import { PERMISSIONS, InviteUserInput } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { AccountLinksService } from '../auth/account-links.service';
import { assertAdminRemains, assertCanGrant } from './access.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly links: AccountLinksService,
  ) {}

  roles(auth: AuthContext) {
    return this.db.run({ tenantId: auth.tenantId, userId: auth.userId }, (tx) =>
      tx.role.findMany({ orderBy: [{ isSystem: 'desc' }, { name: 'asc' }], select: { id: true, code: true, name: true, isSystem: true, _count: { select: { userRoles: true } } } }),
    );
  }

  list(auth: AuthContext) {
    return this.db.run({ tenantId: auth.tenantId, userId: auth.userId }, async (tx) => {
      const rows = await tx.userTenant.findMany({
        where: { tenantId: auth.tenantId! },
        select: {
          userType: true,
          status: true,
          user: {
            select: {
              id: true, fullName: true, email: true, phone: true, status: true, lastLoginAt: true,
              userRoles: { select: { campusId: true, role: { select: { code: true, name: true } } } },
            },
          },
        },
        orderBy: { user: { fullName: 'asc' } },
      });
      return rows.map(({ user: { userRoles, ...u }, userType, status }) => ({
        ...u,
        userType,
        membershipStatus: status,
        roles: userRoles.map((r) => ({ code: r.role.code, name: r.role.name, campusId: r.campusId })),
      }));
    });
  }

  /**
   * Adds a person to this institution with one role (optionally campus-limited).
   * Existing users (e.g. member of another institution) are linked, not duplicated.
   * The person gets an email: a set-password link if they are new, or an "access granted" note if they already have a password.
   */
  async invite(input: InviteUserInput, auth: AuthContext, client: ClientInfo) {
    const scope = scopeFor(auth, PERMISSIONS.IAM_USER_INVITE)!;
    if (input.campusId ? !canAccessCampus(scope, input.campusId) : !scope.all) {
      throw Forbidden('scope-insufficient', 'You can only grant access to campuses you manage');
    }
    const tenantId = auth.tenantId!;
    return this.db.run({ tenantId, userId: auth.userId, loginIdentifier: input.email }, async (tx) => {
      const role = await tx.role.findUnique({ where: { tenantId_code: { tenantId, code: input.roleCode } } });
      if (!role) throw NotFound('Role');
      if (input.campusId && !(await tx.campus.findUnique({ where: { id: input.campusId }, select: { id: true } }))) throw NotFound('Campus');
      return this.addMember(tx, { fullName: input.fullName, email: input.email, role, campusId: input.campusId ?? null }, auth, client);
    });
  }

  /**
   * Shared by single invite and bulk import, inside the caller's tenant transaction:
   * link or create the global user, activate membership, grant the role, queue the email, audit.
   */
  async addMember(tx: Tx, m: { fullName: string; email: string; role: { id: string; code: string }; campusId: string | null }, auth: AuthContext, client?: ClientInfo) {
    const tenantId = auth.tenantId!;
    // The users policy only reveals a global user to an exact login/invite lookup.
    await tx.$executeRaw`SELECT set_config('app.login_identifier', ${m.email}, true)`;
    // Nobody invites someone into rights they do not hold themselves for that reach (also covers bulk import).
    const rights = await tx.rolePermission.findMany({ where: { roleId: m.role.id }, select: { permission: { select: { code: true } } } });
    assertCanGrant(auth, rights.map((r) => r.permission.code), m.campusId);
    const user =
      (await tx.user.findUnique({ where: { email: m.email }, select: { id: true } })) ??
      (await tx.user.create({ data: { email: m.email, fullName: m.fullName }, select: { id: true } }));

    const existing = await tx.userTenant.findUnique({ where: { tenantId_userId: { tenantId, userId: user.id } } });
    if (existing?.status === 'ACTIVE') throw Conflict('already-member', 'This person already has access to the institution');
    if (existing) await tx.userTenant.update({ where: { id: existing.id }, data: { status: 'ACTIVE', updatedBy: auth.userId } });
    else await tx.userTenant.create({ data: { tenantId, userId: user.id, userType: 'STAFF', status: 'ACTIVE', createdBy: auth.userId } });

    await tx.userRole.create({ data: { tenantId, userId: user.id, roleId: m.role.id, campusId: m.campusId, createdBy: auth.userId } });
    await this.links.queueInvite(tx, tenantId, user.id, auth.userId);
    await this.audit.log(tx, { tenantId, userId: auth.userId, campusId: m.campusId, action: 'INVITE', entityType: 'USER', entityId: user.id, newValues: { email: m.email, role: m.role.code, campusId: m.campusId } }, client);
    return { userId: user.id, role: m.role.code, campusId: m.campusId };
  }

  /** Removes access to this institution (membership + roles). The global user account is kept. */
  async remove(userId: string, auth: AuthContext, client: ClientInfo) {
    if (!scopeFor(auth, PERMISSIONS.IAM_USER_INVITE)!.all) throw Forbidden('scope-insufficient', 'Only institution-wide admins can remove access');
    if (userId === auth.userId) throw Forbidden('self-removal', 'You cannot remove your own access');
    const tenantId = auth.tenantId!;
    return this.db.run({ tenantId, userId: auth.userId }, async (tx) => {
      const m = await tx.userTenant.findUnique({ where: { tenantId_userId: { tenantId, userId } } });
      if (!m || m.status === 'REMOVED') throw NotFound('Member');
      await assertAdminRemains(tx, tenantId, { userId });
      await tx.userTenant.update({ where: { id: m.id }, data: { status: 'REMOVED', updatedBy: auth.userId } });
      const roles = await tx.userRole.findMany({ where: { userId }, select: { roleId: true, campusId: true } });
      await tx.userRole.deleteMany({ where: { userId } });
      await this.audit.log(tx, { tenantId, userId: auth.userId, action: 'REMOVE', entityType: 'USER', entityId: userId, oldValues: { status: m.status, roles } }, client);
      return { userId, status: 'REMOVED' };
    });
  }
}
