import { Injectable } from '@nestjs/common';
import { CalcResult, PERMISSIONS, SalaryAssignInput, SalaryCalcError, SalaryComponentInput, SalaryStructureInput, StatutoryRuleInput, TaxOpeningInput, calculateSalary, fromPaise, fyOfMonth } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { ledgerAccounts, unprocessable, dec } from '../accounts/books';
import { ensurePayroll, isoDay, monthDaysOf, monthEnd, num, personName, pz, rulesOn, salaryParts, toCalcComponent, yearToDate } from './payroll-books';

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const todayIst = () => new Date(Date.now() + 330 * 60_000);
const LEFT = ['RESIGNED', 'TERMINATED'];

/** Shape of a calculated breakdown for the screens. */
export const breakdown = (r: CalcResult) => ({
  items: r.items.map((i) => ({ itemType: i.itemType, code: i.code, name: i.name, amount: fromPaise(i.amountPaise) })),
  gross: fromPaise(r.grossPaise), deductions: fromPaise(r.deductionsPaise), employer: fromPaise(r.employerPaise), net: fromPaise(r.netPaise),
  ctcMonthly: fromPaise(r.grossPaise + r.employerPaise), ctcYearly: fromPaise((r.grossPaise + r.employerPaise) * 12), taxYear: fromPaise(r.taxYearPaise),
});

/**
 * Salary set-up (M15.1, M15.2): components, structures, statutory rules and each person's salary
 * (one open salary per person; a revision closes the previous one the day before). Starter components,
 * a "Standard salary" structure and statutory rules are added on first use (pre-filled, "please check").
 */
@Injectable()
export class PayrollSetupService {
  constructor(private readonly db: Db, private readonly audit: AuditService) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  // ───────────── Components ─────────────

