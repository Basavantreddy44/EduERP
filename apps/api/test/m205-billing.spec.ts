/**
 * AC114–AC118 SaaS billing (Phase 22): plans priced per edition, monthly and / or yearly; a subscription
 * uses the chosen cycle and a change applies from the next renewal; GST invoices numbered without gaps;
 * payments, reversals and the statement; the billing check raises renewals once, reminds once, moves an
 * unpaid institution to grace and then read-only after its grace days, and back when paid; settings and
 * per-institution grace are for the super admin only. The check runs with a pretend date ("today") and
 * only for this test's institutions.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { financialYear, termEnd } from '@eduerp/shared';
import { BillingService } from '../src/modules/billing/billing.service';
import { API, PLATFORM_ADMIN, addMember, auth, createTenant, login, ownerDb, startApp, Session } from './helpers';

let app: INestApplication;
let platform: Session;
let support: Session;
let A: Awaited<ReturnType<typeof createTenant>>; // Karnataka (same state as the seller)
let B: Awaited<ReturnType<typeof createTenant>>; // Maharashtra → IGST
let V: Awaited<ReturnType<typeof createTenant>>; // renewal, grace and read-only
let W: Awaited<ReturnType<typeof createTenant>>; // its own grace period (45 days)
const http = () => request(app.getHttpServer());
const as = (s: Session) => ({
  get: (p: string) => http().get(`${API}${p}`).set(auth(s)),
  post: (p: string, b: object = {}) => http().post(`${API}${p}`).set(auth(s)).send(b),
  put: (p: string, b: object = {}) => http().put(`${API}${p}`).set(auth(s)).send(b),
  patch: (p: string, b: object = {}) => http().patch(`${API}${p}`).set(auth(s)).send(b),
});
const P = () => as(platform);
const check = (today: string, ...ids: string[]) => app.get(BillingService).runAll(today, ids);
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const ids: Record<string, string> = {};
const code = `B${Date.now().toString(36).toUpperCase()}`;
let savedSettings: Record<string, unknown>;

beforeAll(async () => {
  app = await startApp();
  platform = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'BillA');
  B = await createTenant(app, platform, 'BillB');
  V = await createTenant(app, platform, 'BillV');
  W = await createTenant(app, platform, 'BillW');
  // A support user (platform role SUPPORT) for the look-but-not-change checks.
  const db = ownerDb();
  const email = `support.${code.toLowerCase()}@test.local`;
  const admin = await db.user.findFirstOrThrow({ where: { email: PLATFORM_ADMIN.email } });
  await db.user.create({ data: { email, fullName: 'Billing Support', passwordHash: admin.passwordHash!, platformRole: 'SUPPORT', status: 'ACTIVE' } });
  await db.$disconnect();
  support = await login(app, email, PLATFORM_ADMIN.password);
  savedSettings = (await P().get('/platform/billing/settings')).body;
  const s = { ...savedSettings, graceDays: 30, renewLeadDays: 15, gstRate: 18, sellerState: 'Karnataka', sellerGstin: null, invoicePrefix: 'EDU', sellerName: 'EduERP Test Seller', sellerAddress: 'Test Road, Mysuru' };
  delete (s as { updatedAt?: string }).updatedAt;
  expect((await P().put('/platform/billing/settings', s)).status).toBe(200);
}, 180_000);

afterAll(async () => {
  if (savedSettings) { const s = { ...savedSettings }; delete (s as { updatedAt?: string }).updatedAt; await P().put('/platform/billing/settings', s); }
  await app?.close();
});

describe('AC114 plans: price per edition, monthly and / or yearly; the chosen cycle', () => {
  it('creates plans with both prices, an edition, and reads the old single price as yearly', async () => {
    const both = await P().post('/platform/plans', { name: 'Std both', code: `${code}_BOTH`, edition: 'STANDARD', priceMonthly: 30, priceYearly: 300, modules: ['STUDENTS', 'FEES'] });
    expect(both.status).toBe(201);
    expect(both.body).toMatchObject({ edition: 'STANDARD', priceMonthly: 30, priceYearly: 300 });
    ids.both = both.body.id;
    const legacy = await P().post('/platform/plans', { name: 'Old style', code: `${code}_OLD`, pricePerStudent: 25, billingCycle: 'YEARLY', modules: [] });
    expect(legacy.body).toMatchObject({ priceYearly: 25, priceMonthly: null, edition: null });
    ids.yearlyOnly = legacy.body.id;
    expect((await P().post('/platform/plans', { name: 'No price', code: `${code}_NONE`, modules: [] })).status).toBe(422);
    const list = (await P().get('/platform/plans')).body as { id: string; priceMonthly: number | null }[];
    expect(list.find((p) => p.id === ids.both)?.priceMonthly).toBe(30);
  });

  it('a subscription uses the chosen cycle and rate; a cycle the plan is not sold in is refused', async () => {
    const r = await P().post(`/platform/tenants/${A.tenantId}/subscription`, { planId: ids.both, status: 'ACTIVE', startDate: '2026-11-01', endDate: '2026-11-30', studentCount: 10, billingCycle: 'MONTHLY' });
    expect(r.status).toBe(201);
    expect(r.body.subscription).toMatchObject({ billingCycle: 'MONTHLY', rate: 30, amount: 300 });
    const no = await P().post(`/platform/tenants/${B.tenantId}/subscription`, { planId: ids.yearlyOnly, status: 'ACTIVE', startDate: '2026-11-01', endDate: '2026-11-30', studentCount: 10, billingCycle: 'MONTHLY' });
    expect(no.body.type).toBe('plan-cycle-not-offered');
    // A later price change leaves the running term's rate alone.
    expect((await P().patch(`/platform/plans/${ids.both}`, { priceMonthly: 35 })).body.priceMonthly).toBe(35);
    expect((await P().get(`/platform/tenants/${A.tenantId}/entitlements`)).body.subscription.rate).toBe(30);
    expect((await P().patch(`/platform/plans/${ids.both}`, { priceMonthly: 30 })).status).toBe(200);
  });
});

describe('AC115 invoices: numbering, GST, print data, own institution only', () => {
  it('raises the first invoice only for a one-cycle term, numbered in order, CGST + SGST in the same state, IGST otherwise', async () => {
    const bad = await P().post(`/platform/tenants/${A.tenantId}/subscription`, { planId: ids.both, status: 'ACTIVE', startDate: '2026-11-01', endDate: '2027-03-31', studentCount: 10, billingCycle: 'YEARLY', raiseInvoice: true });
    expect(bad.body.type).toBe('term-not-one-cycle');
    expect((await P().post(`/platform/tenants/${A.tenantId}/subscription`, { planId: ids.both, status: 'TRIAL', startDate: '2026-11-01', endDate: '2026-11-30', raiseInvoice: true })).status).toBe(422);

    const end = termEnd('2026-11-01', 'YEARLY');
    expect(end).toBe('2027-10-31');
    expect((await P().post(`/platform/tenants/${A.tenantId}/subscription`, { planId: ids.both, status: 'ACTIVE', startDate: '2026-11-01', endDate: end, studentCount: 10, billingCycle: 'YEARLY', raiseInvoice: true })).status).toBe(201);
    expect((await P().patch(`/platform/billing/tenants/${B.tenantId}`, { graceDays: null, gstin: '27ABCDE1234F1Z5', billingState: 'Maharashtra' })).status).toBe(200);
    expect((await P().post(`/platform/tenants/${B.tenantId}/subscription`, { planId: ids.yearlyOnly, status: 'ACTIVE', startDate: '2026-11-01', endDate: end, studentCount: 40, billingCycle: 'YEARLY', raiseInvoice: true })).status).toBe(201);

    const a = (await P().get(`/platform/billing/invoices?tenantId=${A.tenantId}`)).body[0];
    const b = (await P().get(`/platform/billing/invoices?tenantId=${B.tenantId}`)).body[0];
    const fy = financialYear(today);
    expect(a.invoiceNo).toMatch(new RegExp(`^EDU/${fy}/\\d{5}$`));
    expect(Number(b.invoiceNo.slice(-5))).toBe(Number(a.invoiceNo.slice(-5)) + 1);
    expect(a).toMatchObject({ kind: 'FIRST', taxable: 3000, gstRate: 18, cgst: 270, sgst: 270, igst: 0, total: 3540, status: 'UNPAID', periodStart: '2026-11-01', periodEnd: end, dueDate: today });
    expect(b).toMatchObject({ taxable: 1000, cgst: 0, sgst: 0, igst: 180, total: 1180 });
    expect(b.buyer).toMatchObject({ gstin: '27ABCDE1234F1Z5', state: 'Maharashtra' });
    expect(a.seller).toMatchObject({ name: 'EduERP Test Seller', state: 'Karnataka' });
    ids.invA = a.id;
    ids.invB = b.id;
  });

  it('an institution sees only its own bills; staff without the billing right and support staff cannot change anything', async () => {
    const mine = (await as(A.session).get('/billing')).body;
    expect(mine.invoices.map((i: { id: string }) => i.id)).toEqual([ids.invA]);
    expect(mine.subscription).toMatchObject({ billingCycle: 'YEARLY', rate: 300, studentCount: 10 });
    expect((await as(A.session).get(`/billing/invoices/${ids.invA}`)).body.total).toBe(3540);
    expect((await as(A.session).get(`/billing/invoices/${ids.invB}`)).status).toBe(404);
    const teacher = await addMember(app, A.session, { label: 'BillTeacher', roleCode: 'TEACHING_STAFF' });
    expect((await as(teacher.session).get('/billing')).status).toBe(403);
    expect((await as(A.session).get('/platform/billing/invoices')).status).toBe(403);
    expect((await as(support).get(`/platform/billing/invoices/${ids.invA}`)).status).toBe(200);
    expect((await as(support).post(`/platform/billing/invoices/${ids.invA}/payments`, { paidOn: today, amount: 10, mode: 'CASH' })).status).toBe(403);
  });
});

describe('AC116 payments, reversals and the statement', () => {
  it('payments are checked, part and full payment set the status, reversals need a reason, the statement balances', async () => {
    const pay = (b: object) => P().post(`/platform/billing/invoices/${ids.invA}/payments`, b);
    expect((await pay({ paidOn: today, amount: 5000, mode: 'CASH' })).body.type).toBe('payment-over-balance');
    expect((await pay({ paidOn: today, amount: 100, mode: 'UPI' })).status).toBe(422); // UPI needs its reference
    expect((await pay({ paidOn: '2099-01-01', amount: 100, mode: 'CASH' })).body.type).toBe('payment-future');
    const part = await pay({ paidOn: today, amount: 1540, mode: 'UPI', reference: 'UPI-778899' });
    expect(part.body).toMatchObject({ status: 'PART_PAID', paid: 1540, balance: 2000 });
    const full = await pay({ paidOn: today, amount: 2000, mode: 'BANK_TRANSFER', reference: 'UTR123456' });
    expect(full.body).toMatchObject({ status: 'PAID', balance: 0 });
    expect((await pay({ paidOn: today, amount: 1, mode: 'CASH' })).body.type).toBe('invoice-paid');

    const pid = full.body.payments.find((p: { amount: number }) => p.amount === 2000).id;
    expect((await P().post(`/platform/billing/payments/${pid}/reverse`, {})).status).toBe(422);
    const rev = await P().post(`/platform/billing/payments/${pid}/reverse`, { reason: 'Cheque bounced' });
    expect(rev.body).toMatchObject({ status: 'PART_PAID', balance: 2000 });
    expect((await P().post(`/platform/billing/payments/${pid}/reverse`, { reason: 'again' })).body.type).toBe('payment-reversed');
    expect((await P().post(`/platform/billing/invoices/${ids.invA}/cancel`, { reason: 'Wrong count' })).body.type).toBe('invoice-has-payments');

    const st = (await P().get(`/platform/billing/tenants/${A.tenantId}`)).body;
    expect(st.balance).toBe(2000);
    expect(st.statement[0].balance).toBe(2000); // newest first
    expect(st.statement.map((l: { kind: string }) => l.kind).sort()).toEqual(['INVOICE', 'PAYMENT', 'PAYMENT', 'REVERSAL']);
    const db = ownerDb();
    expect(await db.auditLog.count({ where: { tenantId: A.tenantId, entityType: 'PLATFORM_PAYMENT' } })).toBe(3);
    await db.$disconnect();

    // An unpaid invoice can be cancelled with a reason; the number is kept.
    const c = await P().post(`/platform/billing/invoices/${ids.invB}/cancel`, { reason: 'Raised for the wrong plan' });
    expect(c.body).toMatchObject({ status: 'CANCELLED', balance: 0, cancelReason: 'Raised for the wrong plan' });
  });
});

describe('AC117 renewal, reminders, grace, read-only and back', () => {
  it('renewal is raised once with the larger student count and the cycle chosen for the next term', async () => {
    expect((await P().post(`/platform/tenants/${V.tenantId}/subscription`, { planId: ids.both, status: 'ACTIVE', startDate: '2026-11-01', endDate: '2026-11-30', studentCount: 5, billingCycle: 'MONTHLY' })).status).toBe(201);
    // No active students yet: the subscribed 5 is the larger count.
    // The institution chooses yearly for the next renewal.
    const ch = await as(V.session).put('/billing/cycle', { billingCycle: 'YEARLY' });
    expect(ch.status).toBe(200);
    expect(ch.body.subscription).toMatchObject({ billingCycle: 'MONTHLY', nextCycle: 'YEARLY' });

    expect(await check('2026-11-10', V.tenantId)).toMatchObject({ invoices: 0 }); // not yet within 15 days
    expect(await check('2026-11-20', V.tenantId)).toMatchObject({ invoices: 1, reminders: 1 });
    expect(await check('2026-11-20', V.tenantId)).toMatchObject({ invoices: 0, reminders: 0 });
    const inv = (await P().get(`/platform/billing/invoices?tenantId=${V.tenantId}`)).body;
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ kind: 'RENEWAL', billingCycle: 'YEARLY', rate: 300, studentCount: 5, periodStart: '2026-12-01', periodEnd: '2027-11-30', dueDate: '2026-12-01', total: 1770 });
    ids.invV = inv[0].id;
    const sub = (await as(V.session).get('/billing')).body.subscription;
    expect(sub).toMatchObject({ billingCycle: 'YEARLY', nextCycle: null, endDate: '2026-11-30' });
    // 7 days and 1 day before: one reminder each.
    expect((await check('2026-11-24', V.tenantId)).reminders).toBe(1);
    expect((await check('2026-11-30', V.tenantId)).reminders).toBe(1);
    expect((await check('2026-11-30', V.tenantId)).reminders).toBe(0);
    const db2 = ownerDb();
    const notes = await db2.notification.findMany({ where: { tenantId: V.tenantId, eventCode: 'BILLING_DUE' } });
    expect(notes.length).toBe(3);
    expect(notes[0].title).toContain('EDU/');
    await db2.$disconnect();
  });

  it('unpaid after the due date → grace (still works); after 30 days → read-only; paying makes it active again', async () => {
    expect(await check('2026-12-01', V.tenantId)).toMatchObject({ grace: 0 }); // due today
    expect(await check('2026-12-02', V.tenantId)).toMatchObject({ grace: 1 });
    expect((await as(V.session).get('/me/modules')).body.account.status).toBe('GRACE');
    expect((await as(V.session).post('/campuses', { code: 'G1', name: 'Grace campus', campusType: 'SCHOOL' })).status).toBe(201);
    expect(await check('2026-12-31', V.tenantId)).toMatchObject({ readOnly: 0 }); // last day
    expect(await check('2027-01-01', V.tenantId)).toMatchObject({ readOnly: 1 });
    const w = await as(V.session).post('/campuses', { code: 'G2', name: 'Read-only campus', campusType: 'SCHOOL' });
    expect(w.status).toBe(403);
    expect(w.body.type).toBe('tenant-read-only');
    expect((await as(V.session).get('/billing')).status).toBe(200); // bills can still be seen
    const db = ownerDb();
    expect(await db.notification.count({ where: { tenantId: V.tenantId, eventCode: 'BILLING_READONLY' } })).toBeGreaterThan(0);
    expect(await db.auditLog.count({ where: { tenantId: V.tenantId, entityType: 'TENANT', action: 'STATUS_CHANGE', reason: { startsWith: 'Billing:' } } })).toBe(2);
    await db.$disconnect();

    const paid = await P().post(`/platform/billing/invoices/${ids.invV}/payments`, { paidOn: today, amount: 1770, mode: 'BANK_TRANSFER', reference: 'UTR-V-1' });
    expect(paid.body).toMatchObject({ status: 'PAID', accountChange: 'ACTIVE' });
    expect((await as(V.session).get('/billing')).body.subscription.endDate).toBe('2027-11-30');
    expect((await as(V.session).post('/campuses', { code: 'G3', name: 'Paid campus', campusType: 'SCHOOL' })).status).toBe(201);
  });

  it('a suspension made by hand is not lifted by the billing check', async () => {
    expect((await P().patch(`/platform/tenants/${V.tenantId}/status`, { status: 'SUSPENDED', reason: 'Owner request' })).status).toBe(200);
    expect(await check('2027-01-02', V.tenantId)).toMatchObject({ reactivated: 0 });
    expect((await P().get(`/platform/billing/tenants/${V.tenantId}`)).body.tenant).toMatchObject({ status: 'SUSPENDED', billingHold: false });
    expect((await P().patch(`/platform/tenants/${V.tenantId}/status`, { status: 'ACTIVE', reason: 'Done' })).status).toBe(200);
  });

  it("an institution's own grace period (45 days) replaces the default", async () => {
    expect((await P().patch(`/platform/billing/tenants/${W.tenantId}`, { graceDays: 45, gstin: '', billingState: null })).body.account.graceDays).toBe(45);
    expect((await P().post(`/platform/tenants/${W.tenantId}/subscription`, { planId: ids.both, status: 'ACTIVE', startDate: '2026-11-01', endDate: '2026-11-30', studentCount: 4, billingCycle: 'MONTHLY', raiseInvoice: true })).status).toBe(201);
    const inv = (await P().get(`/platform/billing/invoices?tenantId=${W.tenantId}`)).body[0];
    const due = inv.dueDate as string;
    const plus = (n: number) => { const d = new Date(`${due}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    expect(await check(plus(31), W.tenantId)).toMatchObject({ readOnly: 0 });
    expect((await P().get(`/platform/billing/tenants/${W.tenantId}`)).body.tenant.status).toBe('GRACE');
    // The December renewal was raised late (after its term began): it is due the day it is raised, not in the past.
    const late = (await P().get(`/platform/billing/invoices?tenantId=${W.tenantId}`)).body.find((i: { kind: string }) => i.kind === 'RENEWAL');
    expect(late).toMatchObject({ periodStart: '2026-12-01', dueDate: plus(31) > '2026-12-01' ? plus(31) : '2026-12-01' });
    expect(await check(plus(45), W.tenantId)).toMatchObject({ readOnly: 0 });
    expect(await check(plus(46), W.tenantId)).toMatchObject({ readOnly: 1 });
    // Giving more days lifts read-only at once.
    const more = await P().patch(`/platform/billing/tenants/${W.tenantId}`, { graceDays: 90, gstin: null, billingState: null });
    expect(more.body.tenant).toMatchObject({ billingHold: false });
    expect(more.body.tenant.status).not.toBe('SUSPENDED');

    // The banner every member sees: amount, due date and the last day (due + 90 days now).
    const db = ownerDb();
    const past = new Date(Date.now() + 330 * 60_000 - 10 * 86_400_000).toISOString().slice(0, 10);
    await db.platformInvoice.update({ where: { id: inv.id }, data: { dueDate: new Date(`${past}T00:00:00Z`) } });
    await db.$disconnect();
    const last = new Date(`${past}T00:00:00Z`); last.setUTCDate(last.getUTCDate() + 90);
    const banner = (await as(W.session).get('/me/modules')).body.account;
    expect(banner.overdue).toMatchObject({ kind: 'INVOICE', invoiceNo: inv.invoiceNo, amount: inv.total, dueDate: past, lastDay: last.toISOString().slice(0, 10) });
  });
});

describe('AC118 settings: super admin only, checked and recorded', () => {
  it('support and institutions cannot change settings or grace; values are checked; changes are recorded', async () => {
    const s = { ...(await P().get('/platform/billing/settings')).body, graceDays: 30 };
    delete (s as { updatedAt?: string }).updatedAt;
    expect((await as(support).put('/platform/billing/settings', s)).status).toBe(403);
    expect((await as(A.session).put('/platform/billing/settings', s)).status).toBe(403);
    expect((await as(support).patch(`/platform/billing/tenants/${A.tenantId}`, { graceDays: 40, gstin: null, billingState: null })).status).toBe(403);
    expect((await P().put('/platform/billing/settings', { ...s, graceDays: 0 })).status).toBe(422);
    expect((await P().put('/platform/billing/settings', { ...s, sellerGstin: 'NOT-A-GSTIN' })).status).toBe(422);
    expect((await P().patch(`/platform/billing/tenants/${A.tenantId}`, { graceDays: 120, gstin: null, billingState: null })).status).toBe(422);
    const ok = await P().put('/platform/billing/settings', { ...s, graceDays: 35 });
    expect(ok.body.graceDays).toBe(35);
    const db = ownerDb();
    expect((await db.platformBillingSettings.findUniqueOrThrow({ where: { id: 1 } })).updatedBy).toBeTruthy();
    expect(await db.auditLog.count({ where: { tenantId: W.tenantId, entityType: 'TENANT_BILLING' } })).toBe(2);
    await db.$disconnect();
  });
});
