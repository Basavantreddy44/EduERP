/**
 * AC24 enquiries, AC25 applications (numbers, duplicate check, documents, Aadhaar last-4),
 * AC26 decisions, AC27 enrolment (one transaction, guardians reused, seats, forced failure).
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PERMISSIONS } from '@eduerp/shared';
import { OutboxService } from '../src/common/outbox.service';
import { API, PLATFORM_ADMIN, addMember, auth, createRole, createTenant, login, ownerDb, startApp, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let clerk: Session;
let principal: Session;
let campus: string;
let year: string;
let class1: string;
let sectionA: string;
const http = () => request(app.getHttpServer());
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const yesterday = new Date(Date.now() + 330 * 60_000 - 86_400_000).toISOString().slice(0, 10);

const child = (over: Record<string, unknown> = {}) => ({
  campusId: campus, academicYearId: year, programLevelId: class1,
  firstName: 'Ananya', lastName: 'Rao', dob: '2020-04-12', gender: 'FEMALE', category: 'GENERAL',
  fatherName: 'Suresh Rao', motherName: 'Lakshmi Rao', parentPhone: '9876500001', aadhaarLast4: '4321',
  ...over,
});

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'AdmA');
  B = await createTenant(app, platform, 'AdmB');
  campus = (await http().post(`${API}/campuses`).set(auth(A.session)).send({ code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  year = (await http().post(`${API}/academic-years`).set(auth(A.session)).send({ name: '2026-27', startDate: '2026-06-01', endDate: '2027-03-31', makeCurrent: true })).body.id;
  const prog = await http().post(`${API}/programs`).set(auth(A.session)).send({ campusId: campus, name: 'State Board School', code: 'SBS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 10 });
  class1 = prog.body.levels[0].id;
  const secs = await http().post(`${API}/sections`).set(auth(A.session)).send({ academicYearId: year, programLevelId: class1, names: ['A', 'B'], capacity: 2 });
  sectionA = secs.body.find((s: { name: string }) => s.name === 'A').id;

  await createRole(A.tenantId, 'ADM_CLERK', [PERMISSIONS.ADM_ENQUIRY_MANAGE, PERMISSIONS.ADM_APPLICATION_MANAGE, PERMISSIONS.FILES_FILE_UPLOAD, PERMISSIONS.FILES_FILE_READ]);
  await createRole(A.tenantId, 'PRINCIPAL', [PERMISSIONS.ADM_APPLICATION_MANAGE, PERMISSIONS.ADM_APPLICATION_DECIDE, PERMISSIONS.ADM_ENROL]);
  clerk = (await addMember(app, A.session, { label: 'Clerk', roleCode: 'ADM_CLERK' })).session;
  principal = (await addMember(app, A.session, { label: 'Principal', roleCode: 'PRINCIPAL' })).session;
}, 90_000);
afterAll(() => app?.close());

describe('AC24 enquiries', () => {
  let enquiryId: string;

  it('admission staff get open years and classes without any set-up permission; others are refused', async () => {
    expect((await http().get(`${API}/programs`).set(auth(clerk))).status).toBe(403);
    const o = (await http().get(`${API}/admissions/options`).set(auth(clerk))).body;
    expect(o.years.map((y: { name: string }) => y.name)).toEqual(['2026-27']);
    expect(o.programs[0].levels.map((l: { id: string }) => l.id)).toContain(class1);
    await createRole(A.tenantId, 'NOBODY', []);
    const nobody = (await addMember(app, A.session, { label: 'Nobody', roleCode: 'NOBODY' })).session;
    expect((await http().get(`${API}/admissions/options`).set(auth(nobody))).status).toBe(403);
  });

  it('numbers come from the numbering service (series created on first use)', async () => {
    const res = await http().post(`${API}/admissions/enquiries`).set(auth(clerk)).send({
      campusId: campus, academicYearId: year, programLevelId: class1, studentName: 'Ananya Rao', parentName: 'Suresh Rao', phone: '9876500001', source: 'WALK_IN', nextFollowUp: today,
    });
    expect(res.status).toBe(201);
    expect(res.body.enquiryNo).toBe('ENQ/2026-27/0001');
    enquiryId = res.body.id;
    const second = await http().post(`${API}/admissions/enquiries`).set(auth(clerk)).send({
      campusId: campus, academicYearId: year, programLevelId: class1, studentName: 'Kiran M', parentName: 'Mohan', phone: '9876500099', source: 'PHONE', nextFollowUp: yesterday,
    });
    expect(second.body.enquiryNo).toBe('ENQ/2026-27/0002');
  });

  it('"due today" and "overdue" lists', async () => {
    const dueToday = (await http().get(`${API}/admissions/enquiries?due=today`).set(auth(clerk))).body;
    expect(dueToday.rows.map((r: { studentName: string }) => r.studentName)).toEqual(['Ananya Rao']);
    const overdue = (await http().get(`${API}/admissions/enquiries?due=overdue`).set(auth(clerk))).body;
    expect(overdue.rows.map((r: { studentName: string }) => r.studentName)).toEqual(['Kiran M']);
    expect(dueToday.summary.dueOrOverdue).toBe(2);
  });

  it('a follow-up updates status and the next follow-up date', async () => {
    const res = await http().post(`${API}/admissions/enquiries/${enquiryId}/followups`).set(auth(clerk)).send({ mode: 'CALL', remarks: 'Parent will visit on Saturday', status: 'INTERESTED', nextFollowUp: '2099-01-05' });
    expect(res.status).toBe(201);
    const e = (await http().get(`${API}/admissions/enquiries/${enquiryId}`).set(auth(clerk))).body;
    expect(e).toMatchObject({ status: 'INTERESTED', nextFollowUp: '2099-01-05T00:00:00.000Z' });
    expect(e.followups).toHaveLength(1);
    const lost = await http().post(`${API}/admissions/enquiries/${enquiryId}/followups`).set(auth(clerk)).send({ mode: 'CALL', remarks: 'x' , status: 'LOST' });
    expect(lost.status).toBe(422); // remarks too short
  });

  it('conversion to an application keeps the link; an enquiry converts only once', async () => {
    const res = await http().post(`${API}/admissions/applications`).set(auth(clerk)).send(child({ enquiryId }));
    expect(res.status).toBe(201);
    expect(res.body.enquiryId).toBe(enquiryId);
    const e = (await http().get(`${API}/admissions/enquiries/${enquiryId}`).set(auth(clerk))).body;
    expect(e.status).toBe('CONVERTED');
    expect(e.applications.map((a: { id: string }) => a.id)).toEqual([res.body.id]);
    const again = await http().post(`${API}/admissions/applications`).set(auth(clerk)).send(child({ enquiryId, firstName: 'Other', dob: '2019-01-01', duplicateReason: 'testing twice' }));
    expect(again.body.type).toBe('enquiry-converted');
    const followup = await http().post(`${API}/admissions/enquiries/${enquiryId}/followups`).set(auth(clerk)).send({ mode: 'CALL', remarks: 'late call', status: 'FOLLOW_UP' });
    expect(followup.body.type).toBe('enquiry-converted');
  });
});

describe('AC25 applications', () => {
  it('application numbers are gapless: a refused duplicate does not use a number', async () => {
    const list = (await http().get(`${API}/admissions/applications`).set(auth(clerk))).body.rows;
    expect(list.map((a: { applicationNo: string }) => a.applicationNo)).toEqual(['APP/2026-27/0001']);

    // Same phone + same date of birth → flagged, with the match, before saving.
    const dup = await http().post(`${API}/admissions/applications`).set(auth(clerk)).send(child({ firstName: 'Anu' }));
    expect(dup.status).toBe(409);
    expect(dup.body.type).toBe('possible-duplicate');
    expect(dup.body.errors[0]).toMatchObject({ kind: 'APPLICATION', number: 'APP/2026-27/0001', reason: 'SAME_PHONE_AND_DOB' });

    // Staff may continue only with a reason; that application gets the next number, no gap.
    const withReason = await http().post(`${API}/admissions/applications`).set(auth(clerk)).send(child({ firstName: 'Anu', dob: '2020-04-12', duplicateReason: 'Twin sister of Ananya' }));
    expect(withReason.status).toBe(201);
    expect(withReason.body).toMatchObject({ applicationNo: 'APP/2026-27/0002', duplicateReason: 'Twin sister of Ananya' });
  });

  it('same phone + similar name is flagged; a sibling (same phone, different child) is not', async () => {
    const similar = await http().post(`${API}/admissions/duplicate-check`).set(auth(clerk)).send({ parentPhone: '9876500001', firstName: 'Ananya', lastName: 'Rao.', dob: '2021-01-01' });
    expect(similar.body.map((m: { reason: string }) => m.reason)).toContain('SAME_PHONE_SIMILAR_NAME');
    const sibling = await http().post(`${API}/admissions/duplicate-check`).set(auth(clerk)).send({ parentPhone: '9876500001', firstName: 'Rohan', lastName: 'Rao', dob: '2017-08-20' });
    expect(sibling.body).toEqual([]);
    const otherFamily = await http().post(`${API}/admissions/duplicate-check`).set(auth(clerk)).send({ parentPhone: '9876500077', firstName: 'Ananya', lastName: 'Rao', dob: '2020-04-12' });
    expect(otherFamily.body).toEqual([]);
  });

  it('Aadhaar: a full number is refused (API and database); only the last 4 digits are stored', async () => {
    const full = await http().post(`${API}/admissions/applications`).set(auth(clerk)).send(child({ firstName: 'Meera', dob: '2019-02-02', parentPhone: '9876500002', aadhaarLast4: '1234 5678 9012' }));
    expect(full.status).toBe(422);
    expect(JSON.stringify(full.body.errors)).toContain('Do not enter the full Aadhaar number');
    const db = ownerDb();
    try {
      await expect(db.$executeRawUnsafe(`UPDATE admission_applications SET aadhaar_last4 = '12ab' WHERE tenant_id = '${A.tenantId}'`)).rejects.toThrow();
      const cols = await db.$queryRaw<{ character_maximum_length: number }[]>`
        SELECT character_maximum_length FROM information_schema.columns WHERE table_name IN ('admission_applications','students') AND column_name = 'aadhaar_last4'`;
      expect(cols.map((c) => c.character_maximum_length)).toEqual([4, 4]);
    } finally {
      await db.$disconnect();
    }
  });

  it('documents attach to the application via Files', async () => {
    const appId = (await http().get(`${API}/admissions/applications`).set(auth(clerk))).body.rows[0].id;
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    const up = await http().post(`${API}/files`).set(auth(clerk)).field('entityType', 'APPLICATION').field('entityId', appId).field('docType', 'BIRTH_CERT').field('campusId', campus)
      .attach('file', pdf, { filename: 'birth.pdf', contentType: 'application/pdf' });
    expect(up.status).toBe(201);
    const files = (await http().get(`${API}/files?entityType=APPLICATION&entityId=${appId}`).set(auth(clerk))).body;
    expect(files.map((f: { docType: string }) => f.docType)).toEqual(['BIRTH_CERT']);
  });

  it('another institution cannot see the application', async () => {
    const appId = (await http().get(`${API}/admissions/applications`).set(auth(clerk))).body.rows[0].id;
    expect((await http().get(`${API}/admissions/applications/${appId}`).set(auth(B.session))).status).toBe(404);
    expect((await http().get(`${API}/admissions/applications`).set(auth(B.session))).body.rows).toEqual([]);
  });
});

describe('AC26 decisions', () => {
  let appId: string;

  beforeAll(async () => {
    appId = (await http().post(`${API}/admissions/applications`).set(auth(clerk)).send(child({ firstName: 'Varun', lastName: 'Shetty', dob: '2019-06-06', parentPhone: '9876500010', fatherName: 'Prakash Shetty', motherName: null }))).body.id;
  });

  it('only holders of the decide permission act; reject needs a reason', async () => {
    expect((await http().post(`${API}/admissions/applications/${appId}/decision`).set(auth(clerk)).send({ decision: 'APPROVE' })).status).toBe(403);
    expect((await http().post(`${API}/admissions/applications/${appId}/decision`).set(auth(principal)).send({ decision: 'REJECT' })).status).toBe(422);
    const wait = await http().post(`${API}/admissions/applications/${appId}/decision`).set(auth(principal)).send({ decision: 'WAITLIST', remarks: 'Seats full for now' });
    expect(wait.body.status).toBe('WAITLISTED');
    const ok = await http().post(`${API}/admissions/applications/${appId}/decision`).set(auth(principal)).send({ decision: 'APPROVE' });
    expect(ok.body).toMatchObject({ status: 'APPROVED', decidedBy: expect.any(String) });
    expect((await http().post(`${API}/admissions/applications/${appId}/decision`).set(auth(principal)).send({ decision: 'REJECT', remarks: 'Changed mind' })).body.type).toBe('invalid-transition');
  });

  it('every decision is audited', async () => {
    const logs = (await http().get(`${API}/audit-logs?entityType=APPLICATION&entityId=${appId}&pageSize=50`).set(auth(A.session))).body.items as { action: string; newValues: { status?: string } }[];
    const statuses = logs.map((l) => l.newValues?.status).filter(Boolean);
    expect(statuses).toEqual(expect.arrayContaining(['WAITLISTED', 'APPROVED']));
  });

  it('a decided application cannot be edited (API and database)', async () => {
    const edit = await http().patch(`${API}/admissions/applications/${appId}`).set(auth(clerk)).send({ firstName: 'Varun K' });
    expect(edit.body.type).toBe('application-locked');
    const db = ownerDb();
    try {
      await expect(db.$executeRawUnsafe(`UPDATE admission_applications SET first_name = 'Hacked' WHERE id = '${appId}'`)).rejects.toThrow(/application_locked/);
    } finally {
      await db.$disconnect();
    }
  });
});

describe('AC27 enrolment', () => {
  const approve = async (over: Record<string, unknown>) => {
    const created = await http().post(`${API}/admissions/applications`).set(auth(clerk)).send(child(over));
    if (created.status !== 201) throw new Error(JSON.stringify(created.body));
    await http().post(`${API}/admissions/applications/${created.body.id}/decision`).set(auth(principal)).send({ decision: 'APPROVE' });
    return created.body.id as string;
  };
  const nextAdmissionNumber = async () => {
    const db = ownerDb();
    try {
      const r = await db.numberSequence.findFirst({ where: { tenantId: A.tenantId, docType: 'ADMISSION' } });
      return r?.nextNumber ?? null;
    } finally {
      await db.$disconnect();
    }
  };

  it('one transaction: student, admission number, guardians, enrolment, ENROLLED, outbox event', async () => {
    const first = (await http().get(`${API}/admissions/applications?search=APP/2026-27/0001`).set(auth(clerk))).body.rows[0].id;
    await http().post(`${API}/admissions/applications/${first}/decision`).set(auth(principal)).send({ decision: 'APPROVE' });
    const seats = (await http().get(`${API}/admissions/applications/${first}/sections`).set(auth(principal))).body;
    expect(seats.map((s: { name: string; available: number }) => [s.name, s.available])).toEqual([['A', 2], ['B', 2]]);

    const res = await http().post(`${API}/admissions/applications/${first}/enrol`).set(auth(principal)).send({ sectionId: sectionA, rollNo: '1' });
    expect(res.status).toBe(201);
    expect(res.body.admissionNo).toBe('ADM/2026-27/0001');
    expect(res.body.guardians.map((g: { relation: string; reused: boolean }) => [g.relation, g.reused])).toEqual([['FATHER', false], ['MOTHER', false]]);
    const a = (await http().get(`${API}/admissions/applications/${first}`).set(auth(principal))).body;
    expect(a).toMatchObject({ status: 'ENROLLED', student: { admissionNo: 'ADM/2026-27/0001' } });
    expect(res.body.student.aadhaarLast4).toBe('4321');

    const db = ownerDb();
    try {
      const ev = await db.outboxEvent.findFirst({ where: { tenantId: A.tenantId, eventType: 'student.enrolled', aggregateId: res.body.student.id } });
      expect(ev?.payload).toMatchObject({ admissionNo: 'ADM/2026-27/0001', sectionId: sectionA });
    } finally {
      await db.$disconnect();
    }
    // A second enrolment of the same application is refused.
    const again = await http().post(`${API}/admissions/applications/${first}/enrol`).set(auth(principal)).send({ sectionId: sectionA });
    expect(again.body).toMatchObject({ status: 409, type: 'not-approved' });
  });

  it('a failure at any step leaves nothing behind (forced failure at the last step)', async () => {
    const id = await approve({ firstName: 'Rohan', lastName: 'Rao', dob: '2017-08-20' });
    const before = await nextAdmissionNumber();
    const spy = jest.spyOn(OutboxService.prototype, 'add').mockRejectedValueOnce(new Error('forced failure'));
    try {
      const res = await http().post(`${API}/admissions/applications/${id}/enrol`).set(auth(principal)).send({ sectionId: sectionA });
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(await nextAdmissionNumber()).toBe(before); // number not consumed
    const a = (await http().get(`${API}/admissions/applications/${id}`).set(auth(principal))).body;
    expect(a).toMatchObject({ status: 'APPROVED', studentId: null });
    const db = ownerDb();
    try {
      expect(await db.student.count({ where: { tenantId: A.tenantId, firstName: 'Rohan' } })).toBe(0);
      expect(await db.studentEnrollment.count({ where: { tenantId: A.tenantId, sectionId: sectionA } })).toBe(1);
    } finally {
      await db.$disconnect();
    }

    // Retried normally it succeeds, and the sibling re-uses the family's guardians (matched by phone).
    const ok = await http().post(`${API}/admissions/applications/${id}/enrol`).set(auth(principal)).send({ sectionId: sectionA });
    expect(ok.status).toBe(201);
    expect(ok.body.admissionNo).toBe('ADM/2026-27/0002');
    expect(ok.body.guardians.map((g: { relation: string; reused: boolean }) => [g.relation, g.reused])).toEqual([['FATHER', true], ['MOTHER', true]]);
    const db2 = ownerDb();
    try {
      expect(await db2.guardian.count({ where: { tenantId: A.tenantId, phone: '9876500001' } })).toBe(1);
    } finally {
      await db2.$disconnect();
    }
  });

  it('a full section is refused; another section with seats works', async () => {
    const id = await approve({ firstName: 'Diya', lastName: 'Nair', dob: '2020-09-09', parentPhone: '9876500020', fatherName: null, motherName: 'Asha Nair' });
    const full = await http().post(`${API}/admissions/applications/${id}/enrol`).set(auth(principal)).send({ sectionId: sectionA });
    expect(full.body).toMatchObject({ status: 409, type: 'section-full' });
    const sectionB = (await http().get(`${API}/admissions/applications/${id}/sections`).set(auth(principal))).body.find((s: { name: string }) => s.name === 'B').id;
    const ok = await http().post(`${API}/admissions/applications/${id}/enrol`).set(auth(principal)).send({ sectionId: sectionB });
    expect(ok.status).toBe(201);
    expect(ok.body.guardians).toEqual([expect.objectContaining({ relation: 'MOTHER', reused: false })]);
  });

  it('two enrolments racing for the last seat: exactly one wins', async () => {
    const last = (await http().post(`${API}/sections`).set(auth(A.session)).send({ academicYearId: year, programLevelId: class1, names: ['C'], capacity: 1 })).body[0].id;
    const x = await approve({ firstName: 'Ishaan', lastName: 'Gowda', dob: '2020-03-03', parentPhone: '9876500040' });
    const y = await approve({ firstName: 'Tara', lastName: 'Patil', dob: '2020-05-05', parentPhone: '9876500050' });
    const results = await Promise.all([x, y].map((id) => http().post(`${API}/admissions/applications/${id}/enrol`).set(auth(principal)).send({ sectionId: last })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.type).toBe('section-full');
  });

  it('only approved applications enrol; the clerk cannot enrol', async () => {
    const pending = (await http().post(`${API}/admissions/applications`).set(auth(clerk)).send(child({ firstName: 'Zoya', lastName: 'Khan', dob: '2020-01-15', parentPhone: '9876500030' }))).body.id;
    expect((await http().post(`${API}/admissions/applications/${pending}/enrol`).set(auth(principal)).send({ sectionId: sectionA })).body.type).toBe('not-approved');
    expect((await http().post(`${API}/admissions/applications/${pending}/enrol`).set(auth(clerk)).send({ sectionId: sectionA })).status).toBe(403);
  });
});
