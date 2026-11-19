import { z } from 'zod';
import type { StarterAccount } from './accounts';
import { fromPaise, money } from './fees';

/**
 * Phase 15: Payroll (B4 §3) — salary components and structures, staff salaries, statutory rules (PF, ESI,
 * Karnataka professional tax, new-regime income tax), monthly runs, payslips, loans.
 * The salary arithmetic below is pure (paise, whole rupees per line) so the API, tests and screens agree.
 */

const uuid = z.string().uuid();
const date = z.string().date();
const optText = (max: number) => z.string().trim().max(max).optional().nullable();

export const COMPONENT_TYPES = ['EARNING', 'DEDUCTION', 'EMPLOYER'] as const;
export const CALC_TYPES = ['FIXED', 'PERCENT_OF_BASIC', 'PERCENT_OF_GROSS', 'BALANCE', 'FORMULA', 'STATUTORY'] as const;
export const STATUTORY_KINDS = ['PF', 'ESI', 'PT', 'TDS', 'LOAN'] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];
export type CalcType = (typeof CALC_TYPES)[number];
export type StatutoryKind = (typeof STATUTORY_KINDS)[number];
export const RUN_STATUSES = ['DRAFT', 'CALCULATED', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'CANCELLED'] as const;
export const LOAN_TYPES = ['ADVANCE', 'LOAN'] as const;
export const LOAN_STATUSES = ['PENDING_APPROVAL', 'ACTIVE', 'CLOSED', 'REJECTED', 'CANCELLED'] as const;
export const PAYROLL_PAY_MODES = ['CASH', 'CHEQUE', 'NEFT', 'RTGS', 'UPI'] as const;
export const RULE_TYPES = ['PF', 'ESI', 'PT', 'TDS', 'TDS_STD_DEDUCTION', 'TDS_REBATE', 'TDS_CESS'] as const;

const pct = z.coerce.number().min(0, 'Enter 0 to 100').max(100, 'Enter 0 to 100');
const code = z.string().trim().toUpperCase().pipe(z.string().regex(/^[A-Z][A-Z0-9_]{0,19}$/, 'Capital letters, digits and _ (e.g. HRA)'));

// ───────────── M15.1 Salary set-up ─────────────

export const salaryComponentSchema = z
  .object({
    code,
    name: z.string().trim().min(2).max(100),
    componentType: z.enum(COMPONENT_TYPES),
    calcType: z.enum(CALC_TYPES),
    statutoryKind: z.enum(STATUTORY_KINDS).nullable().optional(),
    formula: optText(300),
    isTaxable: z.boolean().default(true),
    affectedByLop: z.boolean().default(true),
    isPfWage: z.boolean().default(false),
    accountId: uuid.nullable().optional(),
    sortOrder: z.coerce.number().int().min(0).max(999).default(0),
    isActive: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if ((v.calcType === 'STATUTORY') !== !!v.statutoryKind) ctx.addIssue({ code: 'custom', path: ['statutoryKind'], message: 'Choose PF, ESI, PT, TDS or loan only for a statutory component' });
    if (v.calcType === 'FORMULA') {
      if (!v.formula) ctx.addIssue({ code: 'custom', path: ['formula'], message: 'Enter the formula, e.g. BASIC * 0.4' });
      else {
        try { checkFormula(v.formula); } catch (e) { ctx.addIssue({ code: 'custom', path: ['formula'], message: (e as Error).message }); }
      }
    }
    if (v.calcType === 'BALANCE' && v.componentType !== 'EARNING') ctx.addIssue({ code: 'custom', path: ['calcType'], message: 'Only an earning can take the balance of gross' });
    if (v.componentType === 'EMPLOYER' && !['PF', 'ESI'].includes(v.statutoryKind ?? '')) ctx.addIssue({ code: 'custom', path: ['statutoryKind'], message: 'Employer contributions are PF or ESI' });
  });
export type SalaryComponentInput = z.infer<typeof salaryComponentSchema>;

