/**
 * AC18 import/export: template, xlsx + csv upload, row-level validation (dry run), error report,
 * commit (once, re-validated), scope/permission/isolation, export round-trip, CSV injection guard.
 * AC19 idempotency keys: replay, mismatch, failed attempts retryable, concurrent duplicates.
 */
import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { API, PLATFORM_ADMIN, addMember, auth, createTenant, login, ownerDb, startApp, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let campusMain: string;
const http = () => request(app.getHttpServer());
const binary = (r: request.Request) => r.buffer(true).parse((res, cb) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
});

async function xlsx(header: string[], rows: (string | Date)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(header);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
async function readXlsx(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}
const upload = (s: Session, type: string, file: Buffer, name: string) => http().post(`${API}/imports/${type}`).set(auth(s)).attach('file', file, name);

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'ImpA');
  B = await createTenant(app, platform, 'ImpB');
  campusMain = (await http().post(`${API}/campuses`).set(auth(A.session)).send({ code: 'MAIN', name: 'Main Campus', campusType: 'SCHOOL' })).body.id;
  await http().post(`${API}/campuses`).set(auth(A.session)).send({ code: 'NORTH', name: 'North Campus', campusType: 'SCHOOL' });
  await http().post(`${API}/departments`).set(auth(A.session)).send({ campusId: campusMain, name: 'Existing', code: 'EXI', deptType: 'ACADEMIC' });
}, 60_000);
afterAll(() => app?.close());

