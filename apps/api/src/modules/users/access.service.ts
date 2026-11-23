import { Injectable } from '@nestjs/common';
import { MODULES, PERMISSIONS, PERMISSION_CATALOGUE, PermissionCode, RoleInput } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { EntitlementsService } from '../platform/entitlements.service';
import { AccountLinksService } from '../auth/account-links.service';

const ADMIN = 'INSTITUTION_ADMIN';
/** The actor may hand out these rights for this reach (null = all campuses) only if they hold each of them there. */
export function assertCanGrant(auth: AuthContext, codes: string[], campusId: string | null) {
  const missing = codes.filter((c) => {
    const sc = scopeFor(auth, c as PermissionCode);
    return !sc || (campusId ? !canAccessCampus(sc, campusId) : !sc.all);
  });
  if (missing.length) throw Forbidden('cannot-grant', `You cannot give rights you do not hold yourself${campusId ? ' at this campus' : ' for all campuses'} (${missing.length} right(s), e.g. ${missing[0]})`);
}

/** The institution must keep one active all-campus Institution Admin besides the grants being taken away. */
export async function assertAdminRemains(tx: Tx, tenantId: string, losing: { userRoleIds?: string[]; userId?: string }) {
  const adminGrant = { role: { code: ADMIN, isSystem: true }, campusId: null };
  if (losing.userId && !(await tx.userRole.count({ where: { ...adminGrant, userId: losing.userId } }))) return;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`admins:${tenantId}`}))`;
  const left = await tx.userRole.count({
    where: {
      role: { code: ADMIN, isSystem: true }, campusId: null,
      ...(losing.userRoleIds ? { id: { notIn: losing.userRoleIds } } : {}),
      ...(losing.userId ? { userId: { not: losing.userId } } : {}),
      user: { userTenants: { some: { tenantId, status: 'ACTIVE' } } },
    },
  });
  if (!left) throw Conflict('last-admin', 'The institution must keep at least one Institution Admin for all campuses');
}

const MODULE_ORDER = new Map<string, number>(MODULES.map((m, i) => [m.code, i]));

/**
 * Access control (improvement round, A1–A3): the roles master (built-in roles are fixed templates —
 * copy to customise; custom roles are editable) and each person's access (roles for all campuses or
 * one campus). Nobody grants rights they do not hold or a campus they cannot reach, and the
 * institution always keeps one all-campus Institution Admin.
 */
@Injectable()
export class AccessService {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly links: AccountLinksService) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  // ───────────── Rights catalogue ─────────────

  permissions(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const on: Set<string> = await EntitlementsService.enabledModules(tx);
      const list = PERMISSION_CATALOGUE.filter((p) => on.has(p.module));
      const modules = [...new Set(list.map((p) => p.module))].sort((a, b) => (MODULE_ORDER.get(a) ?? 99) - (MODULE_ORDER.get(b) ?? 99));
      return modules.map((m) => ({ module: m, name: MODULES.find((x) => x.code === m)?.name ?? m, permissions: list.filter((p) => p.module === m).map((p) => ({ code: p.code, description: p.description })) }));
    });
  }

  // ───────────── Roles master ─────────────

  roles(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.role.findMany({ orderBy: [{ isSystem: 'desc' }, { name: 'asc' }], include: { rolePermissions: { select: { permission: { select: { code: true } } } }, _count: { select: { userRoles: true } } } });
      return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, isSystem: r.isSystem, users: r._count.userRoles, rights: r.rolePermissions.length }));
    });
  }

  role(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await tx.role.findUnique({ where: { id }, include: { rolePermissions: { select: { permission: { select: { code: true } } } } } });
      if (!r) throw NotFound('Role');
      const holders = await tx.userRole.findMany({ where: { roleId: r.id }, select: { id: true, campusId: true, user: { select: { id: true, fullName: true, email: true } } }, orderBy: { user: { fullName: 'asc' } } });
      const campuses = new Map((await tx.campus.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
      return {
        id: r.id, code: r.code, name: r.name, isSystem: r.isSystem, permissionCodes: r.rolePermissions.map((p) => p.permission.code).sort(),
        holders: holders.map((h) => ({ userId: h.user.id, name: h.user.fullName, email: h.user.email, campus: h.campusId ? campuses.get(h.campusId) ?? '' : null })),
        can: { edit: !r.isSystem && !!scopeFor(auth, PERMISSIONS.IAM_ROLE_MANAGE) },
      };
    });
  }

  private async permissionIds(tx: Tx, codes: string[]) {
    const on: Set<string> = await EntitlementsService.enabledModules(tx);
    const allowed = new Set(PERMISSION_CATALOGUE.filter((p) => on.has(p.module)).map((p) => p.code));
    const bad = codes.filter((c) => !allowed.has(c as PermissionCode));
    if (bad.length) throw Conflict('unknown-right', `Not a right of this institution's modules: ${bad[0]}`);
    const rows = await tx.permission.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } });
    return rows.map((r) => r.id);
  }

  private async uniqueCode(tx: Tx, name: string) {
    const base = `CUSTOM_${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 36) || 'ROLE'}`;
    for (let i = 0; ; i++) {
      const code = i ? `${base}_${i + 1}` : base;
      if (!(await tx.role.findFirst({ where: { code }, select: { id: true } }))) return code;
    }
  }

  createRole(input: RoleInput, auth: AuthContext, client: ClientInfo) {
    const codes = [...new Set(input.permissionCodes)];
    return this.db.run(this.ctx(auth), async (tx) => {
      if (await tx.role.findFirst({ where: { name: { equals: input.name, mode: 'insensitive' } }, select: { id: true } })) throw Conflict('duplicate-name', `A role called ${input.name} already exists`);
      const ids = await this.permissionIds(tx, codes);
      assertCanGrant(auth, codes, null);
      const r = await tx.role.create({ data: { tenantId: auth.tenantId!, code: await this.uniqueCode(tx, input.name), name: input.name, isSystem: false, createdBy: auth.userId } });
      await tx.rolePermission.createMany({ data: ids.map((permissionId) => ({ tenantId: auth.tenantId!, roleId: r.id, permissionId, createdBy: auth.userId })) });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'CREATE', entityType: 'ROLE', entityId: r.id, newValues: { name: r.name, code: r.code, rights: codes } }, client);
      return { id: r.id, code: r.code };
    });
  }

  updateRole(id: string, input: RoleInput, auth: AuthContext, client: ClientInfo) {
    const codes = [...new Set(input.permissionCodes)];
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await tx.role.findUnique({ where: { id }, include: { rolePermissions: { select: { permission: { select: { code: true } } } } } });
      if (!r) throw NotFound('Role');
      if (r.isSystem) throw Conflict('built-in-role', 'Built-in roles cannot be changed — copy the role and change the copy');
      const before = r.rolePermissions.map((p) => p.permission.code);
      if (await tx.role.findFirst({ where: { name: { equals: input.name, mode: 'insensitive' }, id: { not: id } }, select: { id: true } })) throw Conflict('duplicate-name', `A role called ${input.name} already exists`);
      const ids = await this.permissionIds(tx, codes);
      // Adding a right requires holding it; removing one does not.
      assertCanGrant(auth, codes.filter((c) => !before.includes(c)), null);
      await tx.role.update({ where: { id }, data: { name: input.name, updatedBy: auth.userId } });
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.rolePermission.createMany({ data: ids.map((permissionId) => ({ tenantId: auth.tenantId!, roleId: id, permissionId, createdBy: auth.userId })) });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'UPDATE', entityType: 'ROLE', entityId: id, oldValues: { name: r.name, rights: before }, newValues: { name: input.name, added: codes.filter((c) => !before.includes(c)), removed: before.filter((c) => !codes.includes(c)) } }, client);
      return { id };
    });
  }

  deleteRole(id: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await tx.role.findUnique({ where: { id }, include: { _count: { select: { userRoles: true, approvalRules: true } } } });
      if (!r) throw NotFound('Role');
      if (r.isSystem) throw Conflict('built-in-role', 'Built-in roles cannot be deleted');
      if (r._count.userRoles) throw Conflict('role-in-use', `${r._count.userRoles} person(s) hold this role — take it away from them first`);
      if (r._count.approvalRules) throw Conflict('role-in-use', 'Approval rules use this role as approver — change them first');
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.role.delete({ where: { id } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'DELETE', entityType: 'ROLE', entityId: id, oldValues: { name: r.name, code: r.code } }, client);
      return { deleted: true };
    });
  }

  // ───────────── One person's access ─────────────

  user(userId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const m = await tx.userTenant.findUnique({ where: { tenantId_userId: { tenantId: auth.tenantId!, userId } }, include: { user: { select: { id: true, fullName: true, email: true, phone: true, status: true, lastLoginAt: true, passwordHash: true } } } });
      if (!m || m.status === 'REMOVED') throw NotFound('User');
      const roles = await tx.userRole.findMany({ where: { userId }, include: { role: { include: { rolePermissions: { select: { permission: { select: { code: true } } } } } } } });
      const campuses = await tx.campus.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
      const cn = new Map(campuses.map((c) => [c.id, c.name]));
      const staff = await tx.employee.findFirst({ where: { userId }, select: { id: true, employeeCode: true, firstName: true, lastName: true, designation: true, campusId: true } });
      const student = await tx.student.findFirst({ where: { userId }, select: { id: true, admissionNo: true, firstName: true, lastName: true } });
      const guardians = await tx.guardian.findMany({ where: { userId }, select: { id: true, students: { select: { student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } } } } } });
      // Effective rights: each right with the campuses it reaches.
      const reach = new Map<string, Set<string>>();
      for (const ur of roles) for (const rp of ur.role.rolePermissions) {
        const set = reach.get(rp.permission.code) ?? new Set<string>();
        set.add(ur.campusId ?? '*');
        reach.set(rp.permission.code, set);
      }
      const on: Set<string> = await EntitlementsService.enabledModules(tx);
      const byModule = new Map<string, { code: string; description: string; campuses: string[] | null }[]>();
      for (const p of PERMISSION_CATALOGUE) {
        const set = reach.get(p.code);
        if (!set || !on.has(p.module)) continue;
        const list = byModule.get(p.module) ?? [];
        list.push({ code: p.code, description: p.description, campuses: set.has('*') ? null : [...set].map((c) => cn.get(c) ?? '') });
        byModule.set(p.module, list);
      }
      const name = (x: { firstName: string; lastName: string | null }) => `${x.firstName} ${x.lastName ?? ''}`.trim();
      return {
        id: m.user.id, fullName: m.user.fullName, email: m.user.email, phone: m.user.phone, accountStatus: m.user.status, membershipStatus: m.status, lastLoginAt: m.user.lastLoginAt, hasPassword: !!m.user.passwordHash, isMe: userId === auth.userId,
        roles: roles.map((ur) => ({ id: ur.id, roleId: ur.roleId, code: ur.role.code, name: ur.role.name, isSystem: ur.role.isSystem, campusId: ur.campusId, campus: ur.campusId ? cn.get(ur.campusId) ?? '' : null, rights: ur.role.rolePermissions.length }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        links: {
          staff: staff ? { id: staff.id, code: staff.employeeCode, name: name(staff), designation: staff.designation, campus: cn.get(staff.campusId) ?? '' } : null,
          student: student ? { id: student.id, name: name(student), admissionNo: student.admissionNo } : null,
          children: guardians.flatMap((gd) => gd.students.map((g) => ({ id: g.student.id, name: name(g.student), admissionNo: g.student.admissionNo }))),
        },
        rights: [...byModule.entries()].sort((a, b) => (MODULE_ORDER.get(a[0]) ?? 99) - (MODULE_ORDER.get(b[0]) ?? 99)).map(([module, perms]) => ({ module, name: MODULES.find((x) => x.code === module)?.name ?? module, permissions: perms })),
        campuses,
        can: (() => { const sc = scopeFor(auth, PERMISSIONS.IAM_USER_INVITE); return { manage: !!sc, manageAll: !!sc?.all, campusIds: !sc ? [] : sc.all ? campuses.map((c) => c.id) : campuses.map((c) => c.id).filter((c) => canAccessCampus(sc, c)) }; })(),
      };
    });
  }

  addRole(userId: string, roleId: string, campusId: string | null, auth: AuthContext, client: ClientInfo) {
    const inviteScope = scopeFor(auth, PERMISSIONS.IAM_USER_INVITE)!;
    if (campusId ? !canAccessCampus(inviteScope, campusId) : !inviteScope.all) throw Forbidden('scope-insufficient', 'You can only give access for campuses you manage');
    return this.db.run(this.ctx(auth), async (tx) => {
      const m = await tx.userTenant.findUnique({ where: { tenantId_userId: { tenantId: auth.tenantId!, userId } } });
      if (!m || m.status !== 'ACTIVE') throw NotFound('User');
      const r = await tx.role.findUnique({ where: { id: roleId }, include: { rolePermissions: { select: { permission: { select: { code: true } } } } } });
      if (!r) throw NotFound('Role');
      if (campusId && !(await tx.campus.findUnique({ where: { id: campusId }, select: { id: true } }))) throw NotFound('Campus');
      assertCanGrant(auth, r.rolePermissions.map((p) => p.permission.code), campusId);
      const held = await tx.userRole.findMany({ where: { userId, roleId } });
      if (held.some((h) => h.campusId === null)) throw Conflict('already-held', `Already ${r.name} for all campuses`);
      if (held.some((h) => h.campusId === campusId)) throw Conflict('already-held', `Already ${r.name} at this campus`);
      // Widening to all campuses replaces the campus-level grants of the same role.
      if (!campusId && held.length) await tx.userRole.deleteMany({ where: { userId, roleId } });
      const ur = await tx.userRole.create({ data: { tenantId: auth.tenantId!, userId, roleId, campusId, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId, action: 'UPDATE', entityType: 'USER_ROLE', entityId: userId, newValues: { granted: r.code, campusId, replaced: !campusId ? held.length : 0 } }, client);
      return { id: ur.id };
    });
  }

  removeRole(userId: string, userRoleId: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const ur = await tx.userRole.findUnique({ where: { id: userRoleId }, include: { role: true } });
      if (!ur || ur.userId !== userId) throw NotFound('Role of this person');
      const inviteScope = scopeFor(auth, PERMISSIONS.IAM_USER_INVITE)!;
      if (ur.campusId ? !canAccessCampus(inviteScope, ur.campusId) : !inviteScope.all) throw Forbidden('scope-insufficient', 'You can only change access for campuses you manage');
      if (ur.role.code === ADMIN && !ur.campusId) {
        if (userId === auth.userId) throw Forbidden('self-admin', 'You cannot remove your own Institution Admin access');
        await assertAdminRemains(tx, auth.tenantId!, { userRoleIds: [ur.id] });
      }
      await tx.userRole.delete({ where: { id: ur.id } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: ur.campusId, action: 'UPDATE', entityType: 'USER_ROLE', entityId: userId, oldValues: { removed: ur.role.code, campusId: ur.campusId } }, client);
      return { removed: true };
    });
  }

  /** Sends the person a set-password / reset link by email. */
  async passwordLink(userId: string, auth: AuthContext, client: ClientInfo) {
    const email = await this.db.run(this.ctx(auth), async (tx) => {
      const m = await tx.userTenant.findUnique({ where: { tenantId_userId: { tenantId: auth.tenantId!, userId } }, include: { user: { select: { email: true, passwordHash: true } } } });
      if (!m || m.status !== 'ACTIVE') throw NotFound('User');
      if (!m.user.email) throw Conflict('no-email', 'This person has no email address');
      if (!m.user.passwordHash) await this.links.queueInvite(tx, auth.tenantId!, userId, auth.userId!);
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'UPDATE', entityType: 'USER', entityId: userId, newValues: { passwordLinkSent: true } }, client);
      return m.user.passwordHash ? m.user.email : null;
    });
    if (email) await this.links.requestReset(email);
    return { sent: true };
  }
}