export const salaryStructureSchema = z.object({
  name: z.string().trim().min(2).max(100),
  designationId: uuid.nullable().optional(),
  isActive: z.boolean().default(true),
  items: z.array(z.object({ componentId: uuid, value: z.union([z.coerce.number().min(0).max(99_999_999), z.null()]).optional() })).min(1, 'Add at least one component').max(40),
});
export type SalaryStructureInput = z.infer<typeof salaryStructureSchema>;

export const salaryAssignSchema = z.object({
  employeeId: uuid,
  structureId: uuid,
  monthlyGross: money.refine((v) => Number(v) > 0, 'Enter the monthly gross'),
  effectiveFrom: date,
  pfApplicable: z.boolean().default(true),
  esiApplicable: z.boolean().default(true),
  ptApplicable: z.boolean().default(true),
  tdsMonthlyOverride: money.nullable().optional(),
  overrides: z.array(z.object({ componentId: uuid, value: z.coerce.number().min(0).max(99_999_999) })).max(40).default([]),
  remarks: optText(300),
});
export type SalaryAssignInput = z.infer<typeof salaryAssignSchema>;

// ───────────── M15.2 Statutory rules ─────────────

export const statutoryRuleSchema = z.object({
  ruleType: z.enum(RULE_TYPES),
  stateCode: z.string().trim().regex(/^\d{2}$/).nullable().optional(),
  slabFrom: money.nullable().optional(),
  slabTo: money.nullable().optional(),
  employeeRate: pct.nullable().optional(),
  employerRate: pct.nullable().optional(),
  fixedAmount: money.nullable().optional(),
  wageCeiling: money.nullable().optional(),
  onlyMonth: z.coerce.number().int().min(1).max(12).nullable().optional(),
  effectiveFrom: date,
  effectiveTo: date.nullable().optional(),
  notes: optText(200),
});
export type StatutoryRuleInput = z.infer<typeof statutoryRuleSchema>;

// ───────────── M15.3 Runs ─────────────

export const payrollRunSchema = z.object({ campusId: uuid, month: z.coerce.number().int().min(1).max(12), year: z.coerce.number().int().min(2020).max(2100) });
export const payrollAdjustmentSchema = z.object({
  employeeId: uuid,
  itemType: z.enum(['EARNING', 'DEDUCTION']),
  label: z.string().trim().min(2).max(100),
  amount: money.refine((v) => Number(v) > 0, 'Enter an amount above zero'),
  isTaxable: z.boolean().default(true),
});
export type PayrollAdjustmentInput = z.infer<typeof payrollAdjustmentSchema>;
export const payrollPaySchema = z.object({ paidOn: date, bankAccountId: uuid });

// ───────────── M15.4 Loans ─────────────

export const employeeLoanSchema = z
  .object({
    employeeId: uuid,
    loanType: z.enum(LOAN_TYPES),
    amount: money.refine((v) => Number(v) > 0, 'Enter an amount above zero'),
    emiAmount: money.refine((v) => Number(v) > 0, 'Enter the monthly recovery'),
    startMonth: z.coerce.number().int().min(1).max(12),
    startYear: z.coerce.number().int().min(2020).max(2100),
    reason: z.string().trim().min(3).max(300),
    disbursedOn: date,
    mode: z.enum(PAYROLL_PAY_MODES),
    bankAccountId: uuid.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (Number(v.emiAmount) > Number(v.amount)) ctx.addIssue({ code: 'custom', path: ['emiAmount'], message: 'The monthly recovery cannot be more than the amount' });
    if (v.mode !== 'CASH' && !v.bankAccountId) ctx.addIssue({ code: 'custom', path: ['bankAccountId'], message: 'Choose the bank account it is paid from' });
  });
export type EmployeeLoanInput = z.infer<typeof employeeLoanSchema>;

/** Salary and tax already paid earlier in a financial year (before EduERP payroll). */
export const taxOpeningSchema = z.object({
  fy: z.string().regex(/^\d{4}-\d{2}$/, 'Financial year like 2026-27'),
  taxablePaid: money,
  tdsDeducted: money,
  remarks: optText(300),
});
export type TaxOpeningInput = z.infer<typeof taxOpeningSchema>;