  components(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await ensurePayroll(tx, auth.tenantId!);
      const rows = await tx.salaryComponent.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
      const accts = new Map((await tx.account.findMany({ where: { id: { in: rows.flatMap((r) => [r.accountId, r.liabilityAccountId]).filter((x): x is string => !!x) } }, select: { id: true, code: true, name: true } })).map((a) => [a.id, `${a.code} · ${a.name}`]));
      return rows.map((r) => ({ ...toCalcComponent(r), accountId: r.accountId, account: r.accountId ? accts.get(r.accountId) ?? null : null, liabilityAccount: r.liabilityAccountId ? accts.get(r.liabilityAccountId) ?? null : null, isSystem: r.isSystem, isActive: r.isActive }));
    });
  }

  saveComponent(id: string | null, input: SalaryComponentInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const chart = await ensurePayroll(tx, auth.tenantId!);
      const old = id ? await tx.salaryComponent.findUnique({ where: { id } }) : null;
      if (id && !old) throw NotFound('Component');
      if (old?.isSystem && (old.code !== input.code || old.componentType !== input.componentType || old.calcType !== input.calcType || (old.statutoryKind ?? null) !== (input.statutoryKind ?? null)))
        throw Conflict('system-component', `${old.name} is built in: only its name, account, flags and order can change`);
      if (!old?.isSystem && input.calcType === 'STATUTORY') throw unprocessable('statutory-builtin', 'PF, ESI, PT, TDS and loan recovery are built in — add your own components as fixed, % or formula', 'calcType');
      if (input.calcType === 'BALANCE') {
        const other = await tx.salaryComponent.findFirst({ where: { calcType: 'BALANCE', isActive: true, ...(id ? { id: { not: id } } : {}) }, select: { name: true } });
        if (other) throw Conflict('one-balance', `${other.name} already takes the balance of gross`);
      }
      let accountId = input.accountId ?? null;
      if (!accountId && input.componentType === 'EARNING') accountId = chart.get('EXP_SALARY')!;
      if (!accountId) throw unprocessable('account-required', 'Choose the account this deduction is credited to', 'accountId');
      const acct = (await ledgerAccounts(tx, [accountId])).get(accountId)!;
      if (input.componentType === 'EARNING' && acct.accountType !== 'EXPENSE') throw unprocessable('account-type', 'An earning posts to an expense account', 'accountId');
      if (input.componentType === 'DEDUCTION' && !['LIABILITY', 'ASSET', 'INCOME'].includes(acct.accountType)) throw unprocessable('account-type', 'A deduction is credited to a liability, asset or income account', 'accountId');
      const data = {
        name: input.name, isTaxable: input.isTaxable, affectedByLop: input.affectedByLop, isPfWage: input.componentType === 'EARNING' && input.isPfWage, accountId, sortOrder: input.sortOrder, isActive: input.isActive,
        formula: input.calcType === 'FORMULA' ? input.formula ?? null : null,
      };
      const dup = await tx.salaryComponent.findFirst({ where: { code: input.code, ...(id ? { id: { not: id } } : {}) }, select: { id: true } });
      if (dup) throw Conflict('duplicate-code', `The code ${input.code} is already used`);
      const row = old
        ? await tx.salaryComponent.update({ where: { id: old.id }, data })
        : await tx.salaryComponent.create({ data: { ...data, tenantId: auth.tenantId!, code: input.code, componentType: input.componentType, calcType: input.calcType, statutoryKind: null } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: old ? 'UPDATE' : 'CREATE', entityType: 'SALARY_COMPONENT', entityId: row.id, oldValues: old ?? undefined, newValues: row }, client);
      return { id: row.id };
    });
  }

  // ───────────── Structures ─────────────

  structures(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await ensurePayroll(tx, auth.tenantId!);
      const rows = await tx.salaryStructure.findMany({ orderBy: { name: 'asc' }, include: { items: true } });
      const comps = new Map((await tx.salaryComponent.findMany()).map((c) => [c.id, c]));
      const used = await tx.employeeSalary.groupBy({ by: ['structureId'], where: { effectiveTo: null }, _count: { _all: true } });
      const desig = new Map((await tx.designation.findMany({ select: { id: true, name: true } })).map((d) => [d.id, d.name]));
      return rows.map((s) => ({
        id: s.id, name: s.name, designationId: s.designationId, designation: s.designationId ? desig.get(s.designationId) ?? null : null, isActive: s.isActive,
        staff: used.find((u) => u.structureId === s.id)?._count._all ?? 0,
        items: s.items.map((i) => { const c = comps.get(i.componentId)!; return { componentId: i.componentId, code: c.code, name: c.name, componentType: c.componentType, calcType: c.calcType, value: num(i.value), sortOrder: c.sortOrder }; }).sort((a, b) => a.sortOrder - b.sortOrder),
      }));
    });
  }

  saveStructure(id: string | null, input: SalaryStructureInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await ensurePayroll(tx, auth.tenantId!);
      const old = id ? await tx.salaryStructure.findUnique({ where: { id }, include: { items: true } }) : null;
      if (id && !old) throw NotFound('Salary structure');
      const ids = [...new Set(input.items.map((i) => i.componentId))];
      if (ids.length !== input.items.length) throw unprocessable('duplicate-component', 'A component is listed twice', 'items');
      const comps = await tx.salaryComponent.findMany({ where: { id: { in: ids } } });
      if (comps.length !== ids.length) throw NotFound('Component');
      for (const c of comps) {
        const v = input.items.find((i) => i.componentId === c.id)!.value ?? null;
        if (!c.isActive) throw unprocessable('component-inactive', `${c.name} is no longer in use`, 'items');
        if (['FIXED', 'PERCENT_OF_BASIC', 'PERCENT_OF_GROSS'].includes(c.calcType) && v == null) throw unprocessable('value-required', `Enter the ${c.calcType === 'FIXED' ? 'amount' : '%'} for ${c.name}`, 'items');
        if (c.calcType.startsWith('PERCENT') && v != null && v > 100) throw unprocessable('percent', `${c.name}: a % is 0 to 100`, 'items');
        if (c.statutoryKind === 'LOAN') throw unprocessable('loan-auto', 'Loan recovery is added automatically', 'items');
      }
      if (!comps.some((c) => c.componentType === 'EARNING')) throw unprocessable('no-earning', 'A structure needs at least one earning', 'items');
      if (comps.filter((c) => c.calcType === 'BALANCE').length > 1) throw unprocessable('one-balance', 'Only one component can take the balance of gross', 'items');
      if (comps.some((c) => c.calcType === 'PERCENT_OF_BASIC') && !comps.some((c) => c.code === 'BASIC')) throw unprocessable('needs-basic', 'A % of basic needs Basic pay in the structure', 'items');
      if (input.designationId && !(await tx.designation.findUnique({ where: { id: input.designationId }, select: { id: true } }))) throw NotFound('Designation');
      const dup = await tx.salaryStructure.findFirst({ where: { name: input.name, ...(id ? { id: { not: id } } : {}) }, select: { id: true } });
      if (dup) throw Conflict('duplicate-name', `A structure called ${input.name} already exists`);
      const s = old
        ? await tx.salaryStructure.update({ where: { id: old.id }, data: { name: input.name, designationId: input.designationId ?? null, isActive: input.isActive } })
        : await tx.salaryStructure.create({ data: { tenantId: auth.tenantId!, name: input.name, designationId: input.designationId ?? null, isActive: input.isActive, createdBy: auth.userId } });
      if (old) await tx.salaryStructureItem.deleteMany({ where: { structureId: s.id } });
      await tx.salaryStructureItem.createMany({ data: input.items.map((i) => ({ tenantId: auth.tenantId!, structureId: s.id, componentId: i.componentId, value: i.value ?? null })) });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: old ? 'UPDATE' : 'CREATE', entityType: 'SALARY_STRUCTURE', entityId: s.id, oldValues: old ?? undefined, newValues: { ...s, items: input.items } }, client);
      return { id: s.id };
    });
  }

  // ───────────── Statutory rules ─────────────

  rules(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await ensurePayroll(tx, auth.tenantId!);
      const rows = await tx.statutoryRule.findMany({ orderBy: [{ ruleType: 'asc' }, { effectiveFrom: 'desc' }, { slabFrom: 'asc' }, { onlyMonth: 'asc' }] });
      const today = todayIst();
      return rows.map((r) => ({
        id: r.id, ruleType: r.ruleType, stateCode: r.stateCode, slabFrom: dec(r.slabFrom) ?? null, slabTo: dec(r.slabTo) ?? null, employeeRate: num(r.employeeRate), employerRate: num(r.employerRate),
        fixedAmount: dec(r.fixedAmount) ?? null, wageCeiling: dec(r.wageCeiling) ?? null, onlyMonth: r.onlyMonth, effectiveFrom: isoDay(r.effectiveFrom), effectiveTo: r.effectiveTo ? isoDay(r.effectiveTo) : null, notes: r.notes,
        inForce: r.effectiveFrom <= today && (!r.effectiveTo || r.effectiveTo >= today),
      }));
    });
  }

  saveRule(id: string | null, input: StatutoryRuleInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await ensurePayroll(tx, auth.tenantId!);
      const old = id ? await tx.statutoryRule.findUnique({ where: { id } }) : null;
      if (id && !old) throw NotFound('Rule');
      if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) throw unprocessable('dates', 'The end date is before the start', 'effectiveTo');
      const need: Record<string, (keyof StatutoryRuleInput)[]> = { PF: ['employeeRate', 'employerRate'], ESI: ['employeeRate', 'employerRate', 'wageCeiling'], PT: ['slabFrom', 'fixedAmount'], TDS: ['slabFrom', 'employeeRate'], TDS_STD_DEDUCTION: ['fixedAmount'], TDS_REBATE: ['wageCeiling'], TDS_CESS: ['employeeRate'] };
      for (const f of need[input.ruleType]) if (input[f] == null) throw unprocessable('value-required', 'Fill in the highlighted value', f);
      const data = {
        ruleType: input.ruleType, stateCode: input.ruleType === 'PT' ? input.stateCode ?? '29' : null, slabFrom: input.slabFrom ?? null, slabTo: input.slabTo ?? null, employeeRate: input.employeeRate ?? null, employerRate: input.employerRate ?? null,
        fixedAmount: input.fixedAmount ?? null, wageCeiling: input.wageCeiling ?? null, onlyMonth: input.onlyMonth ?? null, effectiveFrom: day(input.effectiveFrom), effectiveTo: input.effectiveTo ? day(input.effectiveTo) : null, notes: input.notes ?? null,
      };
      const row = old ? await tx.statutoryRule.update({ where: { id: old.id }, data }) : await tx.statutoryRule.create({ data: { ...data, tenantId: auth.tenantId! } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: old ? 'UPDATE' : 'CREATE', entityType: 'STATUTORY_RULE', entityId: row.id, oldValues: old ?? undefined, newValues: row }, client);
      return { id: row.id };
    });
  }

  // ───────────── Staff salaries ─────────────

  private scope(auth: AuthContext, manage: boolean) {
    return scopeFor(auth, manage ? PERMISSIONS.PAYROLL_SALARY : PERMISSIONS.PAYROLL_SALARY_READ);
  }
  private async staff(tx: Tx, employeeId: string, auth: AuthContext, manage: boolean) {
    const e = await tx.employee.findUnique({ where: { id: employeeId } });
    const s = this.scope(auth, manage);
    if (!e || !s || !canAccessCampus(s, e.campusId)) throw NotFound('Staff member');
    return e;
  }

  salaries(auth: AuthContext, campusId?: string) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await ensurePayroll(tx, auth.tenantId!);
      const s = this.scope(auth, false)!;
      const staff = await tx.employee.findMany({
        where: { status: { notIn: LEFT }, ...(campusId ? { campusId } : {}), ...(s.all ? {} : { campusId: campusId && s.campusIds.includes(campusId) ? campusId : { in: s.campusIds } }) },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }], select: { id: true, firstName: true, lastName: true, employeeCode: true, designation: true, campusId: true },
      });
      const open = await tx.employeeSalary.findMany({ where: { effectiveTo: null, employeeId: { in: staff.map((x) => x.id) } } });
      const structs = new Map((await tx.salaryStructure.findMany({ select: { id: true, name: true } })).map((x) => [x.id, x.name]));
      const loans = await tx.employeeLoan.findMany({ where: { status: 'ACTIVE', employeeId: { in: staff.map((x) => x.id) } }, select: { employeeId: true, amount: true, recovered: true } });
      return staff.map((e) => {
        const a = open.find((o) => o.employeeId === e.id);
        const owed = loans.filter((l) => l.employeeId === e.id).reduce((t, l) => t + pz(l.amount) - pz(l.recovered), 0);
        return {
          employeeId: e.id, name: personName(e), code: e.employeeCode, designation: e.designation, campusId: e.campusId,
          salary: a ? { id: a.id, structure: structs.get(a.structureId) ?? '', monthlyGross: dec(a.monthlyGross), effectiveFrom: isoDay(a.effectiveFrom), pf: a.pfApplicable, esi: a.esiApplicable, pt: a.ptApplicable, tdsOverride: dec(a.tdsMonthlyOverride) ?? null } : null,
          loanOwed: owed ? fromPaise(owed) : null,
        };
      });
    });
  }

  salary(employeeId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await ensurePayroll(tx, auth.tenantId!);
      const e = await this.staff(tx, employeeId, auth, false);
      const rows = await tx.employeeSalary.findMany({ where: { employeeId }, orderBy: { effectiveFrom: 'desc' }, include: { overrides: true } });
      const structs = new Map((await tx.salaryStructure.findMany({ select: { id: true, name: true } })).map((x) => [x.id, x.name]));
      const users = new Map((await tx.user.findMany({ where: { id: { in: rows.map((r) => r.createdBy) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
      const open = rows.find((r) => !r.effectiveTo);
      let preview: ReturnType<typeof breakdown> | null = null;
      let previewError: string | null = null;
      if (open) {
        try { preview = await this.calcFull(tx, open, e.id); } catch (err) { if (err instanceof SalaryCalcError) previewError = err.message; else throw err; }
      }
      return {
        employee: { id: e.id, name: personName(e), code: e.employeeCode, designation: e.designation, campusId: e.campusId, joiningDate: isoDay(e.joiningDate), status: e.status },
        history: rows.map((r) => ({
          id: r.id, structureId: r.structureId, structure: structs.get(r.structureId) ?? '', monthlyGross: dec(r.monthlyGross), effectiveFrom: isoDay(r.effectiveFrom), effectiveTo: r.effectiveTo ? isoDay(r.effectiveTo) : null,
          pf: r.pfApplicable, esi: r.esiApplicable, pt: r.ptApplicable, tdsOverride: dec(r.tdsMonthlyOverride) ?? null, remarks: r.remarks, by: users.get(r.createdBy) ?? null,
          overrides: r.overrides.map((o) => ({ componentId: o.componentId, value: num(o.value) })),
        })),
        preview, previewError,
        opening: await this.openingOf(tx, e.id),
      };
    });
  }

  /** A full month (no loss of pay) for a salary as it would be paid this month. */
  private async calcFull(tx: Tx, a: { id: string; structureId: string; monthlyGross: { toString(): string }; pfApplicable: boolean; esiApplicable: boolean; ptApplicable: boolean; tdsMonthlyOverride: { toString(): string } | null }, employeeId: string | null, parts?: Awaited<ReturnType<typeof salaryParts>>) {
    const now = todayIst();
    const m = now.getUTCMonth() + 1;
    const y = now.getUTCFullYear();
    const p = parts ?? (await salaryParts(tx, a));
    const days = monthDaysOf(m, y);
    const r = calculateSalary({
      ...p, grossPaise: pz(a.monthlyGross), monthDays: days, paidDays: days, month: m, pf: a.pfApplicable, esi: a.esiApplicable, pt: a.ptApplicable,
      tdsOverridePaise: a.tdsMonthlyOverride == null ? null : pz(a.tdsMonthlyOverride), rules: await rulesOn(tx, monthEnd(m, y)), adjustments: [], loans: [],
      ytd: employeeId ? await yearToDate(tx, employeeId, m, y) : { taxablePaise: 0, tdsPaise: 0 },
    });
    return breakdown(r);
  }

  private async partsFor(tx: Tx, input: SalaryAssignInput) {
    const st = await tx.salaryStructure.findUnique({ where: { id: input.structureId } });
    if (!st || !st.isActive) throw NotFound('Salary structure');
    const base = await salaryParts(tx, { id: '00000000-0000-0000-0000-000000000000', structureId: st.id });
    for (const o of input.overrides) {
      const c = base.components.find((x) => x.id === o.componentId);
      if (!c || !(o.componentId in base.values)) throw unprocessable('not-in-structure', 'A personal value is for a component that is not in the structure', 'overrides');
      if (c.calcType === 'STATUTORY' || c.calcType === 'BALANCE' || c.calcType === 'FORMULA') throw unprocessable('not-overridable', `${c.name} is worked out — it cannot take a personal value`, 'overrides');
      if (c.calcType.startsWith('PERCENT') && o.value > 100) throw unprocessable('percent', `${c.name}: a % is 0 to 100`, 'overrides');
      base.values[o.componentId] = o.value;
    }
    return base;
  }

  preview(input: SalaryAssignInput, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await ensurePayroll(tx, auth.tenantId!);
      await this.staff(tx, input.employeeId, auth, true);
      const parts = await this.partsFor(tx, input);
      try {
        return await this.calcFull(tx, { id: '', structureId: input.structureId, monthlyGross: input.monthlyGross, pfApplicable: input.pfApplicable, esiApplicable: input.esiApplicable, ptApplicable: input.ptApplicable, tdsMonthlyOverride: input.tdsMonthlyOverride ?? null }, input.employeeId, parts);
      } catch (e) {
        if (e instanceof SalaryCalcError) throw unprocessable('salary-calc', e.message, 'monthlyGross');
        throw e;
      }
    });
  }

  assign(input: SalaryAssignInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await ensurePayroll(tx, auth.tenantId!);
      await tx.$queryRaw`SELECT id FROM employees WHERE id = ${input.employeeId}::uuid FOR UPDATE`;
      const e = await this.staff(tx, input.employeeId, auth, true);
      if (LEFT.includes(e.status)) throw Conflict('staff-left', `${personName(e)} has left`);
      if (input.effectiveFrom < isoDay(e.joiningDate)) throw unprocessable('before-joining', `${personName(e)} joined on ${isoDay(e.joiningDate)}`, 'effectiveFrom');
      const parts = await this.partsFor(tx, input);
      try {
        await this.calcFull(tx, { id: '', structureId: input.structureId, monthlyGross: input.monthlyGross, pfApplicable: input.pfApplicable, esiApplicable: input.esiApplicable, ptApplicable: input.ptApplicable, tdsMonthlyOverride: input.tdsMonthlyOverride ?? null }, null, parts);
      } catch (err) {
        if (err instanceof SalaryCalcError) throw unprocessable('salary-calc', err.message, 'monthlyGross');
        throw err;
      }
      const prev = await tx.employeeSalary.findFirst({ where: { employeeId: e.id, effectiveTo: null } });
      if (prev) {
        if (isoDay(prev.effectiveFrom) >= input.effectiveFrom) throw Conflict('revision-date', `The current salary starts on ${isoDay(prev.effectiveFrom)} — a revision must start after it`);
        await tx.employeeSalary.update({ where: { id: prev.id }, data: { effectiveTo: new Date(day(input.effectiveFrom).getTime() - 86_400_000) } });
      }
      const row = await tx.employeeSalary.create({
        data: {
          tenantId: auth.tenantId!, employeeId: e.id, structureId: input.structureId, monthlyGross: input.monthlyGross, effectiveFrom: day(input.effectiveFrom), pfApplicable: input.pfApplicable, esiApplicable: input.esiApplicable,
          ptApplicable: input.ptApplicable, tdsMonthlyOverride: input.tdsMonthlyOverride ?? null, remarks: input.remarks ?? null, createdBy: auth.userId,
        },
      });
      if (input.overrides.length) await tx.employeeSalaryComponent.createMany({ data: input.overrides.map((o) => ({ tenantId: auth.tenantId!, assignmentId: row.id, componentId: o.componentId, value: o.value })) });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: e.campusId, action: 'CREATE', entityType: 'EMPLOYEE_SALARY', entityId: row.id, oldValues: prev ? { monthlyGross: dec(prev.monthlyGross), effectiveFrom: isoDay(prev.effectiveFrom) } : undefined, newValues: { employee: personName(e), monthlyGross: input.monthlyGross, effectiveFrom: input.effectiveFrom, revision: !!prev } }, client);
      return { id: row.id, revision: !!prev };
    });
  }

  private async openingOf(tx: Tx, employeeId: string) {
    const now = todayIst();
    const fy = fyOfMonth(now.getUTCMonth() + 1, now.getUTCFullYear());
    const o = await tx.payrollTaxOpening.findFirst({ where: { employeeId, fyLabel: fy } });
    return { fy, taxablePaid: o ? dec(o.taxablePaid) : null, tdsDeducted: o ? dec(o.tdsDeducted) : null, remarks: o?.remarks ?? null };
  }

  /** Salary and tax paid earlier in the financial year, before payroll in EduERP (used for income tax). */
  saveOpening(employeeId: string, input: TaxOpeningInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await this.staff(tx, employeeId, auth, true);
      const old = await tx.payrollTaxOpening.findFirst({ where: { employeeId: e.id, fyLabel: input.fy } });
      const data = { taxablePaid: input.taxablePaid, tdsDeducted: input.tdsDeducted, remarks: input.remarks ?? null, updatedBy: auth.userId };
      const row = old ? await tx.payrollTaxOpening.update({ where: { id: old.id }, data }) : await tx.payrollTaxOpening.create({ data: { ...data, tenantId: auth.tenantId!, employeeId: e.id, fyLabel: input.fy } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: e.campusId, action: old ? 'UPDATE' : 'CREATE', entityType: 'PAYROLL_TAX_OPENING', entityId: row.id, oldValues: old ? { taxablePaid: dec(old.taxablePaid), tdsDeducted: dec(old.tdsDeducted) } : undefined, newValues: { employee: personName(e), fy: input.fy, taxablePaid: input.taxablePaid, tdsDeducted: input.tdsDeducted } }, client);
      return { id: row.id };
    });
  }

  /** Ledger accounts a component can post to (for the set-up screen). */
  accounts(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await ensurePayroll(tx, auth.tenantId!);
      const rows = await tx.account.findMany({ where: { isGroup: false, isActive: true, accountType: { in: ['EXPENSE', 'LIABILITY', 'ASSET', 'INCOME'] } }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true, accountType: true } });
      return rows.map((r) => ({ ...r, isGroup: false }));
    });
  }

  /** Bank accounts salaries and loans can be paid from. */
  bankAccounts(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.bankAccount.findMany({ where: { isActive: true }, orderBy: { bankName: 'asc' } });
      return rows.map((b) => ({ id: b.id, label: `${b.bankName} ••${b.accountNoLast4}`, campusId: b.campusId ?? null }));
    });
  }
}

