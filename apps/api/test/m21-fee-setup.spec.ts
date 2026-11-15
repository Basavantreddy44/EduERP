/**
 * AC29 fee set-up (M2.1): starter chart of accounts, fee heads posting to income accounts, fee
 * structures with instalments (total = sum of items), one active per class / year / fee group,
 * active structures locked (revise instead — DB trigger too), copy to the next year, late-fee
 * rules, money in paise, campus scope, isolation and the module switch.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PERMISSIONS, financialYearOf, formatINR, fromPaise, lateFee, toPaise } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, auth, createRole, createTenant, login, ownerDb, startApp, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let main: string;
let north: string;
let year: string;
let nextYear: string;
let class1: string;
let class2: string;
let puc1: string;
const heads: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);

const structure = (over: Record<string, unknown> = {}) => ({
  campusId: main, academicYearId: year, programLevelId: class1, name: 'Class 1 fees 2026-27',
  instalments: [
    { instalmentNo: 1, name: 'Term 1', dueDate: '2026-06-10' },
    { instalmentNo: 2, name: 'Term 2', dueDate: '2026-10-10' },
    { instalmentNo: 3, name: 'Term 3', dueDate: '2027-01-10' },
  ],
  items: [
    { feeHeadId: heads.TUITION, instalmentNo: 1, amount: '12000' },
    { feeHeadId: heads.TUITION, instalmentNo: 2, amount: 12000 },
    { feeHeadId: heads.TUITION, instalmentNo: 3, amount: '12,000.50' },
    { feeHeadId: heads.ADM, instalmentNo: 1, amount: '5000' },
    { feeHeadId: heads.ADM, instalmentNo: 2, amount: '0' },
  ],
  ...over,
});

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'FeeA');
  B = await createTenant(app, platform, 'FeeB');
  main = (await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  north = (await post('/campuses', { code: 'NORTH', name: 'North PU', campusType: 'PU' })).body.id;
  year = (await post('/academic-years', { name: '2026-27', startDate: '2026-06-01', endDate: '2027-03-31', makeCurrent: true })).body.id;
  nextYear = (await post('/academic-years', { name: '2027-28', startDate: '2027-06-01', endDate: '2028-03-31' })).body.id;
  const sbs = await post('/programs', { campusId: main, name: 'State Board School', code: 'SBS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 10 });
  [class1, class2] = [sbs.body.levels[0].id, sbs.body.levels[1].id];
  puc1 = (await post('/programs', { campusId: north, name: 'PU Science', code: 'PUS', programType: 'PU', levelLabel: 'PUC', durationLevels: 2 })).body.levels[0].id;
}, 120_000);
afterAll(() => app?.close());

describe('money and late-fee arithmetic (paise, no floating point)', () => {
  it('converts and formats amounts exactly', () => {
    expect(toPaise('12,500.5')).toBe(1250050);
    expect(toPaise(0.1) + toPaise(0.2)).toBe(toPaise('0.3'));
    expect(fromPaise(1250005)).toBe('12500.05');
    expect(formatINR(125000050)).toBe('₹12,50,000.50');
    expect(formatINR(1250000)).toBe('₹12,500');
    expect(() => toPaise('12.345')).toThrow();
    expect(financialYearOf('2027-03-31')).toEqual({ name: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' });
    expect(financialYearOf('2026-04-01').name).toBe('2026-27');
  });

  it('late fee follows grace days, type and cap', () => {
    const r = (fineType: 'FIXED' | 'PER_DAY' | 'PERCENT', v: string, cap: string | null = null) => ({ graceDays: 5, fineType, fineValuePaise: toPaise(v), maxFinePaise: cap ? toPaise(cap) : null });
    expect(lateFee(r('FIXED', '100'), 1_000_000, 5)).toBe(0); // within grace
    expect(lateFee(r('FIXED', '100'), 1_000_000, 6)).toBe(10_000);
    expect(lateFee(r('PER_DAY', '10'), 1_000_000, 15)).toBe(10_000); // 10 days × ₹10
    expect(lateFee(r('PER_DAY', '10', '50'), 1_000_000, 40)).toBe(5_000); // capped at ₹50
    expect(lateFee(r('PERCENT', '2.5'), 1_000_000, 30)).toBe(25_000); // 2.5 % of ₹10,000
    expect(lateFee(r('PERCENT', '2.5'), 0, 30)).toBe(0);
  });
});

describe('AC29 chart of accounts and fee heads', () => {
  it('the starter chart is created once, even when asked twice', async () => {
    const [o1, o2] = await Promise.all([http().get(`${API}/fees/setup/options`).set(auth(A.session)), http().get(`${API}/fees/setup/options`).set(auth(A.session))]);
    expect(o1.status).toBe(200);
    expect(o2.status).toBe(200);
    const db = ownerDb();
    const accounts = await db.account.findMany({ where: { tenantId: A.tenantId } });
    await db.$disconnect();
    expect(accounts).toHaveLength(22);
    expect(accounts.filter((a) => a.systemKey === 'STUDENT_RECEIVABLE')).toHaveLength(1);
    expect(o1.body.accounts.every((a: { accountType: string }) => ['INCOME', 'LIABILITY'].includes(a.accountType))).toBe(true);
  });

  it('a fee head posts to the income account of its type unless another is chosen', async () => {
    const t = await post('/fees/heads', { name: 'Tuition fee', code: 'tuition', feeType: 'ACADEMIC' });
    expect(t.status).toBe(201);
    expect(t.body).toMatchObject({ code: 'TUITION', incomeAccount: { code: '4100' } });
    heads.TUITION = t.body.id;
    const d = await post('/fees/heads', { name: 'Caution deposit', code: 'DEPOSIT', feeType: 'DEPOSIT', isRefundable: true });
    expect(d.body.incomeAccount.code).toBe('2200');
    heads.DEPOSIT = d.body.id;
    const opts = (await http().get(`${API}/fees/setup/options`).set(auth(A.session))).body;
    const examIncome = opts.accounts.find((a: { code: string }) => a.code === '4120').id;
    const adm = await post('/fees/heads', { name: 'Admission fee', code: 'ADM', feeType: 'ADMISSION', incomeAccountId: examIncome });
    expect(adm.body.incomeAccount.code).toBe('4120');
    heads.ADM = adm.body.id;
    const fix = await http().patch(`${API}/fees/heads/${adm.body.id}`).set(auth(A.session)).send({ incomeAccountId: opts.accounts.find((a: { code: string }) => a.code === '4110').id });
    expect(fix.body.incomeAccount.code).toBe('4110');
  });

  it('refuses a duplicate code, a group or asset account, and campus-only managers', async () => {
    expect((await post('/fees/heads', { name: 'Tuition again', code: 'TUITION', feeType: 'ACADEMIC' })).body.type).toBe('code-taken');
    const db = ownerDb();
    const group = await db.account.findFirst({ where: { tenantId: A.tenantId, systemKey: 'INCOME' } });
    const cash = await db.account.findFirst({ where: { tenantId: A.tenantId, systemKey: 'CASH' } });
    await db.$disconnect();
    expect((await post('/fees/heads', { name: 'Bad', code: 'BAD1', feeType: 'OTHER', incomeAccountId: group!.id })).body.type).toBe('account-not-postable');
    expect((await post('/fees/heads', { name: 'Bad', code: 'BAD2', feeType: 'OTHER', incomeAccountId: cash!.id })).body.type).toBe('account-not-postable');
    await createRole(A.tenantId, 'NORTH_FEES', [PERMISSIONS.FEE_READ, PERMISSIONS.FEE_SETUP_MANAGE]);
    const northFees = (await addMember(app, A.session, { label: 'NorthFees', roleCode: 'NORTH_FEES', campusId: north })).session;
    const res = await post('/fees/heads', { name: 'Lab fee', code: 'LAB', feeType: 'ACADEMIC' }, northFees);
    expect(res.status).toBe(403);
    expect(res.body.type).toBe('institution-scope');
  });
});

describe('AC29 fee structures', () => {
  let s1: string;

  it('a draft keeps instalments and amounts; the total is the exact sum; empty cells are not stored', async () => {
    const res = await post('/fees/structures', structure());
    expect(res.status).toBe(201);
    s1 = res.body.id;
    expect(res.body).toMatchObject({ status: 'DRAFT', totalAmount: '41000.5' });
    expect(res.body.instalments.map((i: { name: string }) => i.name)).toEqual(['Term 1', 'Term 2', 'Term 3']);
    expect(res.body.items).toHaveLength(4); // the ₹0 admission cell is not a line
    const sum = res.body.items.reduce((a: number, i: { amount: string }) => a + toPaise(i.amount), 0);
    expect(fromPaise(sum)).toBe('41000.50');
  });

  it('refuses bad input: due dates out of order, a head twice, negative or 3-decimal amounts, another campus’s class', async () => {
    const bad = (over: Record<string, unknown>) => post('/fees/structures', structure(over));
    expect((await bad({ instalments: [{ instalmentNo: 1, name: 'T1', dueDate: '2026-10-10' }, { instalmentNo: 2, name: 'T2', dueDate: '2026-06-10' }], items: [] })).status).toBe(422);
    expect((await bad({ items: [{ feeHeadId: heads.TUITION, instalmentNo: 1, amount: '1' }, { feeHeadId: heads.TUITION, instalmentNo: 1, amount: '2' }] })).status).toBe(422);
    expect((await bad({ items: [{ feeHeadId: heads.TUITION, instalmentNo: 1, amount: '-5' }] })).status).toBe(422);
    expect((await bad({ items: [{ feeHeadId: heads.TUITION, instalmentNo: 1, amount: '10.555' }] })).status).toBe(422);
    expect((await bad({ items: [{ feeHeadId: heads.TUITION, instalmentNo: 4, amount: '10' }] })).status).toBe(422);
    expect((await bad({ programLevelId: puc1 })).status).toBe(404);
  });

  it('activation: only one active structure per class, year and fee group; an empty structure cannot go live', async () => {
    expect((await post(`/fees/structures/${s1}/activate`, {})).body.status).toBe('ACTIVE');
    const second = await post('/fees/structures', structure({ name: 'Another Class 1' }));
    expect((await post(`/fees/structures/${second.body.id}/activate`, {})).body.type).toBe('structure-exists');
    const group = await post('/fees/structures', structure({ name: 'Class 1 — new admission', feeGroup: 'New admission' }));
    expect((await post(`/fees/structures/${group.body.id}/activate`, {})).body.status).toBe('ACTIVE');
    const empty = await post('/fees/structures', structure({ programLevelId: class2, name: 'Empty', items: [] }));
    expect((await post(`/fees/structures/${empty.body.id}/activate`, {})).body.type).toBe('structure-empty');
    expect((await http().delete(`${API}/fees/structures/${empty.body.id}`).set(auth(A.session))).body).toEqual({ deleted: true });
    expect((await http().delete(`${API}/fees/structures/${second.body.id}`).set(auth(A.session))).status).toBe(200);
  });

  it('an active structure is locked — in the API and in the database', async () => {
    const edit = await http().patch(`${API}/fees/structures/${s1}`).set(auth(A.session)).send({ name: 'Changed name', instalments: structure().instalments, items: [] });
    expect(edit.body.type).toBe('structure-locked');
    expect((await http().delete(`${API}/fees/structures/${s1}`).set(auth(A.session))).body.type).toBe('structure-locked');
    const db = ownerDb();
    const item = await db.feeStructureItem.findFirst({ where: { feeStructureId: s1 } });
    await expect(db.feeStructureItem.update({ where: { id: item!.id }, data: { amount: '1' } })).rejects.toThrow(/fee_structure_locked/);
    await expect(db.feeStructure.update({ where: { id: s1 }, data: { totalAmount: '1' } })).rejects.toThrow(/fee_structure_locked/);
    await expect(db.feeStructure.update({ where: { id: s1 }, data: { status: 'DRAFT' } })).rejects.toThrow(/fee_structure_locked/);
    await db.$disconnect();
  });

  it('revise → edit the draft → activate: the old version closes, still exactly one active', async () => {
    const rev = await post(`/fees/structures/${s1}/revise`, {});
    expect(rev.status).toBe(201);
    expect(rev.body).toMatchObject({ status: 'DRAFT', revisionOfId: s1, totalAmount: '41000.5' });
    expect((await post(`/fees/structures/${s1}/revise`, {})).body.type).toBe('revision-exists');
    const items = structure().items.map((i) => (i.feeHeadId === heads.TUITION && i.instalmentNo === 1 ? { ...i, amount: '13000' } : i));
    const edited = await http().patch(`${API}/fees/structures/${rev.body.id}`).set(auth(A.session)).send({ name: 'Class 1 fees 2026-27 (revised)', instalments: structure().instalments, items });
    expect(edited.body.totalAmount).toBe('42000.5');
    expect((await post(`/fees/structures/${rev.body.id}/activate`, {})).body.status).toBe('ACTIVE');
    const list = (await http().get(`${API}/fees/structures?programLevelId=${class1}`).set(auth(A.session))).body;
    expect(list.map((s: { name: string; status: string }) => `${s.name} | ${s.status}`).sort()).toEqual([
      'Class 1 fees 2026-27 (revised) | ACTIVE', 'Class 1 fees 2026-27 | CLOSED', 'Class 1 — new admission | ACTIVE',
    ].sort());
  });

  it('copies to next year (and other classes) as drafts with due dates moved a year', async () => {
    const list = (await http().get(`${API}/fees/structures?programLevelId=${class1}&status=ACTIVE`).set(auth(A.session))).body;
    const src = list.find((s: { feeGroup: string | null }) => !s.feeGroup);
    const res = await post(`/fees/structures/${src.id}/copy`, { academicYearId: nextYear, programLevelIds: [class1, class2] });
    expect(res.status).toBe(201);
    expect(res.body.map((s: { name: string; status: string }) => [s.name, s.status])).toEqual([
      ['Class 1 fees 2027-28 (revised)', 'DRAFT'], ['Class 2 fees 2027-28 (revised)', 'DRAFT'],
    ]);
    expect(res.body[0].instalments.map((i: { dueDate: string }) => i.dueDate.slice(0, 10))).toEqual(['2027-06-10', '2027-10-10', '2028-01-10']);
    expect(res.body[1].totalAmount).toBe('42000.5');
    expect((await post(`/fees/structures/${src.id}/copy`, { academicYearId: nextYear, programLevelIds: [puc1] })).status).toBe(404);
  });
});

describe('AC29 late-fee rules', () => {
  it('saves rules and refuses impossible values', async () => {
    const r = await post('/fees/late-fee-rules', { name: 'Tuition late fee', feeHeadId: heads.TUITION, graceDays: 7, fineType: 'PER_DAY', fineValue: '10', maxFine: '500' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ fineValue: '10', maxFine: '500', status: 'ACTIVE' });
    expect((await post('/fees/late-fee-rules', { name: 'Too much', graceDays: 0, fineType: 'PERCENT', fineValue: '150' })).status).toBe(422);
    expect((await post('/fees/late-fee-rules', { name: 'Nothing', graceDays: 0, fineType: 'FIXED', fineValue: '0' })).status).toBe(422);
    const off = await http().patch(`${API}/fees/late-fee-rules/${r.body.id}`).set(auth(A.session)).send({ name: 'Tuition late fee', feeHeadId: heads.TUITION, graceDays: 7, fineType: 'PER_DAY', fineValue: '10', maxFine: '500', status: 'INACTIVE' });
    expect(off.body.status).toBe('INACTIVE');
    expect((await http().get(`${API}/fees/late-fee-rules`).set(auth(A.session))).body).toHaveLength(1);
  });
});

describe('AC29 campus scope, isolation and module switch', () => {
  it('campus managers see and change only their campus; other institutions see nothing', async () => {
    const northFees = (await addMember(app, A.session, { label: 'NorthFees2', roleCode: 'NORTH_FEES', campusId: north })).session;
    const pu = await post('/fees/structures', structure({ campusId: north, programLevelId: puc1, name: 'I PUC fees', items: [{ feeHeadId: heads.TUITION, instalmentNo: 1, amount: '20000' }] }), northFees);
    expect(pu.status).toBe(201);
    expect((await post('/fees/structures', structure(), northFees)).status).toBe(404);
    const theirs = (await http().get(`${API}/fees/structures`).set(auth(northFees))).body;
    expect(theirs.map((s: { name: string }) => s.name)).toEqual(['I PUC fees']);
    const mainOne = (await http().get(`${API}/fees/structures?programLevelId=${class1}`).set(auth(A.session))).body[0].id;
    expect((await http().get(`${API}/fees/structures/${mainOne}`).set(auth(northFees))).status).toBe(404);
    expect((await http().get(`${API}/fees/structures/${mainOne}`).set(auth(B.session))).status).toBe(404);
    expect((await http().get(`${API}/fees/structures`).set(auth(B.session))).body).toEqual([]);
  });

  it('without the permission or the module, fee routes are refused', async () => {
    await createRole(A.tenantId, 'NO_FEES', []);
    const nobody = (await addMember(app, A.session, { label: 'NoFees', roleCode: 'NO_FEES' })).session;
    expect((await http().get(`${API}/fees/structures`).set(auth(nobody))).status).toBe(403);
    const db = ownerDb();
    await db.tenantModule.updateMany({ where: { tenantId: A.tenantId, moduleCode: 'FEES' }, data: { isEnabled: false } });
    try {
      const off = await http().get(`${API}/fees/structures`).set(auth(A.session));
      expect(off.body.type).toBe('module-not-enabled');
    } finally {
      await db.tenantModule.updateMany({ where: { tenantId: A.tenantId, moduleCode: 'FEES' }, data: { isEnabled: true } });
      await db.$disconnect();
    }
  });
});
