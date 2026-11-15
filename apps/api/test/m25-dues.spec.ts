/**
 * AC33 dues & reports (M2.5): dues and ageing equal open bills minus payments to the paisa; late fees
 * follow the most specific rule, grace days and cap, never grow twice on the same day, and can be
 * waived (and stay waived); the no-dues check is right for unpaid / partly paid / fully paid; reports
 * match the accounts (also after a cancelled receipt); reminders reach parents with an email;
 * campus scope and isolation.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { IMPORT_TYPES, PERMISSIONS, ageingBucket, toPaise } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, auth, createRole, createTenant, login, ownerDb, startApp, Session } from './helpers';
import { ruleFor } from '../src/modules/fees/late-fee.service';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let viewer: Session;
let campus: string;
let year: string;
const heads: Record<string, string> = {};
const ids: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const P = (v: { toString(): string }) => toPaise(v.toString());
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const shift = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const binary = (r: request.Test) => r.buffer(true).parse((res, cb) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
});
const row = (name: string, d: { items: { firstName: string }[] }) => d.items.find((i) => i.firstName === name) as Record<string, string> | undefined;
const bills = async (name: string) => (await get(`/fees/students/${ids[name]}`)).body.invoices.sort((a: { instalmentNo: number }, b: { instalmentNo: number }) => a.instalmentNo - b.instalmentNo);

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'DueA');
  B = await createTenant(app, platform, 'DueB');
  campus = (await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  year = (await post('/academic-years', { name: '2026-27', startDate: '2026-06-01', endDate: '2027-03-31', makeCurrent: true })).body.id;
  const sbs = await post('/programs', { campusId: campus, name: 'State Board School', code: 'SBS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 10 });
  const class1 = sbs.body.levels[0].id;
  await post('/sections', { academicYearId: year, programLevelId: class1, names: ['A'], capacity: 40 });
  heads.T = (await post('/fees/heads', { name: 'Tuition fee', code: 'TUITION', feeType: 'ACADEMIC' })).body.id;
  heads.A = (await post('/fees/heads', { name: 'Admission fee', code: 'ADM', feeType: 'ADMISSION' })).body.id;
  const st = await post('/fees/structures', {
    campusId: campus, academicYearId: year, programLevelId: class1, name: 'Class 1 fees',
    instalments: [
      { instalmentNo: 1, name: 'Term 1', dueDate: shift(-100) }, { instalmentNo: 2, name: 'Term 2', dueDate: shift(-45) },
      { instalmentNo: 3, name: 'Term 3', dueDate: shift(-10) }, { instalmentNo: 4, name: 'Term 4', dueDate: shift(30) },
    ],
    items: [
      { feeHeadId: heads.T, instalmentNo: 1, amount: '10000' }, { feeHeadId: heads.A, instalmentNo: 1, amount: '2000' },
      { feeHeadId: heads.T, instalmentNo: 2, amount: '10000' }, { feeHeadId: heads.T, instalmentNo: 3, amount: '5000' }, { feeHeadId: heads.T, instalmentNo: 4, amount: '5000' },
    ],
  });
  expect((await post(`/fees/structures/${st.body.id}/activate`, {})).body.status).toBe('ACTIVE');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => c.header));
  for (const [n, f, email] of [['1', 'Asha', 'asha.parent@example.in'], ['2', 'Bala', 'bala.parent@example.in'], ['3', 'Chitra', ''], ['4', 'Dev', '']]) {
    const r: Record<string, string> = { admissionNo: `D/${n}`, firstName: f, lastName: 'Test', dob: '2019-01-01', gender: 'Girl', campusCode: 'MAIN', programCode: 'SBS', className: 'Class 1', section: 'A', fatherName: 'Parent', parentPhone: `987650002${n}`, parentEmail: email };
    ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => r[c.key] ?? ''));
  }
  const job = await http().post(`${API}/imports/STUDENTS`).set(auth(A.session)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 's.xlsx');
  await post(`/imports/jobs/${job.body.id}/commit`, {});
  for (const s of (await get('/students?pageSize=100')).body.items) ids[s.firstName] = s.id;
  for (const n of [1, 2, 3, 4]) await post('/fees/billing/runs', { academicYearId: year, instalmentNo: n });
  // Payments: Bala pays Term 1, Chitra everything, Dev ₹4,000 of Term 1.
  const pay = (name: string, amount: string, mode: string, ref: string) => post('/fees/payments', { studentId: ids[name], amount, mode, referenceNo: ref, payerName: 'Parent' });
  expect((await pay('Bala', '12000', 'UPI', 'U-1')).status).toBe(201);
  expect((await pay('Chitra', '32000', 'UPI', 'U-2')).status).toBe(201);
  expect((await pay('Dev', '4000', 'BANK_TRANSFER', 'NEFT-1')).status).toBe(201);
  await createRole(A.tenantId, 'FEE_VIEWER', [PERMISSIONS.FEE_READ]);
  viewer = (await addMember(app, A.session, { label: 'Viewer', roleCode: 'FEE_VIEWER' })).session;
}, 120_000);
afterAll(() => app?.close());

describe('helpers', () => {
  it('ageing buckets and late-fee rule choice', () => {
    expect([0, 1, 30, 31, 60, 61, 90, 91].map((d) => ageingBucket(shift(-d), today))).toEqual(['NOT_DUE', 'D1_30', 'D1_30', 'D31_60', 'D31_60', 'D61_90', 'D61_90', 'D90_PLUS']);
    const r = (id: string, campusId: string | null, feeHeadId: string | null) => ({ id, campusId, feeHeadId, graceDays: 0, fineType: 'FIXED' as const, fineValue: 1 as never, maxFine: null });
    const rules = [r('all', null, null), r('campus', 'C', null), r('head', null, 'H'), r('both', 'C', 'H')];
    expect(ruleFor(rules, 'C', 'H')!.id).toBe('both');
    expect(ruleFor(rules, 'X', 'H')!.id).toBe('head');
    expect(ruleFor(rules, 'C', 'Z')!.id).toBe('campus');
    expect(ruleFor(rules, 'X', 'Z')!.id).toBe('all');
    expect(ruleFor([r('head', null, 'H')], 'X', 'Z')).toBeNull();
  });
});

describe('AC33 dues and ageing', () => {
  it('match open bills minus payments to the paisa', async () => {
    const d = (await get('/fees/dues?sort=name')).body;
    expect(d.items.map((i: { firstName: string }) => i.firstName)).toEqual(['Asha', 'Bala', 'Dev']); // Chitra has paid everything
    expect(row('Asha', d)).toMatchObject({ balance: '32000.00', overdue: '27000.00', notDue: '5000.00', d1_30: '5000.00', d31_60: '10000.00', d61_90: '0.00', d90_plus: '12000.00', bills: 4 });
    expect(row('Bala', d)).toMatchObject({ balance: '20000.00', overdue: '15000.00', d90_plus: '0.00' });
    expect(row('Dev', d)).toMatchObject({ balance: '28000.00', d90_plus: '8000.00' });
    expect(d.totals).toMatchObject({ students: 3, balance: '80000.00', overdue: '65000.00', notDue: '15000.00' });
    const db = ownerDb();
    const inv = await db.feeInvoice.findMany({ where: { tenantId: A.tenantId, status: { in: ['UNPAID', 'PARTIAL'] } } });
    const pay = await db.payment.findMany({ where: { tenantId: A.tenantId, status: 'SUCCESS' } });
    const all = await db.feeInvoice.findMany({ where: { tenantId: A.tenantId, status: { not: 'CANCELLED' } } });
    await db.$disconnect();
    expect(inv.reduce((a, i) => a + P(i.balanceAmount), 0)).toBe(P('80000'));
    expect(all.reduce((a, i) => a + P(i.netAmount), 0) - pay.reduce((a, p) => a + P(p.amount), 0)).toBe(P('80000'));
  });

  it('filters by days overdue, minimum balance and name; sorts; pages', async () => {
    const names = async (qs: string) => (await get(`/fees/dues?${qs}`)).body.items.map((i: { firstName: string }) => i.firstName);
    expect(await names('minDaysOverdue=60&sort=name')).toEqual(['Asha', 'Dev']);
    expect(await names('minBalance=25000&sort=balance')).toEqual(['Asha', 'Dev']);
    expect(await names('q=bala')).toEqual(['Bala']);
    const p2 = (await get('/fees/dues?sort=balance&pageSize=2&page=2')).body;
    expect(p2).toMatchObject({ total: 3, page: 2 });
    expect(p2.items.map((i: { firstName: string }) => i.firstName)).toEqual(['Bala']);
  });

  it('the no-dues check: unpaid, partly paid and fully paid', async () => {
    expect((await get(`/fees/students/${ids.Chitra}/no-dues`)).body).toMatchObject({ clear: true, balance: '0.00' });
    expect((await get(`/fees/students/${ids.Dev}/no-dues`)).body).toMatchObject({ clear: false, balance: '28000.00', overdue: '23000.00' });
    const asha = (await get(`/fees/students/${ids.Asha}/no-dues`, viewer)).body;
    expect(asha.clear).toBe(false);
    expect(asha.openBills).toHaveLength(4);
  });
});

describe('AC33 late fees', () => {
  it('follow the most specific rule, grace days and cap; payments count against fees first', async () => {
    await post('/fees/late-fee-rules', { name: 'Tuition per day', feeHeadId: heads.T, graceDays: 7, fineType: 'PER_DAY', fineValue: '10', maxFine: '500' });
    await post('/fees/late-fee-rules', { name: 'Everything else', graceDays: 0, fineType: 'FIXED', fineValue: '100' });
    const r = await post('/fees/late-fees/apply', {});
    expect(r.status).toBe(201);
    const asha = await bills('Asha');
    // Term 1, 100 days: tuition (100−7)×₹10 = ₹930 → cap ₹500; admission fixed ₹100.  Term 2, 45 days: 38×₹10.  Term 3, 10 days: 3×₹10.  Term 4: not due.
    expect(asha.map((b: { fineAmount: string }) => b.fineAmount)).toEqual(['600', '380', '30', '0']);
    expect(asha[0]).toMatchObject({ netAmount: '12600', balanceAmount: '12600' });
    expect((await bills('Bala')).map((b: { fineAmount: string }) => b.fineAmount)).toEqual(['0', '380', '30', '0']); // Term 1 paid in full
    // Dev paid ₹4,000 of Term 1 — it went to tuition first, so tuition still has ₹6,000 unpaid (cap ₹500) and admission ₹2,000 (₹100).
    expect((await bills('Dev'))[0]).toMatchObject({ fineAmount: '600', balanceAmount: '8600' });
    expect(r.body).toMatchObject({ invoiceCount: 8, totalFine: fromRupees(600 + 380 + 30 + 380 + 30 + 600 + 380 + 30) });
    expect((await post('/fees/late-fees/apply', {})).body).toEqual({ invoiceCount: 0, totalFine: '0.00' }); // same day: nothing more
  });

  it('a waived late fee is removed with a reversal and does not come back', async () => {
    const t1 = (await bills('Asha'))[0];
    expect((await post(`/fees/invoices/${t1.id}/waive-fine`, { reason: 'Family medical emergency' })).body).toMatchObject({ fineAmount: '0', fineWaived: true, netAmount: '12000' });
    expect((await post(`/fees/invoices/${t1.id}/waive-fine`, { reason: 'Again please' })).body.type).toBe('fine-waived');
    await post('/fees/late-fees/apply', {});
    expect((await bills('Asha'))[0].fineAmount).toBe('0');
    expect((await post('/fees/late-fees/apply', {}, viewer)).status).toBe(403);
  });
});

function fromRupees(r: number) {
  return `${r}.00`;
}

describe('AC33 reports match the accounts', () => {
  it('collection by day, mode and cashier equals the receipts posted; still true after a cancelled receipt', async () => {
    const c = (await get(`/fees/reports/collection?from=${shift(-1)}&to=${today}`)).body;
    expect(c).toMatchObject({ total: '48000.00', receipts: 3, ledgerTotal: '48000.00', matchesAccounts: true });
    expect(Object.fromEntries(c.byMode.map((m: { key: string; amount: string }) => [m.key, m.amount]))).toEqual({ UPI: '44000.00', BANK_TRANSFER: '4000.00' });
    const dev = (await get(`/fees/students/${ids.Dev}`)).body.payments[0];
    expect((await post(`/fees/payments/${dev.id}/cancel`, { reason: 'Transfer was not received' })).body.status).toBe('CANCELLED');
    const c2 = (await get(`/fees/reports/collection?from=${shift(-1)}&to=${today}`)).body;
    expect(c2).toMatchObject({ total: '44000.00', receipts: 2, ledgerTotal: '44000.00', matchesAccounts: true });
  });

  it('collection by fee head adds up to the money received; dues by class match the receivable account', async () => {
    const h = (await get(`/fees/reports/by-head?from=${shift(-1)}&to=${today}`)).body;
    expect(h.total).toBe('44000.00');
    expect(h.heads.reduce((a: number, x: { amount: string }) => a + P(x.amount), 0) + P(h.advance)).toBe(P(h.total));
    expect(Object.fromEntries(h.heads.map((x: { code: string; amount: string }) => [x.code, x.amount]))).toEqual({ TUITION: '40000.00', ADM: '4000.00' });
    const d = (await get('/fees/reports/dues-by-class')).body;
    expect(d.matchesAccounts).toBe(true);
    expect(d.totalBalance).toBe(d.ledgerReceivable);
    const list = (await get('/fees/dues')).body;
    expect(d.totalBalance).toBe(list.totals.balance);
    expect((await get(`/fees/reports/collection?from=${today}&to=${shift(5)}`)).body.type).toBe('future-date');
  });
});

describe('AC33 reminders, export, scope', () => {
  it('reminders go to parents with an email (with a payment link); others are listed as skipped', async () => {
    const r = await post('/fees/reminders', { studentIds: [ids.Asha, ids.Bala, ids.Chitra, ids.Dev], includePayLink: true });
    expect(r.body.sent).toBe(2);
    expect(r.body.skipped.map((x: { reason: string }) => x.reason).sort()).toEqual(['no-email', 'nothing-due']);
    const db = ownerDb();
    const mail = await db.notificationDelivery.findFirst({ where: { tenantId: A.tenantId, recipient: 'asha.parent@example.in' } });
    const ev = await db.outboxEvent.findFirst({ where: { tenantId: A.tenantId, aggregateId: mail!.id } });
    await db.$disconnect();
    expect((ev!.payload as { body: string }).body).toMatch(/\/pay\/[A-Za-z0-9_-]{20,}/);
    expect((ev!.payload as { body: string }).body).toContain('₹');
    const d = (await get('/fees/dues?sort=name')).body;
    expect(row('Asha', d)!.lastReminder).toBeTruthy();
    expect(row('Dev', d)!.lastReminder).toBeNull();
  });

  it('the dues list exports with the same totals; other institutions see nothing', async () => {
    const x = await binary(http().get(`${API}/exports/FEE_DUES`).set(auth(A.session)));
    expect(x.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws.rowCount - 1).toBe(3);
    let sum = 0;
    ws.eachRow((r, n) => { if (n > 1) sum += P(String(r.getCell(8).text)); });
    expect(sum).toBe(P((await get('/fees/dues')).body.totals.balance));
    expect((await get('/fees/dues', B.session)).body.totals.students).toBe(0);
    expect((await get(`/fees/students/${ids.Asha}/no-dues`, B.session)).status).toBe(404);
  });
});
