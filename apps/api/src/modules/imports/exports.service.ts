import { Injectable } from '@nestjs/common';
import { DEPT_TYPE_LABELS, HOLIDAY_TYPE_LABELS, IMPORT_TYPES, PERMISSIONS } from '@eduerp/shared';
import { Db } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, scopeFor } from '../../common/auth-context';
import { Forbidden } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { buildCsv, buildSheet } from './spreadsheet';
import { FeeDuesService } from '../fees/dues.service';

type Table = { title: string; headers: string[]; rows: (string | number | null)[][] };

/**
 * Exports. Importable types use the import column headers, so a file can be exported, edited and
 * imported again. Campus scope applies; every export is audited (personal data leaves the system).
 */
@Injectable()
export class ExportsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly dues: FeeDuesService,
  ) {}

  async export(type: string, format: 'xlsx' | 'csv', auth: AuthContext, client: ClientInfo): Promise<{ fileName: string; contentType: string; data: Buffer }> {
    const table = await this.db.run({ tenantId: auth.tenantId, userId: auth.userId }, async (tx) => {
      const has = (p: string) => auth.permissions.has(p as never);
      const campuses = await tx.campus.findMany({ select: { id: true, code: true } });
      const code = (id: string | null) => (id ? campuses.find((c) => c.id === id)?.code ?? '' : '');
      const inScope = (perm: string, campusId: string | null) => {
        const s = scopeFor(auth, perm as never);
        return !!s && (s.all || (campusId !== null && s.campusIds.includes(campusId)) || campusId === null);
      };
      const headers = (t: keyof typeof IMPORT_TYPES) => IMPORT_TYPES[t].columns.map((c) => c.header);

      let t: Table;
      switch (type) {
        case 'CAMPUSES': {
          if (!has(PERMISSIONS.ORG_CAMPUS_READ)) throw Forbidden();
          const rows = await tx.campus.findMany({ orderBy: { code: 'asc' } });
          t = { title: 'Campuses', headers: ['Code', 'Name', 'Name (Kannada)', 'Type', 'City', 'Pincode', 'Phone', 'Email', 'Status'], rows: rows.filter((c) => inScope(PERMISSIONS.ORG_CAMPUS_READ, c.id)).map((c) => [c.code, c.name, c.nameLocal, c.campusType, c.city, c.pincode, c.phone, c.email, c.status]) };
          break;
        }
        case 'DEPARTMENTS': {
          if (!has(PERMISSIONS.ORG_ACADEMIC_READ)) throw Forbidden();
          const rows = await tx.department.findMany({ orderBy: [{ campusId: 'asc' }, { code: 'asc' }] });
          t = { title: 'Departments', headers: [...headers('DEPARTMENTS'), 'Status'], rows: rows.filter((d) => inScope(PERMISSIONS.ORG_ACADEMIC_READ, d.campusId)).map((d) => [d.name, d.code, DEPT_TYPE_LABELS[d.deptType as keyof typeof DEPT_TYPE_LABELS] ?? d.deptType, code(d.campusId), d.status]) };
          break;
        }
        case 'HOLIDAYS': {
          if (!has(PERMISSIONS.ORG_ACADEMIC_READ)) throw Forbidden();
          const rows = await tx.holiday.findMany({ orderBy: { holidayDate: 'asc' } });
          t = { title: 'Holidays', headers: headers('HOLIDAYS'), rows: rows.filter((h) => inScope(PERMISSIONS.ORG_ACADEMIC_READ, h.campusId)).map((h) => [h.holidayDate.toISOString().slice(0, 10), h.name, HOLIDAY_TYPE_LABELS[h.holidayType as keyof typeof HOLIDAY_TYPE_LABELS] ?? h.holidayType, code(h.campusId)]) };
          break;
        }
        case 'USERS': {
          if (!has(PERMISSIONS.IAM_USER_READ)) throw Forbidden();
          const rows = await tx.userTenant.findMany({
            where: { status: 'ACTIVE' },
            select: { user: { select: { fullName: true, email: true, lastLoginAt: true, userRoles: { select: { campusId: true, role: { select: { name: true } } } } } } },
            orderBy: { user: { fullName: 'asc' } },
          });
          t = {
            title: 'Users',
            headers: [...headers('USERS'), 'Last sign-in'],
            rows: rows.flatMap(({ user }) => (user.userRoles.length ? user.userRoles : [{ campusId: null, role: { name: '' } }]).map((r) => [user.fullName, user.email, r.role.name, code(r.campusId), user.lastLoginAt ? user.lastLoginAt.toISOString().slice(0, 10) : ''])),
          };
          break;
        }
        case 'STUDENTS': {
          if (!has(PERMISSIONS.STU_STUDENT_READ)) throw Forbidden();
          if (!(await tx.tenantModule.findFirst({ where: { moduleCode: 'STUDENTS', isEnabled: true }, select: { id: true } }))) throw Forbidden('module-not-enabled', "This module is not part of your institution's plan");
          const scope = scopeFor(auth, PERMISSIONS.STU_STUDENT_READ)!;
          const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
          const rows = await tx.student.findMany({
            where: scope.all ? {} : { campusId: { in: scope.campusIds } },
            orderBy: [{ campusId: 'asc' }, { admissionNo: 'asc' }],
            include: {
              enrollments: { where: { status: 'ACTIVE', academicYearId: year?.id ?? '00000000-0000-0000-0000-000000000000' }, take: 1, select: { rollNo: true, section: { select: { name: true, level: { select: { name: true, program: { select: { code: true } } } } } } } },
              guardians: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], select: { relation: true, isPrimary: true, guardian: { select: { name: true, phone: true, email: true } } } },
            },
          });
          const iso = (d: Date) => d.toISOString().slice(0, 10);
          const G: Record<string, string> = { MALE: 'Boy', FEMALE: 'Girl', OTHER: 'Other' };
          t = {
            title: 'Students',
            headers: [...headers('STUDENTS'), 'Status'],
            rows: rows.map((s) => {
              const e = s.enrollments[0];
              const rel = (r: string) => s.guardians.find((g) => g.relation === r)?.guardian.name ?? '';
              const main = s.guardians.find((g) => g.isPrimary)?.guardian ?? s.guardians[0]?.guardian;
              return [
                s.admissionNo, s.firstName, s.lastName, iso(s.dob), G[s.gender] ?? s.gender, s.category, s.motherTongue, s.aadhaarLast4, s.bloodGroup,
                code(s.campusId), e?.section.level.program.code ?? '', e?.section.level.name ?? '', e?.section.name ?? '', e?.rollNo ?? '', iso(s.admissionDate),
                rel('FATHER'), rel('MOTHER'), rel('GUARDIAN'), main?.phone ?? '', main?.email ?? '', s.address, s.status,
              ];
            }),
          };
          break;
        }
        case 'FEE_DUES': {
          if (!has(PERMISSIONS.FEE_READ)) throw Forbidden();
          const d = await this.dues.dues(auth, { sort: 'class', page: 1, pageSize: 100_000 });
          const name = (r: { firstName: string; lastName: string | null }) => `${r.firstName} ${r.lastName ?? ''}`.trim();
          t = {
            title: 'Fee dues',
            headers: ['Admission no', 'Student', 'Class', 'Section', 'Parent', 'Mobile', 'Bills', 'Balance due', 'Overdue', 'Not yet due', '1-30 days', '31-60 days', '61-90 days', 'Over 90 days', 'Oldest due date'],
            rows: d.items.map((r) => [r.admissionNo, name(r), r.levelName, r.sectionName, r.guardianName, r.guardianPhone, r.bills, r.balance, r.overdue, r.notDue, r.d1_30, r.d31_60, r.d61_90, r.d90_plus, r.oldestDue ? r.oldestDue.toISOString().slice(0, 10) : '']),
          };
          break;
        }
        default:
          throw Forbidden('export-type', 'This list cannot be exported');
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'EXPORT', entityType: type, newValues: { format, rows: t.rows.length } }, client);
      return t;
    });

    const stamp = new Date().toISOString().slice(0, 10);
    return format === 'csv'
      ? { fileName: `${table.title} ${stamp}.csv`, contentType: 'text/csv; charset=utf-8', data: buildCsv(table.headers, table.rows) }
      : { fileName: `${table.title} ${stamp}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: await buildSheet(table.title, table.headers, table.rows) };
  }
}
