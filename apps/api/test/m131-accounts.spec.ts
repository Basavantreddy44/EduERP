/**
 * AC70–AC74 accounts (Phase 13): set-up (encrypted bank / PAN, opening balances, month lock with the
 * database backstop, unlock through approval, year close); vendor bills (GST split by state, TDS by PAN
 * type and threshold, approval before posting, one bill number per vendor); payments & vouchers (no
 * overpayment even at once, partial / full, advances, vouchers, party accounts guarded, four eyes); bank
 * reconciliation (duplicate import, one match per entry, the statement explains the difference); reports
 * that tie out; isolation.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PERMISSIONS } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, auth, createRole, createTenant, login, ownerDb, startApp, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let main: string;
let clerk: Session;
let head: Session;
let headRole: string;
const acc: Record<string, string> = {};
const ids: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const put = (path: string, body: unknown, s: Session = A.session) => http().put(`${API}${path}`).set(auth(s)).send(body as object);
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const shift = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** A date in the current financial year, at least a few days back and inside the current month when possible. */
const recent = shift(-2);

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'AccA');
  B = await createTenant(app, platform, 'AccB');
  main = (await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  await createRole(A.tenantId, 'ACC_CLERK', [PERMISSIONS.ACC_READ, PERMISSIONS.ACC_ENTRY, PERMISSIONS.ACC_BANK]);
  headRole = await createRole(A.tenantId, 'ACC_HEAD', [PERMISSIONS.ACC_READ, PERMISSIONS.ACC_ENTRY, PERMISSIONS.ACC_SETUP, PERMISSIONS.ACC_CLOSE, PERMISSIONS.APPROVALS_REQUEST_READ]);
  clerk = (await addMember(app, A.session, { label: 'AccClerk', roleCode: 'ACC_CLERK' })).session;
  head = (await addMember(app, A.session, { label: 'AccHead', roleCode: 'ACC_HEAD' })).session;
  for (const a of (await get('/accounts/chart')).body) if (a.systemKey) acc[a.systemKey] = a.id;
}, 180_000);
afterAll(() => app?.close());

