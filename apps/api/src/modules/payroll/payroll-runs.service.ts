import { Injectable, OnModuleInit } from '@nestjs/common';
import { PERMISSIONS, PayrollAdjustmentInput, SalaryCalcError, calculateSalary, fromPaise, fyOfMonth } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { decryptField } from '../../common/field-crypto';
import { ApprovalsService } from '../approvals/approvals.service';
import { NumberingService } from '../numbering/numbering.service';
import { allocateNo } from '../students/student-records';
import { PostingLine } from '../fees/ledger';
import { assertOpen, postOpen, unprocessable, dec } from '../accounts/books';
import { ensurePayroll, isoDay, mIdx, monthEnd, monthName, monthStart, payDays, personName, pz, rulesOn, salaryParts, yearToDate } from './payroll-books';

const LIVE = ['DRAFT', 'CALCULATED', 'PENDING_APPROVAL', 'APPROVED', 'PAID'];
const csvCell = (v: string | number | null) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/**
 * Monthly payroll runs (M15.3). One live run per campus and month. Calculating works out every person
 * with a salary that month (paid days from staff attendance and leave), keeping one-off lines; it can be
 * repeated until the run is submitted. Approval comes from another person (the approvals engine refuses
 * self-approval; a run cannot be submitted until an approver is set up) and posts one balanced journal
 * dated the month's last day; loans recover their EMI. Paying posts Dr salaries payable / Cr bank and
 * releases the payslips. Payslips of a submitted run cannot change (database trigger).
 */
