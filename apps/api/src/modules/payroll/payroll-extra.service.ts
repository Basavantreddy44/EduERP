import { Injectable, OnModuleInit } from '@nestjs/common';
import { EmployeeLoanInput, PERMISSIONS, SalaryCalcError, calculateSalary, financialYearOf, fromPaise } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { ApprovalsService } from '../approvals/approvals.service';
import { NumberingService } from '../numbering/numbering.service';
import { allocateNo } from '../students/student-records';
import { assertOpen, postOpen, unprocessable, dec } from '../accounts/books';
import { staffLeaveBalance } from '../hr/leave-balances.service';
import { ensurePayroll, isoDay, mIdx, monthDaysOf, monthEnd, monthName, num, payDays, personName, pz, rulesOn, salaryParts, yearToDate } from './payroll-books';

type Col = { key: string; label: string; money?: boolean };
const LOAN_TEXT: Record<string, string> = { ADVANCE: 'salary advance', LOAN: 'loan' };

/**
 * Loans & advances, statutory statements and the exit settlement worksheet (M15.4). A loan is approved
 * where an approval rule exists, then paid out (Dr staff loans / Cr cash or bank) and recovered in each
 * payroll run until repaid. Statements are worked out from the run's payslips, so they always agree
 * with its journal.
 */
