import { HttpStatus } from '@nestjs/common';
import type { TargetType } from '@eduerp/shared';
import type { Tx } from '../../common/prisma.service';
import { AppError } from '../../common/problem';

/** Where a student sits this year: the keys an audience can match. */
export interface Audience { studentId: string; campusId: string; programLevelId: string; sectionId: string }
export type Target = { targetType: string; targetId: string | null };

export const unprocessable = (code: string, detail: string, field: string) => new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, detail, [{ field, message: detail }]);

/** The current-year place of each student (students without a place this year are left out). */
export async function audiencesOf(tx: Tx, studentIds: string[]): Promise<Audience[]> {
  if (!studentIds.length) return [];
  const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
  if (!year) return [];
  const rows = await tx.studentEnrollment.findMany({ where: { studentId: { in: studentIds }, academicYearId: year.id, status: 'ACTIVE' }, select: { studentId: true, sectionId: true, section: { select: { campusId: true, programLevelId: true } } } });
  return rows.map((r) => ({ studentId: r.studentId, campusId: r.section.campusId, programLevelId: r.section.programLevelId, sectionId: r.sectionId }));
}

/** Does an audience list include this student? */
export function reaches(targets: Target[], a: Audience): boolean {
  return targets.some((t) => t.targetType === 'ALL' || (t.targetType === 'CAMPUS' && t.targetId === a.campusId) || (t.targetType === 'LEVEL' && t.targetId === a.programLevelId) || (t.targetType === 'SECTION' && t.targetId === a.sectionId));
}

/** Checks each target exists in the institution; returns the campuses they belong to (null = everyone). */
export async function checkTargets(tx: Tx, targets: { targetType: TargetType; targetId?: string | null }[]): Promise<(string | null)[]> {
  const campuses: (string | null)[] = [];
  for (const t of targets) {
    if (t.targetType === 'ALL') { campuses.push(null); continue; }
    const campusId = t.targetType === 'CAMPUS' ? (await tx.campus.findUnique({ where: { id: t.targetId! }, select: { id: true } }))?.id
      : t.targetType === 'LEVEL' ? (await tx.programLevel.findUnique({ where: { id: t.targetId! }, select: { program: { select: { campusId: true } } } }))?.program.campusId
      : (await tx.section.findUnique({ where: { id: t.targetId! }, select: { campusId: true } }))?.campusId;
    if (!campusId) throw unprocessable('target-invalid', 'An audience was not found', 'targets');
    campuses.push(campusId);
  }
  return campuses;
}

/** Students of the current year reached by an audience list. */
export async function studentsReached(tx: Tx, targets: Target[]): Promise<Audience[]> {
  const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
  if (!year) return [];
  const all = targets.some((t) => t.targetType === 'ALL');
  const ids = (k: string) => targets.filter((t) => t.targetType === k).map((t) => t.targetId!);
  const rows = await tx.studentEnrollment.findMany({
    where: { academicYearId: year.id, status: 'ACTIVE', ...(all ? {} : { OR: [{ sectionId: { in: ids('SECTION') } }, { section: { programLevelId: { in: ids('LEVEL') } } }, { section: { campusId: { in: ids('CAMPUS') } } }] }) },
    select: { studentId: true, sectionId: true, section: { select: { campusId: true, programLevelId: true } } },
  });
  return rows.map((r) => ({ studentId: r.studentId, campusId: r.section.campusId, programLevelId: r.section.programLevelId, sectionId: r.sectionId }));
}

/** Parent / student logins of a set of students (for in-app notices). */
export async function familyUsers(tx: Tx, studentIds: string[]): Promise<string[]> {
  if (!studentIds.length) return [];
  const g = await tx.studentGuardian.findMany({ where: { studentId: { in: studentIds }, guardian: { userId: { not: null } } }, select: { guardian: { select: { userId: true } } } });
  const s = await tx.student.findMany({ where: { id: { in: studentIds }, userId: { not: null } }, select: { userId: true } });
  return [...new Set([...g.map((x) => x.guardian.userId!), ...s.map((x) => x.userId!)])];
}