@Injectable()
export class PayrollRunsService implements OnModuleInit {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly numbering: NumberingService, private readonly approvals: ApprovalsService) {}

  onModuleInit() {
    this.approvals.onComplete('PAYROLL_RUN', (tx, d) => this.decided(tx, d));
  }

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  private can(auth: AuthContext, perm: (typeof PERMISSIONS)[keyof typeof PERMISSIONS], campusId: string) {
    const s = scopeFor(auth, perm);
    return !!s && canAccessCampus(s, campusId);
  }
  private async run(tx: Tx, id: string, auth: AuthContext, perm: (typeof PERMISSIONS)[keyof typeof PERMISSIONS] = PERMISSIONS.PAYROLL_RUN, lock = false) {
    if (lock) await tx.$queryRaw`SELECT id FROM payroll_runs WHERE id = ${id}::uuid FOR UPDATE`;
    const r = await tx.payrollRun.findUnique({ where: { id } });
    if (!r) throw NotFound('Payroll run');
    const readers = [PERMISSIONS.PAYROLL_RUN, PERMISSIONS.PAYROLL_PAY, PERMISSIONS.PAYROLL_REPORTS, PERMISSIONS.PAYROLL_SALARY_READ];
    const ok = perm === PERMISSIONS.PAYROLL_RUN && !lock ? readers.some((p) => this.can(auth, p, r.campusId)) : this.can(auth, perm, r.campusId);
    if (!ok) throw NotFound('Payroll run');
    return r;
  }
  list(auth: AuthContext, status?: string) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.payrollRun.findMany({ where: status ? { status } : {}, orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }], take: 200 });
      const readers = [PERMISSIONS.PAYROLL_RUN, PERMISSIONS.PAYROLL_PAY, PERMISSIONS.PAYROLL_REPORTS, PERMISSIONS.PAYROLL_SALARY_READ];
      const campus = new Map((await tx.campus.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
      const counts = await tx.payslip.groupBy({ by: ['runId'], where: { runId: { in: rows.map((r) => r.id) } }, _count: { _all: true } });
      return rows
        .filter((r) => readers.some((p) => this.can(auth, p, r.campusId)))
        .map((r) => ({ id: r.id, runNo: r.runNo, campusId: r.campusId, campus: campus.get(r.campusId) ?? '', month: r.month, year: r.year, label: monthName(r.month, r.year), status: r.status, staff: counts.find((c) => c.runId === r.id)?._count._all ?? 0, totalGross: dec(r.totalGross), totalDeductions: dec(r.totalDeductions), totalNet: dec(r.totalNet), totalEmployer: dec(r.totalEmployer), paidOn: r.paidOn ? isoDay(r.paidOn) : null }));
    });
  }

  create(campusId: string, month: number, year: number, auth: AuthContext, client: ClientInfo) {
    if (!this.can(auth, PERMISSIONS.PAYROLL_RUN, campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      await ensurePayroll(tx, auth.tenantId!);
      const campus = await tx.campus.findUnique({ where: { id: campusId }, select: { id: true, name: true } });
      if (!campus) throw NotFound('Campus');
      const now = new Date(Date.now() + 330 * 60_000);
      if (mIdx(month, year) > mIdx(now.getUTCMonth() + 2, now.getUTCFullYear())) throw unprocessable('future-month', 'Payroll can be prepared up to next month only', 'month');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payroll:${campusId}:${year}-${month}`}))`;
      const dup = await tx.payrollRun.findFirst({ where: { campusId, month, year, status: { in: LIVE } }, select: { runNo: true } });
      if (dup) throw Conflict('run-exists', `${dup.runNo} is already the ${monthName(month, year)} payroll for ${campus.name}`);
      const runNo = await allocateNo(this.numbering, tx, 'PAYROLL_RUN', campusId, fyOfMonth(month, year), auth.userId);
      const r = await tx.payrollRun.create({ data: { tenantId: auth.tenantId!, campusId, month, year, runNo, preparedBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId, action: 'CREATE', entityType: 'PAYROLL_RUN', entityId: r.id, newValues: { runNo, month: monthName(month, year) } }, client);
      const res = await this.compute(tx, r.id);
      return { id: r.id, runNo, ...res };
    });
  }

  calculate(id: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await this.run(tx, id, auth, PERMISSIONS.PAYROLL_RUN, true);
      if (!['DRAFT', 'CALCULATED'].includes(r.status)) throw Conflict('run-locked', `The run is ${r.status.toLowerCase().replace('_', ' ')} — it can no longer be recalculated`);
      const res = await this.compute(tx, r.id);
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: r.campusId, action: 'UPDATE', entityType: 'PAYROLL_RUN', entityId: r.id, newValues: { recalculated: true, staff: res.staff, totalNet: res.totalNet } }, client);
      return res;
    });
  }

  /** Works out every payslip of the run again (one-off lines are kept). */
  private async compute(tx: Tx, runId: string) {
    const r = await tx.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    const start = monthStart(r.month, r.year);
    const end = monthEnd(r.month, r.year);
    await tx.payslipItem.deleteMany({ where: { payslip: { runId } } });
    await tx.payslip.deleteMany({ where: { runId } });
    const staff = await tx.employee.findMany({ where: { campusId: r.campusId, joiningDate: { lte: end }, OR: [{ leftOn: null }, { leftOn: { gte: start } }] }, orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }] });
    const exits = await tx.employeeExit.findMany({ where: { employeeId: { in: staff.map((s) => s.id) }, status: { in: ['INITIATED', 'CLOSED'] } }, select: { employeeId: true, lastWorkingDate: true } });
    const salaries = await tx.employeeSalary.findMany({ where: { employeeId: { in: staff.map((s) => s.id) }, effectiveFrom: { lte: end }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: start } }] }, orderBy: { effectiveFrom: 'desc' } });
    const adjustments = await tx.payrollAdjustment.findMany({ where: { runId } });
    const details = new Map((await tx.employeeDetail.findMany({ where: { employeeId: { in: staff.map((s) => s.id) } } })).map((d) => [d.employeeId, d]));
    const loans = await tx.employeeLoan.findMany({ where: { status: 'ACTIVE', employeeId: { in: staff.map((s) => s.id) } }, orderBy: { createdAt: 'asc' } });
    const rules = await rulesOn(tx, end);
    const problems: string[] = [];
    const missing: string[] = [];
    let gross = 0, ded = 0, net = 0, emp = 0, count = 0;
    for (const e of staff) {
      const a = salaries.find((s) => s.employeeId === e.id);
      if (!a) { if (!['RESIGNED', 'TERMINATED'].includes(e.status)) missing.push(personName(e)); continue; }
      const lastDay = exits.filter((x) => x.employeeId === e.id).map((x) => x.lastWorkingDate).sort((p, q) => p.getTime() - q.getTime())[0] ?? null;
      if (lastDay && lastDay < start) continue;
      const days = await payDays(tx, e, r.month, r.year, lastDay);
      if (days.employedDays <= 0) continue;
      const parts = await salaryParts(tx, a);
      let res;
      try {
        res = calculateSalary({
          ...parts, grossPaise: pz(a.monthlyGross), monthDays: days.monthDays, paidDays: days.paidDays, month: r.month, pf: a.pfApplicable, esi: a.esiApplicable, pt: a.ptApplicable,
          tdsOverridePaise: a.tdsMonthlyOverride == null ? null : pz(a.tdsMonthlyOverride), rules,
          adjustments: adjustments.filter((x) => x.employeeId === e.id).map((x) => ({ id: x.id, itemType: x.itemType as 'EARNING' | 'DEDUCTION', label: x.label, amountPaise: pz(x.amount), isTaxable: x.isTaxable })),
          loans: loans.filter((l) => l.employeeId === e.id && mIdx(l.startMonth, l.startYear) <= mIdx(r.month, r.year)).map((l) => ({ id: l.id, loanNo: l.loanNo, emiPaise: pz(l.emiAmount), balancePaise: pz(l.amount) - pz(l.recovered) })),
          ytd: await yearToDate(tx, e.id, r.month, r.year),
        });
      } catch (err) {
        if (err instanceof SalaryCalcError) { problems.push(`${personName(e)}: ${err.message}`); continue; }
        throw err;
      }
      const d = details.get(e.id);
      const slip = await tx.payslip.create({
        data: {
          tenantId: r.tenantId, runId, employeeId: e.id, assignmentId: a.id, monthDays: days.monthDays, employedDays: days.employedDays, lopDays: days.lopDays, paidDays: days.paidDays,
          grossEarnings: fromPaise(res.grossPaise), totalDeductions: fromPaise(res.deductionsPaise), employerContributions: fromPaise(res.employerPaise), netPay: fromPaise(res.netPaise),
          pfWages: fromPaise(res.pfWagesPaise), esiWages: fromPaise(res.esiWagesPaise), taxableYearProjected: fromPaise(res.taxableProjectedPaise), taxYear: fromPaise(res.taxYearPaise),
          designation: e.designation, bankName: d?.bankName ?? null, bankAccountLast4: d?.bankAccountLast4 ?? null, ifsc: d?.ifsc ?? null,
        },
      });
      await tx.payslipItem.createMany({ data: res.items.map((i) => ({ tenantId: r.tenantId, payslipId: slip.id, componentId: i.componentId, adjustmentId: i.adjustmentId, loanId: i.loanId, itemType: i.itemType, code: i.code, name: i.name, amount: fromPaise(i.amountPaise), sortOrder: i.sortOrder })) });
      gross += res.grossPaise; ded += res.deductionsPaise; net += res.netPaise; emp += res.employerPaise; count++;
    }
    if (problems.length) throw unprocessable('salary-calc', `Could not work out ${problems.length === 1 ? 'one salary' : `${problems.length} salaries`}: ${problems.slice(0, 5).join(' · ')}`);
    await tx.payrollRun.update({ where: { id: runId }, data: { status: 'CALCULATED', calculatedAt: new Date(), totalGross: fromPaise(gross), totalDeductions: fromPaise(ded), totalNet: fromPaise(net), totalEmployer: fromPaise(emp) } });
    return { staff: count, missing, totalGross: fromPaise(gross), totalNet: fromPaise(net) };
  }

  get(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await this.run(tx, id, auth);
      const slips = await tx.payslip.findMany({ where: { runId: r.id }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
      const staff = new Map((await tx.employee.findMany({ where: { id: { in: slips.map((s) => s.employeeId) } }, select: { id: true, firstName: true, lastName: true, employeeCode: true } })).map((e) => [e.id, e]));
      const adjustments = await tx.payrollAdjustment.findMany({ where: { runId: r.id }, orderBy: { createdAt: 'asc' } });
      const campus = await tx.campus.findUnique({ where: { id: r.campusId }, select: { name: true } });
      const users = new Map((await tx.user.findMany({ where: { id: { in: [r.preparedBy, r.approvedBy, r.paidBy].filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
      const journals = await tx.journalEntry.findMany({ where: { id: { in: [r.journalEntryId, r.paymentJournalEntryId].filter((x): x is string => !!x) } }, select: { id: true, entryNo: true } });
      const bank = r.paidFromBankAccountId ? await tx.bankAccount.findUnique({ where: { id: r.paidFromBankAccountId } }) : null;
      // Staff with no salary set who would otherwise be in this run.
      const withSalary = new Set((await tx.employeeSalary.findMany({ where: { effectiveFrom: { lte: monthEnd(r.month, r.year) } }, select: { employeeId: true } })).map((s) => s.employeeId));
      const missing = (await tx.employee.findMany({ where: { campusId: r.campusId, status: { notIn: ['RESIGNED', 'TERMINATED'] }, joiningDate: { lte: monthEnd(r.month, r.year) } }, select: { id: true, firstName: true, lastName: true } })).filter((e) => !withSalary.has(e.id)).map(personName);
      const slipName = (id: string) => { const e = staff.get(id); return e ? personName(e) : ''; };
      return {
        id: r.id, runNo: r.runNo, campusId: r.campusId, campus: campus?.name ?? '', month: r.month, year: r.year, label: monthName(r.month, r.year), status: r.status,
        totalGross: dec(r.totalGross), totalDeductions: dec(r.totalDeductions), totalNet: dec(r.totalNet), totalEmployer: dec(r.totalEmployer),
        preparedBy: users.get(r.preparedBy) ?? null, calculatedAt: r.calculatedAt, approvedBy: r.approvedBy ? users.get(r.approvedBy) ?? null : null, approvedAt: r.approvedAt,
        journalNo: journals.find((j) => j.id === r.journalEntryId)?.entryNo ?? null, paymentJournalNo: journals.find((j) => j.id === r.paymentJournalEntryId)?.entryNo ?? null,
        paidOn: r.paidOn ? isoDay(r.paidOn) : null, paidBy: r.paidBy ? users.get(r.paidBy) ?? null : null, paidFrom: bank ? `${bank.bankName} ••${bank.accountNoLast4}` : null,
        missing,
        mine: r.preparedBy === auth.userId,
        can: { prepare: this.can(auth, PERMISSIONS.PAYROLL_RUN, r.campusId), pay: this.can(auth, PERMISSIONS.PAYROLL_PAY, r.campusId), reports: this.can(auth, PERMISSIONS.PAYROLL_REPORTS, r.campusId) },
        payslips: slips
          .map((s) => ({
            id: s.id, employeeId: s.employeeId, name: slipName(s.employeeId), code: staff.get(s.employeeId)?.employeeCode ?? '', designation: s.designation,
            monthDays: s.monthDays, employedDays: Number(s.employedDays), lopDays: Number(s.lopDays), paidDays: Number(s.paidDays),
            gross: dec(s.grossEarnings), deductions: dec(s.totalDeductions), employer: dec(s.employerContributions), net: dec(s.netPay),
            bank: s.bankAccountLast4 ? `${s.bankName ?? 'Bank'} ••${s.bankAccountLast4}` : null,
            items: s.items.map((i) => ({ itemType: i.itemType, code: i.code, name: i.name, amount: dec(i.amount) })),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        adjustments: adjustments.map((a) => ({ id: a.id, employeeId: a.employeeId, name: slipName(a.employeeId), itemType: a.itemType, label: a.label, amount: dec(a.amount), isTaxable: a.isTaxable })),
      };
    });
  }

  addAdjustment(id: string, input: PayrollAdjustmentInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await this.run(tx, id, auth, PERMISSIONS.PAYROLL_RUN, true);
      if (!['DRAFT', 'CALCULATED'].includes(r.status)) throw Conflict('run-locked', 'One-off lines can be changed only before the run is submitted');
      const e = await tx.employee.findUnique({ where: { id: input.employeeId } });
      if (!e || e.campusId !== r.campusId) throw NotFound('Staff member');
      const a = await tx.payrollAdjustment.create({ data: { tenantId: auth.tenantId!, runId: r.id, employeeId: e.id, itemType: input.itemType, label: input.label, amount: input.amount, isTaxable: input.itemType === 'EARNING' && input.isTaxable, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: r.campusId, action: 'CREATE', entityType: 'PAYROLL_ADJUSTMENT', entityId: a.id, newValues: { run: r.runNo, employee: personName(e), itemType: input.itemType, label: input.label, amount: input.amount } }, client);
      const res = await this.compute(tx, r.id);
      return { id: a.id, ...res };
    });
  }

  removeAdjustment(id: string, adjustmentId: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await this.run(tx, id, auth, PERMISSIONS.PAYROLL_RUN, true);
      if (!['DRAFT', 'CALCULATED'].includes(r.status)) throw Conflict('run-locked', 'One-off lines can be changed only before the run is submitted');
      const a = await tx.payrollAdjustment.findUnique({ where: { id: adjustmentId } });
      if (!a || a.runId !== r.id) throw NotFound('One-off line');
      await tx.payslipItem.deleteMany({ where: { adjustmentId: a.id } });
      await tx.payrollAdjustment.delete({ where: { id: a.id } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: r.campusId, action: 'DELETE', entityType: 'PAYROLL_ADJUSTMENT', entityId: a.id, oldValues: { label: a.label, amount: dec(a.amount), itemType: a.itemType } }, client);
      return this.compute(tx, r.id);
    });
  }

  submit(id: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await this.run(tx, id, auth, PERMISSIONS.PAYROLL_RUN, true);
      if (r.status !== 'CALCULATED') throw Conflict('run-not-ready', r.status === 'DRAFT' ? 'Calculate the run first' : 'The run is already submitted');
      if (!(await tx.payslip.count({ where: { runId: r.id } }))) throw Conflict('run-empty', 'No one is in this run — set salaries first');
      await assertOpen(tx, isoDay(monthEnd(r.month, r.year)));
      const req = await this.approvals.submit(tx, { tenantId: auth.tenantId!, requestedBy: auth.userId, entityType: 'PAYROLL_RUN', entityId: r.id, campusId: r.campusId, amount: pz(r.totalNet) / 100, summary: `${r.runNo} · ${monthName(r.month, r.year)} salaries, net ₹${dec(r.totalNet)}` }, client);
      if (!req) throw Conflict('no-approver', 'Set up who approves payroll runs first (Settings → Approvals) — a run is always approved by someone other than the person who prepared it');
      await tx.payrollRun.update({ where: { id: r.id }, data: { status: 'PENDING_APPROVAL', approvalRequestId: req.id } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: r.campusId, action: 'SUBMIT', entityType: 'PAYROLL_RUN', entityId: r.id, newValues: { runNo: r.runNo, totalNet: dec(r.totalNet) } }, client);
      return { status: 'PENDING_APPROVAL' };
    });
  }

  cancel(id: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await this.run(tx, id, auth, PERMISSIONS.PAYROLL_RUN, true);
      if (!['DRAFT', 'CALCULATED'].includes(r.status)) throw Conflict('run-locked', r.status === 'PENDING_APPROVAL' ? 'The run is waiting for approval — ask the approver to reject it first' : 'An approved run cannot be cancelled; correct it in next month’s run');
      await tx.payrollRun.update({ where: { id: r.id }, data: { status: 'CANCELLED', cancelledBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: r.campusId, action: 'CANCEL', entityType: 'PAYROLL_RUN', entityId: r.id, oldValues: { status: r.status } }, client);
      return { status: 'CANCELLED' };
    });
  }

  private async decided(tx: Tx, d: { entityId: string; decision: 'APPROVED' | 'REJECTED' | 'CANCELLED'; userId: string }) {
    await tx.$queryRaw`SELECT id FROM payroll_runs WHERE id = ${d.entityId}::uuid FOR UPDATE`;
    const r = await tx.payrollRun.findUnique({ where: { id: d.entityId } });
    if (!r || r.status !== 'PENDING_APPROVAL') return;
    if (d.decision !== 'APPROVED') { await tx.payrollRun.update({ where: { id: r.id }, data: { status: 'CALCULATED', approvalRequestId: null } }); return; }
    const chart = await ensurePayroll(tx, r.tenantId);
    const slips = await tx.payslip.findMany({ where: { runId: r.id }, include: { items: true } });
    const comps = new Map((await tx.salaryComponent.findMany()).map((c) => [c.id, c]));
    const lines: PostingLine[] = [];
    const loanRecovery = new Map<string, number>();
    for (const s of slips) {
      for (const i of s.items) {
        const p = pz(i.amount);
        const c = i.componentId ? comps.get(i.componentId) : undefined;
        if (i.itemType === 'EARNING') lines.push({ accountId: c?.accountId ?? chart.get('EXP_SALARY')!, debitPaise: p });
        else if (i.itemType === 'EMPLOYER') { lines.push({ accountId: c!.accountId!, debitPaise: p }); lines.push({ accountId: c!.liabilityAccountId!, creditPaise: p }); }
        else lines.push({ accountId: c?.accountId ?? chart.get('EXP_SALARY')!, creditPaise: p });
        if (i.loanId) loanRecovery.set(i.loanId, (loanRecovery.get(i.loanId) ?? 0) + p);
      }
      lines.push({ accountId: chart.get('SALARY_PAYABLE')!, creditPaise: pz(s.netPay) });
    }
    const e = await postOpen(tx, this.numbering, { tenantId: r.tenantId, campusId: r.campusId, date: isoDay(monthEnd(r.month, r.year)), voucherType: 'JOURNAL', sourceType: 'PAYROLL_RUN', sourceId: r.id, userId: d.userId, narration: `${r.runNo} · ${monthName(r.month, r.year)} salaries (${slips.length} staff)`, lines });
    for (const [loanId, p] of loanRecovery) {
      const l = await tx.employeeLoan.findUniqueOrThrow({ where: { id: loanId } });
      const recovered = pz(l.recovered) + p;
      if (recovered > pz(l.amount)) throw Conflict('loan-over-recovered', `${l.loanNo} would be recovered beyond its amount — recalculate the run`);
      await tx.employeeLoan.update({ where: { id: l.id }, data: { recovered: fromPaise(recovered), status: recovered === pz(l.amount) ? 'CLOSED' : 'ACTIVE' } });
    }
    await tx.payrollRun.update({ where: { id: r.id }, data: { status: 'APPROVED', approvedBy: d.userId, approvedAt: new Date(), journalEntryId: e.id } });
  }

  /** CSV for the bank's bulk transfer: full account numbers only here, for the payer; the export is audited. */
  bankFile(id: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await this.run(tx, id, auth, PERMISSIONS.PAYROLL_PAY);
      if (!['APPROVED', 'PAID'].includes(r.status)) throw Conflict('run-not-approved', 'The bank file is ready once the run is approved');
      const slips = await tx.payslip.findMany({ where: { runId: r.id, netPay: { gt: 0 } } });
      const staff = new Map((await tx.employee.findMany({ where: { id: { in: slips.map((s) => s.employeeId) } }, select: { id: true, firstName: true, lastName: true, employeeCode: true } })).map((e) => [e.id, e]));
      const details = new Map((await tx.employeeDetail.findMany({ where: { employeeId: { in: slips.map((s) => s.employeeId) } } })).map((d) => [d.employeeId, d]));
      const rows: string[] = ['Sr No,Employee code,Name,Account number,IFSC,Bank,Amount,Narration'];
      const others: { name: string; code: string; net: string }[] = [];
      let n = 0, total = 0;
      for (const s of [...slips].sort((a, b) => personName(staff.get(a.employeeId)!).localeCompare(personName(staff.get(b.employeeId)!)))) {
        const e = staff.get(s.employeeId)!;
        const d = details.get(s.employeeId);
        if (!d?.bankAccountEnc || !d.ifsc) { others.push({ name: personName(e), code: e.employeeCode, net: dec(s.netPay) }); continue; }
        n++; total += pz(s.netPay);
        rows.push([n, e.employeeCode, personName(e), decryptField(d.bankAccountEnc), d.ifsc, d.bankName, dec(s.netPay), `Salary ${monthName(r.month, r.year)}`].map(csvCell).join(','));
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: r.campusId, action: 'EXPORT', entityType: 'PAYROLL_RUN', entityId: r.id, newValues: { bankFile: true, rows: n, total: fromPaise(total) } }, client);
      return { fileName: `${r.runNo.replace(/[^A-Za-z0-9-]+/g, '-')}-bank-transfer.csv`, csv: rows.join('\r\n') + '\r\n', count: n, total: fromPaise(total), others };
    });
  }

  pay(id: string, paidOn: string, bankAccountId: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await this.run(tx, id, auth, PERMISSIONS.PAYROLL_PAY, true);
      if (r.status !== 'APPROVED') throw Conflict('run-not-approved', r.status === 'PAID' ? 'Already paid' : 'The run must be approved first');
      if (paidOn < isoDay(monthStart(r.month, r.year))) throw unprocessable('paid-before-month', `Salaries for ${monthName(r.month, r.year)} cannot be paid before the month starts`, 'paidOn');
      const bank = await tx.bankAccount.findUnique({ where: { id: bankAccountId } });
      if (!bank || !bank.isActive) throw NotFound('Bank account');
      const chart = await ensurePayroll(tx, r.tenantId);
      const amount = pz(r.totalNet);
      let paymentJournalEntryId: string | null = null;
      if (amount > 0) {
        const e = await postOpen(tx, this.numbering, { tenantId: r.tenantId, campusId: r.campusId, date: paidOn, voucherType: 'PAYMENT', sourceType: 'PAYROLL_PAYMENT', sourceId: r.id, userId: auth.userId, narration: `${r.runNo} · ${monthName(r.month, r.year)} salaries paid from ${bank.bankName} ••${bank.accountNoLast4}`, lines: [{ accountId: chart.get('SALARY_PAYABLE')!, debitPaise: amount }, { accountId: bank.accountId, creditPaise: amount }] });
        paymentJournalEntryId = e.id;
      } else {
        throw Conflict('nothing-to-pay', 'The net pay of this run is zero');
      }
      await tx.payrollRun.update({ where: { id: r.id }, data: { status: 'PAID', paidOn: new Date(`${paidOn}T00:00:00Z`), paidFromBankAccountId: bank.id, paymentJournalEntryId, paidBy: auth.userId } });
      await tx.payslip.updateMany({ where: { runId: r.id }, data: { isReleased: true } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: r.campusId, action: 'STATUS_CHANGE', entityType: 'PAYROLL_RUN', entityId: r.id, oldValues: { status: 'APPROVED' }, newValues: { status: 'PAID', paidOn, amount: dec(r.totalNet), bank: `${bank.bankName} ••${bank.accountNoLast4}` } }, client);
      return { status: 'PAID' };
    });
  }

  // ───────────── Payslips ─────────────

  payslip(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.payslip.findUnique({ where: { id }, include: { items: { orderBy: { sortOrder: 'asc' } }, run: true } });
      if (!s) throw NotFound('Payslip');
      const e = await tx.employee.findUniqueOrThrow({ where: { id: s.employeeId } });
      const own = e.userId === auth.userId && s.isReleased;
      const staffSide = [PERMISSIONS.PAYROLL_RUN, PERMISSIONS.PAYROLL_SALARY_READ, PERMISSIONS.PAYROLL_PAY].some((p) => this.can(auth, p, s.run.campusId));
      if (!own && !staffSide) throw NotFound('Payslip');
      const d = await tx.employeeDetail.findFirst({ where: { employeeId: e.id } });
      const campus = await tx.campus.findUnique({ where: { id: s.run.campusId }, select: { name: true, address: true, city: true } });
      const tenant = await tx.tenant.findUnique({ where: { id: s.tenantId }, select: { name: true } });
      const ytd = await yearToDate(tx, e.id, s.run.month, s.run.year);
      const tdsNow = s.items.filter((i) => i.code === 'TDS' && i.itemType === 'DEDUCTION').reduce((t, i) => t + pz(i.amount), 0);
      return {
        id: s.id, runNo: s.run.runNo, month: s.run.month, year: s.run.year, label: monthName(s.run.month, s.run.year), status: s.run.status, isReleased: s.isReleased, paidOn: s.run.paidOn ? isoDay(s.run.paidOn) : null,
        institution: tenant?.name ?? '', campus: campus?.name ?? '', campusAddress: [campus?.address, campus?.city].filter(Boolean).join(', ') || null,
        employee: { name: personName(e), code: e.employeeCode, designation: s.designation, joiningDate: isoDay(e.joiningDate), panLast4: d?.panLast4 ?? null, uanNo: d?.uanNo ?? null, pfNo: d?.pfNo ?? null, esiNo: d?.esiNo ?? null },
        bank: s.bankAccountLast4 ? `${s.bankName ?? 'Bank'} ••${s.bankAccountLast4}${s.ifsc ? ` · ${s.ifsc}` : ''}` : null,
        monthDays: s.monthDays, employedDays: Number(s.employedDays), lopDays: Number(s.lopDays), paidDays: Number(s.paidDays),
        earnings: s.items.filter((i) => i.itemType === 'EARNING').map((i) => ({ name: i.name, amount: dec(i.amount) })),
        deductions: s.items.filter((i) => i.itemType === 'DEDUCTION').map((i) => ({ name: i.name, amount: dec(i.amount) })),
        employer: s.items.filter((i) => i.itemType === 'EMPLOYER').map((i) => ({ name: i.name, amount: dec(i.amount) })),
        gross: dec(s.grossEarnings), deductionsTotal: dec(s.totalDeductions), employerTotal: dec(s.employerContributions), net: dec(s.netPay),
        tax: { projectedTaxable: dec(s.taxableYearProjected), yearTax: dec(s.taxYear), deductedBefore: fromPaise(ytd.tdsPaise), deductedTotal: fromPaise(ytd.tdsPaise + tdsNow) },
      };
    });
  }

  myPayslips(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await tx.employee.findFirst({ where: { userId: auth.userId } });
      if (!e) return { employee: null, payslips: [] };
      const rows = await tx.payslip.findMany({ where: { employeeId: e.id, isReleased: true }, include: { run: { select: { month: true, year: true, paidOn: true } } } });
      return {
        employee: { name: personName(e), code: e.employeeCode },
        payslips: rows
          .sort((a, b) => mIdx(b.run.month, b.run.year) - mIdx(a.run.month, a.run.year))
          .map((s) => ({ id: s.id, label: monthName(s.run.month, s.run.year), month: s.run.month, year: s.run.year, paidOn: s.run.paidOn ? isoDay(s.run.paidOn) : null, gross: dec(s.grossEarnings), deductions: dec(s.totalDeductions), net: dec(s.netPay), paidDays: Number(s.paidDays), lopDays: Number(s.lopDays) })),
      };
    });
  }
}