@Injectable()
export class PayrollExtraService implements OnModuleInit {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly numbering: NumberingService, private readonly approvals: ApprovalsService) {}

  onModuleInit() {
    this.approvals.onComplete('STAFF_LOAN', (tx, d) => this.loanDecided(tx, d));
  }

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  private can(auth: AuthContext, perm: (typeof PERMISSIONS)[keyof typeof PERMISSIONS], campusId: string) {
    const s = scopeFor(auth, perm);
    return !!s && canAccessCampus(s, campusId);
  }

  // ───────────── Loans & advances ─────────────

  loans(auth: AuthContext, status?: string) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const me = await tx.employee.findFirst({ where: { userId: auth.userId }, select: { id: true } });
      const rows = await tx.employeeLoan.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 300 });
      const visible = rows.filter((l) => this.can(auth, PERMISSIONS.PAYROLL_LOAN, l.campusId) || l.employeeId === me?.id);
      const staff = new Map((await tx.employee.findMany({ where: { id: { in: visible.map((l) => l.employeeId) } }, select: { id: true, firstName: true, lastName: true, employeeCode: true } })).map((e) => [e.id, e]));
      return visible.map((l) => ({
        id: l.id, loanNo: l.loanNo, employeeId: l.employeeId, name: personName(staff.get(l.employeeId)!), code: staff.get(l.employeeId)!.employeeCode, campusId: l.campusId, loanType: l.loanType,
        amount: dec(l.amount), emiAmount: dec(l.emiAmount), recovered: dec(l.recovered), balance: fromPaise(pz(l.amount) - pz(l.recovered)), starts: monthName(l.startMonth, l.startYear), startMonth: l.startMonth, startYear: l.startYear,
        reason: l.reason, disbursedOn: isoDay(l.disbursedOn), mode: l.mode, status: l.status, mine: l.employeeId === me?.id,
      }));
    });
  }

  createLoan(input: EmployeeLoanInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const chart = await ensurePayroll(tx, auth.tenantId!);
      const e = await tx.employee.findUnique({ where: { id: input.employeeId } });
      if (!e || !this.can(auth, PERMISSIONS.PAYROLL_LOAN, e.campusId)) throw NotFound('Staff member');
      if (['RESIGNED', 'TERMINATED'].includes(e.status)) throw Conflict('staff-left', `${personName(e)} has left`);
      if (!(await tx.employeeSalary.findFirst({ where: { employeeId: e.id, effectiveTo: null }, select: { id: true } }))) throw Conflict('no-salary', `Set ${personName(e)}'s salary first — the loan is recovered from it`);
      const d = new Date(`${input.disbursedOn}T00:00:00Z`);
      if (mIdx(input.startMonth, input.startYear) < mIdx(d.getUTCMonth() + 1, d.getUTCFullYear())) throw unprocessable('start-before-payout', 'Recovery cannot start before the money is paid out', 'startMonth');
      if (input.mode !== 'CASH') { const b = await tx.bankAccount.findUnique({ where: { id: input.bankAccountId! } }); if (!b || !b.isActive) throw NotFound('Bank account'); }
      if (!chart.get('CASH')) throw NotFound('Cash account');
      await assertOpen(tx, input.disbursedOn);
      const loanNo = await allocateNo(this.numbering, tx, 'STAFF_LOAN', e.campusId, financialYearOf(input.disbursedOn).name, auth.userId);
      const l = await tx.employeeLoan.create({
        data: {
          tenantId: auth.tenantId!, campusId: e.campusId, loanNo, employeeId: e.id, loanType: input.loanType, amount: input.amount, emiAmount: input.emiAmount, startMonth: input.startMonth, startYear: input.startYear,
          reason: input.reason, disbursedOn: d, mode: input.mode, bankAccountId: input.mode === 'CASH' ? null : input.bankAccountId!, status: 'PENDING_APPROVAL', createdBy: auth.userId,
        },
      });
      const req = await this.approvals.submit(tx, { tenantId: auth.tenantId!, requestedBy: auth.userId, entityType: 'STAFF_LOAN', entityId: l.id, campusId: e.campusId, amount: Number(input.amount), summary: `${loanNo} · ${LOAN_TEXT[input.loanType]} of ₹${input.amount} to ${personName(e)}, ₹${input.emiAmount} a month` }, client);
      if (req) await tx.employeeLoan.update({ where: { id: l.id }, data: { approvalRequestId: req.id } });
      else await this.payOut(tx, l.id, auth.userId);
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: e.campusId, action: 'CREATE', entityType: 'STAFF_LOAN', entityId: l.id, newValues: { loanNo, employee: personName(e), loanType: input.loanType, amount: input.amount, emi: input.emiAmount, needsApproval: !!req } }, client);
      return { id: l.id, loanNo, status: req ? 'PENDING_APPROVAL' : 'ACTIVE' };
    });
  }

  private async payOut(tx: Tx, loanId: string, userId: string) {
    const l = await tx.employeeLoan.findUniqueOrThrow({ where: { id: loanId } });
    const chart = await ensurePayroll(tx, l.tenantId);
    const e = await tx.employee.findUniqueOrThrow({ where: { id: l.employeeId } });
    let money = chart.get('CASH')!;
    let from = 'cash';
    if (l.mode !== 'CASH') { const b = await tx.bankAccount.findUniqueOrThrow({ where: { id: l.bankAccountId! } }); money = b.accountId; from = `${b.bankName} ••${b.accountNoLast4}`; }
    const j = await postOpen(tx, this.numbering, { tenantId: l.tenantId, campusId: l.campusId, date: isoDay(l.disbursedOn), voucherType: 'PAYMENT', sourceType: 'STAFF_LOAN', sourceId: l.id, userId, narration: `${l.loanNo} · ${LOAN_TEXT[l.loanType]} to ${personName(e)} paid from ${from}`, lines: [{ accountId: chart.get('STAFF_LOANS')!, debitPaise: pz(l.amount) }, { accountId: money, creditPaise: pz(l.amount) }] });
    await tx.employeeLoan.update({ where: { id: l.id }, data: { status: 'ACTIVE', journalEntryId: j.id } });
  }

  private async loanDecided(tx: Tx, d: { entityId: string; decision: 'APPROVED' | 'REJECTED' | 'CANCELLED'; userId: string }) {
    const l = await tx.employeeLoan.findUnique({ where: { id: d.entityId }, select: { id: true, status: true } });
    if (!l || l.status !== 'PENDING_APPROVAL') return;
    if (d.decision === 'APPROVED') await this.payOut(tx, l.id, d.userId);
    else await tx.employeeLoan.update({ where: { id: l.id }, data: { status: d.decision === 'REJECTED' ? 'REJECTED' : 'CANCELLED' } });
  }

  // ───────────── Statements ─────────────

  report(runId: string, kind: 'register' | 'pf' | 'esi' | 'pt' | 'tds', auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await tx.payrollRun.findUnique({ where: { id: runId } });
      if (!r || !(this.can(auth, PERMISSIONS.PAYROLL_REPORTS, r.campusId) || this.can(auth, PERMISSIONS.PAYROLL_RUN, r.campusId))) throw NotFound('Payroll run');
      if (r.status === 'CANCELLED') throw Conflict('run-cancelled', 'This run was cancelled');
      const slips = await tx.payslip.findMany({ where: { runId: r.id }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
      const staff = new Map((await tx.employee.findMany({ where: { id: { in: slips.map((s) => s.employeeId) } }, select: { id: true, firstName: true, lastName: true, employeeCode: true } })).map((e) => [e.id, e]));
      const details = new Map((await tx.employeeDetail.findMany({ where: { employeeId: { in: slips.map((s) => s.employeeId) } } })).map((d) => [d.employeeId, d]));
      const comps = new Map((await tx.salaryComponent.findMany()).map((c) => [c.id, c]));
      const adjs = new Map((await tx.payrollAdjustment.findMany({ where: { runId: r.id } })).map((a) => [a.id, a]));
      const rules = await rulesOn(tx, monthEnd(r.month, r.year));
      slips.sort((a, b) => personName(staff.get(a.employeeId)!).localeCompare(personName(staff.get(b.employeeId)!)));
      const kindOf = (i: { componentId: string | null }) => (i.componentId ? comps.get(i.componentId)?.statutoryKind ?? null : null);
      const sum = (s: (typeof slips)[number], type: string, kind: string | null) => s.items.filter((i) => i.itemType === type && kindOf(i) === kind).reduce((t, i) => t + pz(i.amount), 0);
      const base = (s: (typeof slips)[number]) => { const e = staff.get(s.employeeId)!; return { name: personName(e), code: e.employeeCode }; };
      let columns: Col[] = [];
      let rows: Record<string, string | number | null>[] = [];
      let ecr: string | null = null;
      const notes: string[] = [];
      if (kind === 'register') {
        const earn = new Map<string, string>(), ded = new Map<string, string>();
        for (const s of slips) for (const i of s.items) { if (i.itemType === 'EARNING') earn.set(i.componentId ? i.code : `ADJ:${i.name}`, i.componentId ? i.name : i.name); else if (i.itemType === 'DEDUCTION') ded.set(i.componentId ? (i.loanId ? 'LOAN' : i.code) : `ADJ:${i.name}`, i.loanId ? 'Loan recovery' : i.name); }
        columns = [{ key: 'name', label: 'Name' }, { key: 'code', label: 'Code' }, { key: 'paidDays', label: 'Paid days' }, { key: 'lopDays', label: 'Loss of pay' },
          ...[...earn].map(([k, v]) => ({ key: `e:${k}`, label: v, money: true })), { key: 'gross', label: 'Gross', money: true },
          ...[...ded].map(([k, v]) => ({ key: `d:${k}`, label: v, money: true })), { key: 'deductions', label: 'Deductions', money: true }, { key: 'net', label: 'Net pay', money: true }, { key: 'employer', label: 'Employer PF / ESI', money: true }];
        rows = slips.map((s) => {
          const row: Record<string, string | number | null> = { ...base(s), paidDays: Number(s.paidDays), lopDays: Number(s.lopDays), gross: dec(s.grossEarnings), deductions: dec(s.totalDeductions), net: dec(s.netPay), employer: dec(s.employerContributions) };
          for (const i of s.items) {
            if (i.itemType === 'EMPLOYER') continue;
            const k = `${i.itemType === 'EARNING' ? 'e' : 'd'}:${i.componentId ? (i.loanId ? 'LOAN' : i.code) : `ADJ:${i.name}`}`;
            row[k] = fromPaise(pz(row[k] as string | null) + pz(i.amount));
          }
          return row;
        });
      } else if (kind === 'pf') {
        columns = [{ key: 'uan', label: 'UAN' }, { key: 'name', label: 'Name' }, { key: 'code', label: 'Code' }, { key: 'gross', label: 'Gross wages', money: true }, { key: 'epfWages', label: 'EPF wages', money: true }, { key: 'epsWages', label: 'EPS wages', money: true }, { key: 'ee', label: 'Employee PF (12%)', money: true }, { key: 'eps', label: 'Pension (EPS 8.33%)', money: true }, { key: 'er', label: 'Employer PF (EPF)', money: true }, { key: 'ncp', label: 'Days not paid' }];
        const epsCeiling = 1_500_000;
        const lines: string[] = [];
        for (const s of slips) {
          const ee = sum(s, 'DEDUCTION', 'PF');
          if (!ee) continue;
          const er = sum(s, 'EMPLOYER', 'PF');
          const wages = pz(s.pfWages);
          const epsWages = Math.min(wages, epsCeiling);
          const eps = Math.min(er, Math.round((epsWages * 833) / 10000 / 100) * 100);
          const uan = details.get(s.employeeId)?.uanNo ?? null;
          if (!uan) notes.push(`${base(s).name} has no UAN — add it in the HR profile before uploading`);
          rows.push({ uan, ...base(s), gross: dec(s.grossEarnings), epfWages: fromPaise(wages), epsWages: fromPaise(epsWages), ee: fromPaise(ee), eps: fromPaise(eps), er: fromPaise(er - eps), ncp: Math.round(Number(s.lopDays)) });
          const rs = (p: number) => String(Math.round(p / 100));
          if (uan) lines.push([uan, base(s).name.toUpperCase(), rs(pz(s.grossEarnings)), rs(wages), rs(epsWages), rs(epsWages), rs(ee), rs(eps), rs(er - eps), String(Math.round(Number(s.lopDays))), '0'].join('#~#'));
        }
        ecr = lines.join('\n');
        notes.push('ECR text file in the EPFO format (UAN#~#Name#~#Gross#~#EPF#~#EPS#~#EDLI wages#~#EE#~#EPS#~#ER#~#NCP days#~#Refund) — check it in the EPFO portal before submitting.');
      } else if (kind === 'esi') {
        columns = [{ key: 'esiNo', label: 'ESI number' }, { key: 'name', label: 'Name' }, { key: 'code', label: 'Code' }, { key: 'paidDays', label: 'Days paid' }, { key: 'wages', label: 'ESI wages', money: true }, { key: 'ee', label: 'Employee (0.75%)', money: true }, { key: 'er', label: 'Employer (3.25%)', money: true }, { key: 'total', label: 'Total', money: true }];
        for (const s of slips) {
          const ee = sum(s, 'DEDUCTION', 'ESI');
          const er = sum(s, 'EMPLOYER', 'ESI');
          if (!ee && !er) continue;
          const esiNo = details.get(s.employeeId)?.esiNo ?? null;
          if (!esiNo) notes.push(`${base(s).name} has no ESI number — add it in the HR profile`);
          rows.push({ esiNo, ...base(s), paidDays: Number(s.paidDays), wages: dec(s.esiWages), ee: fromPaise(ee), er: fromPaise(er), total: fromPaise(ee + er) });
        }
        if (rules.esi) notes.push(`ESI applies when the monthly gross is ₹${fromPaise(rules.esi.ceilingPaise)} or less.`);
      } else if (kind === 'pt') {
        columns = [{ key: 'name', label: 'Name' }, { key: 'code', label: 'Code' }, { key: 'gross', label: 'Gross for the month', money: true }, { key: 'pt', label: 'Professional tax', money: true }];
        rows = slips.map((s) => ({ ...base(s), gross: dec(s.grossEarnings), pt: fromPaise(sum(s, 'DEDUCTION', 'PT')) }));
        notes.push('Karnataka professional tax: ₹200 a month from ₹25,000 gross, ₹300 in February (check the current rates).');
      } else {
        columns = [{ key: 'name', label: 'Name' }, { key: 'code', label: 'Code' }, { key: 'pan', label: 'PAN' }, { key: 'taxable', label: 'Taxable this month', money: true }, { key: 'projected', label: 'Year taxable (projected)', money: true }, { key: 'yearTax', label: 'Year tax', money: true }, { key: 'tds', label: 'TDS this month', money: true }, { key: 'tdsYear', label: 'TDS this year so far', money: true }];
        for (const s of slips) {
          const taxable = s.items.filter((i) => i.itemType === 'EARNING' && ((i.componentId && comps.get(i.componentId)?.isTaxable) || (i.adjustmentId && adjs.get(i.adjustmentId)?.isTaxable))).reduce((t, i) => t + pz(i.amount), 0);
          const tds = sum(s, 'DEDUCTION', 'TDS');
          const ytd = await yearToDate(tx, s.employeeId, r.month, r.year);
          const pan = details.get(s.employeeId)?.panLast4 ?? null;
          if (!pan && pz(s.taxYear) > 0) notes.push(`${base(s).name} has no PAN on record — tax must then be deducted at 20% (section 206AA); add the PAN in the HR profile`);
          rows.push({ ...base(s), pan: pan ? `••••${pan}` : null, taxable: fromPaise(taxable), projected: dec(s.taxableYearProjected), yearTax: dec(s.taxYear), tds: fromPaise(tds), tdsYear: fromPaise(ytd.tdsPaise + tds) });
        }
        notes.push('New tax regime: ₹75,000 standard deduction, no tax up to ₹12 lakh taxable (with marginal relief above it), 4% cess. The year’s tax is spread over the months left, less tax already deducted.');
      }
      const totals: Record<string, string> = {};
      for (const c of columns.filter((x) => x.money)) totals[c.key] = fromPaise(rows.reduce((t, row) => t + pz(row[c.key] as string | null), 0));
      if (kind !== 'register') await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: r.campusId, action: 'EXPORT', entityType: 'PAYROLL_RUN', entityId: r.id, newValues: { statement: kind, rows: rows.length } }, client);
      return { runNo: r.runNo, label: monthName(r.month, r.year), status: r.status, kind, columns, rows, totals, ecr, notes: [...new Set(notes)] };
    });
  }

  // ───────────── Final settlement worksheet ─────────────

  settlement(exitId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const x = await tx.employeeExit.findUnique({ where: { id: exitId } });
      if (!x) throw NotFound('Exit');
      const e = await tx.employee.findUniqueOrThrow({ where: { id: x.employeeId } });
      if (!(this.can(auth, PERMISSIONS.HR_EXIT, e.campusId) || this.can(auth, PERMISSIONS.PAYROLL_SALARY_READ, e.campusId))) throw NotFound('Exit');
      await ensurePayroll(tx, auth.tenantId!);
      const last = x.lastWorkingDate;
      const m = last.getUTCMonth() + 1;
      const y = last.getUTCFullYear();
      const a = await tx.employeeSalary.findFirst({ where: { employeeId: e.id, effectiveFrom: { lte: last } }, orderBy: { effectiveFrom: 'desc' } });
      const lines: { label: string; amount: string; sign: 1 | -1; note?: string }[] = [];
      let total = 0;
      const notes: string[] = [];
      if (!a) notes.push('No salary is set for this person, so only leave and loans are shown.');
      let daily = 0;
      if (a) {
        const parts = await salaryParts(tx, a);
        const md = monthDaysOf(m, y);
        const rules = await rulesOn(tx, monthEnd(m, y));
        try {
          const full = calculateSalary({ ...parts, grossPaise: pz(a.monthlyGross), monthDays: md, paidDays: md, month: m, pf: a.pfApplicable, esi: a.esiApplicable, pt: a.ptApplicable, tdsOverridePaise: a.tdsMonthlyOverride == null ? null : pz(a.tdsMonthlyOverride), rules, adjustments: [], loans: [], ytd: { taxablePaise: 0, tdsPaise: 0 } });
          daily = full.items.filter((i) => i.itemType === 'EARNING' && ['BASIC', 'DA'].includes(i.code)).reduce((t, i) => t + i.amountPaise, 0) / 30;
          const inRun = await tx.payslip.findFirst({ where: { employeeId: e.id, run: { month: m, year: y, status: { not: 'CANCELLED' } } }, include: { run: { select: { runNo: true, status: true } } } });
          if (inRun) notes.push(`${monthName(m, y)} salary is in payroll run ${inRun.run.runNo} (${inRun.run.status.toLowerCase().replace('_', ' ')}).`);
          else {
            const days = await payDays(tx, e, m, y, last);
            const res = calculateSalary({ ...parts, grossPaise: pz(a.monthlyGross), monthDays: days.monthDays, paidDays: days.paidDays, month: m, pf: a.pfApplicable, esi: a.esiApplicable, pt: a.ptApplicable, tdsOverridePaise: a.tdsMonthlyOverride == null ? null : pz(a.tdsMonthlyOverride), rules, adjustments: [], loans: [], ytd: await yearToDate(tx, e.id, m, y) });
            lines.push({ label: `Salary for ${days.paidDays} day(s) of ${monthName(m, y)} (after PF, PT, TDS)`, amount: fromPaise(res.netPaise), sign: 1 });
            total += res.netPaise;
          }
        } catch (err) {
          if (err instanceof SalaryCalcError) notes.push(err.message); else throw err;
        }
      }
      const el = await tx.leaveType.findFirst({ where: { appliesTo: 'EMPLOYEE', code: 'EL', status: 'ACTIVE' } });
      const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true, name: true } });
      if (el && year) {
        const bal = await staffLeaveBalance(tx, e.id, el, year.id);
        const left = Math.max(0, bal.left ?? 0);
        const p = Math.round((left * daily) / 100) * 100;
        lines.push({ label: `${el.name}: ${left} day(s) left in ${year.name}`, amount: fromPaise(p), sign: 1, note: daily ? `at (basic + DA) ÷ 30 = ₹${fromPaise(Math.round(daily))} a day` : 'no daily rate without a salary' });
        total += p;
      }
      const loans = await tx.employeeLoan.findMany({ where: { employeeId: e.id, status: 'ACTIVE' } });
      for (const l of loans) {
        const owed = pz(l.amount) - pz(l.recovered);
        if (owed <= 0) continue;
        lines.push({ label: `${l.loanNo} · ${LOAN_TEXT[l.loanType]} still owed`, amount: fromPaise(owed), sign: -1 });
        total -= owed;
      }
      const dues = await tx.exitClearance.findMany({ where: { exitId: x.id, dueAmount: { gt: 0 } } });
      for (const d of dues) { lines.push({ label: `No-dues: ${d.section.toLowerCase()} dues`, amount: dec(d.dueAmount), sign: -1 }); total -= pz(d.dueAmount); }
      notes.push('Gratuity, notice-period pay and bonus are not included — add them by hand if they apply.');
      return { exitId: x.id, employee: personName(e), lastWorkingDate: isoDay(last), lines, total: fromPaise(total), notes, monthlyGross: a ? num(a.monthlyGross) : null };
    });
  }
}