export const payrollReportQuerySchema = z.object({ campusId: uuid.optional(), month: z.coerce.number().int().min(1).max(12), year: z.coerce.number().int().min(2020).max(2100) });

// ───────────── Starter data (CD-85 style: pre-filled, "please check") ─────────────

/** Accounts payroll adds to the chart (system keys; idempotent). */
export const PAYROLL_CHART: StarterAccount[] = [
  { key: 'STAFF_LOANS', code: '1520', name: 'Staff loans & advances', type: 'ASSET', parent: 'ASSETS' },
  { key: 'TDS_SALARY_PAYABLE', code: '2410', name: 'TDS on salary payable', type: 'LIABILITY', parent: 'LIABILITIES' },
  { key: 'SALARY_PAYABLE', code: '2510', name: 'Salaries payable', type: 'LIABILITY', parent: 'LIABILITIES' },
  { key: 'PF_PAYABLE', code: '2520', name: 'PF payable', type: 'LIABILITY', parent: 'LIABILITIES' },
  { key: 'ESI_PAYABLE', code: '2530', name: 'ESI payable', type: 'LIABILITY', parent: 'LIABILITIES' },
  { key: 'PT_PAYABLE', code: '2540', name: 'Professional tax payable', type: 'LIABILITY', parent: 'LIABILITIES' },
  { key: 'EXP_EMPLOYER_PF', code: '5310', name: "Employer's PF contribution", type: 'EXPENSE', parent: 'EXPENSES' },
  { key: 'EXP_EMPLOYER_ESI', code: '5320', name: "Employer's ESI contribution", type: 'EXPENSE', parent: 'EXPENSES' },
];

/** Starter components; `account` / `liability` are chart keys. */
export const STARTER_COMPONENTS: { code: string; name: string; componentType: ComponentType; calcType: CalcType; statutoryKind?: StatutoryKind; isTaxable: boolean; affectedByLop: boolean; isPfWage: boolean; account: string; liability?: string; sortOrder: number; starterValue?: number }[] = [
  { code: 'BASIC', name: 'Basic pay', componentType: 'EARNING', calcType: 'PERCENT_OF_GROSS', isTaxable: true, affectedByLop: true, isPfWage: true, account: 'EXP_SALARY', sortOrder: 10, starterValue: 50 },
  { code: 'DA', name: 'Dearness allowance', componentType: 'EARNING', calcType: 'PERCENT_OF_BASIC', isTaxable: true, affectedByLop: true, isPfWage: true, account: 'EXP_SALARY', sortOrder: 20, starterValue: 10 },
  { code: 'HRA', name: 'House rent allowance', componentType: 'EARNING', calcType: 'PERCENT_OF_BASIC', isTaxable: true, affectedByLop: true, isPfWage: false, account: 'EXP_SALARY', sortOrder: 30, starterValue: 40 },
  { code: 'CONV', name: 'Conveyance allowance', componentType: 'EARNING', calcType: 'FIXED', isTaxable: true, affectedByLop: true, isPfWage: false, account: 'EXP_SALARY', sortOrder: 40, starterValue: 1600 },
  { code: 'SPECIAL', name: 'Special allowance', componentType: 'EARNING', calcType: 'BALANCE', isTaxable: true, affectedByLop: true, isPfWage: false, account: 'EXP_SALARY', sortOrder: 90 },
  { code: 'PF', name: 'Provident fund (employee)', componentType: 'DEDUCTION', calcType: 'STATUTORY', statutoryKind: 'PF', isTaxable: false, affectedByLop: false, isPfWage: false, account: 'PF_PAYABLE', sortOrder: 110 },
  { code: 'ESI', name: 'ESI (employee)', componentType: 'DEDUCTION', calcType: 'STATUTORY', statutoryKind: 'ESI', isTaxable: false, affectedByLop: false, isPfWage: false, account: 'ESI_PAYABLE', sortOrder: 120 },
  { code: 'PT', name: 'Professional tax', componentType: 'DEDUCTION', calcType: 'STATUTORY', statutoryKind: 'PT', isTaxable: false, affectedByLop: false, isPfWage: false, account: 'PT_PAYABLE', sortOrder: 130 },
  { code: 'TDS', name: 'Income tax (TDS)', componentType: 'DEDUCTION', calcType: 'STATUTORY', statutoryKind: 'TDS', isTaxable: false, affectedByLop: false, isPfWage: false, account: 'TDS_SALARY_PAYABLE', sortOrder: 140 },
  { code: 'LOAN', name: 'Loan / advance recovery', componentType: 'DEDUCTION', calcType: 'STATUTORY', statutoryKind: 'LOAN', isTaxable: false, affectedByLop: false, isPfWage: false, account: 'STAFF_LOANS', sortOrder: 150 },
  { code: 'PF_ER', name: "Employer's PF", componentType: 'EMPLOYER', calcType: 'STATUTORY', statutoryKind: 'PF', isTaxable: false, affectedByLop: false, isPfWage: false, account: 'EXP_EMPLOYER_PF', liability: 'PF_PAYABLE', sortOrder: 210 },
  { code: 'ESI_ER', name: "Employer's ESI", componentType: 'EMPLOYER', calcType: 'STATUTORY', statutoryKind: 'ESI', isTaxable: false, affectedByLop: false, isPfWage: false, account: 'EXP_EMPLOYER_ESI', liability: 'ESI_PAYABLE', sortOrder: 220 },
];

