import { Tx } from '../../common/prisma.service';
import { CampusScope } from '../../common/auth-context';
import { NotificationsService } from '../notifications/notifications.service';

/** Shared helpers of the campus-life modules (Phase 16): people look-up and telling parents. */

export const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
export const day = (s: string) => new Date(`${s}T00:00:00Z`);
export const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
export const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
export const fullName = (p: { firstName: string; lastName: string | null }) => `${p.firstName} ${p.lastName ?? ''}`.trim();
export const prettyDate = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export interface Person { type: 'STUDENT' | 'EMPLOYEE'; id: string; name: string; code: string; campusId: string; detail: string | null }

/** Current students and staff matching a name / admission no / staff code, within the given campuses (null = all). */
export async function searchPeople(tx: Tx, q: string, campusIds: string[] | null, kinds: ('STUDENT' | 'EMPLOYEE')[], limit = 15): Promise<Person[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const words = term.split(/\s+/).slice(0, 3);
  const out: Person[] = [];
  if (kinds.includes('STUDENT')) {
    const rows = await tx.student.findMany({
      where: { status: 'ACTIVE', ...(campusIds ? { campusId: { in: campusIds } } : {}), AND: words.map((w) => ({ OR: [{ firstName: { contains: w, mode: 'insensitive' as const } }, { lastName: { contains: w, mode: 'insensitive' as const } }, { admissionNo: { contains: w, mode: 'insensitive' as const } }] })) },
      take: limit, orderBy: [{ firstName: 'asc' }],
      select: { id: true, firstName: true, lastName: true, admissionNo: true, campusId: true, enrollments: { where: { status: 'ACTIVE' }, take: 1, select: { section: { select: { name: true, level: { select: { name: true } } } } } } },
    });
    for (const s of rows) { const sec = s.enrollments[0]?.section; out.push({ type: 'STUDENT', id: s.id, name: fullName(s), code: s.admissionNo, campusId: s.campusId, detail: sec ? `${sec.level.name} ${sec.name}` : null }); }
  }
  if (kinds.includes('EMPLOYEE')) {
    const rows = await tx.employee.findMany({
      where: { status: { notIn: ['RESIGNED', 'TERMINATED'] }, ...(campusIds ? { campusId: { in: campusIds } } : {}), AND: words.map((w) => ({ OR: [{ firstName: { contains: w, mode: 'insensitive' as const } }, { lastName: { contains: w, mode: 'insensitive' as const } }, { employeeCode: { contains: w, mode: 'insensitive' as const } }] })) },
      take: limit, orderBy: [{ firstName: 'asc' }], select: { id: true, firstName: true, lastName: true, employeeCode: true, campusId: true, designation: true },
    });
    for (const e of rows) out.push({ type: 'EMPLOYEE', id: e.id, name: fullName(e), code: e.employeeCode, campusId: e.campusId, detail: e.designation });
  }
  return out;
}

export const scopeCampuses = (s: CampusScope | null) => (!s ? [] : s.all ? null : s.campusIds);

/** In-app notice to the parents who have the app, else an email to the primary guardian. Returns whether anyone was told. */
export async function tellParents(tx: Tx, notifications: NotificationsService, o: { tenantId: string; senderUserId: string; studentId: string; eventCode: 'INFIRMARY_VISIT' | 'DISCIPLINE_INCIDENT' | 'LIBRARY_OVERDUE' | 'LIBRARY_READY' | 'ACHIEVEMENT'; vars: Record<string, string>; emailSubject: string; emailBody: string; entityType: string; entityId: string }) {
  const users = (await tx.studentGuardian.findMany({ where: { studentId: o.studentId, guardian: { userId: { not: null } } }, select: { guardian: { select: { userId: true } } } })).map((g) => g.guardian.userId!);
  if (users.length) {
    await notifications.notify(tx, { tenantId: o.tenantId, userIds: users, eventCode: o.eventCode, vars: o.vars, entityType: o.entityType, entityId: o.entityId });
    return true;
  }
  if (!o.senderUserId) return false; // background jobs send in-app notices only
  const g = await tx.studentGuardian.findFirst({ where: { studentId: o.studentId, isPrimary: true, guardian: { email: { not: null } } }, select: { guardian: { select: { email: true } } } });
  if (!g?.guardian.email) return false;
  await notifications.emailExternal(tx, { tenantId: o.tenantId, senderUserId: o.senderUserId, to: g.guardian.email, subject: o.emailSubject, body: o.emailBody, eventCode: o.eventCode, entityType: o.entityType, entityId: o.entityId });
  return true;
}