describe('AC70 set-up', () => {
  it('starts with the extra chart, GST codes and TDS sections, marked “please check”', async () => {
    expect(Object.keys(acc)).toEqual(expect.arrayContaining(['CASH', 'BANK_ACCOUNTS', 'VENDORS_PAYABLE', 'TDS_PAYABLE', 'INPUT_CGST', 'SURPLUS', 'EXP_REPAIRS']));
    const st = (await get('/accounts/statutory')).body;
    expect(st.confirmed).toBeNull();
    expect(st.taxCodes.map((t: { code: string }) => t.code)).toEqual(expect.arrayContaining(['EXEMPT', 'GST5', 'GST18']));
    expect(st.tdsSections.map((t: { sectionCode: string }) => t.sectionCode)).toEqual(expect.arrayContaining(['194C', '194J', '194I']));
    for (const t of st.taxCodes) ids[`tax_${t.code}`] = t.id;
    for (const t of st.tdsSections) ids[`tds_${t.sectionCode}`] = t.id;
    expect((await post('/accounts/statutory/confirm', {}, clerk)).status).toBe(403);
    expect((await post('/accounts/statutory/confirm', {}, head)).status).toBe(200);
    expect((await get('/accounts/statutory')).body.confirmed).toMatchObject({ by: expect.any(String) });
  });

  it('bank account numbers are stored encrypted, shown as the last 4, and revealed only with the right (audited)', async () => {
    const r = await post('/accounts/bank-accounts', { campusId: main, bankName: 'Canara Bank', branch: 'Jayanagar', accountNo: '0412 1010 0123 4567', ifsc: 'cnrb0000412', accountType: 'CURRENT', isFeeCollection: true }, head);
    expect(r.status).toBe(201);
    ids.bank = r.body.id; acc.MYBANK = r.body.accountId;
    expect((await post('/accounts/bank-accounts', { bankName: 'Canara Bank', accountNo: '041210100123456 7', ifsc: 'CNRB0000412', accountType: 'CURRENT' }, head)).status).toBe(409);
    const list = (await get('/accounts/bank-accounts')).body;
    expect(list).toEqual([expect.objectContaining({ accountNo: '••••4567', ifsc: 'CNRB0000412', ledger: 'Canara Bank ••4567' })]);
    expect(JSON.stringify(list)).not.toContain('041210100123');
    const db = ownerDb();
    const row = await db.bankAccount.findUniqueOrThrow({ where: { id: ids.bank } });
    expect(row.accountNoEnc).toMatch(/^v1:/);
    expect(row.accountNoEnc).not.toContain('4567');
    const logs = await db.auditLog.findMany({ where: { tenantId: A.tenantId, entityType: 'BANK_ACCOUNT' } });
    expect(JSON.stringify(logs)).not.toContain('0412101001234567');
    await db.$disconnect();
    expect((await post(`/accounts/bank-accounts/${ids.bank}/reveal`, {}, head)).status).toBe(403);
    expect((await post(`/accounts/bank-accounts/${ids.bank}/reveal`, {})).body).toEqual({ accountNo: '0412101001234567' });
  });

  it('opening balances must balance and use balance-sheet accounts', async () => {
    const asOn = '2025-04-01';
    expect((await post('/accounts/opening-balances', { asOn, lines: [{ accountId: acc.CASH, debit: '5000' }, { accountId: acc.CAPITAL_FUND, credit: '4000' }] }, head)).status).toBe(422);
    expect((await post('/accounts/opening-balances', { asOn, lines: [{ accountId: acc.EXP_RENT, debit: '5000' }, { accountId: acc.CAPITAL_FUND, credit: '5000' }] }, head)).status).toBe(422);
    const ok = await post('/accounts/opening-balances', { asOn, lines: [{ accountId: acc.CASH, debit: '50000' }, { accountId: acc.MYBANK, debit: '250000' }, { accountId: acc.CAPITAL_FUND, credit: '300000' }] }, head);
    expect(ok.status).toBe(201);
  });

  it('nothing posts into a locked month — refused by the API and by the database; unlocking needs approval', async () => {
    expect((await post('/accounts/periods/lock', { month: '2026-08' }, clerk)).status).toBe(403);
    expect((await post('/accounts/periods/lock', { month: '2026-08' }, head)).body.status).toBe('LOCKED');
    const v = await post('/accounts/vouchers/expense', { campusId: main, voucherDate: '2026-08-14', expenseAccountId: acc.EXP_STATIONERY, paidFromAccountId: acc.CASH, amount: '500', paidTo: 'Ravi Stationers', narration: 'Chart paper' }, clerk);
    expect(v.status).toBe(409);
    expect(v.body.type).toBe('period-locked');
    // The database refuses too, whoever writes.
    const db = ownerDb();
    const fy = await db.financialYear.findFirstOrThrow({ where: { tenantId: A.tenantId } });
    await expect(db.$executeRawUnsafe(`INSERT INTO journal_entries (id, tenant_id, entry_no, financial_year_id, entry_date, voucher_type, source_type, narration, total_amount) VALUES (gen_random_uuid(), '${A.tenantId}', 'X-1', '${fy.id}', '2026-08-20', 'JOURNAL', 'TEST', 'test', 1)`)).rejects.toThrow(/locked/);
    await db.$disconnect();
    expect((await post('/approvals/rules', { entityType: 'PERIOD_UNLOCK', levelNo: 1, approverRoleId: headRole })).status).toBe(201);
    expect((await post('/accounts/periods/unlock', { month: '2026-08', reason: 'Late electricity bill' }, A.session)).body.status).toBe('UNLOCKING');
    expect((await post('/accounts/vouchers/expense', { campusId: main, voucherDate: '2026-08-14', expenseAccountId: acc.EXP_STATIONERY, paidFromAccountId: acc.CASH, amount: '500', paidTo: 'Ravi Stationers', narration: 'Chart paper' }, clerk)).status).toBe(409);
    const req = (await get('/approvals/inbox', head)).body.find((x: { entityType: string }) => x.entityType === 'PERIOD_UNLOCK');
    expect((await post(`/approvals/requests/${req.id}/act`, { action: 'APPROVE' }, head)).status).toBeLessThan(300);
    expect((await post('/accounts/vouchers/expense', { campusId: main, voucherDate: '2026-08-14', expenseAccountId: acc.EXP_UTILITIES, paidFromAccountId: acc.CASH, amount: '1200', paidTo: 'BESCOM', narration: 'August electricity' }, clerk)).body.status).toBe('POSTED');
  });

  it('a year closes only when every month is locked; the surplus goes to the fund and nothing more posts into it', async () => {
    // 2025-26 activity: income 20,000 by journal, rent 8,000 paid by cash.
    await post('/accounts/vouchers/journal', { voucherDate: '2025-06-10', narration: 'Donation received in cash', lines: [{ accountId: acc.CASH, debit: '20000' }, { accountId: acc.INCOME_DONATIONS, credit: '20000' }] }, head);
    await post('/accounts/vouchers/expense', { campusId: main, voucherDate: '2025-07-05', expenseAccountId: acc.EXP_RENT, paidFromAccountId: acc.CASH, amount: '8000', paidTo: 'Landlord', narration: 'July rent' }, head);
    const years = (await get('/accounts/periods')).body.years;
    const fy = years.find((y: { name: string }) => y.name === '2025-26');
    expect((await post('/accounts/years/close', { financialYearId: fy.id }, head)).status).toBe(409);
    for (const m of ['2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03']) await post('/accounts/periods/lock', { month: m }, head);
    const c = await post('/accounts/years/close', { financialYearId: fy.id }, head);
    expect(c.body).toMatchObject({ name: '2025-26', surplus: '12000.00', balanced: true });
    const tb = (await get('/accounts/reports/TRIAL_BALANCE?from=2025-04-01&to=2026-03-31')).body;
    expect(tb.totals.debit).toBe(tb.totals.credit);
    expect(tb.rows.find((r: { account: string }) => r.account === 'Accumulated surplus')).toMatchObject({ credit: '12000.00' });
    expect(tb.rows.some((r: { type: string }) => r.type === 'INCOME' || r.type === 'EXPENSE')).toBe(false);
    expect((await post('/accounts/periods/unlock', { month: '2025-12', reason: 'Try after close' }, head)).status).toBe(409);
  });
});

