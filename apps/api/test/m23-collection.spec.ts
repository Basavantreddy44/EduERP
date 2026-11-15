/**
 * AC31 counter collection (M2.3): cash needs an open counter; a payment allocates to dues and updates
 * balances in one transaction; receipts are gapless and only for successful payments; a repeated or
 * simultaneous "Collect" is recorded once; two counters cannot spend the same balance; cancel and
 * cheque bounce reverse the posting and reopen dues (optional bounce charge); the counter closes with
 * the computed difference; receipts cannot be edited; everything is audited and posted balanced.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { IMPORT_TYPES, PERMISSIONS, allocate, rupeesInWords, toPaise } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, appDb, auth, createRole, createTenant, login, ownerDb, startApp, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let cashier: Session;
let viewer: Session;
let campus: string;
let year: string;
let idHead: string;
const ids: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session, key?: string) => {
  const r = http().post(`${API}${path}`).set(auth(s));
  if (key) r.set('Idempotency-Key', key);
  return r.send(body as object);
};
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const P = (v: string | number | { toString(): string }) => toPaise(v.toString());
const bill = async (name: string) => (await get(`/fees/students/${ids[name]}`)).body.invoices.find((i: { instalmentNo: number }) => i.instalmentNo === 1);
const pay = (name: string, amount: string, mode = 'CASH', extra: Record<string, unknown> = {}, s: Session = cashier, key?: string) =>
  post('/fees/payments', { studentId: ids[name], amount, mode, payerName: 'Parent', ...extra }, s, key);

/** Receivable posted for a student = the sum of their open balances. */
async function receivableOf(studentId: string) {
  const db = ownerDb();
  const lines = await db.journalLine.findMany({ where: { tenantId: A.tenantId, partyId: studentId, account: { systemKey: 'STUDENT_RECEIVABLE' } } });
  const inv = await db.feeInvoice.findMany({ where: { tenantId: A.tenantId, studentId, status: { not: 'CANCELLED' } } });
  await db.$disconnect();
  return { ledger: lines.reduce((a, l) => a + P(l.debit) - P(l.credit), 0), balances: inv.reduce((a, i) => a + P(i.balanceAmount), 0) };
}

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'PayA');
  B = await createTenant(app, platform, 'PayB');
  campus = (await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  year = (await post('/academic-years', { name: '2026-27', startDate: '2026-06-01', endDate: '2027-03-31', makeCurrent: true })).body.id;
  const sbs = await post('/programs', { campusId: campus, name: 'State Board School', code: 'SBS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 10 });
  const class1 = sbs.body.levels[0].id;
  await post('/sections', { academicYearId: year, programLevelId: class1, names: ['A'], capacity: 40 });
  const tuition = (await post('/fees/heads', { name: 'Tuition fee', code: 'TUITION', feeType: 'ACADEMIC' })).body.id;
  const adm = (await post('/fees/heads', { name: 'Admission fee', code: 'ADM', feeType: 'ADMISSION' })).body.id;
  idHead = (await post('/fees/heads', { name: 'Charges', code: 'CHG', feeType: 'FINE' })).body.id;
  const st = await post('/fees/structures', {
    campusId: campus, academicYearId: year, programLevelId: class1, name: 'Class 1 fees',
    instalments: [{ instalmentNo: 1, name: 'Term 1', dueDate: '2026-06-10' }],
    items: [{ feeHeadId: tuition, instalmentNo: 1, amount: '10000' }, { feeHeadId: adm, instalmentNo: 1, amount: '5000' }],
  });
  await post(`/fees/structures/${st.body.id}/activate`, {});
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => c.header));
  for (const [n, f] of [['P/1', 'Asha'], ['P/2', 'Bala'], ['P/3', 'Chitra'], ['P/4', 'Dev']]) {
    const r: Record<string, string> = { admissionNo: n, firstName: f, lastName: 'Test', dob: '2019-01-01', gender: 'Girl', campusCode: 'MAIN', programCode: 'SBS', className: 'Class 1', section: 'A', fatherName: 'Parent', parentPhone: `98765000${n.slice(2)}0` };
    ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => r[c.key] ?? ''));
  }
  const job = await http().post(`${API}/imports/STUDENTS`).set(auth(A.session)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 's.xlsx');
  await post(`/imports/jobs/${job.body.id}/commit`, {});
  for (const s of (await get('/students?pageSize=100')).body.items) ids[s.firstName] = s.id;
  await post('/fees/billing/runs', { academicYearId: year, instalmentNo: 1 });
  await createRole(A.tenantId, 'CASHIER', [PERMISSIONS.FEE_READ, PERMISSIONS.FEE_COLLECT]);
  await createRole(A.tenantId, 'FEE_VIEWER', [PERMISSIONS.FEE_READ]);
  cashier = (await addMember(app, A.session, { label: 'Cashier', roleCode: 'CASHIER' })).session;
  viewer = (await addMember(app, A.session, { label: 'Viewer', roleCode: 'FEE_VIEWER' })).session;
}, 120_000);
afterAll(() => app?.close());

