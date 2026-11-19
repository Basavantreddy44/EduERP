import { CalcComponent, CalcRules, PAYROLL_CHART, fyOfMonth, STARTER_COMPONENTS, STARTER_STATUTORY_RULES, StarterAccount, toPaise } from '@eduerp/shared';
import { Tx } from '../../common/prisma.service';
import { ensureAccountsChart } from '../accounts/books';

/** Shared helpers of payroll (Phase 15). */

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (m: number, y: number) => `${MONTHS[m - 1]} ${y}`;
export const monthDaysOf = (m: number, y: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const monthStart = (m: number, y: number) => new Date(Date.UTC(y, m - 1, 1));
export const monthEnd = (m: number, y: number) => new Date(Date.UTC(y, m, 0));
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const num = (d: { toString(): string } | null | undefined) => (d == null ? null : Number(d.toString()));
export const pz = (d: { toString(): string } | null | undefined) => (d == null ? 0 : toPaise(d.toString()));
export const personName = (e: { firstName: string; lastName: string | null }) => `${e.firstName} ${e.lastName ?? ''}`.trim();
/** Month index for comparisons (year * 12 + month). */
export const mIdx = (m: number, y: number) => y * 12 + m;
/** First month index of the financial year containing (m, y). */
export const fyStartIdx = (m: number, y: number) => mIdx(4, m >= 4 ? y : y - 1);

/** The accounts chart plus payroll's accounts (idempotent; safe under concurrency). */
export async function ensurePayrollChart(tx: Tx, tenantId: string): Promise<Map<string, string>> {
  const byKey = await ensureAccountsChart(tx, tenantId);
  if (PAYROLL_CHART.every((a) => byKey.has(a.key))) return byKey;
  for (const a of PAYROLL_CHART as StarterAccount[]) {
    if (byKey.has(a.key)) continue;
    const parentId = a.parent ? byKey.get(a.parent) ?? null : null;
    await tx.$executeRaw`
      INSERT INTO accounts (id, tenant_id, code, name, account_type, parent_id, is_group, is_system, system_key, created_at, updated_at)
      VALUES (gen_random_uuid(), ${tenantId}::uuid, ${a.code}, ${a.name}, ${a.type}, ${parentId}::uuid, false, true, ${a.key}, now(), now())
      ON CONFLICT DO NOTHING`;
    const row = await tx.account.findFirst({ where: { OR: [{ systemKey: a.key }, { code: a.code }] }, select: { id: true } });
    if (row) byKey.set(a.key, row.id);
  }
  return byKey;
}

/** Starter components, a "Standard salary" structure and statutory rules — only what the institution does not have yet. */
export async function ensurePayroll(tx: Tx, tenantId: string) {
  const chart = await ensurePayrollChart(tx, tenantId);
  if (!(await tx.salaryComponent.count())) {
    await tx.salaryComponent.createMany({
      skipDuplicates: true,
      data: STARTER_COMPONENTS.map((c) => ({
        tenantId, code: c.code, name: c.name, componentType: c.componentType, calcType: c.calcType, statutoryKind: c.statutoryKind ?? null, isTaxable: c.isTaxable, affectedByLop: c.affectedByLop, isPfWage: c.isPfWage,
        accountId: chart.get(c.account) ?? null, liabilityAccountId: c.liability ? chart.get(c.liability) ?? null : null, sortOrder: c.sortOrder, isSystem: true,
      })),
    });
  }
  if (!(await tx.statutoryRule.count())) {
    await tx.statutoryRule.createMany({
      data: STARTER_STATUTORY_RULES.map((r) => ({
        tenantId, ruleType: r.ruleType, stateCode: r.stateCode ?? null, slabFrom: r.slabFrom ?? null, slabTo: r.slabTo ?? null, employeeRate: r.employeeRate ?? null, employerRate: r.employerRate ?? null,
        fixedAmount: r.fixedAmount ?? null, wageCeiling: r.wageCeiling ?? null, onlyMonth: r.onlyMonth ?? null, effectiveFrom: new Date(`${r.effectiveFrom}T00:00:00Z`), notes: r.notes ?? null,
      })),
    });
  }
  if (!(await tx.salaryStructure.count())) {
    await tx.salaryStructure.createMany({ data: [{ tenantId, name: 'Standard salary' }], skipDuplicates: true });
    const s = await tx.salaryStructure.findFirst({ where: { name: 'Standard salary' } });
    const comps = await tx.salaryComponent.findMany({ where: { code: { in: STARTER_COMPONENTS.filter((c) => c.code !== 'LOAN').map((c) => c.code) } } });
    if (s) {
      await tx.salaryStructureItem.createMany({
        skipDuplicates: true,
        data: comps.map((c) => ({ tenantId, structureId: s.id, componentId: c.id, value: STARTER_COMPONENTS.find((x) => x.code === c.code)?.starterValue ?? null })),
      });
    }
  }
  return chart;
}

/** Statutory rules in force on a day (the latest effective row of each kind), shaped for the calculator. */
export async function rulesOn(tx: Tx, day: Date, stateCode = '29'): Promise<CalcRules> {
  const rows = await tx.statutoryRule.findMany({ where: { effectiveFrom: { lte: day }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }] }, orderBy: { effectiveFrom: 'desc' } });
  const latest = (t: string) => {
    const of = rows.filter((r) => r.ruleType === t);
    const top = of[0]?.effectiveFrom.getTime();
    return of.filter((r) => r.effectiveFrom.getTime() === top);
  };
  const pf = latest('PF')[0];
  const esi = latest('ESI')[0];
  const pt = latest('PT').filter((r) => !r.stateCode || r.stateCode === stateCode);
  const tds = latest('TDS');
  return {
    pf: pf ? { eeRate: num(pf.employeeRate) ?? 0, erRate: num(pf.employerRate) ?? 0, ceilingPaise: pf.wageCeiling == null ? null : pz(pf.wageCeiling) } : null,
    esi: esi && esi.wageCeiling != null ? { eeRate: num(esi.employeeRate) ?? 0, erRate: num(esi.employerRate) ?? 0, ceilingPaise: pz(esi.wageCeiling) } : null,
    pt: pt.map((r) => ({ fromPaise: pz(r.slabFrom), toPaise: r.slabTo == null ? null : pz(r.slabTo), amountPaise: pz(r.fixedAmount), onlyMonth: r.onlyMonth })),
    tds: {
      slabs: tds.map((r) => ({ fromPaise: pz(r.slabFrom), toPaise: r.slabTo == null ? null : pz(r.slabTo), rate: num(r.employeeRate) ?? 0 })).sort((a, b) => a.fromPaise - b.fromPaise),
      stdDeductionPaise: pz(latest('TDS_STD_DEDUCTION')[0]?.fixedAmount),
      rebateLimitPaise: pz(latest('TDS_REBATE')[0]?.wageCeiling),
      cessRate: num(latest('TDS_CESS')[0]?.employeeRate) ?? 0,
    },
  };
}