describe('AC18 import and export', () => {
  let jobId: string;

  it('the template is an Excel file whose Help sheet lists this institution’s campus codes', async () => {
    const res = await binary(http().get(`${API}/imports/templates/DEPARTMENTS`).set(auth(A.session)));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    const wb = await readXlsx(res.body as Buffer);
    expect(wb.worksheets[0].getRow(1).getCell(1).value).toBe('Name *');
    const help: string[] = [];
    wb.getWorksheet('Help')!.eachRow((r) => help.push(r.values ? (r.values as unknown[]).join(' ') : ''));
    expect(help.join('\n')).toContain('MAIN — Main Campus');
  });

  it('upload checks every row and imports nothing yet (dry run)', async () => {
    const file = await xlsx(['Name *', 'Code *', 'Type *', 'Campus code'], [
      ['Science', 'SCI', 'Academic', 'MAIN'], // ok
      ['Commerce', 'com', 'academic', 'main'], // ok (case-insensitive, code upper-cased)
      ['Accounts', 'ACC', 'Administration', ''], // ok, institution-wide
      ['', 'X1', 'Academic', ''], // missing name
      ['Arts', 'ART', 'Teaching', ''], // bad type
      ['Science again', 'SCI', 'Academic', 'MAIN'], // duplicate in file
      ['Ghost', 'GHO', 'Academic', 'SOUTH'], // unknown campus
      ['Existing dup', 'EXI', 'Academic', 'MAIN'], // already in DB
    ]);
    const res = await upload(A.session, 'DEPARTMENTS', file, 'departments.xlsx');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'VALIDATED', totalRows: 8, validRows: 3, errorRows: 5 });
    jobId = res.body.id;

    const bad = (await http().get(`${API}/imports/jobs/${jobId}/rows?status=INVALID`).set(auth(A.session))).body.items as { rowNo: number; errors: string[] }[];
    const at = (n: number) => bad.find((r) => r.rowNo === n)!.errors.join(' | ');
    expect(at(5)).toMatch(/Name/);
    expect(at(6)).toMatch(/Type: use Academic/);
    expect(at(7)).toMatch(/appears twice in this file/);
    expect(at(8)).toMatch(/"SOUTH" does not exist/);
    expect(at(9)).toMatch(/EXI already exists/);

    const db = ownerDb();
    expect(await db.department.count({ where: { tenantId: A.tenantId } })).toBe(1); // still only the existing one
    await db.$disconnect();
  });

  it('error report: the bad rows with an Errors column, ready to fix in Excel', async () => {
    const res = await binary(http().get(`${API}/imports/jobs/${jobId}/errors.xlsx`).set(auth(A.session)));
    const ws = (await readXlsx(res.body as Buffer)).worksheets[0];
    expect(ws.getRow(1).getCell(5).value).toBe('Errors');
    expect(ws.rowCount).toBe(6); // header + 5 bad rows
  });

  it('commit imports the valid rows once, re-checking data that changed since upload', async () => {
    // Someone adds "COM" on Main between upload and commit → that row is skipped, not duplicated.
    await http().post(`${API}/departments`).set(auth(A.session)).send({ campusId: campusMain, name: 'Commerce (manual)', code: 'COM', deptType: 'ACADEMIC' });
    const res = await http().post(`${API}/imports/jobs/${jobId}/commit`).set(auth(A.session));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'COMMITTED', importedRows: 2, skippedRows: 1 });
    const again = await http().post(`${API}/imports/jobs/${jobId}/commit`).set(auth(A.session));
    expect(again.status).toBe(409);
    expect(again.body.type).toBe('import-closed');

    const codes = ((await http().get(`${API}/departments`).set(auth(A.session))).body as { code: string }[]).map((d) => d.code).sort();
    expect(codes).toEqual(['ACC', 'COM', 'EXI', 'SCI']);
    const db = ownerDb();
    const audit = await db.auditLog.findFirst({ where: { tenantId: A.tenantId, entityType: 'IMPORT', entityId: jobId } });
    await db.$disconnect();
    expect(audit?.newValues).toMatchObject({ imported: 2, skipped: 1, invalid: 5 });
  });

  it('CSV works too (BOM, quoted commas, DD-MM-YYYY dates); a missing required column is refused', async () => {
    const csv = Buffer.from('﻿Date,Name,Type,Campus code\r\n01-11-2026,"Rajyotsava, Karnataka",Public holiday,\r\n2026-12-25,Christmas,,NORTH\r\n31-02-2026,Bad date,,\r\n', 'utf8');
    const res = await upload(A.session, 'HOLIDAYS', csv, 'holidays.csv');
    expect(res.body).toMatchObject({ totalRows: 3, validRows: 2, errorRows: 1 });
    const commit = await http().post(`${API}/imports/jobs/${res.body.id}/commit`).set(auth(A.session));
    expect(commit.body.importedRows).toBe(2);
    const names = ((await http().get(`${API}/holidays`).set(auth(A.session))).body as { name: string }[]).map((h) => h.name);
    expect(names).toEqual(['Rajyotsava, Karnataka', 'Christmas']);

    const missing = await upload(A.session, 'HOLIDAYS', Buffer.from('Name\r\nX\r\n'), 'h.csv');
    expect(missing.status).toBe(422);
    expect(missing.body.type).toBe('import-columns');
  });

  it('bulk user import queues one invite email per person', async () => {
    const file = await xlsx(['Full name', 'Email', 'Role', 'Campus code'], [
      ['Anita Rao', 'anita.rao@imp.test', 'Campus Viewer', 'MAIN'],
      ['Kiran Kumar', 'kiran.kumar@imp.test', 'CAMPUS_VIEWER', ''],
      ['Nobody', 'not-an-email', 'Campus Viewer', ''],
      ['Wrong role', 'wrong.role@imp.test', 'Janitor', ''],
    ]);
    const up = await upload(A.session, 'USERS', file, 'staff.xlsx');
    expect(up.body).toMatchObject({ validRows: 2, errorRows: 2 });
    const done = await http().post(`${API}/imports/jobs/${up.body.id}/commit`).set(auth(A.session));
    expect(done.body.importedRows).toBe(2);
    const db = ownerDb();
    const invites = await db.outboxEvent.count({ where: { tenantId: A.tenantId, eventType: 'auth.invite', aggregateId: { in: (await db.user.findMany({ where: { email: { in: ['anita.rao@imp.test', 'kiran.kumar@imp.test'] } }, select: { id: true } })).map((u) => u.id) } } });
    await db.$disconnect();
    expect(invites).toBe(2);
  });

  it('permission, campus scope and tenant isolation', async () => {
    const viewer = await addMember(app, A.session, { label: 'ImpViewer', roleCode: 'CAMPUS_VIEWER' });
    const file = await xlsx(['Name', 'Code', 'Type'], [['X', 'XX', 'Academic']]);
    expect((await upload(viewer.session, 'DEPARTMENTS', file, 'x.xlsx')).status).toBe(403);
    expect((await http().get(`${API}/imports/jobs/${jobId}`).set(auth(B.session))).status).toBe(404);
    expect((await http().get(`${API}/imports/types`).set(auth(viewer.session))).body).toEqual([]);
  });

  it('export → edit → import round trip uses the same columns; CSV neutralises formulas', async () => {
    const exp = await binary(http().get(`${API}/exports/DEPARTMENTS`).set(auth(A.session)));
    expect(exp.status).toBe(200);
    const up = await upload(A.session, 'DEPARTMENTS', exp.body as Buffer, 'export.xlsx');
    expect(up.body.totalRows).toBe(4);
    expect(up.body.errorRows).toBe(4); // every row already exists — recognised, not misread

    await http().post(`${API}/departments`).set(auth(A.session)).send({ campusId: null, name: '=HYPERLINK("http://evil")', code: 'EVIL', deptType: 'ADMIN' });
    const csv = await http().get(`${API}/exports/DEPARTMENTS?format=csv`).set(auth(A.session));
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain(`"'=HYPERLINK(""http://evil"")"`);

    const db = ownerDb();
    expect(await db.auditLog.count({ where: { tenantId: A.tenantId, action: 'EXPORT' } })).toBe(2);
    await db.$disconnect();
  });
});