describe('AC71 vendors & bills', () => {
  it('checks GSTIN / PAN, keeps PAN encrypted', async () => {
    expect((await post('/accounts/vendors', { name: 'Bad GST', vendorType: 'SUPPLIER', gstin: '29ABCDE1234F1Z5', pan: 'ZZZZZ9999Z', stateCode: '29' }, clerk)).status).toBe(422);
    expect((await post('/accounts/vendors', { name: 'Bad state', vendorType: 'SUPPLIER', gstin: '29ABCDE1234F1Z5', stateCode: '27' }, clerk)).status).toBe(422);
    const k = await post('/accounts/vendors', { name: 'Sri Ganesh Electricals', vendorType: 'CONTRACTOR', gstin: '29AAPFG1234K1Z2', pan: 'AAPFG1234K', stateCode: '29', tdsSectionId: ids.tds_194C, bankAccountNo: '123456789012', ifsc: 'SBIN0001234', bankName: 'SBI' }, clerk);
    expect(k.status).toBe(201);
    ids.vk = k.body.id;
    ids.vm = (await post('/accounts/vendors', { name: 'Mumbai Lab Supplies', vendorType: 'SUPPLIER', gstin: '27AABCM5678L1Z9', stateCode: '27' }, clerk)).body.id;
    ids.vi = (await post('/accounts/vendors', { name: 'Ramesh (painter)', vendorType: 'CONTRACTOR', pan: 'ABCPR4321Q', stateCode: '29', tdsSectionId: ids.tds_194C }, clerk)).body.id;
    ids.vn = (await post('/accounts/vendors', { name: 'No PAN Transport', vendorType: 'CONTRACTOR', stateCode: '29', tdsSectionId: ids.tds_194C }, clerk)).body.id;
    const v = (await get('/accounts/vendors', clerk)).body.find((x: { id: string }) => x.id === ids.vk);
    expect(v).toMatchObject({ pan: '••••234K', bankAccount: '••••9012', tdsSection: '194C' });
    // An edit without re-typing PAN / account number keeps them (screens never hold the full values).
    expect((await put(`/accounts/vendors/${ids.vk}`, { name: 'Sri Ganesh Electricals', vendorType: 'CONTRACTOR', gstin: '29AAPFG1234K1Z2', stateCode: '29', tdsSectionId: ids.tds_194C, phone: '9845000111' }, clerk)).status).toBe(200);
    expect((await get('/accounts/vendors', clerk)).body.find((x: { id: string }) => x.id === ids.vk)).toMatchObject({ pan: '••••234K', bankAccount: '••••9012', phone: '9845000111' });
    const db = ownerDb();
    const row = await db.vendor.findUniqueOrThrow({ where: { id: ids.vk } });
    expect(row.panEnc).toMatch(/^v1:/);
    expect(row.panHolder).toBe('OTHER');
    await db.$disconnect();
  });

  it('GST is CGST + SGST within Karnataka and IGST otherwise', async () => {
    const item = { accountId: acc.EXP_TEACHING, description: 'Lab glassware', quantity: '1', rate: '10000', taxCodeId: ids.tax_GST18 };
    const ka = (await post('/accounts/bills/preview', { campusId: main, vendorId: ids.vk, billNo: 'P1', billDate: recent, items: [item], applyTds: false }, clerk)).body;
    expect(ka).toMatchObject({ interState: false, cgst: '900.00', sgst: '900.00', igst: '0.00', total: '11800.00' });
    const mh = (await post('/accounts/bills/preview', { campusId: main, vendorId: ids.vm, billNo: 'P2', billDate: recent, items: [item] }, clerk)).body;
    expect(mh).toMatchObject({ interState: true, cgst: '0.00', sgst: '0.00', igst: '1800.00' });
  });

  it('TDS only above the threshold; the rate follows the PAN (individual 1%, firm 2%, none 20%)', async () => {
    const bill = (vendorId: string, billNo: string, rate: string) => post('/accounts/bills', { campusId: main, vendorId, billNo, billDate: recent, items: [{ accountId: acc.EXP_REPAIRS, description: 'Work', rate }] }, clerk);
    const small = await bill(ids.vi, 'R-1', '20000');
    expect(small.body).toMatchObject({ status: 'APPROVED', tdsAmount: '0.00', payable: '20000.00' });
    expect(small.body.internalNo).toMatch(/^BILL\/\d{4}-\d{2}\/\d{4}$/);
    ids.billSmall = small.body.id;
    const big = await bill(ids.vi, 'R-2', '35000');
    expect(big.body).toMatchObject({ tdsAmount: '350.00', payable: '34650.00' });
    ids.billBig = big.body.id;
    expect((await bill(ids.vk, 'E-77', '40000')).body).toMatchObject({ tdsAmount: '800.00' });
    expect((await bill(ids.vn, 'T-1', '40000')).body).toMatchObject({ tdsAmount: '8000.00' });
    // Year total crossing 1,00,000: a 30,000 bill after 20,000 + 35,000 + 25,000 bills.
    await bill(ids.vi, 'R-3', '25000');
    expect((await bill(ids.vi, 'R-4', '30000')).body.tdsAmount).toBe('300.00');
    const detail = (await get(`/accounts/bills/${ids.billBig}`)).body;
    expect(detail).toMatchObject({ tdsSection: '194C', tdsRate: '1.00', journalEntryNo: expect.any(String) });
  });

  it('one bill number per vendor; a bill with an approval rule posts only after approval; its journal balances', async () => {
    expect((await post('/accounts/bills', { campusId: main, vendorId: ids.vi, billNo: 'r-1', billDate: recent, items: [{ accountId: acc.EXP_REPAIRS, description: 'Again', rate: '100' }] }, clerk)).status).toBe(409);
    expect((await post('/accounts/bills', { campusId: main, vendorId: ids.vm, billNo: 'R-1', billDate: recent, items: [{ accountId: acc.EXP_TEACHING, description: 'Beakers', rate: '1000', taxCodeId: ids.tax_GST18 }] }, clerk)).status).toBe(201);
    expect((await post('/approvals/rules', { entityType: 'VENDOR_BILL', levelNo: 1, approverRoleId: headRole, minAmount: 50000 })).status).toBe(201);
    const b = (await post('/accounts/bills', { campusId: main, vendorId: ids.vm, billNo: 'BIG-1', billDate: recent, items: [{ accountId: acc.EXP_TEACHING, description: 'Microscopes', quantity: '4', rate: '15000', taxCodeId: ids.tax_GST18 }] }, clerk)).body;
    expect(b.status).toBe('PENDING_APPROVAL');
    expect((await get(`/accounts/bills/${b.id}`)).body.journalEntryNo).toBeNull();
    expect((await post('/accounts/payments', { campusId: main, vendorId: ids.vm, paymentDate: recent, mode: 'CASH', allocations: [{ billId: b.id, amount: '100' }] }, clerk)).status).toBe(409);
    const req = (await get('/approvals/inbox', head)).body.find((x: { entityType: string }) => x.entityType === 'VENDOR_BILL');
    expect((await post(`/approvals/requests/${req.id}/act`, { action: 'APPROVE' }, head)).status).toBeLessThan(300);
    const after = (await get(`/accounts/bills/${b.id}`)).body;
    expect(after).toMatchObject({ status: 'APPROVED', total: '70800.00', journalEntryNo: expect.any(String) });
    ids.billMh = b.id;
    const db = ownerDb();
    const unbalanced = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM (SELECT journal_entry_id FROM journal_lines WHERE tenant_id = '${A.tenantId}' GROUP BY journal_entry_id HAVING SUM(debit) <> SUM(credit)) x`);
    expect(unbalanced[0].n).toBe(0);
    await db.$disconnect();
  });
});

describe('AC72 payments & vouchers', () => {
  it('never pays more than is due — also when two payments are made at once', async () => {
    expect((await post('/accounts/payments', { campusId: main, vendorId: ids.vi, paymentDate: recent, mode: 'CASH', allocations: [{ billId: ids.billSmall, amount: '20000.01' }] }, clerk)).status).toBe(422);
    expect((await post('/accounts/payments', { campusId: main, vendorId: ids.vi, paymentDate: recent, mode: 'NEFT', allocations: [{ billId: ids.billSmall, amount: '100' }] }, clerk)).status).toBe(422); // bank + UTR needed
    const both = await Promise.all([1, 2].map(() => post('/accounts/payments', { campusId: main, vendorId: ids.vi, paymentDate: recent, mode: 'NEFT', bankAccountId: ids.bank, referenceNo: 'UTR1', allocations: [{ billId: ids.billSmall, amount: '20000' }] }, clerk)));
    const codes = both.map((r) => r.status).sort();
    expect(codes[0]).toBe(201);
    expect([409, 422]).toContain(codes[1]); // the second sees the bill already paid
    expect((await get(`/accounts/bills/${ids.billSmall}`)).body).toMatchObject({ status: 'PAID', balance: '0.00' });
  });

  it('part payments, advances and their adjustment keep bill balances right', async () => {
    const p1 = await post('/accounts/payments', { campusId: main, vendorId: ids.vi, paymentDate: recent, mode: 'CHEQUE', bankAccountId: ids.bank, referenceNo: '000451', allocations: [{ billId: ids.billBig, amount: '20000' }] }, clerk);
    expect(p1.body.status).toBe('PAID');
    ids.cheque = p1.body.id;
    expect((await get(`/accounts/bills/${ids.billBig}`)).body).toMatchObject({ status: 'PARTIAL', balance: '14650.00' });
    const adv = await post('/accounts/payments', { campusId: main, vendorId: ids.vi, paymentDate: recent, mode: 'CASH', advanceAmount: '5000' }, clerk);
    expect(adv.body).toMatchObject({ status: 'PAID', amount: '5000.00' });
    expect((await post(`/accounts/payments/${adv.body.id}/adjust`, { billId: ids.billBig, amount: '6000' }, clerk)).status).toBe(422);
    expect((await post(`/accounts/payments/${adv.body.id}/adjust`, { billId: ids.billBig, amount: '5000' }, clerk)).status).toBe(200);
    expect((await get(`/accounts/bills/${ids.billBig}`)).body).toMatchObject({ status: 'PARTIAL', balance: '9650.00' });
    expect((await post(`/accounts/payments/${adv.body.id}/cancel`, { reason: 'Entered by mistake' }, clerk)).status).toBe(409); // advance already used
    const ledger = (await get(`/accounts/vendors/${ids.vi}/ledger`)).body;
    const v = (await get('/accounts/vendors')).body.find((x: { id: string }) => x.id === ids.vi);
    expect(Math.round(Number(ledger.lines.at(-1).balance) * 100)).toBe(Math.round((Number(v.due) - Number(v.advance)) * 100));
  });

  it('a payment needing approval is approved by someone else; the preparer cannot approve it', async () => {
    expect((await post('/approvals/rules', { entityType: 'VENDOR_PAYMENT', levelNo: 1, approverRoleId: headRole })).status).toBe(201);
    const p = (await post('/accounts/payments', { campusId: main, vendorId: ids.vm, paymentDate: recent, mode: 'RTGS', bankAccountId: ids.bank, referenceNo: 'UTR-RT-9', allocations: [{ billId: ids.billMh, amount: '70800' }] }, head)).body;
    expect(p.status).toBe('PENDING_APPROVAL');
    const req = (await get('/approvals/inbox', head)).body.find((x: { entityType: string; entityId: string }) => x.entityType === 'VENDOR_PAYMENT');
    expect(req).toBeUndefined(); // not in the preparer’s own inbox
    const db = ownerDb();
    const r = await db.approvalRequest.findFirstOrThrow({ where: { tenantId: A.tenantId, entityType: 'VENDOR_PAYMENT', entityId: p.id } });
    await db.$disconnect();
    expect((await post(`/approvals/requests/${r.id}/act`, { action: 'APPROVE' }, head)).status).toBe(403);
    const other = (await addMember(app, A.session, { label: 'AccHead2', roleCode: 'ACC_HEAD' })).session;
    expect((await post(`/approvals/requests/${r.id}/act`, { action: 'APPROVE' }, other)).status).toBeLessThan(300);
    expect((await get(`/accounts/bills/${ids.billMh}`)).body.status).toBe('PAID');
  });

  it('expense, contra and journal vouchers; party accounts only through their own screens', async () => {
    expect((await post('/accounts/vouchers/expense', { campusId: main, voucherDate: recent, expenseAccountId: acc.CASH, paidFromAccountId: acc.CASH, amount: '10', paidTo: 'x', narration: 'wrong' }, clerk)).status).toBe(422);
    expect((await post('/accounts/vouchers/expense', { campusId: main, voucherDate: recent, expenseAccountId: acc.EXP_MISC, paidFromAccountId: acc.EXP_RENT, amount: '10', paidTo: 'x', narration: 'wrong' }, clerk)).status).toBe(422);
    expect((await post('/accounts/vouchers/contra', { voucherDate: recent, fromAccountId: acc.MYBANK, toAccountId: acc.CASH, amount: '10000', referenceNo: 'SELF-CHQ', narration: 'Cash withdrawn for petty expenses' }, A.session)).body.status).toBe('POSTED');
    expect((await post('/accounts/vouchers/journal', { voucherDate: recent, narration: 'Fix vendor', lines: [{ accountId: acc.VENDORS_PAYABLE, debit: '10' }, { accountId: acc.EXP_MISC, credit: '10' }] }, clerk)).status).toBe(422);
    expect((await post('/accounts/vouchers/journal', { voucherDate: recent, narration: 'Unbalanced', lines: [{ accountId: acc.EXP_MISC, debit: '10' }, { accountId: acc.CASH, credit: '9' }] }, clerk)).status).toBe(422);
    const ex = await post('/accounts/vouchers/expense', { campusId: main, voucherDate: recent, expenseAccountId: acc.EXP_COMMUNICATION, paidFromAccountId: acc.MYBANK, amount: '1499', paidTo: 'BSNL', narration: 'Internet' }, clerk);
    expect(ex.body.status).toBe('POSTED');
    ids.internet = ex.body.id;
  });
});

describe('AC73 bank reconciliation', () => {
  const csv = (rows: string[]) => Buffer.from(['Canara Bank statement', 'Account ••4567', '', 'Txn Date,Description,Ref No,Withdrawal,Deposit,Balance', ...rows].join('\n'));
  const fmt = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  const mapping = () => JSON.stringify({ bankAccountId: ids.bank, dateColumn: 'Txn Date', descriptionColumn: 'Description', referenceColumn: 'Ref No', debitColumn: 'Withdrawal', creditColumn: 'Deposit', balanceColumn: 'Balance', dateFormat: 'DD/MM/YYYY' });
  const upload = (rows: string[]) => http().post(`${API}/accounts/bank/statements`).set(auth(clerk)).field('mapping', mapping()).attach('file', csv(rows), 'statement.csv');
  let rows: string[];

  it('previews columns, imports, and a second import of the same statement adds nothing', async () => {
    rows = [`${fmt(recent)},CHQ 000451 SRI RAMESH,000451,"20,000.00",,`, `${fmt(recent)},NEFT UTR1 RAMESH,UTR1,20000.00,,`, `${fmt(recent)},SELF CHQ CASH,SELF-CHQ,10000,,`, `${fmt(recent)},BSNL INTERNET,,1499.00,,`, `${fmt(recent)},BANK CHARGES,,118.00,,`, `${fmt(recent)},INTEREST CREDIT,,,350.00,`];
    const pv = await http().post(`${API}/accounts/bank/statements/preview`).set(auth(clerk)).attach('file', csv(rows), 'statement.csv');
    expect(pv.body.suggested).toMatchObject({ dateColumn: 'Txn Date', debitColumn: 'Withdrawal', creditColumn: 'Deposit', dateFormat: 'DD/MM/YYYY' });
    const first = await upload(rows);
    expect(first.body).toMatchObject({ lines: 6, added: 6 });
    expect((await upload(rows)).body).toMatchObject({ lines: 6, added: 0, skipped: 6 });
  });

  it('suggests and auto-matches by amount and date; each entry matches only one line, only on this bank', async () => {
    const w = (await get(`/accounts/bank/${ids.bank}/workbench`, clerk)).body;
    expect(w.statementLines).toHaveLength(6);
    const am = (await post(`/accounts/bank/${ids.bank}/auto-match`, {}, clerk)).body;
    expect(am.matched).toBeGreaterThanOrEqual(2); // the cheque, the contra and the internet (the two ₹20,000 lines are ambiguous)
    const w2 = (await get(`/accounts/bank/${ids.bank}/workbench`, clerk)).body;
    // An entry already matched cannot be matched to a second line.
    const used = await firstReconciledJournalLine();
    const open = w2.statementLines[0];
    expect((await post('/accounts/bank/match', { statementLineId: open.id, journalLineIds: [used] }, clerk)).status).toBeGreaterThanOrEqual(409);
    // A cash journal line is not on this bank.
    const cashLine = await ownerDbFirstCashLine();
    const charges = w2.statementLines.find((l: { description: string }) => l.description === 'BANK CHARGES');
    expect((await post('/accounts/bank/match', { statementLineId: charges.id, journalLineIds: [cashLine] }, clerk)).status).toBe(422);
  });

  it('bank-only lines are posted as vouchers or ignored; the statement explains the whole difference', async () => {
    let w = (await get(`/accounts/bank/${ids.bank}/workbench`, clerk)).body;
    const charges = w.statementLines.find((l: { description: string }) => l.description === 'BANK CHARGES');
    expect((await post(`/accounts/bank/lines/${charges.id}/post`, { accountId: acc.BANK_CHARGES, narration: 'Bank charges' }, clerk)).body).toMatchObject({ matchStatus: 'MATCHED' });
    const interest = w.statementLines.find((l: { description: string }) => l.description === 'INTEREST CREDIT');
    expect((await post(`/accounts/bank/lines/${interest.id}/post`, { accountId: acc.INCOME_INTEREST, narration: 'Savings interest' }, clerk)).body.matchStatus).toBe('MATCHED');
    w = (await get(`/accounts/bank/${ids.bank}/workbench`, clerk)).body;
    for (const l of w.statementLines) {
      if (l.suggestions.length) await post('/accounts/bank/match', { statementLineId: l.id, journalLineIds: [l.suggestions[0].journalLineId] }, clerk);
      else await post(`/accounts/bank/lines/${l.id}/ignore`, { reason: 'Not ours' }, clerk);
    }
    const st = (await get(`/accounts/bank/${ids.bank}/statement?asOn=${today}`, clerk)).body;
    // Book balance minus items not yet in the bank, plus bank-only items, is what the bank should show.
    const p = (v: string) => Math.round(Number(v) * 100);
    expect(p(st.expectedBankBalance)).toBe(p(st.bookBalance) - p(st.depositsNotCredited.total) + p(st.paymentsNotPresented.total) + p(st.bankOnly.moneyIn) - p(st.bankOnly.moneyOut));
    expect(st.paymentsNotPresented.items.map((i: { narration: string }) => i.narration).join(' ')).toMatch(/RTGS|UTR-RT-9/);
    // Opening balances are carried from the old books, not bank transactions waiting to clear.
    expect(st.depositsNotCredited.items.map((i: { narration: string }) => i.narration).join(' ')).not.toMatch(/Opening balances/); // the approved RTGS payment is not on the statement yet
    // Unmatching puts a line back.
    const matched = await firstMatchedLine();
    expect((await post(`/accounts/bank/lines/${matched}/unmatch`, {}, clerk)).body.matchStatus).toBe('UNMATCHED');
    expect((await post(`/accounts/vouchers/${ids.internet}/cancel`, { reason: 'test' }, clerk)).status).toBeLessThan(500);
  });
});

async function ownerDbFirstCashLine() {
  const db = ownerDb();
  const l = await db.journalLine.findFirstOrThrow({ where: { tenantId: A.tenantId, accountId: acc.CASH }, select: { id: true } });
  await db.$disconnect();
  return l.id;
}
async function firstReconciledJournalLine() {
  const db = ownerDb();
  const r = await db.bankReconciliation.findFirstOrThrow({ where: { tenantId: A.tenantId }, select: { journalLineId: true } });
  await db.$disconnect();
  return r.journalLineId;
}
async function firstMatchedLine() {
  const db = ownerDb();
  const l = await db.bankStatementLine.findFirstOrThrow({ where: { tenantId: A.tenantId, matchStatus: 'MATCHED' }, select: { id: true } });
  await db.$disconnect();
  return l.id;
}

describe('AC74 reports', () => {
  it('trial balance balances; income & expenditure and the balance sheet tie out', async () => {
    const q = `from=2026-04-01&to=${today}`;
    const tb = (await get(`/accounts/reports/TRIAL_BALANCE?${q}`)).body;
    expect(tb.totals.debit).toBe(tb.totals.credit);
    const ie = (await get(`/accounts/reports/INCOME_EXPENDITURE?${q}`)).body;
    const bs = (await get(`/accounts/reports/BALANCE_SHEET?${q}`)).body;
    expect(bs.notes[0]).toBe('Assets equal funds and liabilities.');
    const surplusRow = bs.rows.find((r: { account?: string }) => /not yet closed/.test(r.account ?? ''));
    const sign = /Deficit/.test(ie.totals.account) ? -1 : 1;
    expect(Number(surplusRow.amount)).toBeCloseTo(sign * Number(ie.totals.amount), 2);
    const totalAssets = bs.rows.find((r: { account?: string }) => r.account === 'Total assets').amount;
    expect(bs.rows.find((r: { account?: string }) => r.account === 'Total funds & liabilities').amount).toBe(totalAssets);
  });

  it('cash / bank books, ledger, day book, receipts & payments, GST and TDS registers, Excel', async () => {
    const q = `from=2026-04-01&to=${today}`;
    const bank = (await get(`/accounts/reports/BANK_BOOK?${q}&accountId=${acc.MYBANK}`)).body;
    expect(bank.title).toMatch(/Canara Bank ••4567/);
    expect(bank.rows.length).toBeGreaterThan(3);
    expect((await get(`/accounts/reports/LEDGER?${q}`)).status).toBe(422);
    expect((await get(`/accounts/reports/LEDGER?${q}&accountId=${acc.EXPENSES}`)).body.rows.length).toBeGreaterThan(3); // a group covers its accounts
    expect((await get(`/accounts/reports/DAY_BOOK?${q}`)).body.totals.debit).toBe((await get(`/accounts/reports/DAY_BOOK?${q}`)).body.totals.credit);
    expect((await get(`/accounts/reports/RECEIPTS_PAYMENTS?${q}`)).body.rows[0].side).toBe('Opening cash & bank');
    const gst = (await get(`/accounts/reports/GST_REGISTER?${q}`)).body;
    expect(gst.rows.some((r: { igst: string }) => r.igst === '10800.00')).toBe(true);
    const tds = (await get(`/accounts/reports/TDS_REGISTER?${q}`, head)).body;
    expect(tds.rows.map((r: { pan: string }) => r.pan)).toEqual(expect.arrayContaining(['••••234K', 'No PAN']));
    expect((await get(`/accounts/reports/TDS_REGISTER?${q}`)).body.rows.map((r: { pan: string }) => r.pan)).toContain('AAPFG1234K'); // admin may reveal
    const x = await get(`/accounts/reports/TRIAL_BALANCE/excel?${q}`);
    expect(x.status).toBe(200);
    expect(x.headers['content-type']).toMatch(/spreadsheetml/);
  });
});

describe('isolation', () => {
  it('another institution sees none of it', async () => {
    expect((await get('/accounts/vendors', B.session)).body).toEqual([]);
    expect((await get(`/accounts/bills/${ids.billBig}`, B.session)).status).toBe(404);
    expect((await get('/accounts/bank-accounts', B.session)).body).toEqual([]);
    expect((await post(`/accounts/bank-accounts/${ids.bank}/reveal`, {}, B.session)).status).toBe(404);
    expect((await put(`/accounts/vendors/${ids.vk}`, { name: 'Hijack', vendorType: 'SUPPLIER', stateCode: '29' }, B.session)).status).toBe(404);
    expect((await get('/accounts/payments', B.session)).body).toEqual([]);
  });
});