/**
 * Starter statutory rules — commonly used figures for 2025-26 onwards; the school's accountant must check them.
 * PF 12% + 12% on PF wages up to ₹15,000; ESI 0.75% + 3.25% when gross is up to ₹21,000; Karnataka professional
 * tax ₹200 a month from ₹25,000 (₹300 in February); income tax new regime (Finance Act 2025).
 */
export interface StarterRule { ruleType: (typeof RULE_TYPES)[number]; stateCode?: string; slabFrom?: string | null; slabTo?: string | null; employeeRate?: number; employerRate?: number; fixedAmount?: string; wageCeiling?: string; onlyMonth?: number; effectiveFrom: string; notes?: string }
export const STARTER_STATUTORY_RULES: StarterRule[] = [
  { ruleType: 'PF', employeeRate: 12, employerRate: 12, wageCeiling: '15000.00', effectiveFrom: '2014-09-01', notes: 'On PF wages (basic + DA) up to the ceiling' },
  { ruleType: 'ESI', employeeRate: 0.75, employerRate: 3.25, wageCeiling: '21000.00', effectiveFrom: '2019-07-01', notes: 'Only when the monthly gross is up to the ceiling' },
  { ruleType: 'PT', stateCode: '29', slabFrom: '25000.00', slabTo: null, fixedAmount: '200.00', effectiveFrom: '2025-04-01', notes: 'Karnataka: gross ₹25,000 and above' },
  { ruleType: 'PT', stateCode: '29', slabFrom: '25000.00', slabTo: null, fixedAmount: '300.00', onlyMonth: 2, effectiveFrom: '2025-04-01', notes: 'Karnataka: February' },
  { ruleType: 'TDS', slabFrom: '0.00', slabTo: '400000.00', employeeRate: 0, effectiveFrom: '2025-04-01' },
  { ruleType: 'TDS', slabFrom: '400000.00', slabTo: '800000.00', employeeRate: 5, effectiveFrom: '2025-04-01' },
  { ruleType: 'TDS', slabFrom: '800000.00', slabTo: '1200000.00', employeeRate: 10, effectiveFrom: '2025-04-01' },
  { ruleType: 'TDS', slabFrom: '1200000.00', slabTo: '1600000.00', employeeRate: 15, effectiveFrom: '2025-04-01' },
  { ruleType: 'TDS', slabFrom: '1600000.00', slabTo: '2000000.00', employeeRate: 20, effectiveFrom: '2025-04-01' },
  { ruleType: 'TDS', slabFrom: '2000000.00', slabTo: '2400000.00', employeeRate: 25, effectiveFrom: '2025-04-01' },
  { ruleType: 'TDS', slabFrom: '2400000.00', slabTo: null, employeeRate: 30, effectiveFrom: '2025-04-01' },
  { ruleType: 'TDS_STD_DEDUCTION', fixedAmount: '75000.00', effectiveFrom: '2025-04-01', notes: 'Standard deduction (new regime)' },
  { ruleType: 'TDS_REBATE', wageCeiling: '1200000.00', effectiveFrom: '2025-04-01', notes: 'No tax up to this taxable income (rebate), with marginal relief above it' },
  { ruleType: 'TDS_CESS', employeeRate: 4, effectiveFrom: '2025-04-01', notes: 'Health and education cess' },
];