describe('AC19 idempotency keys', () => {
  const holiday = (name: string, date: string) => ({ holidayDate: date, name, holidayType: 'INSTITUTION' });

  it('a retry with the same key returns the first result and creates nothing new', async () => {
    const key = `test-${Date.now()}-a`;
    const first = await http().post(`${API}/holidays`).set(auth(A.session)).set('Idempotency-Key', key).send(holiday('Founders Day', '2027-02-10'));
    const retry = await http().post(`${API}/holidays`).set(auth(A.session)).set('Idempotency-Key', key).send(holiday('Founders Day', '2027-02-10'));
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replay']).toBe('true');
    expect(retry.body.id).toBe(first.body.id);
    const db = ownerDb();
    expect(await db.holiday.count({ where: { tenantId: A.tenantId, name: 'Founders Day' } })).toBe(1);
    await db.$disconnect();
  });

  it('the same key with a different body is refused', async () => {
    const key = `test-${Date.now()}-b`;
    await http().post(`${API}/holidays`).set(auth(A.session)).set('Idempotency-Key', key).send(holiday('Sports Day', '2027-02-11'));
    const other = await http().post(`${API}/holidays`).set(auth(A.session)).set('Idempotency-Key', key).send(holiday('Sports Day', '2027-02-12'));
    expect(other.status).toBe(422);
    expect(other.body.type).toBe('idempotency-key-reused');
  });

  it('a failed attempt is not remembered, so it can be retried with the same key', async () => {
    const key = `test-${Date.now()}-c`;
    const dup = await http().post(`${API}/holidays`).set(auth(A.session)).set('Idempotency-Key', key).send(holiday('Clash', '2027-02-10')); // date taken
    expect(dup.status).toBe(409);
    const db = ownerDb();
    expect(await db.idempotencyKey.count({ where: { key } })).toBe(0);
    await db.$disconnect();
  });

  it('two simultaneous requests with one key create exactly one record', async () => {
    const key = `test-${Date.now()}-d`;
    const send = () => http().post(`${API}/holidays`).set(auth(A.session)).set('Idempotency-Key', key).send(holiday('Annual Day', '2027-03-05'));
    const results = await Promise.all([send(), send(), send()]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201).length).toBeGreaterThanOrEqual(1);
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
    const db = ownerDb();
    expect(await db.holiday.count({ where: { tenantId: A.tenantId, name: 'Annual Day' } })).toBe(1);
    await db.$disconnect();
  });

  it('keys are per institution: B can use the same key independently', async () => {
    const key = `test-${Date.now()}-e`;
    const a = await http().post(`${API}/holidays`).set(auth(A.session)).set('Idempotency-Key', key).send(holiday('Shared Key', '2027-03-06'));
    const b = await http().post(`${API}/holidays`).set(auth(B.session)).set('Idempotency-Key', key).send(holiday('Shared Key', '2027-03-06'));
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers['idempotent-replay']).toBeUndefined();
    expect(b.body.id).not.toBe(a.body.id);
  });
});
