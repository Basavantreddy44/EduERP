import type { Tx } from '../../common/prisma.service';

/**
 * Which fee structure a student is billed from (one ACTIVE assignment per student per year).
 * Called wherever a student gets a class (enrolment, import, re-joining) and when a structure becomes
 * active, so nobody is missed whichever happens first.
 */

/** The class's default structure (no fee group) for the year, if a student has none yet. */
export async function autoAssign(tx: Tx, a: { tenantId: string; studentId: string; academicYearId: string; programLevelId: string; userId: string }) {
  const existing = await tx.studentFeeAssignment.findFirst({ where: { studentId: a.studentId, academicYearId: a.academicYearId, status: 'ACTIVE' }, select: { id: true } });
  if (existing) return null;
  const s = await tx.feeStructure.findFirst({ where: { academicYearId: a.academicYearId, programLevelId: a.programLevelId, status: 'ACTIVE', feeGroup: null }, select: { id: true } });
  if (!s) return null;
  return tx.studentFeeAssignment.create({ data: { tenantId: a.tenantId, studentId: a.studentId, academicYearId: a.academicYearId, feeStructureId: s.id, source: 'AUTO', createdBy: a.userId } });
}

/** Assigns a default structure to every current student of its class who has no structure yet. */
export async function assignToClass(tx: Tx, structureId: string, userId: string) {
  const s = await tx.feeStructure.findUniqueOrThrow({ where: { id: structureId }, select: { tenantId: true, academicYearId: true, programLevelId: true, status: true, feeGroup: true } });
  if (s.status !== 'ACTIVE' || s.feeGroup) return 0;
  return tx.$executeRaw`
    INSERT INTO student_fee_assignments (id, tenant_id, student_id, academic_year_id, fee_structure_id, status, source, created_by, updated_at)
    SELECT gen_random_uuid(), ${s.tenantId}::uuid, e.student_id, ${s.academicYearId}::uuid, ${structureId}::uuid, 'ACTIVE', 'AUTO', ${userId}::uuid, now()
      FROM student_enrollments e
      JOIN sections sec ON sec.id = e.section_id
      JOIN students st ON st.id = e.student_id
     WHERE e.academic_year_id = ${s.academicYearId}::uuid AND e.status = 'ACTIVE' AND sec.program_level_id = ${s.programLevelId}::uuid
       AND st.status IN ('ACTIVE', 'INACTIVE')
       AND NOT EXISTS (SELECT 1 FROM student_fee_assignments a WHERE a.student_id = e.student_id AND a.academic_year_id = ${s.academicYearId}::uuid AND a.status = 'ACTIVE')
    ON CONFLICT DO NOTHING`;
}

/** A revision replaces its predecessor for everyone on it (bills already made keep their amounts). */
export function moveToRevision(tx: Tx, fromId: string, toId: string) {
  return tx.studentFeeAssignment.updateMany({ where: { feeStructureId: fromId, status: 'ACTIVE' }, data: { feeStructureId: toId } });
}

/** Students of the class who are current but not on any structure (shown so nobody is left unbilled). */
export async function unassignedCount(tx: Tx, academicYearId: string, programLevelId: string) {
  const r = await tx.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM student_enrollments e
      JOIN sections sec ON sec.id = e.section_id
      JOIN students st ON st.id = e.student_id
     WHERE e.academic_year_id = ${academicYearId}::uuid AND e.status = 'ACTIVE' AND sec.program_level_id = ${programLevelId}::uuid
       AND st.status IN ('ACTIVE', 'INACTIVE')
       AND NOT EXISTS (SELECT 1 FROM student_fee_assignments a WHERE a.student_id = e.student_id AND a.academic_year_id = ${academicYearId}::uuid AND a.status = 'ACTIVE')`;
  return Number(r[0].n);
}