export const toCalcComponent = (c: { id: string; code: string; name: string; componentType: string; calcType: string; statutoryKind: string | null; formula: string | null; isTaxable: boolean; affectedByLop: boolean; isPfWage: boolean; sortOrder: number }): CalcComponent => ({
  id: c.id, code: c.code, name: c.name, componentType: c.componentType as CalcComponent['componentType'], calcType: c.calcType as CalcComponent['calcType'], statutoryKind: (c.statutoryKind as CalcComponent['statutoryKind']) ?? null,
  formula: c.formula, isTaxable: c.isTaxable, affectedByLop: c.affectedByLop, isPfWage: c.isPfWage, sortOrder: c.sortOrder,
});

/** The components and values of a salary: its structure's lines with personal values on top, plus loan recovery. */
export async function salaryParts(tx: Tx, a: { id: string; structureId: string }) {
  const items = await tx.salaryStructureItem.findMany({ where: { structureId: a.structureId } });
  const overrides = await tx.employeeSalaryComponent.findMany({ where: { assignmentId: a.id } });
  const ids = items.map((i) => i.componentId);
  const comps = await tx.salaryComponent.findMany({ where: { isActive: true, OR: [{ id: { in: ids } }, { statutoryKind: 'LOAN' }] } });
  const values: Record<string, number | null> = {};
  for (const i of items) values[i.componentId] = num(i.value);
  for (const o of overrides) values[o.componentId] = num(o.value);
  return { components: comps.map(toCalcComponent), values };
}

