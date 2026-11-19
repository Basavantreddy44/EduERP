import type { DocType } from '@eduerp/shared';
import type { Tx } from '../../common/prisma.service';
import { AppError } from '../../common/problem';
import type { NumberingService } from '../numbering/numbering.service';

/**
 * Rules shared by admissions (enrolment), student records and the student import, so a student is
 * created the same way whichever door they come in by.
 */

export const day = (d: string) => new Date(`${d}T00:00:00Z`);
/** Today's date in India (the institution's working day), as a UTC-midnight Date for DATE columns. */
export const todayIST = () => day(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10));
/** Number-series year label from the academic-year name, e.g. "2026-27". */
export const yearLabelOf = (name: string) => name.replace(/[^A-Za-z0-9-]/g, '').slice(0, 10);

/** Default series created on first use, so a new school can start without set-up. */
const DEFAULT_PREFIX: Partial<Record<DocType, string>> = { ENQUIRY: 'ENQ', APPLICATION: 'APP', ADMISSION: 'ADM', INVOICE: 'INV', RECEIPT: 'RCT', JOURNAL: 'JV', COMPLAINT: 'CMP', DEPT_REQUEST: 'REQ', GATE_PASS: 'GP', VISITOR_PASS: 'VP', VENDOR: 'VEN', VENDOR_BILL: 'BILL', VENDOR_PAYMENT: 'PAY', VOUCHER: 'VCH' };

/** Allocates the next number (gapless, inside the caller's transaction), creating the default series on first use. */
export async function allocateNo(numbering: NumberingService, tx: Tx, docType: DocType, campusId: string, yearName: string, userId: string | null) {
  const yearLabel = yearLabelOf(yearName);
  try {
    return await numbering.allocate(tx, { docType, campusId, yearLabel });
  } catch (e) {
    if (!(e instanceof AppError) || e.code !== 'numbering-not-configured') throw e;
    await tx.$executeRaw`
      INSERT INTO number_sequences (id, tenant_id, campus_id, doc_type, prefix, year_label, next_number, padding, created_by, updated_at)
      VALUES (gen_random_uuid(), app_current_tenant(), NULL, ${docType}, ${`${DEFAULT_PREFIX[docType] ?? docType}/${yearLabel}/`}, ${yearLabel}, 1, 4, ${userId}::uuid, now())
      ON CONFLICT DO NOTHING`;
    return numbering.allocate(tx, { docType, campusId, yearLabel });
  }
}

export type Relation = 'FATHER' | 'MOTHER' | 'GUARDIAN';

/**
 * Parents of a new student (CD-21). The contact parent is found by phone: if a guardian with that
 * phone already exists (a sibling studies here), that family's guardians are reused, not duplicated.
 */
export async function linkGuardians(
  tx: Tx,
  studentId: string,
  a: { tenantId: string; fatherName: string | null; motherName: string | null; guardianName: string | null; parentPhone: string; parentEmail: string | null },
  userId: string,
) {
  const wanted = ([['FATHER', a.fatherName], ['MOTHER', a.motherName], ['GUARDIAN', a.guardianName]] as [Relation, string | null][]).filter(
    (w): w is [Relation, string] => !!w[1],
  );
  const primaryRel = wanted[0][0];
  const existing = await tx.guardian.findFirst({ where: { phone: a.parentPhone }, orderBy: { createdAt: 'asc' } });
  const family = existing
    ? await tx.studentGuardian.findMany({
        where: { student: { guardians: { some: { guardianId: existing.id } } } },
        include: { guardian: true },
        distinct: ['guardianId'],
      })
    : [];
  const out: { id: string; relation: Relation; reused: boolean }[] = [];
  for (const [relation, name] of wanted) {
    const isPrimary = relation === primaryRel;
    let g =
      family.find((f) => f.relation === relation && f.guardian.name.trim().toLowerCase() === name.trim().toLowerCase())?.guardian ??
      (isPrimary && existing ? existing : null);
    const reused = !!g;
    if (!g) {
      g = await tx.guardian.create({
        data: { tenantId: a.tenantId, name, phone: isPrimary ? a.parentPhone : null, email: isPrimary ? a.parentEmail : null, createdBy: userId },
      });
    }
    if (out.some((o) => o.id === g!.id)) continue;
    await tx.studentGuardian.create({ data: { tenantId: a.tenantId, studentId, guardianId: g.id, relation, isPrimary } });
    out.push({ id: g.id, relation, reused });
  }
  return out;
}

/** Appends to the permanent status history (the table cannot be updated or deleted by the app). */
export function recordStatus(
  tx: Tx,
  s: { tenantId: string; studentId: string; oldStatus: string | null; newStatus: string; effectiveDate: Date; reason: string; userId: string },
) {
  return tx.studentStatusHistory.create({
    data: { tenantId: s.tenantId, studentId: s.studentId, oldStatus: s.oldStatus, newStatus: s.newStatus, effectiveDate: s.effectiveDate, reason: s.reason, createdBy: s.userId },
  });
}
