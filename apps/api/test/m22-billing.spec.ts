/**
 * AC30 billing (M2.2): structures assigned on enrolment and on activation; billing runs gapless and
 * idempotent (also when two run at once); concessions only after approval, never more than the
 * amount (percent and fixed, used up across bills; applied to unpaid bills on approval); extra
 * charges; cancellation by reversal; every bill posts a balanced entry; the journal cannot be edited.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { IMPORT_TYPES, PERMISSIONS, applyConcessions, toPaise } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, appDb, auth, createRole, createTenant, login, ownerDb, startApp, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let principal: Session;
let campus: string;
let year: string;
let class1: string;
let class2: string;
let s1: string; // class 1 default structure
const heads: Record<string, string> = {};
const ids: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const P = (v: string | number) => toPaise(String(v));

async function importStudents(rows: Record<string, string>[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => c.header));
  for (const r of rows) ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => r[c.key] ?? ''));
  const job = await http().post(`${API}/imports/STUDENTS`).set(auth(A.session)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 's.xlsx');
  expect(job.body.errorRows).toBe(0);
  await post(`/imports/jobs/${job.body.id}/commit`, {});
  for (const s of (await get('/students?pageSize=100')).body.items) ids[s.firstName] = s.id;
}
const kid = (firstName: string, className: string, parentPhone: string, admissionNo: string) => ({
  admissionNo, firstName, lastName: 'Test', dob: '2019-01-01', gender: 'Girl', campusCode: 'MAIN', programCode: 'SBS', className, section: 'A', fatherName: 'Parent', parentPhone,
});

/** Every entry for a bill balances, and the receivable posted equals the bill's balance. */
async function ledgerOf(invoiceId: string) {
  const db = ownerDb();
  const entries = await db.journalEntry.findMany({ where: { sourceType: 'FEE_INVOICE', sourceId: invoiceId }, include: { lines: { include: { account: true } } }, orderBy: { postedAt: 'asc' } });
  await db.$disconnect();
  for (const e of entries) {
    const d = e.lines.reduce((a, l) => a + P(l.debit.toString()), 0);
    const c = e.lines.reduce((a, l) => a + P(l.credit.toString()), 0);
    expect(d).toBe(c);
    expect(d).toBe(P(e.totalAmount.toString()));
  }
  const receivable = entries.flatMap((e) => e.lines).filter((l) => l.account.systemKey === 'STUDENT_RECEIVABLE').reduce((a, l) => a + P(l.debit.toString()) - P(l.credit.toString()), 0);
  return { entries, receivable };
}

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'BillA');
  B = await createTenant(app, platform, 'BillB');
  campus = (await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  year = (await post('/academic-years', { name: '2026-27', startDate: '2026-06-01', endDate: '2027-03-31', makeCurrent: true })).body.id;
  const sbs = await post('/programs', { campusId: campus, name: 'State Board School', code: 'SBS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 10 });
  [class1, class2] = [sbs.body.levels[0].id, sbs.body.levels[1].id];
  await post('/sections', { academicYearId: year, programLevelId: class1, names: ['A'], capacity: 40 });
  await post('/sections', { academicYearId: year, programLevelId: class2, names: ['A'], capacity: 40 });
  heads.TUITION = (await post('/fees/heads', { name: 'Tuition fee', code: 'TUITION', feeType: 'ACADEMIC' })).body.id;
  heads.ADM = (await post('/fees/heads', { name: 'Admission fee', code: 'ADM', feeType: 'ADMISSION' })).body.id;
  heads.ID = (await post('/fees/heads', { name: 'ID card', code: 'IDCARD', feeType: 'OTHER' })).body.id;
  const st = await post('/fees/structures', {
    campusId: campus, academicYearId: year, programLevelId: class1, name: 'Class 1 fees',
    instalments: [{ instalmentNo: 1, name: 'Term 1', dueDate: '2026-06-10' }, { instalmentNo: 2, name: 'Term 2', dueDate: '2026-10-10' }],
    items: [{ feeHeadId: heads.TUITION, instalmentNo: 1, amount: '10000' }, { feeHeadId: heads.ADM, instalmentNo: 1, amount: '5000' }, { feeHeadId: heads.TUITION, instalmentNo: 2, amount: '10000' }],
  });
  s1 = st.body.id;
  await post(`/fees/structures/${s1}/activate`, {});
  await createRole(A.tenantId, 'PRINCIPAL', [PERMISSIONS.APPROVALS_REQUEST_READ]);
  principal = (await addMember(app, A.session, { label: 'Principal', roleCode: 'PRINCIPAL' })).session;
}, 120_000);
afterAll(() => app?.close());

describe('AC30 fee assignment', () => {
  it('students get their class’s structure when they join; a structure made active later reaches existing students', async () => {
    await importStudents([kid('Asha', 'Class 1', '9876500001', 'B/1'), kid('Bala', 'Class 1', '9876500001', 'B/2'), kid('Chitra', 'Class 1', '9876500003', 'B/3'), kid('Dev', 'Class 2', '9876500004', 'B/4')]);
    const asha = (await get(`/fees/students/${ids.Asha}`)).body;
    expect(asha.assignment.structure).toMatchObject({ id: s1, name: 'Class 1 fees' });
    expect((await get(`/fees/students/${ids.Dev}`)).body.assignment).toBeNull();
    expect((await post('/fees/billing/preview', { academicYearId: year, instalmentNo: 1 })).body.withoutFees).toBe(1);

    const s2 = await post('/fees/structures', {
      campusId: campus, academicYearId: year, programLevelId: class2, name: 'Class 2 fees',
      instalments: [{ instalmentNo: 1, name: 'Term 1', dueDate: '2026-06-10' }], items: [{ feeHeadId: heads.TUITION, instalmentNo: 1, amount: '12000' }],
    });
    const act = await post(`/fees/structures/${s2.body.id}/activate`, {});
    expect(act.body).toMatchObject({ status: 'ACTIVE', assigned: 1 });
    expect((await get(`/fees/structures/${s2.body.id}`)).body).toMatchObject({ studentCount: 1, withoutFees: 0 });
    expect((await post('/fees/billing/preview', { academicYearId: year, instalmentNo: 1 })).body.withoutFees).toBe(0);
  });

  it('a student can be moved to a fee-group structure of their own class only', async () => {
    const g = await post('/fees/structures', {
      campusId: campus, academicYearId: year, programLevelId: class1, name: 'Class 1 staff ward', feeGroup: 'Staff ward',
      instalments: [{ instalmentNo: 1, name: 'Term 1', dueDate: '2026-06-10' }], items: [{ feeHeadId: heads.TUITION, instalmentNo: 1, amount: '2000' }],
    });
    expect((await post(`/fees/structures/${g.body.id}/activate`, {})).body.assigned).toBe(0); // groups are given one by one
    expect((await post(`/fees/students/${ids.Dev}/assignment`, { feeStructureId: g.body.id })).body.type).toBe('other-class');
    expect((await post(`/fees/students/${ids.Chitra}/assignment`, { feeStructureId: g.body.id })).status).toBe(201);
    const c = (await get(`/fees/students/${ids.Chitra}`)).body;
    expect(c.assignment.structure.feeGroup).toBe('Staff ward');
    expect(c.structureOptions.map((o: { name: string }) => o.name)).toEqual(['Class 1 fees', 'Class 1 staff ward']);
    await post(`/fees/students/${ids.Chitra}/assignment`, { feeStructureId: s1 }); // back to the default
  });
});

describe('AC30 billing runs', () => {
  it('bills each student once per instalment with gapless numbers and a balanced posting', async () => {
    const pre = (await post('/fees/billing/preview', { academicYearId: year, instalmentNo: 1 })).body;
    expect(pre).toMatchObject({ students: 4, alreadyBilled: 0, grossAmount: '57000.00' });
    // Two runs at the same moment: one waits for the other; nobody is billed twice.
    const [r1, r2] = await Promise.all([post('/fees/billing/runs', { academicYearId: year, instalmentNo: 1 }), post('/fees/billing/runs', { academicYearId: year, instalmentNo: 1 })]);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    expect([r1.body.billedCount, r2.body.billedCount].sort()).toEqual([0, 4]);
    const db = ownerDb();
    const invoices = await db.feeInvoice.findMany({ where: { tenantId: A.tenantId }, orderBy: { invoiceNo: 'asc' } });
    await db.$disconnect();
    expect(invoices.map((i) => i.invoiceNo)).toEqual(['INV/2026-27/0001', 'INV/2026-27/0002', 'INV/2026-27/0003', 'INV/2026-27/0004']);
    for (const inv of invoices) {
      const { entries, receivable } = await ledgerOf(inv.id);
      expect(entries).toHaveLength(1);
      expect(receivable).toBe(P(inv.balanceAmount.toString()));
    }
    const again = await post('/fees/billing/runs', { academicYearId: year, instalmentNo: 1 });
    expect(again.body).toMatchObject({ billedCount: 0, alreadyBilled: 4 });
    const asha = (await get(`/fees/students/${ids.Asha}`)).body;
    expect(asha.invoices[0]).toMatchObject({ grossAmount: '15000', netAmount: '15000', status: 'UNPAID', dueDate: '2026-06-10T00:00:00.000Z', description: 'Class 1 · Term 1 · 2026-27' });
    expect(asha.totals).toMatchObject({ billed: '15000.00', balance: '15000.00' });
    const db2 = ownerDb();
    const jv = await db2.journalEntry.findMany({ where: { tenantId: A.tenantId }, orderBy: { entryNo: 'asc' }, select: { entryNo: true } });
    await db2.$disconnect();
    expect(jv.map((j) => j.entryNo)).toEqual(['JV/2026-27/0001', 'JV/2026-27/0002', 'JV/2026-27/0003', 'JV/2026-27/0004']);
  });
});

describe('AC30 concessions', () => {
  it('cannot be requested until someone is set up to approve them', async () => {
    const r = await post(`/fees/students/${ids.Asha}/concessions`, { academicYearId: year, feeHeadId: heads.TUITION, concessionType: 'SIBLING', valueType: 'PERCENT', value: '50', reason: 'Second child in the school' });
    expect(r.body.type).toBe('approval-rule-missing');
    const db = ownerDb();
    expect(await db.concession.count({ where: { tenantId: A.tenantId } })).toBe(0);
    const role = await db.role.findFirst({ where: { tenantId: A.tenantId, code: 'PRINCIPAL' } });
    await db.$disconnect();
    expect((await post('/approvals/rules', { entityType: 'CONCESSION', levelNo: 1, approverRoleId: role!.id })).status).toBe(201);
  });

  it('apply only after approval — to the unpaid bill (with an adjustment posting) and to later bills', async () => {
    const c = await post(`/fees/students/${ids.Asha}/concessions`, { academicYearId: year, feeHeadId: heads.TUITION, concessionType: 'SIBLING', valueType: 'PERCENT', value: '50', reason: 'Second child in the school' });
    expect(c.body.status).toBe('PENDING');
    let asha = (await get(`/fees/students/${ids.Asha}`)).body;
    expect(asha.invoices[0].netAmount).toBe('15000'); // nothing changes while pending
    const inbox = (await get('/approvals/inbox', principal)).body;
    const req = (inbox.items ?? inbox).find((x: { entityId: string }) => x.entityId === c.body.id);
    expect((await post(`/approvals/requests/${req.id}/act`, { action: 'APPROVE' }, principal)).status).toBe(201);
    asha = (await get(`/fees/students/${ids.Asha}`)).body;
    expect(asha.concessions[0].status).toBe('APPROVED');
    expect(asha.invoices[0]).toMatchObject({ grossAmount: '15000', concessionAmount: '5000', netAmount: '10000', balanceAmount: '10000' });
    const { entries, receivable } = await ledgerOf(asha.invoices[0].id);
    expect(entries.map((e) => e.voucherType)).toEqual(['SALES', 'JOURNAL']);
    expect(receivable).toBe(P('10000'));
  });

  it('a fixed amount is used up across bills and never exceeds what is billed; a rejected one does nothing', async () => {
    const fixed = await post(`/fees/students/${ids.Bala}/concessions`, { academicYearId: year, concessionType: 'SCHOLARSHIP', valueType: 'AMOUNT', value: '12000', reason: 'Merit scholarship' });
    const big = await post(`/fees/students/${ids.Chitra}/concessions`, { academicYearId: year, concessionType: 'MANAGEMENT', valueType: 'AMOUNT', value: '50000', reason: 'Full waiver by the trust' });
    const no = await post(`/fees/students/${ids.Dev}/concessions`, { academicYearId: year, concessionType: 'OTHER', valueType: 'PERCENT', value: '10', reason: 'Asked at the counter' });
    const inbox = (await get('/approvals/inbox', principal)).body;
    const find = (id: string) => (inbox.items ?? inbox).find((x: { entityId: string }) => x.entityId === id).id;
    await post(`/approvals/requests/${find(fixed.body.id)}/act`, { action: 'APPROVE' }, principal);
    await post(`/approvals/requests/${find(big.body.id)}/act`, { action: 'APPROVE' }, principal);
    await post(`/approvals/requests/${find(no.body.id)}/act`, { action: 'REJECT', remarks: 'Not eligible' }, principal);

    expect((await get(`/fees/students/${ids.Bala}`)).body.invoices[0]).toMatchObject({ concessionAmount: '12000', netAmount: '3000' });
    const chitra = (await get(`/fees/students/${ids.Chitra}`)).body;
    expect(chitra.invoices[0]).toMatchObject({ concessionAmount: '15000', netAmount: '0', status: 'PAID' }); // capped at the bill
    const dev = (await get(`/fees/students/${ids.Dev}`)).body;
    expect(dev.concessions[0].status).toBe('REJECTED');
    expect(dev.invoices[0].concessionAmount).toBe('0');

    // Term 2: Asha 50 % of tuition; Bala's ₹12,000 is used up; Chitra still has ₹35,000 left.
    await post('/fees/billing/runs', { academicYearId: year, instalmentNo: 2 });
    const t2 = async (n: string) => (await get(`/fees/students/${ids[n]}`)).body.invoices.find((i: { instalmentNo: number }) => i.instalmentNo === 2);
    expect(await t2('Asha')).toMatchObject({ grossAmount: '10000', concessionAmount: '5000', netAmount: '5000' });
    expect(await t2('Bala')).toMatchObject({ concessionAmount: '0', netAmount: '10000' });
    expect(await t2('Chitra')).toMatchObject({ concessionAmount: '10000', netAmount: '0' });
    expect(await t2('Dev')).toBeUndefined(); // Class 2 has no second instalment
  });

  it('the concession arithmetic itself (paise) never exceeds a line', () => {
    const r = applyConcessions([{ feeHeadId: 'T', amountPaise: 100_001 }, { feeHeadId: 'A', amountPaise: 50_000 }], [
      { id: 'p', feeHeadId: 'T', valueType: 'PERCENT', valuePaise: 3_333, usedPaise: 0 },
      { id: 'f', feeHeadId: null, valueType: 'AMOUNT', valuePaise: 100_000, usedPaise: 20_000 },
    ]);
    // Tuition: 33.33 % = 33,330 p, then the fixed concession (80,000 p left) covers the other 66,671 p — the line is fully waived.
    // Admission: only the 13,329 p left of the fixed concession.
    expect(r.map((l) => l.concessionPaise)).toEqual([100_001, 13_329]);
    expect(r[0].parts).toEqual([{ concessionId: 'p', amountPaise: 33_330 }, { concessionId: 'f', amountPaise: 66_671 }]);
    expect(r[1].parts).toEqual([{ concessionId: 'f', amountPaise: 13_329 }]);
  });
});

describe('AC30 extra charges and cancellation', () => {
  it('an extra charge is a bill of its own; cancelling reverses its posting and frees the instalment', async () => {
    const extra = await post(`/fees/students/${ids.Dev}/charges`, { feeHeadId: heads.ID, amount: '750', dueDate: '2026-12-01', description: 'Lost ID card' });
    expect(extra.status).toBe(201);
    expect(extra.body).toMatchObject({ instalmentNo: null, netAmount: '750', description: 'Lost ID card' });
    const dev = (await get(`/fees/students/${ids.Dev}`)).body;
    const term1 = dev.invoices.find((i: { instalmentNo: number }) => i.instalmentNo === 1);
    expect((await post(`/fees/invoices/${term1.id}/cancel`, { reason: 'Wrong class' })).body.status).toBe('CANCELLED');
    expect((await post(`/fees/invoices/${term1.id}/cancel`, { reason: 'Again please' })).body.type).toBe('invoice-cancelled');
    const { entries, receivable } = await ledgerOf(term1.id);
    expect(entries.map((e) => [e.voucherType, e.status])).toEqual([['SALES', 'REVERSED'], ['SALES', 'POSTED']]);
    expect(entries[1].reversalOfId).toBe(entries[0].id);
    expect(receivable).toBe(0);
    const rebill = await post('/fees/billing/runs', { academicYearId: year, instalmentNo: 1 });
    expect(rebill.body.billedCount).toBe(1);
    const after = (await get(`/fees/students/${ids.Dev}`)).body;
    expect(after.totals).toMatchObject({ billed: '12750.00', balance: '12750.00' });
  });

  it('the journal cannot be edited, deleted or posted unbalanced — even directly in the database', async () => {
    const db = appDb();
    await expect(db.$executeRawUnsafe(`UPDATE journal_lines SET debit = debit + 1`)).rejects.toThrow(/permission denied/);
    await expect(db.$executeRawUnsafe(`DELETE FROM journal_entries`)).rejects.toThrow(/permission denied/);
    await db.$disconnect();
    const owner = ownerDb();
    const e = await owner.journalEntry.findFirstOrThrow({ where: { tenantId: A.tenantId } });
    await expect(owner.journalEntry.update({ where: { id: e.id }, data: { narration: 'changed' } })).rejects.toThrow(/journal_immutable/);
    const acc = await owner.account.findFirstOrThrow({ where: { tenantId: A.tenantId, systemKey: 'CASH' } });
    await expect(owner.$transaction(async (tx) => {
      const x = await tx.journalEntry.create({ data: { tenantId: A.tenantId, entryNo: 'TEST/1', financialYearId: e.financialYearId, entryDate: new Date(), voucherType: 'JOURNAL', sourceType: 'MANUAL', narration: 'x', totalAmount: '100' } });
      await tx.journalLine.create({ data: { tenantId: A.tenantId, journalEntryId: x.id, accountId: acc.id, debit: '100' } });
    })).rejects.toThrow(/journal_unbalanced/);
    await owner.$disconnect();
  });
});

describe('AC30 revisions, scope and isolation', () => {
  it('activating a revision moves its students; bills already made keep their amounts', async () => {
    const rev = await post(`/fees/structures/${s1}/revise`, {});
    const act = await post(`/fees/structures/${rev.body.id}/activate`, {});
    expect(act.body).toMatchObject({ status: 'ACTIVE', moved: 3 });
    expect((await get(`/fees/students/${ids.Asha}`)).body.assignment.structure.id).toBe(rev.body.id);
    expect((await get(`/fees/students/${ids.Asha}`)).body.invoices.find((i: { instalmentNo: number }) => i.instalmentNo === 1).feeStructureId).toBe(s1);
  });

  it('other institutions and people without the permission see nothing', async () => {
    expect((await get(`/fees/students/${ids.Asha}`, B.session)).status).toBe(404);
    expect((await post('/fees/billing/preview', { academicYearId: year, instalmentNo: 1 }, B.session)).status).toBe(404);
    expect((await post(`/fees/students/${ids.Asha}/charges`, { feeHeadId: heads.ID, amount: '10', dueDate: '2026-12-01', description: 'Test' }, principal)).status).toBe(403);
  });
});