/**
 * Days of the month a person is paid for: days employed (joining / leaving / last working day) less loss of
 * pay — an absence counts 1, a half day ½, approved unpaid leave 1 (½ for a half-day leave). Approved paid
 * leave cancels an absence on the same day. Days with no attendance marked are paid.
 */
export async function payDays(tx: Tx, e: { id: string; joiningDate: Date; leftOn: Date | null }, m: number, y: number, lastDay: Date | null) {
  const start = monthStart(m, y);
  const end = monthEnd(m, y);
  const monthDays = monthDaysOf(m, y);
  const from = e.joiningDate > start ? e.joiningDate : start;
  let to = end;
  if (e.leftOn && e.leftOn < to) to = e.leftOn;
  if (lastDay && lastDay < to) to = lastDay;
  if (to < from) return { monthDays, employedDays: 0, lopDays: 0, paidDays: 0 };
  const employedDays = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const lop = new Map<string, number>();
  const att = await tx.staffAttendance.findMany({ where: { employeeId: e.id, attendanceDate: { gte: from, lte: to }, status: { in: ['ABSENT', 'HALF_DAY'] } }, select: { attendanceDate: true, status: true } });
  for (const a of att) lop.set(isoDay(a.attendanceDate), a.status === 'ABSENT' ? 1 : 0.5);
  const leave = await tx.leaveRequest.findMany({ where: { employeeId: e.id, status: 'APPROVED', fromDate: { lte: to }, toDate: { gte: from } }, include: { leaveType: { select: { isPaid: true } } } });
  for (const l of leave) {
    for (let d = new Date(Math.max(l.fromDate.getTime(), from.getTime())); d <= l.toDate && d <= to; d = new Date(d.getTime() + 86_400_000)) {
      const k = isoDay(d);
      if (l.leaveType.isPaid) { const left = l.halfDay ? Math.max(0, (lop.get(k) ?? 0) - 0.5) : 0; if (left) lop.set(k, left); else lop.delete(k); }
      else lop.set(k, Math.max(lop.get(k) ?? 0, l.halfDay ? 0.5 : 1));
    }
  }
  const lopDays = Math.min(employedDays, [...lop.values()].reduce((s, v) => s + v, 0));
  return { monthDays, employedDays, lopDays, paidDays: employedDays - lopDays };
}

/** Taxable salary and TDS already in approved runs of the same financial year, before this month. */
export async function yearToDate(tx: Tx, employeeId: string, m: number, y: number) {
  const fromIdx = fyStartIdx(m, y);
  const cur = mIdx(m, y);
  const rows = await tx.$queryRaw<{ taxable: string | null; tds: string | null }[]>`
    SELECT SUM(CASE WHEN i.item_type = 'EARNING' AND (c.is_taxable OR a.is_taxable) THEN i.amount END)::text AS taxable,
           SUM(CASE WHEN i.item_type = 'DEDUCTION' AND c.statutory_kind = 'TDS' THEN i.amount END)::text AS tds
      FROM payslip_items i
      JOIN payslips p ON p.id = i.payslip_id
      JOIN payroll_runs r ON r.id = p.run_id
      LEFT JOIN salary_components c ON c.id = i.component_id
      LEFT JOIN payroll_adjustments a ON a.id = i.adjustment_id
     WHERE p.employee_id = ${employeeId}::uuid AND r.status IN ('APPROVED', 'PAID')
       AND (r.year * 12 + r.month) >= ${fromIdx} AND (r.year * 12 + r.month) < ${cur}`;
  const opening = await tx.payrollTaxOpening.findFirst({ where: { employeeId, fyLabel: fyOfMonth(m, y) } });
  return { taxablePaise: pz(rows[0]?.taxable ?? null) + pz(opening?.taxablePaid), tdsPaise: pz(rows[0]?.tds ?? null) + pz(opening?.tdsDeducted) };
}
