/**
 * AC79–AC82 Payroll (Phase 15): salary set-up (structure arithmetic, one open salary, revisions, read
 * rights); statutory arithmetic (PF ceiling, ESI limit and rounding, Karnataka PT with February, new-regime
 * TDS with rebate / marginal relief / cess, spread over the months left); the monthly run (paid days from
 * attendance and leave, joiners, one run per campus and month, one-off lines, no approver → refused, the
 * preparer cannot approve, one balanced journal, frozen payslips, loan recovery, locked month, bank file
 * for the payer only, payment and release, cancel frees the month); payslips, statements, settlement;
 * isolation.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CalcRules, PERMISSIONS, calculateSalary, evalFormula, fyOfMonth, monthsLeftInFy, newRegimeTax } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, auth, createRole, createTenant, login, ownerDb, startApp, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let main: string;
let north: string;
let hr: Session;
let boss: Session;
let accts: Session;
let clerk: Session;
let priya: Session;
const ids: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
// The run month: last month (fully in the past).
const lm = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1));
const M = lm.getUTCMonth() + 1;
const Y = lm.getUTCFullYear();
const MD = new Date(Date.UTC(Y, M, 0)).getUTCDate();
const d = (day: number) => `${Y}-${String(M).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const nextMonth = shift(d(MD), 1);
const rupees = (p: number) => p / 100;

const RULES: CalcRules = {
  pf: { eeRate: 12, erRate: 12, ceilingPaise: 1_500_000 },
  esi: { eeRate: 0.75, erRate: 3.25, ceilingPaise: 2_100_000 },
  pt: [{ fromPaise: 2_500_000, toPaise: null, amountPaise: 20_000, onlyMonth: null }, { fromPaise: 2_500_000, toPaise: null, amountPaise: 30_000, onlyMonth: 2 }],
  tds: {
    slabs: [[0, 4], [4, 8], [8, 12], [12, 16], [16, 20], [20, 24], [24, null]].map(([f, t], i) => ({ fromPaise: (f as number) * 100_000_00, toPaise: t == null ? null : (t as number) * 100_000_00, rate: [0, 5, 10, 15, 20, 25, 30][i] })),
    stdDeductionPaise: 75_000_00, rebateLimitPaise: 12_00_000_00, cessRate: 4,
  },
};
const C = (code: string, componentType: 'EARNING' | 'DEDUCTION' | 'EMPLOYER', calcType: string, extra: Record<string, unknown> = {}) => ({ id: code, code, name: code, componentType, calcType, statutoryKind: null, formula: null, isTaxable: componentType === 'EARNING', affectedByLop: componentType === 'EARNING', isPfWage: false, sortOrder: 0, ...extra }) as Parameters<typeof calculateSalary>[0]['components'][number];
const STD = [
  C('BASIC', 'EARNING', 'PERCENT_OF_GROSS', { isPfWage: true, sortOrder: 10 }), C('DA', 'EARNING', 'PERCENT_OF_BASIC', { isPfWage: true, sortOrder: 20 }), C('HRA', 'EARNING', 'PERCENT_OF_BASIC', { sortOrder: 30 }),
  C('CONV', 'EARNING', 'FIXED', { sortOrder: 40 }), C('SPECIAL', 'EARNING', 'BALANCE', { sortOrder: 90 }),
  C('PF', 'DEDUCTION', 'STATUTORY', { statutoryKind: 'PF', sortOrder: 110 }), C('ESI', 'DEDUCTION', 'STATUTORY', { statutoryKind: 'ESI', sortOrder: 120 }), C('PT', 'DEDUCTION', 'STATUTORY', { statutoryKind: 'PT', sortOrder: 130 }),
  C('TDS', 'DEDUCTION', 'STATUTORY', { statutoryKind: 'TDS', sortOrder: 140 }), C('LOAN', 'DEDUCTION', 'STATUTORY', { statutoryKind: 'LOAN', sortOrder: 150 }),
  C('PF_ER', 'EMPLOYER', 'STATUTORY', { statutoryKind: 'PF', sortOrder: 210 }), C('ESI_ER', 'EMPLOYER', 'STATUTORY', { statutoryKind: 'ESI', sortOrder: 220 }),
];
const VALUES = { BASIC: 50, DA: 10, HRA: 40, CONV: 1600, PF: null, ESI: null, PT: null, TDS: null, PF_ER: null, ESI_ER: null };
const calc = (grossRupees: number, o: Partial<Parameters<typeof calculateSalary>[0]> = {}) =>
  calculateSalary({ components: STD, values: VALUES, grossPaise: grossRupees * 100, monthDays: 30, paidDays: 30, month: 11, pf: true, esi: true, pt: true, tdsOverridePaise: null, rules: RULES, adjustments: [], loans: [], ytd: { taxablePaise: 0, tdsPaise: 0 }, ...o });
const item = (r: ReturnType<typeof calculateSalary>, code: string) => rupees(r.items.find((i) => i.code === code)?.amountPaise ?? 0);

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'PayA');
  B = await createTenant(app, platform, 'PayB');
  main = (await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  north = (await post('/campuses', { code: 'NORTH', name: 'North School', campusType: 'SCHOOL' })).body.id;
  for (const [k, first, campus, joined] of [['priya', 'Priya', main, shift(today, -500)], ['ravi', 'Ravi', main, shift(today, -500)], ['kiran', 'Kiran', main, d(11)], ['sunil', 'Sunil', north, shift(today, -500)], ['nobody', 'Nanda', main, shift(today, -500)]] as const) {
    ids[k] = (await post('/staff', { campusId: campus, firstName: first, gender: 'FEMALE', employeeType: 'TEACHING', designation: 'Assistant Teacher', joiningDate: joined })).body.id;
  }
  ids.payRole = await createRole(A.tenantId, 'PAY_HR', [PERMISSIONS.PAYROLL_SETUP, PERMISSIONS.PAYROLL_SALARY_READ, PERMISSIONS.PAYROLL_SALARY, PERMISSIONS.PAYROLL_RUN, PERMISSIONS.PAYROLL_LOAN, PERMISSIONS.PAYROLL_REPORTS, PERMISSIONS.HR_PROFILE_READ, PERMISSIONS.HR_PROFILE_MANAGE, PERMISSIONS.HR_EXIT, PERMISSIONS.APPROVALS_REQUEST_READ]);
  await createRole(A.tenantId, 'PAY_ACCTS', [PERMISSIONS.PAYROLL_PAY, PERMISSIONS.PAYROLL_REPORTS, PERMISSIONS.ACC_READ]);
  await createRole(A.tenantId, 'PAY_STAFF', [PERMISSIONS.LEAVE_SELF]);
  hr = (await addMember(app, A.session, { label: 'PayHr', roleCode: 'PAY_HR', campusId: main })).session;
  boss = (await addMember(app, A.session, { label: 'PayBoss', roleCode: 'PAY_HR', campusId: main })).session;
  accts = (await addMember(app, A.session, { label: 'PayAccts', roleCode: 'PAY_ACCTS' })).session;
  clerk = (await addMember(app, A.session, { label: 'PayClerk', roleCode: 'PAY_STAFF' })).session;
  const p = await addMember(app, A.session, { label: 'PriyaPay', roleCode: 'PAY_STAFF' });
  priya = p.session;
  await post(`/staff/${ids.priya}/user`, { userId: p.userId });
  await http().put(`${API}/hr/staff/${ids.priya}`).set(auth(hr)).send({ pan: 'ABCPK1234Q', uanNo: '100200300400', bankName: 'Canara Bank', bankAccountNo: '0412 2010 0045 6789', ifsc: 'CNRB0000412' });
  ids.bank = (await post('/accounts/bank-accounts', { campusId: main, bankName: 'Canara Bank', branch: 'Jayanagar', accountNo: '0412 1010 0999 1111', ifsc: 'CNRB0000412', accountType: 'CURRENT' })).body.id;
}, 180_000);
afterAll(() => app?.close());

describe('AC80 statutory arithmetic', () => {
  it('structure: % of gross, % of basic, fixed and the balance add up to the gross; PF capped at ₹15,000 wages', () => {
    const r = calc(30000);
    expect([item(r, 'BASIC'), item(r, 'DA'), item(r, 'HRA'), item(r, 'CONV'), item(r, 'SPECIAL')]).toEqual([15000, 1500, 6000, 1600, 5900]);
    expect(rupees(r.grossPaise)).toBe(30000);
    expect(item(r, 'PF')).toBe(1800); // 12% of min(16,500, 15,000)
    expect(item(r, 'PF_ER')).toBe(1800);
    expect(item(r, 'ESI')).toBe(0); // gross above ₹21,000
    expect(item(r, 'PT')).toBe(200);
    expect(rupees(r.netPaise)).toBe(30000 - 1800 - 200);
  });

  it('ESI up to ₹21,000 gross, rounded up; PT nil below ₹25,000 and ₹300 in February', () => {
    const r = calc(17777);
    expect(item(r, 'ESI')).toBe(134); // 0.75% of 17,777 = 133.33 → 134
    expect(item(r, 'ESI_ER')).toBe(578); // 3.25% = 577.75 → 578
    expect(item(r, 'PT')).toBe(0);
    expect(item(calc(30000, { month: 2 }), 'PT')).toBe(300);
    expect(item(calc(21001), 'ESI')).toBe(0);
  });

  it('loss of pay reduces the earnings by paid days; a formula component works from earlier ones', () => {
    const r = calc(30000, { paidDays: 27 });
    expect(rupees(r.grossPaise)).toBe(27000);
    expect(evalFormula('MIN(BASIC * 0.1, 1250) + 50', { BASIC: 15000 })).toBe(1300);
    expect(() => evalFormula('BASIC +', { BASIC: 1 })).toThrow(/Formula/);
    expect(() => evalFormula('FOO * 2', {})).toThrow(/not a component/);
  });

  it('new regime: no tax up to ₹12 lakh, marginal relief just above, 4% cess; spread over the months left', () => {
    expect(newRegimeTax(12_00_000_00, RULES.tds)).toBe(0);
    expect(rupees(newRegimeTax(12_10_000_00, RULES.tds))).toBe(10400); // relief caps tax at ₹10,000, + cess
    expect(rupees(newRegimeTax(16_00_000_00, RULES.tds))).toBe(124800);
    expect(monthsLeftInFy(4)).toBe(12);
    expect(monthsLeftInFy(3)).toBe(1);
    // ₹1.5 lakh a month from April: (18 L − 75k) taxable → ₹1,50,800 a year → ₹12,567 a month.
    expect(item(calc(150000, { month: 4, esi: false }), 'TDS')).toBe(12567);
    // In January with ₹1,20,000 already deducted: (1,50,800 − 1,20,000) ÷ 3.
    expect(item(calc(150000, { month: 1, esi: false, ytd: { taxablePaise: 9 * 150000_00, tdsPaise: 120000_00 } }), 'TDS')).toBe(10267);
    // An override wins.
    expect(item(calc(150000, { month: 4, esi: false, tdsOverridePaise: 5000_00 }), 'TDS')).toBe(5000);
  });

  it('a loan is recovered up to its balance; deductions never exceed the earnings', () => {
    const r = calc(30000, { loans: [{ id: 'L1', loanNo: 'LN/1', emiPaise: 5000_00, balancePaise: 3000_00 }] });
    expect(r.items.find((i) => i.loanId === 'L1')?.amountPaise).toBe(3000_00);
    expect(() => calc(30000, { adjustments: [{ id: 'X', itemType: 'DEDUCTION', label: 'Recovery', amountPaise: 40000_00, isTaxable: false }] })).toThrow(/more than the earnings/);
  });
});

describe('AC79 salary set-up', () => {
  it('starts with components, a standard structure and statutory rules; bad formulas are refused', async () => {
    const comps = (await get('/payroll/components', hr)).body;
    expect(comps.map((c: { code: string }) => c.code)).toEqual(expect.arrayContaining(['BASIC', 'DA', 'HRA', 'SPECIAL', 'PF', 'ESI', 'PT', 'TDS', 'LOAN', 'PF_ER', 'ESI_ER']));
    for (const c of comps) ids[`c_${c.code}`] = c.id;
    const structs = (await get('/payroll/structures', hr)).body;
    ids.std = structs.find((s: { name: string }) => s.name === 'Standard salary').id;
    const rules = (await get('/payroll/statutory-rules', hr)).body;
    expect(rules.filter((r: { ruleType: string }) => r.ruleType === 'TDS')).toHaveLength(7);
    expect((await post('/payroll/components', { code: 'WELF', name: 'Welfare fund', componentType: 'DEDUCTION', calcType: 'FORMULA', formula: 'BASIC * ' }, hr)).status).toBe(422);
    expect((await post('/payroll/components', { code: 'PF', name: 'Again', componentType: 'EARNING', calcType: 'FIXED' }, hr)).status).toBe(409);
    expect((await post('/payroll/components', { code: 'X1', name: 'Not mine', componentType: 'EARNING', calcType: 'FIXED' }, clerk)).status).toBe(403);
  });

  it('one open salary per person; a revision closes the previous one the day before; reading needs the right', async () => {
    const from = shift(today, -400);
    const s1 = await post('/payroll/salaries', { employeeId: ids.priya, structureId: ids.std, monthlyGross: 28000, effectiveFrom: from }, hr);
    expect(s1.status).toBe(201);
    expect((await post('/payroll/salaries', { employeeId: ids.priya, structureId: ids.std, monthlyGross: 29000, effectiveFrom: from }, hr)).status).toBe(409);
    const s2 = await post('/payroll/salaries', { employeeId: ids.priya, structureId: ids.std, monthlyGross: 30000, effectiveFrom: shift(today, -200) }, hr);
    expect(s2.body.revision).toBe(true);
    const v = (await get(`/payroll/salaries/${ids.priya}`, hr)).body;
    expect(v.history).toHaveLength(2);
    expect(v.history[1].effectiveTo).toBe(shift(today, -201));
    expect(v.preview.gross).toBe('30000.00');
    const db = ownerDb();
    expect(await db.employeeSalary.count({ where: { employeeId: ids.priya, effectiveTo: null } })).toBe(1);
    await db.$disconnect();
    // The preview shows the breakdown before saving; a gross the fixed parts cannot fit is refused.
    const pv = await post('/payroll/salaries/preview', { employeeId: ids.ravi, structureId: ids.std, monthlyGross: 20000, effectiveFrom: from }, hr);
    expect(pv.body).toMatchObject({ gross: '20000.00' });
    expect(pv.body.items.find((i: { code: string }) => i.code === 'ESI').amount).toBe('150.00');
    expect((await post('/payroll/salaries/preview', { employeeId: ids.ravi, structureId: ids.std, monthlyGross: 1000, effectiveFrom: from }, hr)).status).toBe(422);
    expect((await post('/payroll/salaries', { employeeId: ids.ravi, structureId: ids.std, monthlyGross: 20000, effectiveFrom: from }, hr)).status).toBe(201);
    expect((await post('/payroll/salaries', { employeeId: ids.kiran, structureId: ids.std, monthlyGross: 31000, effectiveFrom: d(11) }, hr)).status).toBe(201);
    expect((await post('/payroll/salaries', { employeeId: ids.sunil, structureId: ids.std, monthlyGross: 25000, effectiveFrom: from })).status).toBe(201);
    // HR of the main campus cannot see the north campus; staff without the right see nothing.
    expect((await get(`/payroll/salaries/${ids.sunil}`, hr)).status).toBe(404);
    expect((await get('/payroll/salaries', hr)).body.map((x: { name: string }) => x.name)).not.toContain('Sunil');
    expect((await get('/payroll/salaries', clerk)).status).toBe(403);
  });
});

describe('AC80 tax opening', () => {
  it('salary and tax paid earlier in the year (before EduERP) count for income tax', async () => {
    const fy = fyOfMonth(Number(today.slice(5, 7)), Number(today.slice(0, 4)));
    expect(Number((await get(`/payroll/salaries/${ids.sunil}`)).body.preview.taxYear)).toBe(0);
    const put = (s: Session) => http().put(`${API}/payroll/salaries/${ids.sunil}/opening`).set(auth(s)).send({ fy, taxablePaid: 1300000, tdsDeducted: 20000 });
    expect((await put(hr)).status).toBe(404);
    expect((await put(A.session)).status).toBe(200);
    const after = (await get(`/payroll/salaries/${ids.sunil}`)).body;
    expect(after.opening).toMatchObject({ fy, taxablePaid: '1300000.00', tdsDeducted: '20000.00' });
    expect(Number(after.preview.taxYear)).toBeGreaterThan(0);
    expect(after.preview.items.find((i: { code: string }) => i.code === 'TDS')).toBeTruthy();
  });
});

describe('AC81 monthly payroll run', () => {
  it('paid days come from attendance and leave; joiners are paid for their days; staff without a salary are listed', async () => {
    const db = ownerDb();
    const types = await Promise.all([
      db.leaveType.create({ data: { tenantId: A.tenantId, name: 'Casual leave', code: 'CLX', appliesTo: 'EMPLOYEE', isPaid: true, daysPerYear: 12 } }),
      db.leaveType.create({ data: { tenantId: A.tenantId, name: 'Unpaid leave', code: 'ULX', appliesTo: 'EMPLOYEE', isPaid: false } }),
    ]);
    const adminUser = (await db.user.findFirstOrThrow({ where: { email: A.admin.email } })).id;
    const att = (employeeId: string, day: number, status: string) => ({ tenantId: A.tenantId, campusId: main, employeeId, attendanceDate: new Date(`${d(day)}T00:00:00Z`), status });
    await db.staffAttendance.createMany({ data: [att(ids.priya, 5, 'ABSENT'), att(ids.priya, 6, 'HALF_DAY'), att(ids.priya, 7, 'ABSENT'), att(ids.ravi, 5, 'PRESENT')] });
    const leave = (employeeId: string, typeId: string, from: number, to: number, days: number) => ({ tenantId: A.tenantId, campusId: main, applicantType: 'EMPLOYEE', employeeId, leaveTypeId: typeId, fromDate: new Date(`${d(from)}T00:00:00Z`), toDate: new Date(`${d(to)}T00:00:00Z`), days, reason: 'Test', appliedBy: adminUser, status: 'APPROVED', decidedBy: adminUser, decidedAt: new Date() });
    await db.leaveRequest.createMany({ data: [leave(ids.priya, types[0].id, 7, 7, 1), leave(ids.ravi, types[1].id, 12, 13, 2)] });
    await db.$disconnect();
    // A ₹5,000 salary advance for Priya, recovered ₹2,000 a month from the run month (no approval rule: paid out at once).
    const loan = await post('/payroll/loans', { employeeId: ids.priya, loanType: 'ADVANCE', amount: 5000, emiAmount: 2000, startMonth: M, startYear: Y, reason: 'Medical expenses', disbursedOn: d(1), mode: 'CASH' }, hr);
    expect(loan.status).toBe(201);
    expect(loan.body.status).toBe('ACTIVE');
    ids.loan = loan.body.id;
    expect((await post('/payroll/loans', { employeeId: ids.nobody, loanType: 'LOAN', amount: 5000, emiAmount: 1000, startMonth: M, startYear: Y, reason: 'Test', disbursedOn: d(1), mode: 'CASH' }, hr)).status).toBe(409);

    const run = await post('/payroll/runs', { campusId: main, month: M, year: Y }, hr);
    expect(run.status).toBe(201);
    ids.run = run.body.id;
    expect(run.body.staff).toBe(3);
    expect(run.body.missing).toEqual(['Nanda']);
    expect((await post('/payroll/runs', { campusId: main, month: M, year: Y }, hr)).status).toBe(409);
    const v = (await get(`/payroll/runs/${ids.run}`, hr)).body;
    const slip = (n: string) => v.payslips.find((p: { name: string }) => p.name === n);
    expect(slip('Priya')).toMatchObject({ employedDays: MD, lopDays: 1.5, paidDays: MD - 1.5 }); // absent 1 + half 0.5; the paid leave covers day 7
    expect(slip('Ravi')).toMatchObject({ lopDays: 2 }); // two days of unpaid leave
    expect(slip('Kiran')).toMatchObject({ employedDays: MD - 10, lopDays: 0 });
    expect(Number(slip('Kiran').gross)).toBeCloseTo(Math.round((31000 * (MD - 10)) / MD), -1);
    expect(slip('Priya').items.find((i: { code: string }) => i.code === 'LOAN').amount).toBe('2000.00');
    expect(slip('Ravi').items.find((i: { code: string }) => i.code === 'ESI')).toBeTruthy();
  });

  it('one-off lines recalculate the run; a run cannot be submitted until an approver is set up', async () => {
    const before = (await get(`/payroll/runs/${ids.run}`, hr)).body.payslips.find((p: { name: string }) => p.name === 'Ravi').gross;
    const a = await post(`/payroll/runs/${ids.run}/adjustments`, { employeeId: ids.ravi, itemType: 'EARNING', label: 'Exam duty allowance', amount: 1000 }, hr);
    expect(a.status).toBe(201);
    const after = (await get(`/payroll/runs/${ids.run}`, hr)).body.payslips.find((p: { name: string }) => p.name === 'Ravi').gross;
    expect(Number(after) - Number(before)).toBe(1000);
    const s = await post(`/payroll/runs/${ids.run}/submit`, {}, hr);
    expect(s.status).toBe(409);
    expect(s.body.type).toBe('no-approver');
  });

  it('the preparer cannot approve; approval posts one balanced journal matching the payslips; payslips freeze; loans recover', async () => {
    expect((await post('/approvals/rules', { entityType: 'PAYROLL_RUN', levelNo: 1, approverRoleId: ids.payRole })).status).toBe(201);
    expect((await post(`/payroll/runs/${ids.run}/submit`, {}, hr)).body.status).toBe('PENDING_APPROVAL');
    expect((await post(`/payroll/runs/${ids.run}/calculate`, {}, hr)).status).toBe(409);
    const req = (await get('/approvals/inbox', boss)).body.find((x: { entityType: string }) => x.entityType === 'PAYROLL_RUN');
    expect((await post(`/approvals/requests/${req.id}/act`, { action: 'APPROVE' }, hr)).status).toBe(403);
    expect((await post(`/approvals/requests/${req.id}/act`, { action: 'APPROVE' }, boss)).status).toBeLessThan(300);
    const v = (await get(`/payroll/runs/${ids.run}`, hr)).body;
    expect(v.status).toBe('APPROVED');
    expect(v.journalNo).toBeTruthy();
    const db = ownerDb();
    const run = await db.payrollRun.findUniqueOrThrow({ where: { id: ids.run } });
    const lines = await db.journalLine.findMany({ where: { journalEntryId: run.journalEntryId! } });
    const dr = lines.reduce((t, l) => t + Number(l.debit), 0);
    const cr = lines.reduce((t, l) => t + Number(l.credit), 0);
    expect(dr).toBeCloseTo(cr, 2);
    expect(dr).toBeCloseTo(Number(run.totalGross) + Number(run.totalEmployer), 2);
    const payable = await db.account.findFirstOrThrow({ where: { tenantId: A.tenantId, systemKey: 'SALARY_PAYABLE' } });
    expect(Number(lines.find((l) => l.accountId === payable.id)!.credit)).toBeCloseTo(Number(run.totalNet), 2);
    await expect(db.$executeRawUnsafe(`UPDATE payslips SET net_pay = net_pay + 1, gross_earnings = gross_earnings + 1 WHERE run_id = '${ids.run}'`)).rejects.toThrow(/cannot change/);
    expect(Number((await db.employeeLoan.findUniqueOrThrow({ where: { id: ids.loan } })).recovered)).toBe(2000);
    await db.$disconnect();
  });

  it('the bank file is for the payer only (full account numbers, audited); paying posts to the bank and releases payslips', async () => {
    expect((await get('/payroll/my-payslips', priya)).body.payslips).toHaveLength(0);
    expect((await post(`/payroll/runs/${ids.run}/bank-file`, {}, hr)).status).toBe(403);
    const f = await post(`/payroll/runs/${ids.run}/bank-file`, {}, accts);
    expect(f.status).toBe(200);
    expect(f.body.csv).toContain('041220100045678');
    expect(f.body.count).toBe(1);
    expect(f.body.others.map((o: { name: string }) => o.name)).toEqual(expect.arrayContaining(['Ravi', 'Kiran']));
    const db = ownerDb();
    expect(await db.auditLog.count({ where: { tenantId: A.tenantId, entityType: 'PAYROLL_RUN', entityId: ids.run, action: 'EXPORT' } })).toBeGreaterThan(0);
    await db.$disconnect();
    expect((await post(`/payroll/runs/${ids.run}/pay`, { paidOn: shift(d(1), -1), bankAccountId: ids.bank }, accts)).status).toBe(422);
    const p = await post(`/payroll/runs/${ids.run}/pay`, { paidOn: nextMonth, bankAccountId: ids.bank }, accts);
    expect(p.body.status).toBe('PAID');
    const mine = (await get('/payroll/my-payslips', priya)).body.payslips;
    expect(mine).toHaveLength(1);
    const slip = (await get(`/payroll/payslips/${mine[0].id}`, priya)).body;
    expect(slip.employee).toMatchObject({ name: 'Priya', panLast4: '234Q', uanNo: '100200300400' });
    expect(slip.lopDays).toBe(1.5);
    const ravi = (await get(`/payroll/runs/${ids.run}`, hr)).body.payslips.find((x: { name: string }) => x.name === 'Ravi');
    expect((await get(`/payroll/payslips/${ravi.id}`, priya)).status).toBe(404);
  });

  it('nothing posts into a locked month; cancelling a run frees the month', async () => {
    const n = await post('/payroll/runs', { campusId: north, month: M, year: Y });
    expect(n.status).toBe(201);
    expect((await post('/accounts/periods/lock', { month: `${Y}-${String(M).padStart(2, '0')}` })).body.status).toBe('LOCKED');
    const s = await post(`/payroll/runs/${n.body.id}/submit`, {});
    expect(s.status).toBe(409);
    expect(s.body.type).toBe('period-locked');
    expect((await post(`/payroll/runs/${n.body.id}/cancel`, {})).body.status).toBe('CANCELLED');
    expect((await post('/payroll/runs', { campusId: north, month: M, year: Y })).status).toBe(201);
  });
});

describe('AC82 statements, settlement, isolation', () => {
  it('PF / ESI / PT / TDS statements add up to the payslips; the ECR line carries the UAN', async () => {
    const v = (await get(`/payroll/runs/${ids.run}`, hr)).body;
    const total = (code: string) => v.payslips.reduce((t: number, p: { items: { code: string; amount: string }[] }) => t + p.items.filter((i) => i.code === code).reduce((s, i) => s + Number(i.amount), 0), 0);
    const pf = (await get(`/payroll/runs/${ids.run}/report?kind=pf`, hr)).body;
    expect(Number(pf.totals.ee)).toBeCloseTo(total('PF'), 2);
    expect(Number(pf.totals.eps) + Number(pf.totals.er)).toBeCloseTo(total('PF_ER'), 2);
    expect(pf.ecr).toMatch(/^100200300400#~#PRIYA#~#/m);
    expect(pf.notes.join(' ')).toContain('no UAN');
    const esi = (await get(`/payroll/runs/${ids.run}/report?kind=esi`, hr)).body;
    expect(Number(esi.totals.ee)).toBeCloseTo(total('ESI'), 2);
    const pt = (await get(`/payroll/runs/${ids.run}/report?kind=pt`, hr)).body;
    expect(Number(pt.totals.pt)).toBeCloseTo(total('PT'), 2);
    const tds = (await get(`/payroll/runs/${ids.run}/report?kind=tds`, hr)).body;
    expect(Number(tds.totals.tds)).toBeCloseTo(total('TDS'), 2);
    const reg = (await get(`/payroll/runs/${ids.run}/report?kind=register`, accts)).body;
    expect(Number(reg.totals.net)).toBeCloseTo(Number(v.totalNet), 2);
    expect((await get(`/payroll/runs/${ids.run}/report?kind=pf`, clerk)).status).toBe(404);
  });

  it('the settlement worksheet counts the last month’s days and any loan still owed', async () => {
    const x = await post('/hr/exits', { employeeId: ids.priya, exitType: 'RESIGNATION', resignationDate: shift(today, -5), lastWorkingDate: today, reason: 'Moving to Mysuru', sections: ['ACCOUNTS'] }, hr);
    expect(x.status).toBe(201);
    const w = (await get(`/payroll/settlement/${x.body.id}`, hr)).body;
    const salary = w.lines.find((l: { label: string }) => l.label.startsWith('Salary for'));
    expect(salary).toBeTruthy();
    const loan = w.lines.find((l: { label: string }) => l.label.includes('still owed'));
    expect(loan.amount).toBe('3000.00');
    expect(Number(w.total)).toBeCloseTo(Number(salary.amount) - 3000, 2);
    expect((await get(`/payroll/settlement/${x.body.id}`, clerk)).status).toBe(404);
  });

  it('another institution sees none of it', async () => {
    expect((await get(`/payroll/runs/${ids.run}`, B.session)).status).toBe(404);
    expect((await get('/payroll/runs', B.session)).body).toHaveLength(0);
    expect((await get('/payroll/salaries', B.session)).body.map((x: { name: string }) => x.name)).not.toContain('Priya');
    expect((await get(`/payroll/payslips/${(await get('/payroll/my-payslips', priya)).body.payslips[0].id}`, B.session)).status).toBe(404);
  });
});
