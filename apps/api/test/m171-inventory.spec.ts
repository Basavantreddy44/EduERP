/**
 * AC87–AC90 Inventory & purchase (Phase 17): stock never below zero (also with two issues at once),
 * weighted average, ledger = balance; purchase requests with approval, quotations and the comparative
 * statement, one selected quotation; orders approved by someone else, receipts up to the order + 5%,
 * only accepted quantities in stock, bills from receipts never more than accepted less billed; issues,
 * transfers and counts adjusted after approval; low-stock list and notice; isolation.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PERMISSIONS } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, auth, createRole, createTenant, login, ownerDb, startApp, Session } from './helpers';
import { InventoryService } from '../src/modules/inventory/inventory.service';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let main: string;
let north: string;
let keeper: Session;
let buyer: Session;
let hod: Session;
const ids: Record<string, string> = {};
const acc: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const bal = async (storeId: string, itemId: string) => {
  const db = ownerDb();
  const b = await db.stockBalance.findFirst({ where: { storeId, itemId } });
  const last = await db.stockTransaction.findFirst({ where: { storeId, itemId }, orderBy: { txnAt: 'desc' } });
  await db.$disconnect();
  return { quantity: Number(b?.quantity ?? 0), value: Number(b?.value ?? 0), avg: Number(b?.avgCost ?? 0), ledgerQty: Number(last?.balanceAfter ?? 0), ledgerValue: Number(last?.valueAfter ?? 0) };
};

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'InvA');
  B = await createTenant(app, platform, 'InvB');
  main = (await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  north = (await post('/campuses', { code: 'NORTH', name: 'North School', campusType: 'SCHOOL' })).body.id;
  ids.dept = (await post('/departments', { campusId: main, name: 'Science', code: 'SCI', deptType: 'ACADEMIC' })).body.id;
  for (const a of (await get('/accounts/chart')).body) if (a.systemKey) acc[a.systemKey] = a.id;
  for (const t of (await get('/accounts/statutory')).body.taxCodes) ids[`tax_${t.code}`] = t.id;
  ids.v1 = (await post('/accounts/vendors', { name: 'Sri Lakshmi Stationers', vendorType: 'SUPPLIER', gstin: '29AAPFL1234K1Z2', stateCode: '29' })).body.id;
  ids.v2 = (await post('/accounts/vendors', { name: 'Bengaluru Office Mart', vendorType: 'SUPPLIER', stateCode: '29' })).body.id;
  await createRole(A.tenantId, 'KEEPER_R', [PERMISSIONS.INV_READ, PERMISSIONS.INV_SETUP, PERMISSIONS.INV_RECEIVE, PERMISSIONS.INV_ISSUE, PERMISSIONS.INV_COUNT]);
  await createRole(A.tenantId, 'BUYER_R', [PERMISSIONS.INV_READ, PERMISSIONS.INV_PURCHASE, PERMISSIONS.APPROVALS_REQUEST_READ]);
  await createRole(A.tenantId, 'HOD_R', [PERMISSIONS.INV_REQUEST]);
  const k = await addMember(app, A.session, { label: 'Keeper', roleCode: 'KEEPER_R', campusId: main });
  keeper = k.session;
  ids.keeperEmp = (await post('/staff', { campusId: main, firstName: 'Ramesh', gender: 'MALE', employeeType: 'NON_TEACHING', designation: 'Store keeper', joiningDate: '2020-06-01' })).body.id;
  await post(`/staff/${ids.keeperEmp}/user`, { userId: k.userId });
  ids.keeperUser = k.userId;
  buyer = (await addMember(app, A.session, { label: 'Buyer', roleCode: 'BUYER_R', campusId: main })).session;
  hod = (await addMember(app, A.session, { label: 'Hod', roleCode: 'HOD_R', campusId: main })).session;
  const db = ownerDb();
  ids.adminRole = (await db.role.findFirstOrThrow({ where: { tenantId: A.tenantId, code: 'INSTITUTION_ADMIN' } })).id;
  await db.$disconnect();
}, 180_000);
afterAll(() => app?.close());

describe('AC87 items & stock', () => {
  it('items and stores; opening stock; stock never goes below zero, also with two issues at once; ledger = balance', async () => {
    const cats = (await get('/inventory/options', keeper)).body.categories;
    ids.stationery = cats.find((c: { name: string }) => c.name === 'Stationery').id;
    const paper = await post('/inventory/items', { name: 'A4 paper (75 GSM)', categoryId: ids.stationery, unit: 'REAM', reorderLevel: 10, expenseAccountId: acc.EXP_STATIONERY, taxCodeId: ids.tax_GST18, hsnCode: '4802' }, keeper);
    expect(paper.status).toBe(201);
    expect(paper.body.itemCode).toBe('ITM-0001');
    ids.paper = paper.body.id;
    ids.marker = (await post('/inventory/items', { itemCode: 'mkr box', name: 'Whiteboard markers (box of 10)', categoryId: ids.stationery, unit: 'BOX', reorderLevel: 5, expenseAccountId: acc.EXP_STATIONERY }, keeper)).body.id;
    expect((await post('/inventory/items', { itemCode: 'MKR-BOX', name: 'Again', categoryId: ids.stationery, unit: 'BOX' }, keeper)).status).toBe(409);
    expect((await post('/inventory/items', { name: 'Wrong account', categoryId: ids.stationery, unit: 'PCS', expenseAccountId: acc.CASH }, keeper)).status).toBe(422);
    ids.main = (await post('/inventory/stores', { campusId: main, name: 'Main Store', storeKeeperId: ids.keeperEmp }, keeper)).body.id;
    ids.lab = (await post('/inventory/stores', { campusId: main, name: 'Lab Store' }, keeper)).body.id;
    expect((await post('/inventory/stores', { campusId: north, name: 'North Store' }, keeper)).status).toBe(404);
    expect((await post('/inventory/opening-stock', { storeId: ids.main, date: today, lines: [{ itemId: ids.paper, quantity: 20, rate: 250 }, { itemId: ids.marker, quantity: 8, rate: 400 }] }, keeper)).status).toBe(201);
    expect((await post('/inventory/opening-stock', { storeId: ids.main, date: today, lines: [{ itemId: ids.paper, quantity: 1, rate: 1 }] }, keeper)).status).toBe(409);
    const one = await post('/inventory/issues', { issueType: 'ISSUE', fromStoreId: ids.main, toDepartmentId: ids.dept, issueDate: today, items: [{ itemId: ids.paper, quantity: 5 }] }, keeper);
    expect(one.body.totalValue).toBe('1250.00');
    const both = await Promise.all([1, 2].map(() => post('/inventory/issues', { issueType: 'ISSUE', fromStoreId: ids.main, toDepartmentId: ids.dept, issueDate: today, items: [{ itemId: ids.paper, quantity: 10 }] }, keeper)));
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(both.find((r) => r.status === 409)!.body.type).toBe('insufficient-stock');
    const b = await bal(ids.main, ids.paper);
    expect(b).toMatchObject({ quantity: 5, value: 1250, ledgerQty: 5, ledgerValue: 1250 });
    const db = ownerDb();
    const t = await db.stockTransaction.findFirstOrThrow({ where: { storeId: ids.main, itemId: ids.paper } });
    await expect(db.$executeRawUnsafe(`UPDATE stock_transactions SET quantity = 99 WHERE id = '${t.id}'`)).rejects.toThrow(/cannot be changed/);
    await expect(db.$executeRawUnsafe(`UPDATE stock_balances SET quantity = -1 WHERE store_id = '${ids.main}' AND item_id = '${ids.paper}'`)).rejects.toThrow();
    await db.$disconnect();
  });
});

describe('AC88 requests & quotations', () => {
  it('a request is approved where a rule exists; the comparison picks the lowest total and per-item rates; one selection', async () => {
    const pr = await post('/inventory/requests', { campusId: main, departmentId: ids.dept, justification: 'Paper and markers for the term', items: [{ itemId: ids.paper, quantity: 50, estimatedRate: 260 }, { itemId: ids.marker, quantity: 10, estimatedRate: 400 }] }, hod);
    expect(pr.status).toBe(201);
    expect(pr.body.status).toBe('APPROVED');
    ids.pr = pr.body.id;
    expect((await post('/approvals/rules', { entityType: 'PURCHASE_REQUEST', levelNo: 1, approverRoleId: ids.adminRole })).status).toBe(201);
    const pr2 = await post('/inventory/requests', { campusId: main, departmentId: ids.dept, justification: 'Extra markers', items: [{ itemId: ids.marker, quantity: 5 }] }, hod);
    expect(pr2.body.status).toBe('SUBMITTED');
    expect((await post(`/inventory/requests/${pr2.body.id}/cancel`, {}, hod)).body.type).toBe('pr-waiting');
    expect((await post(`/inventory/requests/${pr2.body.id}/quotations`, { vendorId: ids.v1, quotationDate: today, items: [] }, buyer)).status).toBe(422);
    const req = (await get('/approvals/inbox')).body.find((x: { entityType: string }) => x.entityType === 'PURCHASE_REQUEST');
    expect((await post(`/approvals/requests/${req.id}/act`, { action: 'APPROVE' })).status).toBeLessThan(300);
    const items = (await get(`/inventory/requests/${ids.pr}`, buyer)).body.items;
    const pi = (it: string) => items.find((x: { itemId: string }) => x.itemId === it).id;
    const q1 = await post(`/inventory/requests/${ids.pr}/quotations`, { vendorId: ids.v1, quotationDate: today, deliveryDays: 5, items: [{ prItemId: pi(ids.paper), rate: 255, taxPercent: 18 }, { prItemId: pi(ids.marker), rate: 380, taxPercent: 18 }] }, buyer);
    expect(q1.body.totalAmount).toBe(String((50 * 255 + 10 * 380) * 1.18) + '.00');
    ids.q1 = q1.body.id;
    ids.q2 = (await post(`/inventory/requests/${ids.pr}/quotations`, { vendorId: ids.v2, quotationDate: today, items: [{ prItemId: pi(ids.paper), rate: 250, taxPercent: 18 }, { prItemId: pi(ids.marker), rate: 420, taxPercent: 18 }] }, buyer)).body.id;
    expect((await post(`/inventory/requests/${ids.pr}/quotations`, { vendorId: ids.v1, quotationDate: today, items: [{ prItemId: pi(ids.paper), rate: 1 }] }, buyer)).status).toBe(409);
    expect((await post(`/inventory/requests/${ids.pr}/quotations`, { vendorId: ids.v2, quotationDate: today, items: [] }, hod)).status).toBe(403);
    const v = (await get(`/inventory/requests/${ids.pr}`, buyer)).body;
    expect(v.quotations.find((q: { id: string }) => q.id === ids.q1).lowestTotal).toBe(true);
    expect(v.items.find((x: { itemId: string }) => x.itemId === ids.paper).lowestQuotationId).toBe(ids.q2);
    expect(v.items.find((x: { itemId: string }) => x.itemId === ids.marker).lowestQuotationId).toBe(ids.q1);
    await post(`/inventory/quotations/${ids.q2}/select`, { reason: 'Cheapest paper' }, buyer);
    await post(`/inventory/quotations/${ids.q1}/select`, { reason: 'Lowest total; delivers in 5 days' }, buyer);
    const after = (await get(`/inventory/requests/${ids.pr}`, buyer)).body.quotations;
    expect(after.filter((q: { isSelected: boolean }) => q.isSelected).map((q: { id: string }) => q.id)).toEqual([ids.q1]);
  });
});

describe('AC89 orders, receipts & bills', () => {
  it('orders are approved by someone else where a rule exists', async () => {
    const po = await post(`/inventory/quotations/${ids.q1}/order`, { storeId: ids.main, poDate: today }, buyer);
    expect(po.status).toBe(201);
    expect(po.body.status).toBe('APPROVED');
    ids.po = po.body.id;
    expect((await get(`/inventory/requests/${ids.pr}`, buyer)).body.status).toBe('ORDERED');
    const db = ownerDb();
    const buyerRole = (await db.role.findFirstOrThrow({ where: { tenantId: A.tenantId, code: 'BUYER_R' } })).id;
    await db.$disconnect();
    expect((await post('/approvals/rules', { entityType: 'PURCHASE_ORDER', levelNo: 1, approverRoleId: buyerRole })).status).toBe(201);
    const direct = await post('/inventory/orders', { campusId: main, vendorId: ids.v2, storeId: ids.lab, poDate: today, items: [{ itemId: ids.marker, quantity: 3, rate: 410 }] }, buyer);
    expect(direct.body.status).toBe('PENDING_APPROVAL');
    const db2 = ownerDb();
    const reqId = (await db2.purchaseOrder.findUniqueOrThrow({ where: { id: direct.body.id } })).approvalRequestId!;
    await db2.$disconnect();
    expect((await post(`/approvals/requests/${reqId}/act`, { action: 'APPROVE' }, buyer)).status).toBe(403); // the buyer prepared it
    expect((await post(`/approvals/requests/${reqId}/act`, { action: 'APPROVE' })).status).toBe(403); // the admin is not an approver for this rule
    const other = await addMember(app, A.session, { label: 'Buyer2', roleCode: 'BUYER_R', campusId: main });
    expect((await post(`/approvals/requests/${reqId}/act`, { action: 'APPROVE' }, other.session)).status).toBeLessThan(300);
    expect((await get(`/inventory/orders/${direct.body.id}`, buyer)).body.status).toBe('APPROVED');
  });

  it('only accepted quantities enter stock; at most the order + 5%; the order shows partly / fully received', async () => {
    const o = (await get(`/inventory/orders/${ids.po}`, keeper)).body;
    const line = (it: string) => o.items.find((x: { itemId: string }) => x.itemId === it).id;
    expect((await post(`/inventory/orders/${ids.po}/receipts`, { receiptDate: today, lines: [{ poItemId: line(ids.paper), receivedQty: 30, rejectedQty: 2 }] }, keeper)).status).toBe(422);
    const g1 = await post(`/inventory/orders/${ids.po}/receipts`, { receiptDate: today, vendorChallanNo: 'DC-118', lines: [{ poItemId: line(ids.paper), receivedQty: 30, rejectedQty: 2, rejectionReason: 'Wet packets' }, { poItemId: line(ids.marker), receivedQty: 10 }] }, keeper);
    expect(g1.body.orderStatus).toBe('PARTIAL');
    ids.g1 = g1.body.id;
    expect((await post(`/inventory/orders/${ids.po}/receipts`, { receiptDate: today, lines: [{ poItemId: line(ids.paper), receivedQty: 25 }] }, keeper)).body.type).toBe('over-receipt');
    expect((await post(`/inventory/orders/${ids.po}/receipts`, { receiptDate: today, lines: [{ poItemId: line(ids.paper), receivedQty: 24 }] }, keeper)).body.orderStatus).toBe('RECEIVED');
    // 5 @ 250 + 28 @ 255 + 24 @ 255 = 14,510 for 57 reams.
    expect(await bal(ids.main, ids.paper)).toMatchObject({ quantity: 57, value: 14510, ledgerQty: 57, ledgerValue: 14510 });
    expect((await bal(ids.main, ids.paper)).avg).toBeCloseTo(14510 / 57, 3);
  });

  it('a bill from a receipt never bills more than accepted less already billed', async () => {
    const o = (await get(`/inventory/orders/${ids.po}`, keeper)).body;
    const r1 = o.receipts.find((r: { id: string }) => r.id === ids.g1);
    const paperLine = r1.items.find((i: { item: string }) => i.item.startsWith('A4')).id;
    const b = await post(`/inventory/receipts/${ids.g1}/bill`, { billNo: 'SLS/2026/441', billDate: today, lines: [{ grnItemId: paperLine, quantity: 20 }] }, keeper);
    expect(b.status).toBe(201);
    expect(b.body.total).toBe(String(20 * 255 * 1.18) + '.00');
    expect((await post(`/inventory/receipts/${ids.g1}/bill`, { billNo: 'SLS/2026/442', billDate: today, lines: [{ grnItemId: paperLine, quantity: 9 }] }, keeper)).body.type).toBe('over-billing');
    expect((await post(`/inventory/receipts/${ids.g1}/bill`, { billNo: 'SLS/2026/442', billDate: today, lines: [{ grnItemId: paperLine, quantity: 8 }] }, keeper)).status).toBe(201);
    const db = ownerDb();
    const bill = await db.vendorBill.findFirstOrThrow({ where: { tenantId: A.tenantId, billNo: 'SLS/2026/441' }, include: { items: true } });
    expect(bill).toMatchObject({ purchaseOrderId: ids.po, goodsReceiptId: ids.g1 });
    expect(bill.items[0].goodsReceiptItemId).toBe(paperLine);
    expect(bill.items[0].accountId).toBe(acc.EXP_STATIONERY);
    await db.$disconnect();
    expect((await get(`/inventory/orders/${ids.po}`, keeper)).body.receipts.find((r: { id: string }) => r.id === ids.g1).items.find((i: { id: string }) => i.id === paperLine)).toMatchObject({ billedQty: '28.00', unbilledQty: '0.00' });
  });
});

describe('AC90 issues, counts & alerts', () => {
  it('transfers move stock at the average rate; a count adjusts only after approval', async () => {
    const t = await post('/inventory/issues', { issueType: 'TRANSFER', fromStoreId: ids.main, toStoreId: ids.lab, issueDate: today, items: [{ itemId: ids.paper, quantity: 6 }] }, keeper);
    expect(t.status).toBe(201);
    const lab = await bal(ids.lab, ids.paper);
    expect(lab.quantity).toBe(6);
    expect(lab.value).toBeCloseTo(Math.round((14510 * 6) / 57 * 100) / 100, 2);
    const c1 = await post('/inventory/counts', { storeId: ids.lab, countDate: today, lines: [{ itemId: ids.paper, countedQty: 5 }] }, keeper);
    expect(c1.body.status).toBe('ADJUSTED');
    expect((await bal(ids.lab, ids.paper)).quantity).toBe(5);
    expect((await post('/approvals/rules', { entityType: 'STOCK_ADJUSTMENT', levelNo: 1, approverRoleId: ids.adminRole })).status).toBe(201);
    const c2 = await post('/inventory/counts', { storeId: ids.lab, countDate: today, lines: [{ itemId: ids.paper, countedQty: 9 }] }, keeper);
    expect(c2.body.status).toBe('PENDING_APPROVAL');
    expect((await bal(ids.lab, ids.paper)).quantity).toBe(5);
    expect((await post('/inventory/counts', { storeId: ids.lab, countDate: today, lines: [{ itemId: ids.paper, countedQty: 1 }] }, keeper)).body.type).toBe('count-pending');
    const req = (await get('/approvals/inbox')).body.find((x: { entityType: string }) => x.entityType === 'STOCK_ADJUSTMENT');
    expect((await post(`/approvals/requests/${req.id}/act`, { action: 'APPROVE' })).status).toBeLessThan(300);
    expect(await bal(ids.lab, ids.paper)).toMatchObject({ quantity: 9, ledgerQty: 9 });
  });

  it('items below their reorder level are listed and the store keeper is told once a day', async () => {
    await post('/inventory/issues', { issueType: 'ISSUE', fromStoreId: ids.main, issuedToEmployeeId: ids.keeperEmp, issueDate: today, items: [{ itemId: ids.marker, quantity: 14 }] }, keeper);
    const low = (await get(`/inventory/stock?storeId=${ids.main}&low=true`, keeper)).body.rows;
    expect(low.map((r: { item: string }) => r.item)).toContain('Whiteboard markers (box of 10)');
    const svc = app.get(InventoryService);
    expect(await svc.alertAll()).toBeGreaterThanOrEqual(1);
    expect(await svc.alertAll()).toBe(0);
    const db = ownerDb();
    const n = await db.notification.count({ where: { tenantId: A.tenantId, userId: ids.keeperUser, eventCode: 'INVENTORY_LOW' } });
    await db.$disconnect();
    expect(n).toBe(1);
    const cons = (await get('/inventory/reports/consumption', keeper)).body;
    expect(cons.rows.find((r: { department: string }) => r.department === 'Science')).toBeTruthy();
  });

  it('another institution sees none of it', async () => {
    expect((await get(`/inventory/orders/${ids.po}`, B.session)).status).toBe(404);
    expect((await get(`/inventory/requests/${ids.pr}`, B.session)).status).toBe(404);
    expect((await get('/inventory/items', B.session)).body.map((i: { name: string }) => i.name)).not.toContain('A4 paper (75 GSM)');
    expect((await get('/inventory/orders', B.session)).body).toHaveLength(0);
  });
});