// ───────────── Formula ─────────────

/** Formula grammar: numbers, component codes, GROSS, + - * / ( ), MIN(a,b), MAX(a,b), ROUND(a). Rupees in, rupees out. */
type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };
function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if ((c >= '0' && c <= '9') || c === '.') {
      let j = i;
      while (j < src.length && ((src[j] >= '0' && src[j] <= '9') || src[j] === '.')) j++;
      const n = Number(src.slice(i, j));
      if (!Number.isFinite(n)) throw new Error(`Formula: "${src.slice(i, j)}" is not a number`);
      out.push({ t: 'num', v: n }); i = j; continue;
    }
    const up = c.toUpperCase();
    if (up >= 'A' && up <= 'Z') {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j).toUpperCase() }); i = j; continue;
    }
    if ('+-*/(),'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    throw new Error(`Formula: "${c}" is not allowed`);
  }
  return out;
}

/** Evaluates a formula with the given variables (rupees). Throws a readable message on a bad formula or unknown name. */
export function evalFormula(src: string, vars: Record<string, number>): number {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const take = (v?: string) => {
    const t = toks[p];
    if (!t || (v && !(t.t === 'op' && t.v === v))) throw new Error(`Formula: expected "${v ?? 'a value'}"`);
    p++;
    return t;
  };
  const expr = (): number => {
    let v = term();
    while (peek()?.t === 'op' && ['+', '-'].includes(peek()!.v as string)) { const o = take().v; v = o === '+' ? v + term() : v - term(); }
    return v;
  };
  const term = (): number => {
    let v = factor();
    while (peek()?.t === 'op' && ['*', '/'].includes(peek()!.v as string)) {
      const o = take().v;
      const r = factor();
      if (o === '/' && r === 0) throw new Error('Formula: division by zero');
      v = o === '*' ? v * r : v / r;
    }
    return v;
  };
  const factor = (): number => {
    const t = peek();
    if (!t) throw new Error('Formula: incomplete');
    if (t.t === 'op' && t.v === '-') { take(); return -factor(); }
    if (t.t === 'op' && t.v === '(') { take('('); const v = expr(); take(')'); return v; }
    if (t.t === 'num') { take(); return t.v; }
    if (t.t === 'id') {
      take();
      if (['MIN', 'MAX', 'ROUND'].includes(t.v)) {
        take('(');
        const args = [expr()];
        while (peek()?.t === 'op' && peek()!.v === ',') { take(','); args.push(expr()); }
        take(')');
        if (t.v === 'ROUND') { if (args.length !== 1) throw new Error('Formula: ROUND takes one value'); return Math.round(args[0]); }
        if (args.length < 2) throw new Error(`Formula: ${t.v} takes two or more values`);
        return t.v === 'MIN' ? Math.min(...args) : Math.max(...args);
      }
      if (!(t.v in vars)) throw new Error(`Formula: "${t.v}" is not a component worked out before this one`);
      return vars[t.v];
    }
    throw new Error(`Formula: unexpected "${t.v}"`);
  };
  const v = expr();
  if (p < toks.length) throw new Error(`Formula: unexpected "${toks[p].v}"`);
  return v;
}

/** Syntax check with every name allowed (names are checked again when salaries are worked out). */
export function checkFormula(src: string) {
  const names = tokenize(src).filter((t) => t.t === 'id' && !['MIN', 'MAX', 'ROUND'].includes(t.v as string)).map((t) => t.v as string);
  evalFormula(src, Object.fromEntries(names.map((n) => [n, 1])));
}

