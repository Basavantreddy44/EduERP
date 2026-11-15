import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@eduerp/db';
import {
  BillingRunInput, ConcessionInput, ConcessionRule, ExtraChargeInput, PERMISSIONS, PermissionCode, applyConcessions, formatINR, fromPaise, toPaise,
} from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, CampusScope, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { NumberingService } from '../numbering/numbering.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { allocateNo, todayIST } from '../students/student-records';
import { ensureChart, post, reverse } from './ledger';

const READ = PERMISSIONS.FEE_READ;
const BILL = PERMISSIONS.FEE_BILL;
const paise = (d: Prisma.Decimal | string | number) => toPaise(d.toString());
const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (d: string) => new Date(`${d}T00:00:00Z`);

type Line = { feeHeadId: string; amountPaise: number; incomeAccountId: string };

/**
 * Billing (M2.2): fee assignments, bills per instalment (one live bill per student, year and
 * instalment — runs are safe to repeat), extra charges, cancellation by reversal, concessions through
 * approvals. Every bill posts Dr Student receivable + Dr Concessions / Cr fee income.
 */
@Injectable()
export class FeeBillingService implements OnModuleInit {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly approvals: ApprovalsService,
  ) {}

  onModuleInit() {
    this.approvals.onComplete('CONCESSION', (tx, d) => this.decided(tx, d));
  }

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  private scope(auth: AuthContext, code: PermissionCode): CampusScope {
    return scopeFor(auth, code)!;
  }
  private async student(tx: Tx, id: string, auth: AuthContext, code: PermissionCode) {
    const s = await tx.student.findUnique({ where: { id }, select: { id: true, tenantId: true, campusId: true, firstName: true, lastName: true, admissionNo: true, status: true } });
    if (!s || !canAccessCampus(this.scope(auth, code), s.campusId)) throw NotFound('Student');
    return s;
  }

  // ───────────── Bill composition ─────────────

  /** Approved concessions of a student for a year, with how much of each is already used. */
  private async concessionRules(tx: Tx, studentId: string, academicYearId: string): Promise<ConcessionRule[]> {
    const rows = await tx.$queryRaw<{ id: string; fee_head_id: string | null; value_type: 'PERCENT' | 'AMOUNT'; value: string; used: string }[]>`
      SELECT c.id, c.fee_head_id, c.value_type, c.value::text,
             coalesce((SELECT sum(u.amount) FROM fee_invoice_item_concessions u
                         JOIN fee_invoice_items i ON i.id = u.item_id JOIN fee_invoices f ON f.id = i.invoice_id
                        WHERE u.concession_id = c.id AND f.status <> 'CANCELLED'), 0)::text AS used
        FROM concessions c
       WHERE c.student_id = ${studentId}::uuid AND c.academic_year_id = ${academicYearId}::uuid AND c.status = 'APPROVED'
       ORDER BY c.created_at`;
    return rows.map((r) => ({ id: r.id, feeHeadId: r.fee_head_id, valueType: r.value_type, valuePaise: toPaise(r.value), usedPaise: toPaise(r.used) }));
  }

  /** Creates one bill (lines, concessions, posting). Lines with no amount are skipped. */
  private async createInvoice(
    tx: Tx,
    b: {
      tenantId: string; campusId: string; student: { id: string; firstName: string; lastName: string | null; admissionNo: string }; academicYearId: string; yearName: string;
      feeStructureId: string | null; billingRunId: string | null; instalmentNo: number | null; description: string; invoiceDate: string; dueDate: string; lines: Line[]; userId: string;
    },
  ) {
    const chart = await ensureChart(tx, b.tenantId);
    const lines = b.lines.filter((l) => l.amountPaise > 0);
    const applied = applyConcessions(lines, await this.concessionRules(tx, b.student.id, b.academicYearId));
    const gross = applied.reduce((a, l) => a + l.amountPaise, 0);
    const conc = applied.reduce((a, l) => a + l.concessionPaise, 0);
    const invoiceNo = await allocateNo(this.numbering, tx, 'INVOICE', b.campusId, b.yearName, b.userId);
    const inv = await tx.feeInvoice.create({
      data: {
        tenantId: b.tenantId, campusId: b.campusId, invoiceNo, studentId: b.student.id, academicYearId: b.academicYearId, feeStructureId: b.feeStructureId, billingRunId: b.billingRunId,
        instalmentNo: b.instalmentNo, description: b.description.slice(0, 200), invoiceDate: day(b.invoiceDate), dueDate: day(b.dueDate),
        grossAmount: fromPaise(gross), concessionAmount: fromPaise(conc), netAmount: fromPaise(gross - conc), balanceAmount: fromPaise(gross - conc), createdBy: b.userId,
        status: gross - conc === 0 ? 'PAID' : 'UNPAID', // fully covered by concessions: nothing to collect
      },
    });
    for (const l of applied) {
      const item = await tx.feeInvoiceItem.create({
        data: { tenantId: b.tenantId, invoiceId: inv.id, feeHeadId: l.feeHeadId, amount: fromPaise(l.amountPaise), concession: fromPaise(l.concessionPaise), netAmount: fromPaise(l.amountPaise - l.concessionPaise) },
      });
      if (l.parts.length) await tx.feeInvoiceItemConcession.createMany({ data: l.parts.map((p) => ({ tenantId: b.tenantId, itemId: item.id, concessionId: p.concessionId, amount: fromPaise(p.amountPaise) })) });
    }
    const entry = await post(tx, this.numbering, {
      tenantId: b.tenantId, campusId: b.campusId, date: b.invoiceDate, voucherType: 'SALES', sourceType: 'FEE_INVOICE', sourceId: inv.id, userId: b.userId,
      narration: `Bill ${invoiceNo} · ${b.student.admissionNo} ${b.student.firstName} ${b.student.lastName ?? ''} · ${b.description}`,
      lines: [
        { accountId: chart.get('STUDENT_RECEIVABLE')!, debitPaise: gross - conc, partyType: 'STUDENT', partyId: b.student.id },
        { accountId: chart.get('CONCESSIONS')!, debitPaise: conc },
        ...applied.map((l) => ({ accountId: lines.find((x) => x.feeHeadId === l.feeHeadId)!.incomeAccountId, creditPaise: l.amountPaise })),
      ],
    });
    return tx.feeInvoice.update({ where: { id: inv.id }, data: { journalEntryId: entry.id } });
  }

  // ───────────── Billing runs ─────────────

  /** Who would be billed: per class, how many students and how much, and who has no fee structure. */
  async preview(input: BillingRunInput, auth: AuthContext) {
    return this.db.run(this.ctx(auth), (tx) => this.plan(tx, input, auth, READ));
  }

  private async plan(tx: Tx, input: BillingRunInput, auth: AuthContext, code: PermissionCode) {
    const scope = this.scope(auth, code);
    if (input.campusId && !canAccessCampus(scope, input.campusId)) throw NotFound('Campus');
    const year = await tx.academicYear.findUnique({ where: { id: input.academicYearId }, select: { id: true, name: true, status: true } });
    if (!year) throw NotFound('Academic year');
    const campusIds = input.campusId ? [input.campusId] : scope.all ? null : scope.campusIds;
    const assignments = await tx.studentFeeAssignment.findMany({
      where: {
        academicYearId: year.id, status: 'ACTIVE', student: { status: { in: ['ACTIVE', 'INACTIVE'] } },
        structure: { ...(campusIds ? { campusId: { in: campusIds } } : {}), ...(input.programLevelId ? { programLevelId: input.programLevelId } : {}) },
      },
      include: {
        student: { select: { id: true, firstName: true, lastName: true, admissionNo: true, campusId: true } },
        structure: {
          select: {
            id: true, name: true, campusId: true, programLevelId: true, level: { select: { name: true, sequence: true, program: { select: { name: true } } } },
            instalments: { where: { instalmentNo: input.instalmentNo } },
            items: { where: { instalmentNo: input.instalmentNo }, include: { feeHead: { select: { incomeAccountId: true } } } },
          },
        },
      },
    });
    const billed = new Set(
      (await tx.feeInvoice.findMany({ where: { academicYearId: year.id, instalmentNo: input.instalmentNo, status: { not: 'CANCELLED' }, studentId: { in: assignments.map((a) => a.studentId) } }, select: { studentId: true } })).map((i) => i.studentId),
    );
    const toBill = assignments.filter((a) => !billed.has(a.studentId) && a.structure.instalments.length && a.structure.items.length);
    const byClass = new Map<string, { programLevelId: string; className: string; programName: string; sequence: number; students: number; amountPaise: number; alreadyBilled: number }>();
    for (const a of assignments) {
      const k = a.structure.programLevelId;
      const c = byClass.get(k) ?? { programLevelId: k, className: a.structure.level.name, programName: a.structure.level.program.name, sequence: a.structure.level.sequence, students: 0, amountPaise: 0, alreadyBilled: 0 };
      if (billed.has(a.studentId)) c.alreadyBilled += 1;
      else if (a.structure.items.length && a.structure.instalments.length) {
        c.students += 1;
        c.amountPaise += a.structure.items.reduce((s, i) => s + paise(i.amount), 0);
      }
      byClass.set(k, c);
    }
    // Current students of the chosen scope with no structure at all: they would be missed.
    const unassigned = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM student_enrollments e
        JOIN sections sec ON sec.id = e.section_id JOIN students st ON st.id = e.student_id
       WHERE e.academic_year_id = ${year.id}::uuid AND e.status = 'ACTIVE' AND st.status IN ('ACTIVE', 'INACTIVE')
         AND (${campusIds}::uuid[] IS NULL OR st.campus_id = ANY(${campusIds}::uuid[]))
         AND (${input.programLevelId ?? null}::uuid IS NULL OR sec.program_level_id = ${input.programLevelId ?? null}::uuid)
         AND NOT EXISTS (SELECT 1 FROM student_fee_assignments a WHERE a.student_id = e.student_id AND a.academic_year_id = e.academic_year_id AND a.status = 'ACTIVE')`;
    return {
      year,
      toBill,
      summary: {
        students: toBill.length,
        alreadyBilled: billed.size,
        withoutFees: Number(unassigned[0].n),
        grossAmount: fromPaise([...byClass.values()].reduce((s, c) => s + c.amountPaise, 0)),
        classes: [...byClass.values()].sort((x, y) => x.programName.localeCompare(y.programName) || x.sequence - y.sequence).map(({ amountPaise, ...c }) => ({ ...c, amount: fromPaise(amountPaise) })),
      },
    };
  }

  /** Bills one instalment for everyone in scope who is not billed yet. Safe to repeat. */
  async run(input: BillingRunInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      // One run per year + instalment at a time (two clicks or two cashiers queue here).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing:${auth.tenantId}:${input.academicYearId}:${input.instalmentNo}`}))`;
      const { year, toBill, summary } = await this.plan(tx, input, auth, BILL);
      if (year.status === 'CLOSED') throw Conflict('academic-year-closed', `${year.name} is closed`);
      const invoiceDate = input.invoiceDate ?? iso(todayIST());
      const run = await tx.feeBillingRun.create({
        data: { tenantId: auth.tenantId!, campusId: input.campusId ?? null, academicYearId: year.id, programLevelId: input.programLevelId ?? null, instalmentNo: input.instalmentNo, invoiceDate: day(invoiceDate), skippedCount: summary.alreadyBilled, createdBy: auth.userId },
      });
      let total = 0;
      for (const a of toBill) {
        const inst = a.structure.instalments[0];
        const inv = await this.createInvoice(tx, {
          tenantId: auth.tenantId!, campusId: a.student.campusId, student: a.student, academicYearId: year.id, yearName: year.name, feeStructureId: a.structure.id, billingRunId: run.id,
          instalmentNo: input.instalmentNo, description: `${a.structure.level.name} · ${inst.name} · ${year.name}`, invoiceDate, dueDate: iso(inst.dueDate),
          lines: a.structure.items.map((i) => ({ feeHeadId: i.feeHeadId, amountPaise: paise(i.amount), incomeAccountId: i.feeHead.incomeAccountId })), userId: auth.userId,
        });
        total += paise(inv.netAmount);
      }
      const done = await tx.feeBillingRun.update({ where: { id: run.id }, data: { billedCount: toBill.length, totalAmount: fromPaise(total) } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: input.campusId ?? null, action: 'CREATE', entityType: 'FEE_BILLING_RUN', entityId: run.id, newValues: { ...done, alreadyBilled: summary.alreadyBilled } }, client);
      return { ...done, alreadyBilled: summary.alreadyBilled, withoutFees: summary.withoutFees };
    }, { timeout: 180_000 });
  }

  runs(auth: AuthContext, academicYearId?: string) {
    const scope = this.scope(auth, READ);
    return this.db.run(this.ctx(auth), (tx) =>
      tx.feeBillingRun.findMany({
        where: { ...(academicYearId ? { academicYearId } : {}), ...(scope.all ? {} : { campusId: { in: scope.campusIds } }) },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { academicYear: { select: { name: true } } },
      }),
    );
  }

  // ───────────── Student fee account ─────────────

  async account(studentId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.student(tx, studentId, auth, READ);
      const year = (await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true, name: true } })) ?? (await tx.academicYear.findFirst({ orderBy: { startDate: 'desc' }, select: { id: true, name: true } }));
      const [assignment, invoices, concessions, payments, enrolment] = await Promise.all([
        year ? tx.studentFeeAssignment.findFirst({ where: { studentId, academicYearId: year.id, status: 'ACTIVE' }, include: { structure: { select: { id: true, name: true, feeGroup: true, totalAmount: true, instalments: { orderBy: { instalmentNo: 'asc' } } } } } }) : null,
        tx.feeInvoice.findMany({
          where: { studentId },
          orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
          include: { items: { include: { feeHead: { select: { name: true, code: true } } } }, academicYear: { select: { name: true } } },
        }),
        tx.concession.findMany({ where: { studentId }, orderBy: { createdAt: 'desc' }, include: { feeHead: { select: { name: true } }, academicYear: { select: { name: true } } } }),
        tx.payment.findMany({ where: { studentId }, orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }], select: { id: true, receiptNo: true, paymentDate: true, amount: true, paymentMode: true, referenceNo: true, status: true, cancelledReason: true, payerName: true } }),
        year ? tx.studentEnrollment.findFirst({ where: { studentId, academicYearId: year.id, status: 'ACTIVE' }, select: { section: { select: { programLevelId: true } } } }) : null,
      ]);
      const options = year && enrolment
        ? await tx.feeStructure.findMany({ where: { academicYearId: year.id, programLevelId: enrolment.section.programLevelId, status: 'ACTIVE' }, select: { id: true, name: true, feeGroup: true, totalAmount: true }, orderBy: { feeGroup: { sort: 'asc', nulls: 'first' } } })
        : [];
      const live = invoices.filter((i) => i.status !== 'CANCELLED');
      const sum = (f: (i: (typeof live)[number]) => Prisma.Decimal) => fromPaise(live.reduce((a, i) => a + paise(f(i)), 0));
      const today = todayIST();
      return {
        student: s,
        year,
        assignment,
        structureOptions: options,
        totals: {
          billed: sum((i) => i.grossAmount), concession: sum((i) => i.concessionAmount), fine: sum((i) => i.fineAmount), net: sum((i) => i.netAmount),
          paid: sum((i) => i.paidAmount), balance: sum((i) => i.balanceAmount),
          overdue: fromPaise(live.filter((i) => i.dueDate < today).reduce((a, i) => a + paise(i.balanceAmount), 0)),
        },
        invoices,
        concessions,
        payments,
        canBill: !!scopeFor(auth, BILL) && canAccessCampus(this.scope(auth, BILL), s.campusId),
        canCollect: !!scopeFor(auth, PERMISSIONS.FEE_COLLECT) && canAccessCampus(this.scope(auth, PERMISSIONS.FEE_COLLECT), s.campusId),
        canCancelReceipt: !!scopeFor(auth, PERMISSIONS.FEE_RECEIPT_CANCEL) && canAccessCampus(this.scope(auth, PERMISSIONS.FEE_RECEIPT_CANCEL), s.campusId),
        canRequestConcession: !!scopeFor(auth, PERMISSIONS.FEE_CONCESSION_REQUEST) && canAccessCampus(this.scope(auth, PERMISSIONS.FEE_CONCESSION_REQUEST), s.campusId),
      };
    });
  }

  /** Puts a student on another active structure of their class (e.g. a fee group); future bills only. */
  async changeAssignment(studentId: string, feeStructureId: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.student(tx, studentId, auth, BILL);
      const st = await tx.feeStructure.findUnique({ where: { id: feeStructureId }, select: { id: true, status: true, academicYearId: true, programLevelId: true, name: true } });
      if (!st) throw NotFound('Fee structure');
      if (st.status !== 'ACTIVE') throw Conflict('structure-not-active', 'Only an active fee structure can be assigned');
      const enrolled = await tx.studentEnrollment.findFirst({ where: { studentId, academicYearId: st.academicYearId, status: 'ACTIVE' }, select: { section: { select: { programLevelId: true } } } });
      if (!enrolled || enrolled.section.programLevelId !== st.programLevelId) throw Conflict('other-class', 'This fee structure is for a different class or year');
      const before = await tx.studentFeeAssignment.findFirst({ where: { studentId, academicYearId: st.academicYearId, status: 'ACTIVE' } });
      if (before?.feeStructureId === st.id) return before;
      if (before) await tx.studentFeeAssignment.update({ where: { id: before.id }, data: { status: 'CANCELLED' } });
      const a = await tx.studentFeeAssignment.create({ data: { tenantId: s.tenantId, studentId, academicYearId: st.academicYearId, feeStructureId: st.id, source: 'MANUAL', createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: s.tenantId, userId: auth.userId, campusId: s.campusId, action: 'UPDATE', entityType: 'STUDENT_FEES', entityId: studentId, oldValues: { feeStructureId: before?.feeStructureId ?? null }, newValues: { feeStructureId: st.id, name: st.name } }, client);
      return a;
    });
  }

  // ───────────── Extra charges & cancellation ─────────────

  /** A one-off bill inside the caller's transaction (extra charges, cheque-bounce charges). */
  async chargeInTx(tx: Tx, s: { id: string; tenantId: string; campusId: string; firstName: string; lastName: string | null; admissionNo: string }, input: ExtraChargeInput, userId: string) {
    const head = await tx.feeHead.findUnique({ where: { id: input.feeHeadId }, select: { id: true, status: true, incomeAccountId: true, name: true } });
    if (!head) throw NotFound('Fee head');
    if (head.status !== 'ACTIVE') throw Conflict('fee-head-inactive', `${head.name} is inactive`);
    const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true, name: true, status: true } });
    if (!year || year.status === 'CLOSED') throw Conflict('no-open-year', 'There is no open current academic year');
    return this.createInvoice(tx, {
      tenantId: s.tenantId, campusId: s.campusId, student: s, academicYearId: year.id, yearName: year.name, feeStructureId: null, billingRunId: null, instalmentNo: null,
      description: input.description, invoiceDate: iso(todayIST()), dueDate: input.dueDate, lines: [{ feeHeadId: head.id, amountPaise: toPaise(input.amount), incomeAccountId: head.incomeAccountId }], userId,
    });
  }

  async extraCharge(studentId: string, input: ExtraChargeInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.student(tx, studentId, auth, BILL);
      const inv = await this.chargeInTx(tx, s, input, auth.userId);
      await this.audit.log(tx, { tenantId: s.tenantId, userId: auth.userId, campusId: s.campusId, action: 'CREATE', entityType: 'FEE_INVOICE', entityId: inv.id, newValues: inv }, client);
      return inv;
    });
  }

  /** Cancels a bill with nothing paid: the posting is reversed and the instalment can be billed again. */
  async cancelInvoice(id: string, reason: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM fee_invoices WHERE id = ${id}::uuid FOR UPDATE`;
      const inv = rows.length ? await tx.feeInvoice.findUnique({ where: { id } }) : null;
      if (!inv || !canAccessCampus(this.scope(auth, BILL), inv.campusId)) throw NotFound('Bill');
      if (inv.status === 'CANCELLED') throw Conflict('invoice-cancelled', 'This bill is already cancelled');
      if (paise(inv.paidAmount) > 0) throw Conflict('invoice-paid', 'Money has been received against this bill; cancel the receipt first');
      const date = iso(todayIST());
      const entries = await tx.journalEntry.findMany({ where: { sourceType: 'FEE_INVOICE', sourceId: id, status: 'POSTED', reversalOfId: null }, select: { id: true } });
      for (const e of entries) await reverse(tx, this.numbering, e.id, date, `Cancelled bill ${inv.invoiceNo}: ${reason}`, auth.userId);
      const c = await tx.feeInvoice.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: auth.userId, cancelReason: reason } });
      await this.audit.log(tx, { tenantId: inv.tenantId, userId: auth.userId, campusId: inv.campusId, action: 'UPDATE', entityType: 'FEE_INVOICE', entityId: id, oldValues: { status: inv.status }, newValues: { status: 'CANCELLED', reason }, reason }, client);
      return c;
    });
  }

  // ───────────── Concessions ─────────────

  async requestConcession(studentId: string, input: ConcessionInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.student(tx, studentId, auth, PERMISSIONS.FEE_CONCESSION_REQUEST);
      const year = await tx.academicYear.findUnique({ where: { id: input.academicYearId }, select: { name: true, status: true } });
      if (!year) throw NotFound('Academic year');
      if (year.status === 'CLOSED') throw Conflict('academic-year-closed', `${year.name} is closed`);
      if (input.feeHeadId && !(await tx.feeHead.findUnique({ where: { id: input.feeHeadId }, select: { id: true } }))) throw NotFound('Fee head');
      const c = await tx.concession.create({
        data: { tenantId: s.tenantId, campusId: s.campusId, studentId, academicYearId: input.academicYearId, feeHeadId: input.feeHeadId ?? null, concessionType: input.concessionType, valueType: input.valueType, value: input.value, reason: input.reason, createdBy: auth.userId },
      });
      const what = input.valueType === 'PERCENT' ? `${Number(input.value)}%` : formatINR(toPaise(input.value));
      const req = await this.approvals.submit(tx, {
        tenantId: s.tenantId, requestedBy: auth.userId, entityType: 'CONCESSION', entityId: c.id, campusId: s.campusId,
        amount: input.valueType === 'AMOUNT' ? toPaise(input.value) / 100 : null,
        summary: `${what} ${input.concessionType.toLowerCase().replace('_', ' ')} concession for ${s.firstName} ${s.lastName ?? ''} (${s.admissionNo}), ${year.name}: ${input.reason}`,
      }, client);
      if (!req) {
        throw new AppError(HttpStatus.CONFLICT, 'approval-rule-missing', 'No one is set up to approve concessions yet. Ask the administrator to add an approval rule for concessions (Approvals → Rules).');
      }
      const saved = await tx.concession.update({ where: { id: c.id }, data: { approvalRequestId: req.id } });
      await this.audit.log(tx, { tenantId: s.tenantId, userId: auth.userId, campusId: s.campusId, action: 'CREATE', entityType: 'CONCESSION', entityId: c.id, newValues: saved }, client);
      return saved;
    });
  }

  /** Stops an approved concession for bills made from now on (bills already made keep theirs). */
  async cancelConcession(id: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = await tx.concession.findUnique({ where: { id } });
      if (!c || !canAccessCampus(this.scope(auth, BILL), c.campusId)) throw NotFound('Concession');
      if (c.status !== 'APPROVED') throw Conflict('invalid-transition', c.status === 'PENDING' ? 'A pending concession is rejected by the approver' : `This concession is ${c.status.toLowerCase()}`);
      const u = await tx.concession.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.log(tx, { tenantId: c.tenantId, userId: auth.userId, campusId: c.campusId, action: 'UPDATE', entityType: 'CONCESSION', entityId: id, oldValues: { status: 'APPROVED' }, newValues: { status: 'CANCELLED' } }, client);
      return u;
    });
  }

  /**
   * Approval decided (same transaction). An approved concession also reduces the student's bills of
   * that year that have nothing paid yet, with an adjustment posting Dr Concessions / Cr Receivable.
   */
  private async decided(tx: Tx, d: { entityId: string; decision: 'APPROVED' | 'REJECTED' | 'CANCELLED'; remarks: string | null; userId: string; tenantId: string }) {
    const c = await tx.concession.findUnique({ where: { id: d.entityId } });
    if (!c || c.status !== 'PENDING') return;
    await tx.concession.update({ where: { id: c.id }, data: { status: d.decision, decidedAt: new Date(), decisionRemarks: d.remarks } });
    if (d.decision !== 'APPROVED') return;
    const open = await tx.feeInvoice.findMany({
      where: { studentId: c.studentId, academicYearId: c.academicYearId, status: 'UNPAID', paidAmount: 0 },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      include: { items: true },
    });
    if (!open.length) return;
    const chart = await ensureChart(tx, c.tenantId);
    const rule = (await this.concessionRules(tx, c.studentId, c.academicYearId)).find((r) => r.id === c.id)!;
    for (const inv of open) {
      // Only this concession, on what is still payable on each line.
      const applied = applyConcessions(inv.items.map((i) => ({ feeHeadId: i.feeHeadId, amountPaise: paise(i.amount) - paise(i.concession) })), [rule]);
      let extra = 0;
      for (const [n, l] of applied.entries()) {
        if (!l.concessionPaise) continue;
        const item = inv.items[n];
        await tx.feeInvoiceItem.update({ where: { id: item.id }, data: { concession: fromPaise(paise(item.concession) + l.concessionPaise), netAmount: fromPaise(paise(item.netAmount) - l.concessionPaise) } });
        await tx.feeInvoiceItemConcession.create({ data: { tenantId: c.tenantId, itemId: item.id, concessionId: c.id, amount: fromPaise(l.concessionPaise) } });
        extra += l.concessionPaise;
        if (rule.valueType === 'AMOUNT') rule.usedPaise += l.concessionPaise;
      }
      if (!extra) continue;
      await tx.feeInvoice.update({
        where: { id: inv.id },
        data: { concessionAmount: fromPaise(paise(inv.concessionAmount) + extra), netAmount: fromPaise(paise(inv.netAmount) - extra), balanceAmount: fromPaise(paise(inv.balanceAmount) - extra), ...(paise(inv.netAmount) - extra === 0 ? { status: 'PAID' } : {}) },
      });
      await post(tx, this.numbering, {
        tenantId: c.tenantId, campusId: inv.campusId, date: iso(todayIST()), voucherType: 'JOURNAL', sourceType: 'FEE_INVOICE', sourceId: inv.id, userId: d.userId,
        narration: `Concession on bill ${inv.invoiceNo} (approved)`,
        lines: [
          { accountId: chart.get('CONCESSIONS')!, debitPaise: extra },
          { accountId: chart.get('STUDENT_RECEIVABLE')!, creditPaise: extra, partyType: 'STUDENT', partyId: c.studentId },
        ],
      });
    }
  }
}
