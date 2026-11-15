/**
 * AC32 online payment (M2.4): payment links (only a hash of the token stored); a receipt only after a
 * signature-verified, captured payment; bad checkout or webhook signatures are rejected and logged;
 * the browser, the webhook and the re-check together create exactly one receipt; failed payments make
 * none; money beyond the dues is held as an advance; refunds need approval, go back through the
 * gateway (a gateway error changes nothing) and post a reversal. Runs on the simulated gateway, which
 * uses the same HMAC signature scheme as Razorpay.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { IMPORT_TYPES, PERMISSIONS, toPaise } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, auth, createRole, createTenant, login, ownerDb, startApp, Session } from './helpers';
import { PAYMENT_GATEWAY, SimulatedGateway, hmac } from '../src/modules/fees/gateway';
import { FeeOnlineService } from '../src/modules/fees/online.service';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let cashier: Session;
let principal: Session;
let gw: SimulatedGateway;
let campus: string;
let year: string;
const ids: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const pub = { get: (t: string) => http().get(`${API}/public/pay/${t}`), post: (t: string, what: string, body: unknown = {}) => http().post(`${API}/public/pay/${t}/${what}`).send(body as object) };
const P = (v: { toString(): string }) => toPaise(v.toString());
const bill = async (name: string) => (await get(`/fees/students/${ids[name]}`)).body.invoices.find((i: { instalmentNo: number }) => i.instalmentNo === 1);
const link = async (name: string) => {
  const r = await post('/fees/pay-links', { studentId: ids[name] }, cashier);
  expect(r.status).toBe(201);
  return r.body.url.split('/pay/')[1] as string;
};
const webhook = (body: object, opts: { secret?: string; eventId?: string } = {}) => {
  const raw = JSON.stringify(body);
  return http().post(`${API}/webhooks/razorpay`).set('content-type', 'application/json').set('x-razorpay-signature', hmac(opts.secret ?? SimulatedGateway.WEBHOOK_SECRET, raw)).set('x-razorpay-event-id', opts.eventId ?? `evt_${Math.random().toString(36).slice(2)}`).send(raw);
};
const captured = (p: { id: string; orderId: string; amountPaise: number }) => ({ event: 'payment.captured', payload: { payment: { entity: { id: p.id, order_id: p.orderId, amount: p.amountPaise, status: 'captured', method: 'upi' } } } });
async function countReceipts(studentId: string) {
  const db = ownerDb();
  const n = await db.payment.count({ where: { tenantId: A.tenantId, studentId } });
  await db.$disconnect();
  return n;
}

beforeAll(async () => {
  app = await startApp();
  gw = app.get(PAYMENT_GATEWAY);
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'OnlA');
  B = await createTenant(app, platform, 'OnlB');
  campus = (await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  year = (await post('/academic-years', { name: '2026-27', startDate: '2026-06-01', endDate: '2027-03-31', makeCurrent: true })).body.id;
  const sbs = await post('/programs', { campusId: campus, name: 'State Board School', code: 'SBS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 10 });
  const class1 = sbs.body.levels[0].id;
  await post('/sections', { academicYearId: year, programLevelId: class1, names: ['A'], capacity: 40 });
  const tuition = (await post('/fees/heads', { name: 'Tuition fee', code: 'TUITION', feeType: 'ACADEMIC' })).body.id;
  const adm = (await post('/fees/heads', { name: 'Admission fee', code: 'ADM', feeType: 'ADMISSION' })).body.id;
  const st = await post('/fees/structures', {
    campusId: campus, academicYearId: year, programLevelId: class1, name: 'Class 1 fees',
    instalments: [{ instalmentNo: 1, name: 'Term 1', dueDate: '2026-06-10' }],
    items: [{ feeHeadId: tuition, instalmentNo: 1, amount: '10000' }, { feeHeadId: adm, instalmentNo: 1, amount: '5000' }],
  });
  await post(`/fees/structures/${st.body.id}/activate`, {});
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => c.header));
  for (const [n, f] of [['1', 'Asha'], ['2', 'Bala'], ['3', 'Chitra'], ['4', 'Dev']]) {
    const r: Record<string, string> = { admissionNo: `O/${n}`, firstName: f, lastName: 'Test', dob: '2019-01-01', gender: 'Girl', campusCode: 'MAIN', programCode: 'SBS', className: 'Class 1', section: 'A', fatherName: 'Parent', parentPhone: `987650001${n}`, parentEmail: `parent${n}@example.in` };
    ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => r[c.key] ?? ''));
  }
  const job = await http().post(`${API}/imports/STUDENTS`).set(auth(A.session)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 's.xlsx');
  await post(`/imports/jobs/${job.body.id}/commit`, {});
  for (const s of (await get('/students?pageSize=100')).body.items) ids[s.firstName] = s.id;
  await post('/fees/billing/runs', { academicYearId: year, instalmentNo: 1 });
  await createRole(A.tenantId, 'CASHIER', [PERMISSIONS.FEE_READ, PERMISSIONS.FEE_COLLECT]);
  await createRole(A.tenantId, 'PRINCIPAL', [PERMISSIONS.APPROVALS_REQUEST_READ]);
  cashier = (await addMember(app, A.session, { label: 'Cashier', roleCode: 'CASHIER' })).session;
  principal = (await addMember(app, A.session, { label: 'Principal', roleCode: 'PRINCIPAL' })).session;
}, 120_000);
afterAll(() => app?.close());

describe('AC32 payment links and the public page', () => {
  it('a link shows the school, the student and what is due — without signing in; only its hash is stored', async () => {
    expect((await get('/fees/online/status')).body.gateway).toBe('simulated');
    const r = await post('/fees/pay-links', { studentId: ids.Asha, sendEmail: true }, cashier);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ amount: '15000', sentTo: 'parent1@example.in' });
    const token = r.body.url.split('/pay/')[1];
    const v = await pub.get(token);
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ status: 'ACTIVE', amount: '15000.00', student: { name: 'Asha Test', admissionNo: 'O/1' }, gateway: 'simulated' });
    expect(v.body.bills).toHaveLength(1);
    expect((await pub.get('x'.repeat(32))).status).toBe(404);
    const db = ownerDb();
    const l = await db.paymentLink.findFirstOrThrow({ where: { id: r.body.id } });
    const mail = await db.notificationDelivery.findFirst({ where: { tenantId: A.tenantId, recipient: 'parent1@example.in' } });
    await db.$disconnect();
    expect(l.tokenHash).not.toContain(token);
    expect(l.tokenHash).toHaveLength(64);
    expect(mail?.status).toBe('QUEUED');
  });
});

describe('AC32 checkout confirmation', () => {
  let token: string;
  let orderId: string;

  it('a bad signature is rejected; a failed payment makes no receipt', async () => {
    token = await link('Asha');
    const o = await pub.post(token, 'order');
    expect(o.status).toBe(201);
    expect(o.body).toMatchObject({ amountPaise: 1_500_000, keyId: 'rzp_simulated' });
    orderId = o.body.orderId;
    const sim = await pub.post(token, 'simulate', { orderId, outcome: 'success' });
    const forged = await pub.post(token, 'confirm', { orderId, paymentId: sim.body.paymentId, signature: 'a'.repeat(64) });
    expect(forged.status).toBe(400);
    expect(forged.body.type).toBe('signature-invalid');
    expect(await countReceipts(ids.Asha)).toBe(0);

    const o2 = await pub.post(token, 'order');
    const fail = await pub.post(token, 'simulate', { orderId: o2.body.orderId, outcome: 'failure' });
    const r = await pub.post(token, 'confirm', { orderId: o2.body.orderId, paymentId: fail.body.paymentId, signature: fail.body.signature });
    expect(r.body).toMatchObject({ status: 'PENDING' });
    expect(await countReceipts(ids.Asha)).toBe(0);
    expect((await pub.get(token)).body.status).toBe('ACTIVE');
  });

  it('a captured payment gives one receipt (mode ONLINE, posted to the gateway clearing account); confirming again changes nothing', async () => {
    const sim = await pub.post(token, 'simulate', { orderId, outcome: 'success' });
    const body = { orderId, paymentId: sim.body.paymentId, signature: sim.body.signature };
    const [a, b] = await Promise.all([pub.post(token, 'confirm', body), pub.post(token, 'confirm', body)]);
    expect([a.body.status, b.body.status]).toEqual(['PAID', 'PAID']);
    expect(a.body.receiptNo).toBe(b.body.receiptNo);
    expect(await countReceipts(ids.Asha)).toBe(1);
    expect(await bill('Asha')).toMatchObject({ status: 'PAID', balanceAmount: '0' });
    const v = (await pub.get(token)).body;
    expect(v.status).toBe('PAID');
    expect(v.receipt.receiptNo).toBe(a.body.receiptNo);
    const db = ownerDb();
    const p = await db.payment.findUniqueOrThrow({ where: { id: a.body.receiptId }, include: { allocations: true } });
    const e = await db.journalEntry.findUniqueOrThrow({ where: { id: p.journalEntryId! }, include: { lines: { include: { account: true } } } });
    await db.$disconnect();
    expect(p).toMatchObject({ paymentMode: 'ONLINE', referenceNo: sim.body.paymentId, cashierSessionId: null });
    expect(e.lines.map((l) => [l.account.systemKey, l.debit.toString(), l.credit.toString()]).sort()).toEqual([['GATEWAY_CLEARING', '15000', '0'], ['STUDENT_RECEIVABLE', '0', '15000']]);
    expect((await pub.post(token, 'order')).body.type).toBe('link-closed');
  });
});

describe('AC32 webhooks and the re-check', () => {
  it('webhooks with a bad signature are rejected and logged; a repeated event is ignored; a webhook alone records the payment once', async () => {
    const token = await link('Bala');
    const o = (await pub.post(token, 'order')).body;
    const sim = (await pub.post(token, 'simulate', { orderId: o.orderId, outcome: 'success' })).body;
    const ev = captured({ id: sim.paymentId, orderId: o.orderId, amountPaise: o.amountPaise });
    const bad = await webhook(ev, { secret: 'wrong-secret' });
    expect(bad.status).toBe(400);
    expect(await countReceipts(ids.Bala)).toBe(0);
    const ok = await webhook(ev, { eventId: 'evt_bala_1' });
    expect(ok.status).toBe(200);
    expect(await countReceipts(ids.Bala)).toBe(1);
    expect((await webhook(ev, { eventId: 'evt_bala_1' })).body).toMatchObject({ duplicate: true });
    expect((await webhook(ev, { eventId: 'evt_bala_2' })).status).toBe(200); // a second event for the same payment
    expect(await countReceipts(ids.Bala)).toBe(1);
    // The browser comes back later: same receipt.
    const late = await pub.post(token, 'confirm', { orderId: o.orderId, paymentId: sim.paymentId, signature: sim.signature });
    expect(late.body.status).toBe('PAID');
    expect(await countReceipts(ids.Bala)).toBe(1);
    const db = ownerDb();
    const logged = await db.paymentWebhookEvent.findMany({ where: { payload: { path: ['payload', 'payment', 'entity', 'id'], equals: sim.paymentId } }, orderBy: { receivedAt: 'asc' } });
    await db.$disconnect();
    expect(logged.map((l) => l.signatureValid)).toEqual([false, true, true]);
    expect(logged[1].result).toMatch(/^receipt RCT\//);
  });

  it('the re-check records a payment whose browser and webhook never arrived; a gateway outage changes nothing', async () => {
    const token = await link('Chitra');
    const o = (await pub.post(token, 'order')).body;
    await pub.post(token, 'simulate', { orderId: o.orderId, outcome: 'success' });
    const db = ownerDb();
    // Only this order is old enough to be re-checked (others from earlier tests are made fresh).
    await db.onlineOrder.updateMany({ where: { tenantId: A.tenantId, status: 'CREATED', NOT: { gatewayOrderId: o.orderId } }, data: { createdAt: new Date() } });
    await db.onlineOrder.updateMany({ where: { gatewayOrderId: o.orderId }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    await db.$disconnect();
    const online = app.get(FeeOnlineService);
    gw.failNext = 'Gateway timed out';
    expect(await online.reconcileTenant(A.tenantId)).toMatchObject({ checked: 1, paid: 0 });
    expect(await countReceipts(ids.Chitra)).toBe(0);
    expect(await online.reconcileTenant(A.tenantId)).toMatchObject({ checked: 1, paid: 1 });
    expect(await countReceipts(ids.Chitra)).toBe(1);
    expect((await post('/fees/online/recheck', {}, cashier)).body).toMatchObject({ paid: 0 });
  });

  it('money beyond what is due (paid at the counter meanwhile) is kept as an advance, never refused', async () => {
    const token = await link('Dev');
    const o = (await pub.post(token, 'order')).body; // ₹15,000
    expect((await post('/fees/payments', { studentId: ids.Dev, amount: '5000', mode: 'UPI', referenceNo: 'UPI-1', payerName: 'Parent' })).status).toBe(201);
    const sim = (await pub.post(token, 'simulate', { orderId: o.orderId, outcome: 'success' })).body;
    const r = await pub.post(token, 'confirm', { orderId: o.orderId, paymentId: sim.paymentId, signature: sim.signature });
    expect(r.body.status).toBe('PAID');
    expect(await bill('Dev')).toMatchObject({ status: 'PAID', balanceAmount: '0' });
    const db = ownerDb();
    const p = await db.payment.findUniqueOrThrow({ where: { id: r.body.receiptId }, include: { allocations: true } });
    const lines = await db.journalLine.findMany({ where: { journalEntryId: p.journalEntryId! }, include: { account: true } });
    await db.$disconnect();
    expect(p.allocations.reduce((a, x) => a + P(x.amount), 0)).toBe(P('10000'));
    expect(lines.find((l) => l.account.systemKey === 'FEE_ADVANCE')?.credit.toString()).toBe('5000');
  });
});

describe('AC32 refunds', () => {
  let ashaReceipt: string;

  it('need an approver; cannot exceed the receipt; online receipts are refunded, not cancelled', async () => {
    ashaReceipt = (await get(`/fees/students/${ids.Asha}`)).body.payments[0].id;
    expect((await post(`/fees/payments/${ashaReceipt}/cancel`, { reason: 'Trying to cancel' })).body.type).toBe('online-receipt');
    expect((await post(`/fees/payments/${ashaReceipt}/refunds`, { amount: '2000', reason: 'Admission withdrawn in part' }, cashier)).body.type).toBe('approval-rule-missing');
    const db = ownerDb();
    const role = await db.role.findFirstOrThrow({ where: { tenantId: A.tenantId, code: 'PRINCIPAL' } });
    await db.$disconnect();
    expect((await post('/approvals/rules', { entityType: 'REFUND', levelNo: 1, approverRoleId: role.id })).status).toBe(201);
    expect((await post(`/fees/payments/${ashaReceipt}/refunds`, { amount: '15000.01', reason: 'More than paid' }, cashier)).body.type).toBe('more-than-paid');
  });

  it('approved: the gateway returns the money, the dues reopen and a reversal is posted', async () => {
    const r = await post(`/fees/payments/${ashaReceipt}/refunds`, { amount: '2000', reason: 'Admission fee partly returned' }, cashier);
    expect(r.body).toMatchObject({ status: 'PENDING', refundMode: 'ONLINE' });
    expect(await bill('Asha')).toMatchObject({ balanceAmount: '0' }); // nothing changes while pending
    const req = ((await get('/approvals/inbox', principal)).body.items ?? (await get('/approvals/inbox', principal)).body).find((x: { entityId: string }) => x.entityId === r.body.id);
    expect((await post(`/approvals/requests/${req.id}/act`, { action: 'APPROVE' }, principal)).status).toBe(201);
    const refunds = (await get(`/fees/students/${ids.Asha}/refunds`)).body;
    expect(refunds[0]).toMatchObject({ status: 'PAID', amount: '2000' });
    expect(refunds[0].gatewayRefundId).toMatch(/^rfnd_sim/);
    expect(gw.refunds.at(-1)).toMatchObject({ amountPaise: 200_000 });
    expect(await bill('Asha')).toMatchObject({ status: 'PARTIAL', balanceAmount: '2000' });
    const db = ownerDb();
    const e = await db.journalEntry.findUniqueOrThrow({ where: { id: refunds[0].journalEntryId }, include: { lines: { include: { account: true } } } });
    await db.$disconnect();
    expect(e.lines.map((l) => [l.account.systemKey, l.debit.toString(), l.credit.toString()]).sort()).toEqual([['GATEWAY_CLEARING', '0', '2000'], ['STUDENT_RECEIVABLE', '2000', '0']]);
  });

  it('a gateway error marks the refund failed and changes nothing; a rejected refund does nothing', async () => {
    const r = await post(`/fees/payments/${ashaReceipt}/refunds`, { amount: '1000', reason: 'Second partial refund' }, cashier);
    const inbox = async () => (await get('/approvals/inbox', principal)).body;
    gw.failNext = 'Refund declined by gateway';
    const req = ((await inbox()).items ?? (await inbox())).find((x: { entityId: string }) => x.entityId === r.body.id);
    await post(`/approvals/requests/${req.id}/act`, { action: 'APPROVE' }, principal);
    const after = (await get(`/fees/students/${ids.Asha}/refunds`)).body.find((x: { id: string }) => x.id === r.body.id);
    expect(after).toMatchObject({ status: 'FAILED', failureReason: 'Refund declined by gateway' });
    expect(await bill('Asha')).toMatchObject({ balanceAmount: '2000' });

    const r2 = await post(`/fees/payments/${ashaReceipt}/refunds`, { amount: '500', reason: 'Asked at the counter' }, cashier);
    const req2 = ((await inbox()).items ?? (await inbox())).find((x: { entityId: string }) => x.entityId === r2.body.id);
    await post(`/approvals/requests/${req2.id}/act`, { action: 'REJECT', remarks: 'Not eligible' }, principal);
    expect((await get(`/fees/students/${ids.Asha}/refunds`)).body.find((x: { id: string }) => x.id === r2.body.id).status).toBe('REJECTED');
    expect(await bill('Asha')).toMatchObject({ balanceAmount: '2000' });
  });
});

describe('AC32 isolation', () => {
  it('links and refunds belong to their institution; a public token opens only its own link', async () => {
    expect((await get(`/fees/students/${ids.Asha}/pay-links`, B.session)).status).toBe(404);
    expect((await get(`/fees/students/${ids.Asha}/pay-links`, cashier)).body.length).toBeGreaterThan(0);
    expect((await post('/fees/pay-links', { studentId: ids.Asha }, B.session)).status).toBe(404);
  });
});