// ───────────── Salary arithmetic ─────────────

export interface CalcComponent { id: string; code: string; name: string; componentType: ComponentType; calcType: CalcType; statutoryKind: StatutoryKind | null; formula: string | null; isTaxable: boolean; affectedByLop: boolean; isPfWage: boolean; sortOrder: number }
export interface CalcRules {
  pf: { eeRate: number; erRate: number; ceilingPaise: number | null } | null;
  esi: { eeRate: number; erRate: number; ceilingPaise: number } | null;
  pt: { fromPaise: number; toPaise: number | null; amountPaise: number; onlyMonth: number | null }[];
  tds: { slabs: { fromPaise: number; toPaise: number | null; rate: number }[]; stdDeductionPaise: number; rebateLimitPaise: number; cessRate: number };
}
export interface CalcInput {
  components: CalcComponent[];
  /** Structure value or personal override (rupees for FIXED, % for PERCENT_*). */
  values: Record<string, number | null>;
  grossPaise: number;
  monthDays: number;
  paidDays: number;
  month: number;
  pf: boolean; esi: boolean; pt: boolean;
  tdsOverridePaise: number | null;
  rules: CalcRules;
  adjustments: { id: string; itemType: 'EARNING' | 'DEDUCTION'; label: string; amountPaise: number; isTaxable: boolean }[];
  loans: { id: string; loanNo: string; emiPaise: number; balancePaise: number }[];
  ytd: { taxablePaise: number; tdsPaise: number };
}
export interface CalcItem { componentId: string | null; adjustmentId: string | null; loanId: string | null; itemType: ComponentType; code: string; name: string; amountPaise: number; sortOrder: number }
export interface CalcResult { items: CalcItem[]; grossPaise: number; deductionsPaise: number; employerPaise: number; netPaise: number; pfWagesPaise: number; esiWagesPaise: number; taxableProjectedPaise: number; taxYearPaise: number }

export class SalaryCalcError extends Error {}

const rupee = (p: number) => Math.round(p / 100) * 100;
const rupeeUp = (p: number) => Math.ceil(p / 100 - 1e-9) * 100;
/** `pct` percent of `basePaise` (exact to the paisa before rounding). */
const pctOf = (basePaise: number, pct: number) => (basePaise * Math.round(pct * 10000)) / 1_000_000;

/** Months left in the Indian financial year (April–March), counting the given month. */
export const monthsLeftInFy = (month: number) => 12 - ((month - 4 + 12) % 12);
/** Financial year label of a payroll month, e.g. 2026-27. */
export const fyOfMonth = (month: number, year: number) => { const s = month >= 4 ? year : year - 1; return `${s}-${String((s + 1) % 100).padStart(2, '0')}`; };

/** Yearly income tax under the new regime on a taxable income (after the standard deduction), with rebate, marginal relief and cess. */
export function newRegimeTax(taxablePaise: number, r: CalcRules['tds']): number {
  if (taxablePaise <= 0) return 0;
  let tax = 0;
  for (const s of r.slabs) {
    const top = s.toPaise == null ? taxablePaise : Math.min(taxablePaise, s.toPaise);
    if (top > s.fromPaise) tax += ((top - s.fromPaise) * s.rate) / 100;
  }
  if (taxablePaise <= r.rebateLimitPaise) tax = 0;
  else tax = Math.min(tax, taxablePaise - r.rebateLimitPaise); // marginal relief just above the rebate limit
  return rupee(tax + (tax * r.cessRate) / 100);
}

