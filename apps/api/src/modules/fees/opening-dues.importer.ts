import { Injectable } from '@nestjs/common';
import { PERMISSIONS, isYearLabel, toPaise } from '@eduerp/shared';
import type { Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus } from '../../common/auth-context';
import type { ClientInfo } from '../../common/decorators';
import { ImportContext, Importer, baseContext, parseDate } from '../imports/importers';
import { todayIST } from '../students/student-records';
import { FeeBillingService } from './billing.service';

export interface OpeningDueRow {
  studentId: string;
  admissionNo: string;
  yearLabel: string;
  description: string;
  amountPaise: number;
  dueDate: string;
}

interface Ctx extends ImportContext {
  currentStart: number | null; // start year of the current academic year, e.g. 2026
  students: Map<string, { id: string; campusId: string }>; // ADMISSION NO (upper) → student
  done: Set<string>; // studentId|yearLabel already imported (live bill)
}

/**
 * Opening dues (Phase 23 F2): what each student owed before EduERP. One live opening-dues bill per
 * student and year label (the database refuses a second one too).
 */
@Injectable()
export class OpeningDuesImporter implements Importer<OpeningDueRow> {
  readonly type = 'OPENING_DUES' as const;
  readonly permission = PERMISSIONS.FEE_BILL;
  readonly module = 'FEES' as const;
  constructor(
    private readonly audit: AuditService,
    private readonly billing: FeeBillingService,
  ) {}

  async helpLists(tx: Tx) {
    const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { name: true } });
    return [{ title: 'Current academic year (opening dues must be for an earlier year)', values: [year?.name ?? 'Not set'] }];
  }

  async prepare(tx: Tx, auth: AuthContext): Promise<Ctx> {
    const base = await baseContext(tx, auth, this.permission);
    const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { startDate: true } });
    const students = new Map(
      (await tx.student.findMany({ select: { id: true, campusId: true, admissionNo: true } }))
        .filter((s) => canAccessCampus(base.scope, s.campusId))
        .map((s) => [s.admissionNo.trim().toUpperCase(), { id: s.id, campusId: s.campusId }]),
    );
    const done = new Set(
      (await tx.feeInvoice.findMany({ where: { openingYearLabel: { not: null }, status: { not: 'CANCELLED' } }, select: { studentId: true, openingYearLabel: true } })).map((b) => `${b.studentId}|${b.openingYearLabel}`),
    );
    return { ...base, currentStart: year ? year.startDate.getUTCFullYear() : null, students, done };
  }

  check(v: Record<string, string>, ctx: Ctx, seen: Set<string>) {
    const errors: string[] = [];
    if (ctx.currentStart === null) return { errors: ['There is no current academic year. Set one under Setup → Academic years.'] };
    const adm = (v.admissionNo ?? '').trim().toUpperCase();
    const st = ctx.students.get(adm);
    if (!adm) errors.push('Admission no: required');
    else if (!st) errors.push(`Admission no: no student ${v.admissionNo.trim()} in your campuses`);
    const yearLabel = (v.yearLabel ?? '').trim().replace(/^(\d{4})-(\d{4})$/, (_m, a: string, b: string) => `${a}-${b.slice(2)}`);
    if (!isYearLabel(yearLabel)) errors.push('Year: like 2025-26');
    else if (Number(yearLabel.slice(0, 4)) >= ctx.currentStart) errors.push(`Year: must be before the current academic year (${ctx.currentStart}-${String((ctx.currentStart + 1) % 100).padStart(2, '0')})`);
    if (st && isYearLabel(yearLabel)) {
      const k = `${st.id}|${yearLabel}`;
      if (seen.has(k)) errors.push(`${adm} ${yearLabel}: twice in this file`);
      else if (ctx.done.has(k)) errors.push(`${adm} ${yearLabel}: opening dues for this year are already in EduERP`);
      seen.add(k);
    }
    const rawAmt = (v.amount ?? '').replace(/[₹,\s]/g, '');
    let amountPaise = 0;
    if (!/^\d+(\.\d{1,2})?$/.test(rawAmt)) errors.push('Amount: a number in rupees, up to 2 decimals');
    else {
      amountPaise = toPaise(rawAmt);
      if (amountPaise <= 0) errors.push('Amount: more than 0');
      else if (amountPaise > 100_000_000) errors.push('Amount: at most ₹10,00,000');
    }
    let dueDate = new Date(todayIST()).toISOString().slice(0, 10);
    if ((v.dueDate ?? '').trim()) {
      const d = parseDate(v.dueDate);
      if (!d) errors.push('Due date: YYYY-MM-DD or DD-MM-YYYY');
      else dueDate = d;
    }
    const description = ((v.description ?? '').trim() || `Opening dues ${yearLabel}`).slice(0, 200);
    if (errors.length) return { errors };
    return { errors, row: { studentId: st!.id, admissionNo: adm, yearLabel, description, amountPaise, dueDate } };
  }

  async write(tx: Tx, row: OpeningDueRow, auth: AuthContext, client: ClientInfo) {
    const inv = await this.billing.openingDue(tx, row, auth.userId);
    await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: inv.campusId, action: 'CREATE', entityType: 'FEE_INVOICE', entityId: inv.id, newValues: { invoiceNo: inv.invoiceNo, openingYearLabel: row.yearLabel, amount: inv.netAmount, admissionNo: row.admissionNo } }, client);
    return inv.id;
  }
}
