/**
 * Phase 23 fees at go-live: AC119 earlier-year dues stay open after the year changes and are shown with
 * their year (dues list, student page, carried-dues report); AC120 opening dues import (checked rows,
 * once per student and year, posted to accounts, an ordinary bill); AC121 student credit balance
 * (kept at the counter only when chosen, used against a bill within limits, cancelled by reversal,
 * refunded through approval, used automatically when the setting is on, matching the accounts).
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { IMPORT_TYPES, PERMISSIONS, toPaise } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, auth, createRole, createTenant, login, ownerDb, startApp, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let cashier: Session;
let principal: Session;
let campus: string;
let y1: string;
let y2: string;
let chargeHead: string;
const ids: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const P = (v: string | number | { toString(): string }) => toPaise(v.toString());
const account = async (name: string) => (await get(`/fees/students/${ids[name]}`)).body;
const credit = async (name: string) => (await get(`/fees/students/${ids[name]}/credit`)).body;

async function upload(type: 'STUDENTS' | 'OPENING_DUES', rows: Record<string, string>[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(IMPORT_TYPES[type].columns.map((c) => c.header));
  for (const r of rows) ws.addRow(IMPORT_TYPES[type].columns.map((c) => (r as Record<string, string>)[c.key] ?? ''));
  return http().post(`${API}/imports/${type}`).set(auth(A.session)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 'f.xlsx');
}

/** The student's balance on "Fees received in advance" straight from the journal. */
async function ledgerCredit(studentId: string) {
  const db = ownerDb();
  const lines = await db.journalLine.findMany({ where: { tenantId: A.tenantId, partyId: studentId, account: { systemKey: 'FEE_ADVANCE' } } });
  await db.$disconnect();
  return lines.reduce((a, l) => a + P(l.credit) - P(l.debit), 0);
}

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'GoLive');
  campus = (await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  y1 = (await post('/academic-years', { name: '2025-26', startDate: '2025-06-01', endDate: '2026-03-31', makeCurrent: true })).body.id;
  y2 = (await post('/academic-years', { name: '2026-27', startDate: '2026-06-01', endDate: '2027-03-31' })).body.id;
  const sbs = await post('/programs', { campusId: campus, name: 'State Board School', code: 'SBS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 10 });
  const class1 = sbs.body.levels[0].id;
  await post('/sections', { academicYearId: y1, programLevelId: class1, names: ['A'], capacity: 40 });
  const tuition = (await post('/fees/heads', { name: 'Tuition fee', code: 'TUITION', feeType: 'ACADEMIC' })).body.id;
  chargeHead = (await post('/fees/heads', { name: 'Books', code: 'BOOKS', feeType: 'OTHER' })).body.id;
  const st = await post('/fees/structures', {
    campusId: campus, academicYearId: y1, programLevelId: class1, name: 'Class 1 fees',
    instalments: [{ instalmentNo: 1, name: 'Year', dueDate: '2025-06-10' }],
    items: [{ feeHeadId: tuition, instalmentNo: 1, amount: '10000' }],
  });
  await post(`/fees/structures/${st.body.id}/activate`, {});
  const job = await upload('STUDENTS', [['G/1', 'Asha'], ['G/2', 'Bala'], ['G/3', 'Chitra'], ['G/4', 'Dev']].map(([n, f]) => ({
    admissionNo: n, firstName: f, lastName: 'Test', dob: '2019-01-01', gender: 'Girl', campusCode: 'MAIN', programCode: 'SBS', className: 'Class 1', section: 'A', fatherName: 'Parent', parentPhone: `98450${n.slice(2).padStart(5, '0')}`,
  })));
  await post(`/imports/jobs/${job.body.id}/commit`, {});
  for (const s of (await get('/students?pageSize=100')).body.items) ids[s.firstName] = s.id;
  await post('/fees/billing/runs', { academicYearId: y1, instalmentNo: 1 });
  await createRole(A.tenantId, 'CASHIER', [PERMISSIONS.FEE_READ, PERMISSIONS.FEE_COLLECT]);
  await createRole(A.tenantId, 'PRINCIPAL', [PERMISSIONS.APPROVALS_REQUEST_READ]);
  cashier = (await addMember(app, A.session, { label: 'Cashier', roleCode: 'CASHIER' })).session;
  principal = (await addMember(app, A.session, { label: 'Principal', roleCode: 'PRINCIPAL' })).session;
  // The new year starts: last year's bills are still open.
  expect((await post(`/academic-years/${y2}/make-current`, {})).status).toBeLessThan(300);
}, 180_000);
afterAll(() => app?.close());

describe('AC119 earlier-year dues', () => {
  it('stay open after the year changes and are shown with their year', async () => {
    const a = await account('Asha');
    expect(a.year.name).toBe('2026-27');
    expect(a.totals).toMatchObject({ balance: '10000.00', earlier: '10000.00' });
    expect(a.invoices[0]).toMatchObject({ yearLabel: '2025-26', isEarlier: true, isOpening: false, balanceAmount: '10000' });
    const d = (await get('/fees/dues?pageSize=50')).body;
    expect(d.totals).toMatchObject({ students: 4, balance: '40000.00', earlier: '40000.00' });
    expect(d.items.find((r: { studentId: string }) => r.studentId === ids.Asha).earlier).toBe('10000.00');
    expect((await get('/fees/dues?earlier=only')).body.total).toBe(4);
  });

  it('the carried-dues report lists them by year and class and matches the open bills', async () => {
    const r = (await get('/fees/reports/carried-dues')).body;
    expect(r).toMatchObject({ total: '40000.00', students: 4, byYear: [{ yearLabel: '2025-26', balance: '40000.00' }] });
    expect(r.items).toHaveLength(4);
    expect(r.items[0]).toMatchObject({ yearLabel: '2025-26', isOpening: false });
    expect((await get('/fees/reports/carried-dues', cashier)).status).toBe(200);
  });
});

describe('AC120 opening dues', () => {
  it('the import checks rows: known student, an earlier year, a real amount, once per student and year', async () => {
    const job = await upload('OPENING_DUES', [
      { admissionNo: 'G/2', yearLabel: '2024-25', amount: '3,000', dueDate: '2026-06-30', description: 'Balance tuition 2024-25' },
      { admissionNo: 'G/3', yearLabel: '2024-2025', amount: '1200.50' },
      { admissionNo: 'G/2', yearLabel: '2024-25', amount: '10' }, // twice in the file
      { admissionNo: 'G/9', yearLabel: '2024-25', amount: '10' }, // unknown student
      { admissionNo: 'G/4', yearLabel: '2026-27', amount: '10' }, // the current year
      { admissionNo: 'G/4', yearLabel: '2024-26', amount: '10' }, // not a year
      { admissionNo: 'G/4', yearLabel: '2024-25', amount: '0' },
    ]);
    expect(job.status).toBe(201);
    expect(job.body).toMatchObject({ validRows: 2, errorRows: 5 });
    expect((await post(`/imports/jobs/${job.body.id}/commit`, {})).status).toBeLessThan(300);
    const again = await upload('OPENING_DUES', [{ admissionNo: 'G/2', yearLabel: '2024-25', amount: '50' }]);
    expect(again.body).toMatchObject({ validRows: 0, errorRows: 1 });
    // A cashier cannot import opening dues.
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Data').addRow(IMPORT_TYPES.OPENING_DUES.columns.map((c) => c.header));
    expect((await http().post(`${API}/imports/OPENING_DUES`).set(auth(cashier)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 'f.xlsx')).status).toBe(403);
  });

  it('each row is an ordinary bill marked with its year, posted Dr receivable / Cr General fund', async () => {
    const b = await account('Bala');
    const op = b.invoices.find((i: { isOpening: boolean }) => i.isOpening);
    expect(op).toMatchObject({ yearLabel: '2024-25', isEarlier: true, netAmount: '3000', balanceAmount: '3000', description: 'Balance tuition 2024-25', status: 'UNPAID' });
    expect(b.totals).toMatchObject({ balance: '13000.00', earlier: '13000.00' });
    expect((await account('Chitra')).invoices.find((i: { isOpening: boolean }) => i.isOpening)).toMatchObject({ yearLabel: '2024-25', netAmount: '1200.5', description: 'Opening dues 2024-25' });
    const db = ownerDb();
    const e = await db.journalEntry.findUniqueOrThrow({ where: { id: op.journalEntryId }, include: { lines: { include: { account: true } } } });
    await db.$disconnect();
    expect(e.lines.map((l) => [l.account.systemKey, l.debit.toString(), l.credit.toString()]).sort()).toEqual([['CAPITAL_FUND', '0', '3000'], ['STUDENT_RECEIVABLE', '3000', '0']]);
    const r = (await get('/fees/reports/carried-dues')).body;
    expect(r.total).toBe('44200.50');
    expect(r.byYear).toEqual([{ yearLabel: '2024-25', balance: '4200.50' }, { yearLabel: '2025-26', balance: '40000.00' }]);
    // It is collected like any bill.
    await post('/fees/counter/open', { campusId: campus, openingCash: '0' }, cashier);
    const pay = await post('/fees/payments', { studentId: ids.Chitra, amount: '1200.50', mode: 'CASH', payerName: 'Parent', invoiceIds: [(await account('Chitra')).invoices.find((i: { isOpening: boolean }) => i.isOpening).id] }, cashier);
    expect(pay.status).toBe(201);
    expect((await account('Chitra')).invoices.find((i: { isOpening: boolean }) => i.isOpening).status).toBe('PAID');
  });
});

describe('AC121 student credit balance', () => {
  let chitraReceipt: string;

  it('money over the bills becomes credit at the counter only when chosen', async () => {
    const over = await post('/fees/payments', { studentId: ids.Chitra, amount: '12000', mode: 'CASH', payerName: 'Parent' }, cashier);
    expect(over.body.type).toBe('more-than-due');
    const r = await post('/fees/payments', { studentId: ids.Chitra, amount: '12000', mode: 'CASH', payerName: 'Parent', keepCredit: true }, cashier);
    expect(r.status).toBe(201);
    chitraReceipt = r.body.id;
    const a = await account('Chitra');
    expect(a.totals.balance).toBe('0.00');
    expect(a.credit).toMatchObject({ balance: '2000.00', available: '2000.00', pendingRefunds: '0.00' });
    expect(await ledgerCredit(ids.Chitra)).toBe(P('2000'));
    const c = await credit('Chitra');
    expect(c.movements[0]).toMatchObject({ added: '2000.00', used: '0.00', balance: '2000.00' });
    // Without the choice, a payment with nothing due is still refused.
    expect((await post('/fees/payments', { studentId: ids.Chitra, amount: '100', mode: 'CASH', payerName: 'Parent' }, cashier)).body.type).toBe('nothing-due');
  });

  it('credit is used against a chosen bill — never more than the credit or the bill', async () => {
    const op = (await account('Bala')).invoices.find((i: { isOpening: boolean }) => i.isOpening);
    // Bala has no credit.
    expect((await post(`/fees/students/${ids.Bala}/credit/adjust`, { invoiceId: op.id, amount: '10' }, cashier)).body.type).toBe('more-than-credit');
    // Chitra's credit cannot pay someone else's bill.
    expect((await post(`/fees/students/${ids.Chitra}/credit/adjust`, { invoiceId: op.id, amount: '10' }, cashier)).status).toBe(404);
    // Give Chitra a new bill and use part of her credit on it.
    const ch = await post(`/fees/students/${ids.Chitra}/charges`, { feeHeadId: chargeHead, amount: '1500', dueDate: '2026-07-15', description: 'Books 2026-27' });
    expect(ch.status).toBe(201);
    const bill = (await account('Chitra')).invoices.find((i: { description: string }) => i.description === 'Books 2026-27');
    expect(bill.isEarlier).toBe(false);
    expect((await post(`/fees/students/${ids.Chitra}/credit/adjust`, { invoiceId: bill.id, amount: '1600' }, cashier)).body.type).toBe('more-than-due');
    const adj = await post(`/fees/students/${ids.Chitra}/credit/adjust`, { invoiceId: bill.id, amount: '1500', note: 'Parent asked' }, cashier);
    expect(adj.status).toBe(201);
    expect(adj.body).toMatchObject({ adjustmentNo: 'ADJ/2026-27/0001', amount: '1500', source: 'MANUAL', status: 'ACTIVE' });
    expect((await account('Chitra')).invoices.find((i: { id: string }) => i.id === bill.id)).toMatchObject({ status: 'PAID', balanceAmount: '0' });
    expect((await credit('Chitra'))).toMatchObject({ balance: '500.00', available: '500.00' });
    expect(await ledgerCredit(ids.Chitra)).toBe(P('500'));
    // The receipt that made the credit cannot be cancelled now that its credit is used.
    expect((await post(`/fees/payments/${chitraReceipt}/cancel`, { reason: 'Entered by mistake' })).body.type).toBe('credit-used');
  });

  it('an adjustment is cancelled by reversal: the bill opens again and the credit comes back', async () => {
    const c = await credit('Chitra');
    const id = c.adjustments[0].id;
    expect((await post(`/fees/credit-adjustments/${id}/cancel`, { reason: 'Wrong bill' }, cashier)).status).toBe(403);
    expect((await post(`/fees/credit-adjustments/${id}/cancel`, { reason: 'Wrong bill chosen' })).status).toBe(201);
    expect((await post(`/fees/credit-adjustments/${id}/cancel`, { reason: 'Wrong bill chosen' })).body.type).toBe('adjustment-final');
    expect(await credit('Chitra')).toMatchObject({ balance: '2000.00' });
    expect((await account('Chitra')).invoices.find((i: { description: string }) => i.description === 'Books 2026-27')).toMatchObject({ status: 'UNPAID', balanceAmount: '1500' });
    expect(await ledgerCredit(ids.Chitra)).toBe(P('2000'));
  });

  it('credit is refunded only through approval and never beyond what is left', async () => {
    expect((await post(`/fees/students/${ids.Chitra}/credit/refunds`, { amount: '500', reason: 'Parent wants it back', refundMode: 'CASH' }, cashier)).body.type).toBe('approval-rule-missing');
    const db = ownerDb();
    const role = await db.role.findFirstOrThrow({ where: { tenantId: A.tenantId, code: 'PRINCIPAL' } });
    await db.$disconnect();
    expect((await post('/approvals/rules', { entityType: 'REFUND', levelNo: 1, approverRoleId: role.id })).status).toBe(201);
    expect((await post(`/fees/students/${ids.Chitra}/credit/refunds`, { amount: '2000.01', reason: 'Too much asked', refundMode: 'CASH' }, cashier)).body.type).toBe('more-than-credit');
    const r = await post(`/fees/students/${ids.Chitra}/credit/refunds`, { amount: '500', reason: 'Parent wants part back', refundMode: 'BANK_TRANSFER' }, cashier);
    expect(r.body).toMatchObject({ status: 'PENDING', kind: 'CREDIT', paymentId: null });
    expect(await credit('Chitra')).toMatchObject({ balance: '2000.00', pendingRefunds: '500.00', available: '1500.00' });
    const inbox = (await get('/approvals/inbox', principal)).body;
    const req = (inbox.items ?? inbox).find((x: { entityId: string }) => x.entityId === r.body.id);
    expect((await post(`/approvals/requests/${req.id}/act`, { action: 'APPROVE' }, principal)).status).toBe(201);
    expect((await get(`/fees/students/${ids.Chitra}/refunds`)).body.find((x: { id: string }) => x.id === r.body.id)).toMatchObject({ status: 'PAID', amount: '500' });
    expect(await credit('Chitra')).toMatchObject({ balance: '1500.00', pendingRefunds: '0.00', available: '1500.00' });
    expect(await ledgerCredit(ids.Chitra)).toBe(P('1500'));
  });

  it('with the setting on, a new bill uses the credit straight away', async () => {
    expect((await http().put(`${API}/settings/fees.auto_use_credit`).set(auth(A.session)).send({ value: true })).status).toBe(200);
    await post(`/fees/students/${ids.Chitra}/charges`, { feeHeadId: chargeHead, amount: '1000', dueDate: '2026-08-01', description: 'Uniform 2026-27' });
    const bill = (await account('Chitra')).invoices.find((i: { description: string }) => i.description === 'Uniform 2026-27');
    expect(bill).toMatchObject({ status: 'PAID', balanceAmount: '0' });
    const c = await credit('Chitra');
    expect(c).toMatchObject({ balance: '500.00' });
    expect(c.adjustments[0]).toMatchObject({ source: 'AUTO', amount: '1000', invoiceNo: bill.invoiceNo });
    // A bill larger than the credit uses what there is.
    await post(`/fees/students/${ids.Chitra}/charges`, { feeHeadId: chargeHead, amount: '800', dueDate: '2026-08-01', description: 'Trip 2026-27' });
    expect((await account('Chitra')).invoices.find((i: { description: string }) => i.description === 'Trip 2026-27')).toMatchObject({ status: 'PARTIAL', balanceAmount: '300' });
    expect(await credit('Chitra')).toMatchObject({ balance: '0.00' });
    await http().put(`${API}/settings/fees.auto_use_credit`).set(auth(A.session)).send({ value: false });
  });

  it('the advances report matches the accounts; every bill and credit movement is balanced', async () => {
    await post('/fees/payments', { studentId: ids.Dev, amount: '10250', mode: 'CASH', payerName: 'Parent', keepCredit: true }, cashier);
    const r = (await get('/fees/reports/advances')).body;
    expect(r).toMatchObject({ total: '250.00', students: 1, accountBalance: '250.00', matchesAccounts: true });
    expect(r.items[0]).toMatchObject({ studentId: ids.Dev, credit: '250.00' });
    const db = ownerDb();
    const bad = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM (SELECT e.id FROM journal_entries e JOIN journal_lines l ON l.journal_entry_id = e.id WHERE e.tenant_id = ${A.tenantId}::uuid GROUP BY e.id HAVING sum(l.debit) <> sum(l.credit)) x`;
    const audits = await db.auditLog.count({ where: { tenantId: A.tenantId, entityType: 'FEE_CREDIT_ADJUSTMENT' } });
    await db.$disconnect();
    expect(Number(bad[0].n)).toBe(0);
    expect(audits).toBeGreaterThanOrEqual(2);
  });
});