/** Works out one person's month: earnings (with loss of pay), PF, ESI, PT, TDS, one-off lines and loan recovery. */
export function calculateSalary(i: CalcInput): CalcResult {
  const comps = [...i.components].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  const earn = comps.filter((c) => c.componentType === 'EARNING');
  const full = new Map<string, number>(); // full-month amount per earning code (paise)
  const vars: Record<string, number> = { GROSS: i.grossPaise / 100 };
  const val = (c: CalcComponent) => {
    const v = i.values[c.id];
    if (v == null && c.calcType !== 'BALANCE' && c.calcType !== 'FORMULA') throw new SalaryCalcError(`${c.name}: no value in the salary structure`);
    return v ?? 0;
  };
  for (const c of earn) {
    if (c.calcType === 'BALANCE') continue;
    let p = 0;
    if (c.calcType === 'FIXED') p = Math.round(val(c) * 100);
    else if (c.calcType === 'PERCENT_OF_GROSS') p = pctOf(i.grossPaise, val(c));
    else if (c.calcType === 'PERCENT_OF_BASIC') {
      if (!full.has('BASIC')) throw new SalaryCalcError(`${c.name} is a % of basic, but basic pay is not worked out before it`);
      p = pctOf(full.get('BASIC')!, val(c));
    } else if (c.calcType === 'FORMULA') {
      try { p = evalFormula(c.formula ?? '', vars) * 100; } catch (e) { throw new SalaryCalcError(`${c.name}: ${(e as Error).message}`); }
    }
    p = Math.max(0, rupee(p));
    full.set(c.code, p);
    vars[c.code] = p / 100;
  }
  const balance = earn.filter((c) => c.calcType === 'BALANCE');
  if (balance.length > 1) throw new SalaryCalcError('Only one component can take the balance of gross');
  if (balance.length) {
    const rest = i.grossPaise - [...full.values()].reduce((s, p) => s + p, 0);
    if (rest < 0) throw new SalaryCalcError(`The components add up to more than the gross by ₹${fromPaise(-rest)}`);
    full.set(balance[0].code, rest);
  }
  const items: CalcItem[] = [];
  const ratio = i.monthDays > 0 ? Math.max(0, Math.min(1, i.paidDays / i.monthDays)) : 0;
  let gross = 0, taxable = 0, regularTaxable = 0, pfWages = 0, esiWages = 0;
  for (const c of earn) {
    const f = full.get(c.code) ?? 0;
    const p = c.affectedByLop ? rupee(f * ratio) : f;
    if (c.isTaxable) { taxable += p; regularTaxable += f; }
    if (c.isPfWage) pfWages += p;
    esiWages += p;
    gross += p;
    if (p > 0) items.push({ componentId: c.id, adjustmentId: null, loanId: null, itemType: 'EARNING', code: c.code, name: c.name, amountPaise: p, sortOrder: c.sortOrder });
  }
  for (const a of i.adjustments.filter((x) => x.itemType === 'EARNING')) {
    gross += a.amountPaise;
    if (a.isTaxable) taxable += a.amountPaise;
    items.push({ componentId: null, adjustmentId: a.id, loanId: null, itemType: 'EARNING', code: 'ADJ', name: a.label, amountPaise: a.amountPaise, sortOrder: 500 });
  }
  const byKind = (type: ComponentType, kind: StatutoryKind) => comps.find((c) => c.componentType === type && c.statutoryKind === kind);
  let deductions = 0, employer = 0;
  const add = (c: CalcComponent | undefined, p: number) => {
    if (!c || p <= 0) return;
    items.push({ componentId: c.id, adjustmentId: null, loanId: null, itemType: c.componentType, code: c.code, name: c.name, amountPaise: p, sortOrder: c.sortOrder });
    if (c.componentType === 'DEDUCTION') deductions += p; else employer += p;
  };
  // PF on PF wages up to the ceiling.
  let pfBase = 0;
  if (i.pf && i.rules.pf && byKind('DEDUCTION', 'PF')) {
    pfBase = i.rules.pf.ceilingPaise == null ? pfWages : Math.min(pfWages, i.rules.pf.ceilingPaise);
    add(byKind('DEDUCTION', 'PF'), rupee(pctOf(pfBase, i.rules.pf.eeRate)));
    add(byKind('EMPLOYER', 'PF'), rupee(pctOf(pfBase, i.rules.pf.erRate)));
  }
  // ESI only when the monthly gross is within the limit; rounded up to the rupee.
  let esiBase = 0;
  if (i.esi && i.rules.esi && byKind('DEDUCTION', 'ESI') && i.grossPaise <= i.rules.esi.ceilingPaise) {
    esiBase = esiWages;
    add(byKind('DEDUCTION', 'ESI'), rupeeUp(pctOf(esiBase, i.rules.esi.eeRate)));
    add(byKind('EMPLOYER', 'ESI'), rupeeUp(pctOf(esiBase, i.rules.esi.erRate)));
  }
  // Professional tax by slab of the month's gross; a month-specific slab (February) wins.
  if (i.pt && byKind('DEDUCTION', 'PT')) {
    const fits = i.rules.pt.filter((s) => gross >= s.fromPaise && (s.toPaise == null || gross <= s.toPaise) && (s.onlyMonth == null || s.onlyMonth === i.month));
    const slab = fits.find((s) => s.onlyMonth === i.month) ?? fits.find((s) => s.onlyMonth == null);
    if (slab) add(byKind('DEDUCTION', 'PT'), slab.amountPaise);
  }
  // Income tax: projected year (paid so far + this month + regular months left) − standard deduction.
  const left = monthsLeftInFy(i.month);
  const projected = Math.max(0, i.ytd.taxablePaise + taxable + regularTaxable * (left - 1) - i.rules.tds.stdDeductionPaise);
  const yearTax = newRegimeTax(projected, i.rules.tds);
  if (byKind('DEDUCTION', 'TDS')) {
    const tds = i.tdsOverridePaise != null ? i.tdsOverridePaise : Math.max(0, rupee((yearTax - i.ytd.tdsPaise) / left));
    add(byKind('DEDUCTION', 'TDS'), tds);
  }
  // The school's own deductions (welfare fund, society, etc.): fixed, % of earned basic / gross, or a formula.
  const earnedBasic = items.find((x) => x.code === 'BASIC' && x.componentId)?.amountPaise ?? 0;
  for (const c of comps.filter((x) => x.componentType === 'DEDUCTION' && x.calcType !== 'STATUTORY')) {
    let p = 0;
    if (c.calcType === 'FIXED') p = Math.round(val(c) * 100);
    else if (c.calcType === 'PERCENT_OF_BASIC') p = pctOf(earnedBasic, val(c));
    else if (c.calcType === 'PERCENT_OF_GROSS') p = pctOf(gross, val(c));
    else if (c.calcType === 'FORMULA') {
      try { p = evalFormula(c.formula ?? '', { ...vars, EARNED: gross / 100 }) * 100; } catch (e) { throw new SalaryCalcError(`${c.name}: ${(e as Error).message}`); }
    }
    add(c, Math.max(0, rupee(p)));
  }
  for (const a of i.adjustments.filter((x) => x.itemType === 'DEDUCTION')) {
    deductions += a.amountPaise;
    items.push({ componentId: null, adjustmentId: a.id, loanId: null, itemType: 'DEDUCTION', code: 'ADJ', name: a.label, amountPaise: a.amountPaise, sortOrder: 600 });
  }
  if (deductions > gross) throw new SalaryCalcError(`Deductions (₹${fromPaise(deductions)}) are more than the earnings (₹${fromPaise(gross)})`);
  // Loan recovery: never more than the balance or what is left to pay.
  const loanComp = byKind('DEDUCTION', 'LOAN');
  for (const l of i.loans) {
    if (!loanComp) break;
    const p = Math.min(l.emiPaise, l.balancePaise, gross - deductions);
    if (p <= 0) continue;
    deductions += p;
    items.push({ componentId: loanComp.id, adjustmentId: null, loanId: l.id, itemType: 'DEDUCTION', code: loanComp.code, name: `${loanComp.name} (${l.loanNo})`, amountPaise: p, sortOrder: loanComp.sortOrder });
  }
  items.sort((a, b) => a.sortOrder - b.sortOrder);
  return { items, grossPaise: gross, deductionsPaise: deductions, employerPaise: employer, netPaise: gross - deductions, pfWagesPaise: pfBase, esiWagesPaise: esiBase, taxableProjectedPaise: projected, taxYearPaise: yearTax };
}