describe('money helpers', () => {
  it('allocation never exceeds what is due; amounts in words follow Indian numbering', () => {
    expect(allocate(1_200_000, [{ id: 'a', duePaise: 1_000_000 }, { id: 'b', duePaise: 500_000 }])).toEqual({ allocations: [{ id: 'a', amountPaise: 1_000_000 }, { id: 'b', amountPaise: 200_000 }], leftPaise: 0 });
    expect(allocate(2_000_000, [{ id: 'a', duePaise: 1_000_000 }]).leftPaise).toBe(1_000_000);
    expect(rupeesInWords(12_505_050)).toBe('One lakh twenty-five thousand and fifty rupees and fifty paise only');
    expect(rupeesInWords(100)).toBe('One rupee only');
    expect(rupeesInWords(1_000_000_000)).toBe('One crore rupees only');
  });
});

describe('AC31 counter and collection', () => {
  let counterId: string;

  it('cash needs an open counter; one open counter per cashier', async () => {
    expect((await pay('Asha', '6000')).body.type).toBe('counter-closed');
    const o = await post('/fees/counter/open', { campusId: campus, openingCash: '500' }, cashier);
    expect(o.status).toBe(201);
    counterId = o.body.id;
    expect((await post('/fees/counter/open', { campusId: campus, openingCash: '0' }, cashier)).body.type).toBe('counter-open');
  });

  it('a part payment allocates to the bill, gets the first receipt number and posts Dr Cash / Cr Receivable', async () => {
    const r = await pay('Asha', '6000');
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ receiptNo: 'RCT/2026-27/0001', status: 'SUCCESS', amount: '6000', paymentMode: 'CASH', cashierSessionId: counterId });
    expect(await bill('Asha')).toMatchObject({ paidAmount: '6000', balanceAmount: '9000', status: 'PARTIAL' });
    const db = ownerDb();
    const e = await db.journalEntry.findUniqueOrThrow({ where: { id: r.body.journalEntryId }, include: { lines: { include: { account: true } } } });
    const allocs = await db.paymentAllocation.findMany({ where: { paymentId: r.body.id } });
    await db.$disconnect();
    expect(e.voucherType).toBe('RECEIPT');
    expect(e.lines.map((l) => [l.account.systemKey, l.debit.toString(), l.credit.toString()]).sort()).toEqual([['CASH', '6000', '0'], ['STUDENT_RECEIVABLE', '0', '6000']]);
    expect(allocs.reduce((a, x) => a + P(x.amount), 0)).toBe(P('6000'));
    expect(await receivableOf(ids.Asha)).toEqual({ ledger: P('9000'), balances: P('9000') });
  });

  it('refuses more than is due, a future date, and a cheque without number or bank', async () => {
    const over = await pay('Asha', '9000.01');
    expect(over.body.type).toBe('more-than-due');
    expect(over.body.detail).toContain('₹9,000');
    expect((await pay('Asha', '100', 'CASH', { paymentDate: '2099-01-01' })).body.type).toBe('future-date');
    expect((await pay('Bala', '100', 'CHEQUE')).status).toBe(422);
    expect((await pay('Bala', '100', 'CHEQUE', { referenceNo: '000123' })).status).toBe(422);
  });

  it('a repeated or simultaneous "Collect" with the same key is recorded once', async () => {
    const key = 'collect-chitra-0001';
    const [x, y] = await Promise.all([pay('Chitra', '1000', 'CASH', {}, cashier, key), pay('Chitra', '1000', 'CASH', {}, cashier, key)]);
    const ok = [x, y].filter((r) => r.status === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const again = await pay('Chitra', '1000', 'CASH', {}, cashier, key);
    expect(again.body.receiptNo).toBe(ok[0].body.receiptNo);
    expect((await get(`/fees/students/${ids.Chitra}`)).body.payments).toHaveLength(1);
    expect(await bill('Chitra')).toMatchObject({ paidAmount: '1000' });
  });

  it('two payments at the same moment cannot spend the same balance', async () => {
    const [a, b] = await Promise.all([pay('Dev', '15000', 'CASH'), pay('Dev', '15000', 'CASH')]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect([a.body.type, b.body.type]).toContain('nothing-due'); // the second waited, then found nothing left
    expect(await bill('Dev')).toMatchObject({ paidAmount: '15000', balanceAmount: '0', status: 'PAID' });
    expect((await pay('Dev', '1', 'UPI', { referenceNo: 'UPI-78' }, A.session)).body.type).toBe('nothing-due');
  });

  it('receipt numbers are gapless and only for successful money', async () => {
    const db = ownerDb();
    const nos = (await db.payment.findMany({ where: { tenantId: A.tenantId }, orderBy: { receiptNo: 'asc' } })).map((p) => p.receiptNo);
    await db.$disconnect();
    expect(nos).toEqual(nos.map((_, i) => `RCT/2026-27/${String(i + 1).padStart(4, '0')}`));
    expect(nos).toHaveLength(3); // Asha, Chitra, Dev — refused attempts used no number
  });
});

