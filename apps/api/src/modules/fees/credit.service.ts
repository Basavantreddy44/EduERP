import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@eduerp/db';
import { AdjustCreditInput, CarriedDuesQuery, CreditRefundInput, PERMISSIONS, PermissionCode, formatINR, fromPaise, toPaise } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, CampusScope, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { NumberingService } from '../numbering/numbering.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { todayIST } from '../students/student-records';
import { adjustCreditInTx, creditAvailablePaise, lockCredit, moveBillPaid } from './credit-core';
import { ensureChart, reverse } from './ledger';

const READ = PERMISSIONS.FEE_READ;
const COLLECT = PERMISSIONS.FEE_COLLECT;
const CANCEL = PERMISSIONS.FEE_RECEIPT_CANCEL;
const paise = (d: Prisma.Decimal | string | number | null) => toPaise((d ?? 0).toString());
const iso = (d: Date) => d.toISOString().slice(0, 10);
const NIL = '00000000-0000-0000-0000-000000000000';

/**
 * Fees at go-live (Phase 23): a student's credit balance (fees received in advance) — seen, used
 * against a bill, cancelled by reversal, refunded through approval — and the reports for earlier-year
 * dues and for credit balances, each checked against the accounts.
 */
@Injectable()
export class FeeCreditService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly approvals: ApprovalsService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  private scope(auth: AuthContext, code: PermissionCode): CampusScope {
    return scopeFor(auth, code)!;
  }
  private can(auth: AuthContext, code: PermissionCode, campusId: string) {
    return !!scopeFor(auth, code) && canAccessCampus(this.scope(auth, code), campusId);
  }
  private async student(tx: Tx, id: string, auth: AuthContext, code: PermissionCode) {
    const s = await tx.student.findUnique({ where: { id }, select: { id: true, tenantId: true, campusId: true, firstName: true, lastName: true, admissionNo: true } });
    if (!s || !canAccessCampus(this.scope(auth, code), s.campusId)) throw NotFound('Student');
    return s;
  }

  /** The credit balance, what is held for refunds, every movement with the running balance, and adjustments. */
  async credit(studentId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.student(tx, studentId, auth, READ);
      return { ...(await this.creditView(tx, s.tenantId, s.id)), canUse: this.can(auth, COLLECT, s.campusId), canCancel: this.can(auth, CANCEL, s.campusId) };
    });
  }

  async creditView(tx: Tx, tenantId: string, studentId: string) {
    const chart = await ensureChart(tx, tenantId);
    const { balance, pendingRefunds, available } = await creditAvailablePaise(tx, tenantId, studentId);
    const lines = await tx.$queryRaw<{ entry_date: Date; entry_no: string; source_type: string; source_id: string | null; narration: string; credit: Prisma.Decimal; debit: Prisma.Decimal; created_at: Date }[]>`
      SELECT e.entry_date, e.entry_no, e.source_type, e.source_id, e.narration, l.credit, l.debit, e.posted_at AS created_at
        FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
       WHERE l.account_id = ${chart.get('FEE_ADVANCE')!}::uuid AND l.party_type = 'STUDENT' AND l.party_id = ${studentId}::uuid
       ORDER BY e.entry_date, e.posted_at`;
    let run = 0;
    const movements = lines.map((l) => {
      run += paise(l.credit) - paise(l.debit);
      return { date: l.entry_date, entryNo: l.entry_no, kind: l.source_type, narration: l.narration, added: fromPaise(paise(l.credit)), used: fromPaise(paise(l.debit)), balance: fromPaise(run) };
    }).reverse();
    const adjustments = await tx.feeCreditAdjustment.findMany({
      where: { studentId }, orderBy: { createdAt: 'desc' },
      include: { lines: { select: { invoiceId: true, amount: true } } },
    });
    const bills = new Map((await tx.feeInvoice.findMany({ where: { id: { in: [...new Set(adjustments.flatMap((a) => a.lines.map((l) => l.invoiceId)))] } }, select: { id: true, invoiceNo: true, description: true } })).map((b) => [b.id, b]));
    return {
      balance: fromPaise(balance), pendingRefunds: fromPaise(pendingRefunds), available: fromPaise(available),
      movements,
      adjustments: adjustments.map((a) => {
        const b = bills.get(a.lines[0]?.invoiceId ?? '');
        return { id: a.id, adjustmentNo: a.adjustmentNo, adjustedOn: a.adjustedOn, amount: a.amount, source: a.source, note: a.note, status: a.status, cancelReason: a.cancelReason, invoiceNo: b?.invoiceNo ?? null, invoiceDescription: b?.description ?? null };
      }),
    };
  }

  /** Uses credit against a chosen bill (counter / fee office). */
  async adjust(studentId: string, input: AdjustCreditInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.student(tx, studentId, auth, COLLECT);
      const adj = await adjustCreditInTx(tx, this.numbering, { tenantId: s.tenantId, student: s, invoiceId: input.invoiceId, amountPaise: toPaise(input.amount), source: 'MANUAL', note: input.note ?? null, userId: auth.userId });
      await this.audit.log(tx, { tenantId: s.tenantId, userId: auth.userId, campusId: s.campusId, action: 'CREATE', entityType: 'FEE_CREDIT_ADJUSTMENT', entityId: adj!.id, newValues: { adjustmentNo: adj!.adjustmentNo, invoiceId: input.invoiceId, amount: input.amount } }, client);
      return adj;
    });
  }

  /** Cancels an adjustment by reversal: the bill is open again and the credit comes back. */
  async cancelAdjustment(id: string, reason: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM fee_credit_adjustments WHERE id = ${id}::uuid FOR UPDATE`;
      const a = rows.length ? await tx.feeCreditAdjustment.findUnique({ where: { id }, include: { lines: true } }) : null;
      if (!a || !canAccessCampus(this.scope(auth, CANCEL), a.campusId)) throw NotFound('Adjustment');
      if (a.status !== 'ACTIVE') throw Conflict('adjustment-final', 'This adjustment is already cancelled');
      await lockCredit(tx, a.studentId);
      const invIds = [...new Set(a.lines.map((l) => l.invoiceId))];
      await tx.$queryRaw`SELECT id FROM fee_invoices WHERE id = ANY(${invIds}::uuid[]) FOR UPDATE`;
      for (const inv of await tx.feeInvoice.findMany({ where: { id: { in: invIds } }, include: { items: true } })) {
        await moveBillPaid(tx, inv, a.lines.filter((l) => l.invoiceId === inv.id).map((l) => ({ itemId: l.invoiceItemId, paise: -paise(l.amount) })));
      }
      await reverse(tx, this.numbering, a.journalEntryId!, iso(todayIST()), `Cancelled credit adjustment ${a.adjustmentNo}: ${reason}`, auth.userId);
      const saved = await tx.feeCreditAdjustment.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason, cancelledAt: new Date(), cancelledBy: auth.userId } });
      await this.audit.log(tx, { tenantId: a.tenantId, userId: auth.userId, campusId: a.campusId, action: 'UPDATE', entityType: 'FEE_CREDIT_ADJUSTMENT', entityId: id, oldValues: { status: 'ACTIVE' }, newValues: { status: 'CANCELLED', reason } }, client);
      return saved;
    });
  }

  /** Asks to pay credit back (decided through the refund approval, like receipt refunds). */
  async requestRefund(studentId: string, input: CreditRefundInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.student(tx, studentId, auth, COLLECT);
      await lockCredit(tx, s.id);
      const { available } = await creditAvailablePaise(tx, s.tenantId, s.id);
      if (toPaise(input.amount) > available) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'more-than-credit', available ? `Only ${formatINR(available)} of credit can be refunded` : 'This student has no credit to refund', [{ field: 'amount', message: `At most ${formatINR(available)}` }]);
      const r = await tx.refund.create({ data: { tenantId: s.tenantId, campusId: s.campusId, kind: 'CREDIT', paymentId: null, studentId: s.id, amount: input.amount, reason: input.reason, refundMode: input.refundMode, createdBy: auth.userId } });
      const req = await this.approvals.submit(tx, {
        tenantId: s.tenantId, requestedBy: auth.userId, entityType: 'REFUND', entityId: r.id, campusId: s.campusId, amount: toPaise(input.amount) / 100,
        summary: `Refund ${formatINR(toPaise(input.amount))} of credit (${s.firstName} ${s.lastName ?? ''}, ${s.admissionNo}) by ${input.refundMode.toLowerCase().replace('_', ' ')}: ${input.reason}`.slice(0, 500),
      }, client);
      if (!req) throw new AppError(HttpStatus.CONFLICT, 'approval-rule-missing', 'No one is set up to approve refunds yet. Ask the administrator to add an approval rule for refunds (Approvals → Rules).');
      const saved = await tx.refund.update({ where: { id: r.id }, data: { approvalRequestId: req.id } });
      await this.audit.log(tx, { tenantId: s.tenantId, userId: auth.userId, campusId: s.campusId, action: 'CREATE', entityType: 'REFUND', entityId: r.id, newValues: saved }, client);
      return saved;
    });
  }

  // ───────────── Reports ─────────────

  private campusSql(scope: CampusScope, campusId: string | undefined, col: Prisma.Sql) {
    if (campusId) return Prisma.sql`${col} = ${campusId}::uuid`;
    return scope.all ? Prisma.sql`TRUE` : Prisma.sql`${col} = ANY(${scope.campusIds}::uuid[])`;
  }

  private async currentYear(tx: Tx) {
    return (await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true, name: true } })) ?? (await tx.academicYear.findFirst({ orderBy: { startDate: 'desc' }, select: { id: true, name: true } }));
  }

  /** Open bills from earlier academic years (and opening dues), by class of this year. */
  async carriedDues(q: CarriedDuesQuery, auth: AuthContext) {
    const scope = this.scope(auth, READ);
    if (q.campusId && !canAccessCampus(scope, q.campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      const year = await this.currentYear(tx);
      const where = [this.campusSql(scope, q.campusId, Prisma.sql`f.campus_id`)];
      if (q.programLevelId) where.push(Prisma.sql`sec.program_level_id = ${q.programLevelId}::uuid`);
      const rows = await tx.$queryRaw<{ student_id: string; admission_no: string; first_name: string; last_name: string | null; status: string; level_name: string | null; section_name: string | null; level_seq: number | null; program_name: string | null; invoice_no: string; description: string; year_label: string; due_date: Date; balance: Prisma.Decimal; is_opening: boolean }[]>`
        SELECT s.id AS student_id, s.admission_no, s.first_name, s.last_name, s.status, l.name AS level_name, sec.name AS section_name, l.sequence AS level_seq, p.name AS program_name,
               f.invoice_no, f.description, coalesce(f.opening_year_label, y.name) AS year_label, f.due_date, f.balance_amount AS balance, f.opening_year_label IS NOT NULL AS is_opening
          FROM fee_invoices f
          JOIN students s ON s.id = f.student_id
          JOIN academic_years y ON y.id = f.academic_year_id
          LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = ${year?.id ?? NIL}::uuid AND e.status = 'ACTIVE'
          LEFT JOIN sections sec ON sec.id = e.section_id
          LEFT JOIN program_levels l ON l.id = sec.program_level_id
          LEFT JOIN programs p ON p.id = l.program_id
         WHERE f.status IN ('UNPAID','PARTIAL') AND f.balance_amount > 0
           AND (f.academic_year_id <> ${year?.id ?? NIL}::uuid OR f.opening_year_label IS NOT NULL)
           AND ${Prisma.join(where, ' AND ')}
         ORDER BY p.name NULLS LAST, l.sequence NULLS LAST, sec.name NULLS LAST, lower(s.first_name), s.admission_no, f.due_date`;
      const byClass = new Map<string, { programName: string | null; levelName: string | null; students: Set<string>; balance: number }>();
      const byYear = new Map<string, number>();
      for (const r of rows) {
        const k = `${r.program_name ?? ''}|${r.level_name ?? ''}`;
        const c = byClass.get(k) ?? { programName: r.program_name, levelName: r.level_name, students: new Set(), balance: 0 };
        c.students.add(r.student_id);
        c.balance += paise(r.balance);
        byClass.set(k, c);
        byYear.set(r.year_label, (byYear.get(r.year_label) ?? 0) + paise(r.balance));
      }
      const total = rows.reduce((a, r) => a + paise(r.balance), 0);
      return {
        year,
        total: fromPaise(total),
        students: new Set(rows.map((r) => r.student_id)).size,
        byYear: [...byYear.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, p]) => ({ yearLabel: label, balance: fromPaise(p) })),
        byClass: [...byClass.values()].map((c) => ({ programName: c.programName, levelName: c.levelName ?? null, students: c.students.size, balance: fromPaise(c.balance) })),
        items: rows.map((r) => ({
          studentId: r.student_id, admissionNo: r.admission_no, name: `${r.first_name} ${r.last_name ?? ''}`.trim(), status: r.status, levelName: r.level_name, sectionName: r.section_name,
          invoiceNo: r.invoice_no, description: r.description, yearLabel: r.year_label, dueDate: r.due_date, balance: fromPaise(paise(r.balance)), isOpening: r.is_opening,
        })),
      };
    });
  }

  /** Students holding credit, by class — and the same total from the "Fees received in advance" account. */
  async advances(q: CarriedDuesQuery, auth: AuthContext) {
    const scope = this.scope(auth, READ);
    if (q.campusId && !canAccessCampus(scope, q.campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      const year = await this.currentYear(tx);
      const chart = await ensureChart(tx, auth.tenantId!);
      const where = [this.campusSql(scope, q.campusId, Prisma.sql`s.campus_id`)];
      if (q.programLevelId) where.push(Prisma.sql`sec.program_level_id = ${q.programLevelId}::uuid`);
      const rows = await tx.$queryRaw<{ student_id: string; admission_no: string; first_name: string; last_name: string | null; status: string; level_name: string | null; section_name: string | null; program_name: string | null; credit: Prisma.Decimal }[]>`
        WITH c AS (
          SELECT l.party_id AS student_id, sum(l.credit - l.debit) AS credit
            FROM journal_lines l WHERE l.account_id = ${chart.get('FEE_ADVANCE')!}::uuid AND l.party_type = 'STUDENT'
           GROUP BY l.party_id HAVING sum(l.credit - l.debit) <> 0)
        SELECT s.id AS student_id, s.admission_no, s.first_name, s.last_name, s.status, l.name AS level_name, sec.name AS section_name, p.name AS program_name, c.credit
          FROM c JOIN students s ON s.id = c.student_id
          LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = ${year?.id ?? NIL}::uuid AND e.status = 'ACTIVE'
          LEFT JOIN sections sec ON sec.id = e.section_id
          LEFT JOIN program_levels l ON l.id = sec.program_level_id
          LEFT JOIN programs p ON p.id = l.program_id
         WHERE ${Prisma.join(where, ' AND ')}
         ORDER BY p.name NULLS LAST, l.sequence NULLS LAST, sec.name NULLS LAST, lower(s.first_name), s.admission_no`;
      const total = rows.reduce((a, r) => a + paise(r.credit), 0);
      // The account's own balance (only meaningful for the whole institution, so only without filters).
      const acc = await tx.$queryRaw<{ bal: Prisma.Decimal | null }[]>`SELECT sum(credit - debit) AS bal FROM journal_lines WHERE account_id = ${chart.get('FEE_ADVANCE')!}::uuid`;
      const whole = !q.campusId && !q.programLevelId && scope.all;
      return {
        total: fromPaise(total),
        students: rows.length,
        accountBalance: whole ? fromPaise(paise(acc[0]?.bal ?? 0)) : null,
        matchesAccounts: whole ? paise(acc[0]?.bal ?? 0) === total : null,
        items: rows.map((r) => ({ studentId: r.student_id, admissionNo: r.admission_no, name: `${r.first_name} ${r.last_name ?? ''}`.trim(), status: r.status, programName: r.program_name, levelName: r.level_name, sectionName: r.section_name, credit: fromPaise(paise(r.credit)) })),
      };
    });
  }
}
