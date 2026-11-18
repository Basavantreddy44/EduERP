import { Injectable } from '@nestjs/common';
import { PERMISSIONS, PortalAccessRow, PortalChild, PortalInviteInput, PortalMe } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { AccountLinksService } from '../auth/account-links.service';
import { HttpStatus } from '@nestjs/common';

const noEmail = () => new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'email-required', 'Enter an email address for the login', [{ field: 'email', message: 'Required' }]);

/**
 * Parent & student logins (M5.1). The office gives a guardian (or the student) a login from the
 * student's profile; the person gets the usual "set your password" email. Access to a child comes
 * only from these links and ends when a link is removed or the student leaves.
 */
@Injectable()
export class PortalAccessService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly links: AccountLinksService,
  ) {}

  private ctx(auth: AuthContext, loginIdentifier?: string) {
    return { tenantId: auth.tenantId, userId: auth.userId, ...(loginIdentifier ? { loginIdentifier } : {}) };
  }

  private async student(tx: Tx, id: string, auth: AuthContext, manage: boolean) {
    const scope = scopeFor(auth, manage ? PERMISSIONS.STU_STUDENT_MANAGE : PERMISSIONS.STU_STUDENT_READ)!;
    const s = await tx.student.findUnique({ where: { id }, select: { id: true, campusId: true, firstName: true, lastName: true, userId: true, status: true } });
    if (!s || !canAccessCampus(scope, s.campusId)) throw NotFound('Student');
    return s;
  }

  private loginOf(u: { passwordHash: string | null } | null | undefined): PortalAccessRow['login'] {
    return !u ? 'NONE' : u.passwordHash ? 'ACTIVE' : 'INVITED';
  }

  /** Who has a login for this student. */
  list(studentId: string, auth: AuthContext): Promise<PortalAccessRow[]> {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.student(tx, studentId, auth, false);
      const gs = await tx.studentGuardian.findMany({ where: { studentId }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], select: { relation: true, guardian: { select: { id: true, name: true, email: true, userId: true } } } });
      const userIds = [...gs.map((g) => g.guardian.userId), s.userId].filter((x): x is string => !!x);
      const users = new Map((await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, passwordHash: true } })).map((u) => [u.id, u]));
      const own = s.userId ? users.get(s.userId) : undefined;
      return [
        ...gs.map((g): PortalAccessRow => {
          const u = g.guardian.userId ? users.get(g.guardian.userId) : undefined;
          return { kind: 'GUARDIAN', id: g.guardian.id, name: g.guardian.name, relation: g.relation, email: u?.email ?? g.guardian.email, login: g.guardian.userId ? this.loginOf(u ?? { passwordHash: null }) : 'NONE' };
        }),
        { kind: 'STUDENT', id: s.id, name: `${s.firstName} ${s.lastName ?? ''}`.trim(), relation: null, email: own?.email ?? null, login: s.userId ? this.loginOf(own ?? { passwordHash: null }) : 'NONE' },
      ];
    });
  }

  /** Finds or makes the global user for an email and gives them an active membership here. */
  private async userFor(tx: Tx, email: string, fullName: string, userType: 'PARENT' | 'STUDENT', auth: AuthContext) {
    const tenantId = auth.tenantId!;
    await tx.$executeRaw`SELECT set_config('app.login_identifier', ${email}, true)`;
    const user =
      (await tx.user.findUnique({ where: { email }, select: { id: true, status: true } })) ??
      (await tx.user.create({ data: { email, fullName }, select: { id: true, status: true } }));
    if (user.status === 'DISABLED') throw Conflict('login-disabled', 'This login has been disabled');
    const m = await tx.userTenant.findUnique({ where: { tenantId_userId: { tenantId, userId: user.id } } });
    if (!m) await tx.userTenant.create({ data: { tenantId, userId: user.id, userType, status: 'ACTIVE', createdBy: auth.userId } });
    else if (m.status !== 'ACTIVE') await tx.userTenant.update({ where: { id: m.id }, data: { status: 'ACTIVE', updatedBy: auth.userId } });
    return user.id;
  }

  /** Gives one of the student's guardians a login (or sends the invitation again). */
  inviteGuardian(studentId: string, guardianId: string, input: PortalInviteInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth, input.email), async (tx) => {
      const s = await this.student(tx, studentId, auth, true);
      const link = await tx.studentGuardian.findUnique({ where: { studentId_guardianId: { studentId, guardianId } }, select: { guardian: { select: { id: true, name: true, email: true, userId: true } } } });
      if (!link) throw NotFound('Guardian');
      const g = link.guardian;
      const email = input.email ?? g.email?.toLowerCase();
      if (!email) throw noEmail();
      const userId = await this.userFor(tx, email, g.name, 'PARENT', auth);
      if (g.userId && g.userId !== userId) throw Conflict('has-login', 'This guardian already has a login with another email. Remove it first.');
      await tx.guardian.update({ where: { id: g.id }, data: { userId, email } });
      await this.links.queueInvite(tx, auth.tenantId!, userId, auth.userId);
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: s.campusId, action: 'INVITE', entityType: 'PORTAL_LOGIN', entityId: g.id, newValues: { kind: 'GUARDIAN', studentId, email } }, client);
      return { guardianId: g.id, userId, email };
    });
  }

  /** Gives the student their own login (older students). */
  inviteStudent(studentId: string, input: PortalInviteInput, auth: AuthContext, client: ClientInfo) {
    if (!input.email) throw noEmail();
    const email = input.email;
    return this.db.run(this.ctx(auth, email), async (tx) => {
      const s = await this.student(tx, studentId, auth, true);
      if (s.status !== 'ACTIVE') throw Conflict('student-not-active', 'Only a current student can be given a login');
      const userId = await this.userFor(tx, email, `${s.firstName} ${s.lastName ?? ''}`.trim(), 'STUDENT', auth);
      if (s.userId && s.userId !== userId) throw Conflict('has-login', 'This student already has a login with another email. Remove it first.');
      const other = await tx.student.findFirst({ where: { userId, id: { not: studentId } }, select: { id: true } });
      if (other) throw Conflict('login-in-use', 'This email is already the login of another student');
      await tx.student.update({ where: { id: studentId }, data: { userId, updatedBy: auth.userId } });
      await this.links.queueInvite(tx, auth.tenantId!, userId, auth.userId);
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: s.campusId, action: 'INVITE', entityType: 'PORTAL_LOGIN', entityId: studentId, newValues: { kind: 'STUDENT', email } }, client);
      return { studentId, userId, email };
    });
  }

  /** Removes a login link. A person left with no links and no staff role loses access to the institution. */
  revoke(studentId: string, kind: 'GUARDIAN' | 'STUDENT', id: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.student(tx, studentId, auth, true);
      let userId: string | null;
      if (kind === 'GUARDIAN') {
        const link = await tx.studentGuardian.findUnique({ where: { studentId_guardianId: { studentId, guardianId: id } }, select: { guardian: { select: { userId: true } } } });
        if (!link) throw NotFound('Guardian');
        userId = link.guardian.userId;
        if (userId) await tx.guardian.update({ where: { id }, data: { userId: null } });
      } else {
        userId = s.userId;
        if (userId) await tx.student.update({ where: { id: studentId }, data: { userId: null, updatedBy: auth.userId } });
      }
      if (!userId) throw NotFound('Login');
      const still = (await tx.guardian.count({ where: { userId } })) + (await tx.student.count({ where: { userId } })) + (await tx.userRole.count({ where: { userId } }));
      if (!still) await tx.userTenant.updateMany({ where: { tenantId: auth.tenantId!, userId }, data: { status: 'REMOVED', updatedBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: s.campusId, action: 'REMOVE', entityType: 'PORTAL_LOGIN', entityId: id, oldValues: { kind, studentId, userId } }, client);
      return { removed: true, accessEnded: !still };
    });
  }

  /** The signed-in parent's children (and the student themself), with this year's class. */
  me(auth: AuthContext): Promise<PortalMe> {
    const ids = auth.portalStudentIds ?? [];
    if (!ids.length) return Promise.resolve({ hasPortal: false, children: [] });
    return this.db.run(this.ctx(auth), async (tx) => {
      const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
      const rows = await tx.student.findMany({
        where: { id: { in: ids } },
        orderBy: [{ firstName: 'asc' }],
        select: {
          id: true, firstName: true, lastName: true, admissionNo: true, userId: true,
          campus: { select: { name: true } },
          guardians: { where: { guardian: { userId: auth.userId } }, select: { relation: true } },
          enrollments: { where: { academicYearId: year?.id ?? '00000000-0000-0000-0000-000000000000', status: { not: 'CANCELLED' } }, orderBy: { enrolledOn: 'desc' }, take: 1, select: { section: { select: { name: true, level: { select: { name: true } } } } } },
        },
      });
      const children = rows.map((s): PortalChild => ({
        id: s.id, name: `${s.firstName} ${s.lastName ?? ''}`.trim(), admissionNo: s.admissionNo, campusName: s.campus.name,
        className: s.enrollments[0]?.section.level.name ?? null, sectionName: s.enrollments[0]?.section.name ?? null,
        relation: s.userId === auth.userId ? 'SELF' : s.guardians[0]?.relation ?? 'GUARDIAN',
      }));
      return { hasPortal: true, children };
    });
  }
}