describe('AC31 cheques, bounce and cancellation', () => {
  let cheque: { id: string; receiptNo: string };

  it('a cheque is held as "cheques in hand"; a bounce reopens the dues, reverses the posting and can bill a charge', async () => {
    const r = await pay('Bala', '15000', 'CHEQUE', { referenceNo: '004512', bankName: 'Canara Bank', chequeDate: '2026-11-15' }, A.session);
    expect(r.status).toBe(201);
    cheque = r.body;
    expect(await bill('Bala')).toMatchObject({ status: 'PAID', balanceAmount: '0' });
    expect((await post(`/fees/payments/${cheque.id}/bounce`, { reason: 'Insufficient funds' }, cashier)).status).toBe(403); // cashier cannot reverse
    const b = await post(`/fees/payments/${cheque.id}/bounce`, { reason: 'Insufficient funds', chargeAmount: '300', chargeFeeHeadId: idHead });
    expect(b.status).toBe(201);
    expect(b.body.status).toBe('BOUNCED');
    expect(b.body.chargeInvoiceNo).toMatch(/^INV\//);
    expect(await bill('Bala')).toMatchObject({ status: 'UNPAID', paidAmount: '0', balanceAmount: '15000' });
    const acc = (await get(`/fees/students/${ids.Bala}`)).body;
    expect(acc.totals.balance).toBe('15300.00');
    expect(acc.payments[0]).toMatchObject({ status: 'BOUNCED', cancelledReason: 'Insufficient funds' });
    expect(await receivableOf(ids.Bala)).toEqual({ ledger: P('15300'), balances: P('15300') });
    expect((await post(`/fees/payments/${cheque.id}/bounce`, { reason: 'Again' })).body.type).toBe('receipt-final');
  });

  it('cancelling a cash receipt restores the bill; cash cannot bounce', async () => {
    const r = await pay('Chitra', '2000');
    expect((await post(`/fees/payments/${r.body.id}/bounce`, { reason: 'Not a cheque' })).body.type).toBe('not-a-cheque');
    const c = await post(`/fees/payments/${r.body.id}/cancel`, { reason: 'Entered for the wrong student' });
    expect(c.body.status).toBe('CANCELLED');
    expect(await bill('Chitra')).toMatchObject({ paidAmount: '1000', balanceAmount: '14000', status: 'PARTIAL' });
    expect(await receivableOf(ids.Chitra)).toEqual({ ledger: P('14000'), balances: P('14000') });
  });

  it('a receipt shows its allocations and the balance left; it cannot be edited, even in the database', async () => {
    const asha = (await get(`/fees/students/${ids.Asha}`)).body.payments[0];
    const rc = (await get(`/fees/payments/${asha.id}`, viewer)).body;
    expect(rc).toMatchObject({ receiptNo: 'RCT/2026-27/0001', amount: '6000', balanceAfter: '9000.00', className: 'Class 1 – A' });
    expect(rc.allocations.reduce((a: number, x: { amount: string }) => a + P(x.amount), 0)).toBe(P('6000'));
    // A part payment pays the fees first (tuition before admission; deposits and fines last).
    expect(rc.allocations.map((x: { amount: string; item: { feeHead: { code: string } } }) => [x.item.feeHead.code, x.amount])).toEqual([['TUITION', '6000']]);
    expect(rc.institution).toBeTruthy();
    const owner = ownerDb();
    await expect(owner.payment.update({ where: { id: asha.id }, data: { amount: '1' } })).rejects.toThrow(/payment_locked/);
    await owner.$disconnect();
    const db = appDb();
    await expect(db.$executeRawUnsafe('DELETE FROM payments')).rejects.toThrow(/permission denied/);
    await db.$disconnect();
  });
});

describe('AC31 day close, scope and isolation', () => {
  it('closing the counter computes expected cash and the difference; then cash is refused', async () => {
    const before = (await get('/fees/counter', cashier)).body;
    // opening 500 + Asha 6000 + Chitra 1000 + Dev 15000 (cash) — the cancelled ₹2,000 is not counted
    expect(before.session.expectedCash).toBe('22500.00');
    expect(before.session.byMode.CASH).toEqual({ amount: '22000.00', count: 3 });
    expect(before.session.cancelledCount).toBe(1);
    const closed = await post(`/fees/counter/${before.session.id}/close`, { countedCash: '22450', remarks: '₹50 short — checked twice' }, cashier);
    expect(closed.body).toMatchObject({ status: 'CLOSED', systemCashTotal: '22000', countedCash: '22450', difference: '-50', expectedCash: '22500.00' });
    expect((await post(`/fees/counter/${before.session.id}/close`, { countedCash: '1' }, cashier)).body.type).toBe('counter-closed');
    expect((await pay('Chitra', '10')).body.type).toBe('counter-closed');
    expect((await get('/fees/counter', cashier)).body.session).toBeNull();
  });

  it('other institutions and people without the permission are refused', async () => {
    const asha = (await get(`/fees/students/${ids.Asha}`)).body.payments[0];
    expect((await get(`/fees/payments/${asha.id}`, B.session)).status).toBe(404);
    expect((await pay('Asha', '10', 'UPI', { referenceNo: 'X1' }, viewer)).status).toBe(403);
    expect((await post(`/fees/payments/${asha.id}/cancel`, { reason: 'Trying to cancel' }, viewer)).status).toBe(403);
  });
});
