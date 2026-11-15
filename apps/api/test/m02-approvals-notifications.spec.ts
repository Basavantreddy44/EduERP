/**
 * AC14 approvals engine (routing, SoD, approver-only, reject, outbox, audit) and
 * AC13 notifications (in-app + email in the recipient's language, opt-out, mandatory, delivery status).
 * Runs the real worker and sends real email to Mailpit.
 */
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { Db } from '../src/common/prisma.service';
import { ApprovalsService, resolveRoute } from '../src/modules/approvals/approvals.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { WorkerModule } from '../src/worker/worker.module';
import { JobsRunner } from '../src/worker/jobs.runner';
import { API, PLATFORM_ADMIN, addMember, appDb, auth, createRole, createTenant, login, mailsTo, ownerDb, startApp, waitFor, Session } from './helpers';

let app: INestApplication;
let worker: INestApplicationContext;
let A: Awaited<ReturnType<typeof createTenant>>;
type Member = Awaited<ReturnType<typeof addMember>>;
let requester: Member, hod: Member, principal: Member, outsider: Member;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'Appr');
  const hodRole = await createRole(A.tenantId, 'HOD');
  const principalRole = await createRole(A.tenantId, 'PRINCIPAL');
  requester = await addMember(app, A.session, { label: 'Requester', roleCode: 'CAMPUS_VIEWER' });
  hod = await addMember(app, A.session, { label: 'Hod', roleCode: 'HOD' });
  principal = await addMember(app, A.session, { label: 'Principal', roleCode: 'PRINCIPAL', language: 'kn' });
  outsider = await addMember(app, A.session, { label: 'Outsider', roleCode: 'CAMPUS_VIEWER' });

  // Level 1: HOD always. Level 2: Principal only for ₹1,000 and above.
  for (const body of [
    { entityType: 'TEST', levelNo: 1, approverRoleId: hodRole },
    { entityType: 'TEST', levelNo: 2, approverRoleId: principalRole, minAmount: 1000 },
  ]) {
    const res = await http().post(`${API}/approvals/rules`).set(auth(A.session)).send(body);
    expect(res.status).toBe(201);
  }

  worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
  await worker.get(JobsRunner).start({ pollSeconds: 0.5 });
}, 90_000);

afterAll(async () => {
  await worker?.get(JobsRunner).stop();
  await worker?.close();
  await app?.close();
});

/** What a business module does: submit inside its own transaction. */
const submit = (amount: number, entityId: string, summary: string) =>
  app.get(Db).run({ tenantId: A.tenantId, userId: requester.userId }, (tx) =>
    app.get(ApprovalsService).submit(tx, { tenantId: A.tenantId, requestedBy: requester.userId, entityType: 'TEST', entityId, amount, summary }),
  );
const act = (s: Session, id: string, body: object) => http().post(`${API}/approvals/requests/${id}/act`).set(auth(s)).send(body);
const inbox = async (s: Session) => (await http().get(`${API}/approvals/inbox`).set(auth(s))).body as { id: string }[];
const notifications = async (s: Session) => (await http().get(`${API}/notifications`).set(auth(s))).body as { items: { eventCode: string; title: string; entityId: string; id: string }[]; unreadCount: number };

describe('route resolution (unit)', () => {
  const rules = [
    { campusId: null, minAmount: null, levelNo: 1, approverRoleId: 'r1' },
    { campusId: null, minAmount: { toString: () => '1000' } as never, levelNo: 2, approverRoleId: 'r2' },
    { campusId: 'c1', minAmount: null, levelNo: 1, approverRoleId: 'r9' },
  ];
  it('applies amount thresholds and prefers campus rules', () => {
    expect(resolveRoute(rules, null, 500)).toEqual([{ levelNo: 1, roleId: 'r1' }]);
    expect(resolveRoute(rules, null, 1000)).toEqual([{ levelNo: 1, roleId: 'r1' }, { levelNo: 2, roleId: 'r2' }]);
    expect(resolveRoute(rules, 'c1', 5000)).toEqual([{ levelNo: 1, roleId: 'r9' }]);
    expect(resolveRoute([], null, 10)).toEqual([]);
  });
});

describe('AC14 approvals', () => {
  let big: string; // ₹5,000 → 2 levels

  it('routes by amount: ₹5,000 needs 2 levels', async () => {
    const r = await submit(5000, '00000000-0000-4000-8000-000000000001', 'Concession for Ravi, Class 8');
    expect(r).not.toBeNull();
    expect(r!.totalLevels).toBe(2);
    big = r!.id;
    expect((await inbox(hod.session)).map((x) => x.id)).toContain(big);
    expect((await inbox(principal.session)).map((x) => x.id)).not.toContain(big);
  });

  it('the requester cannot approve their own request (API and database)', async () => {
    const res = await act(requester.session, big, { action: 'APPROVE' });
    expect(res.status).toBe(403);
    expect(res.body.type).toBe('sod-violation');

    const db = appDb();
    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${A.tenantId}, true)`;
        await tx.approvalAction.create({ data: { tenantId: A.tenantId, approvalRequestId: big, levelNo: 1, actionBy: requester.userId, action: 'APPROVE' } });
      }),
    ).rejects.toThrow(/approval_sod_violation/);
    await db.$disconnect();
  });

  it('only the role of the current level can act', async () => {
    expect((await act(outsider.session, big, { action: 'APPROVE' })).body.type).toBe('not-approver');
    expect((await act(principal.session, big, { action: 'APPROVE' })).body.type).toBe('not-approver'); // not their level yet
  });

  it('level 1 approval moves it to level 2; the final approval completes it and emits an outbox event', async () => {
    const l1 = await act(hod.session, big, { action: 'APPROVE', remarks: 'OK as per policy' });
    expect(l1.status).toBe(201);
    expect(l1.body).toMatchObject({ status: 'PENDING', currentLevel: 2 });
    expect((await act(hod.session, big, { action: 'APPROVE' })).body.type).toBe('not-approver');
    expect((await inbox(principal.session)).map((x) => x.id)).toContain(big);

    const l2 = await act(principal.session, big, { action: 'APPROVE' });
    expect(l2.body).toMatchObject({ status: 'APPROVED' });

    const db = ownerDb();
    const completed = await db.outboxEvent.findUnique({ where: { dedupeKey: `approval:${big}:completed` } });
    const audit = await db.auditLog.findMany({ where: { entityType: 'APPROVAL_REQUEST', entityId: big }, orderBy: { createdAt: 'asc' } });
    await db.$disconnect();
    expect(completed?.payload).toMatchObject({ decision: 'APPROVED', entityType: 'TEST' });
    expect(audit.map((a) => a.action)).toEqual(['SUBMIT', 'APPROVE', 'APPROVE']);
  });

  it('₹500 needs one level; reject requires a reason and ends the request', async () => {
    const r = await submit(500, '00000000-0000-4000-8000-000000000002', 'Small concession');
    expect(r!.totalLevels).toBe(1);
    expect((await act(hod.session, r!.id, { action: 'REJECT' })).status).toBe(422);
    const rej = await act(hod.session, r!.id, { action: 'REJECT', remarks: 'Not eligible this term' });
    expect(rej.body).toMatchObject({ status: 'REJECTED' });
    const again = await act(hod.session, r!.id, { action: 'APPROVE' });
    expect(again.status).toBe(409);
    expect(again.body.type).toBe('approval-closed');
  });

  it('one open request per record; no rule means no approval needed', async () => {
    await submit(100, '00000000-0000-4000-8000-000000000003', 'x');
    await expect(submit(100, '00000000-0000-4000-8000-000000000003', 'x')).rejects.toMatchObject({ code: 'approval-already-open' });
    const none = await app.get(Db).run({ tenantId: A.tenantId }, (tx) =>
      app.get(ApprovalsService).submit(tx, { tenantId: A.tenantId, requestedBy: requester.userId, entityType: 'LEAVE', entityId: '00000000-0000-4000-8000-000000000004' }),
    );
    expect(none).toBeNull();
  });
});

describe('AC13 notifications', () => {
  it('approvers get an in-app notification and an email in their own language', async () => {
    // Principal prefers Kannada; HOD English.
    const kn = await waitFor(async () => (await notifications(principal.session)).items.find((n) => n.eventCode === 'APPROVAL_PENDING'), 20_000, 'principal notification');
    expect(kn.title).toBe('ಅನುಮೋದನೆ ಅಗತ್ಯವಿದೆ: Test request');
    const en = await waitFor(async () => (await notifications(hod.session)).items.find((n) => n.eventCode === 'APPROVAL_PENDING'), 20_000, 'hod notification');
    expect(en.title).toBe('Approval needed: Test request');

    const knMail = await waitFor(async () => (await mailsTo(principal.email)).find((m) => m.Subject.startsWith('ಅನುಮೋದನೆ ಅಗತ್ಯವಿದೆ')), 20_000, 'kannada email');
    expect(knMail.Subject).toBe('ಅನುಮೋದನೆ ಅಗತ್ಯವಿದೆ: Test request');
    expect((await mailsTo(hod.email)).some((m) => m.Subject === 'Approval needed: Test request')).toBe(true);
  }, 60_000);

  it('the requester hears the decision, and each email delivery records SENT', async () => {
    const n = await waitFor(async () => (await notifications(requester.session)).items.find((x) => x.eventCode === 'APPROVAL_APPROVED'), 20_000, 'approved notification');
    expect(n.title).toBe('Approved: Test request');
    await waitFor(async () => (await mailsTo(requester.email)).some((m) => m.Subject === 'Approved: Test request'), 20_000, 'approved email');

    const db = ownerDb();
    const sent = await waitFor(async () => {
      const d = await db.notificationDelivery.findFirst({ where: { notificationId: n.id, channel: 'EMAIL' } });
      return d?.status === 'SENT' ? d : null;
    }, 20_000, 'delivery SENT');
    await db.$disconnect();
    expect(sent.providerMsgId).toBeTruthy();
  }, 60_000);

  it('an opt-out skips the email (recorded as SKIPPED); the in-app inbox still gets it', async () => {
    const pref = await http().put(`${API}/notifications/preferences`).set(auth(requester.session)).send({ eventCode: 'APPROVAL_REJECTED', channel: 'EMAIL', isEnabled: false });
    expect(pref.status).toBe(200);
    const r = await submit(200, '00000000-0000-4000-8000-000000000005', 'Opt-out check');
    await act(hod.session, r!.id, { action: 'REJECT', remarks: 'Testing opt-out' });

    const n = await waitFor(async () => (await notifications(requester.session)).items.find((x) => x.eventCode === 'APPROVAL_REJECTED' && x.entityId === r!.id), 20_000, 'rejected notification');
    const db = ownerDb();
    const d = await db.notificationDelivery.findFirst({ where: { notificationId: n.id, channel: 'EMAIL' } });
    await db.$disconnect();
    expect(d).toMatchObject({ status: 'SKIPPED', errorMessage: 'opted-out' });
  }, 60_000);

  it('mandatory events ignore opt-outs and cannot be turned off', async () => {
    const off = await http().put(`${API}/notifications/preferences`).set(auth(requester.session)).send({ eventCode: 'ACCOUNT_SECURITY', channel: 'EMAIL', isEnabled: false });
    expect(off.status).toBe(422);
    expect(off.body.type).toBe('preference-mandatory');

    // Even a stored opt-out (e.g. from before the event became mandatory) is ignored.
    const owner = ownerDb();
    await owner.notificationPreference.create({ data: { tenantId: A.tenantId, userId: requester.userId, eventCode: 'ACCOUNT_SECURITY', channel: 'EMAIL', isEnabled: false } });
    await owner.$disconnect();
    await app.get(Db).run({ tenantId: A.tenantId }, (tx) =>
      app.get(NotificationsService).notify(tx, { tenantId: A.tenantId, userIds: [requester.userId], eventCode: 'ACCOUNT_SECURITY', vars: { message: 'Your password was changed.' } }),
    );
    await waitFor(async () => (await mailsTo(requester.email)).some((m) => m.Subject === 'Account security notice'), 20_000, 'security email');
  }, 60_000);

  it('inbox: unread count, mark one read, mark all read; other users cannot touch it', async () => {
    const before = await notifications(requester.session);
    expect(before.unreadCount).toBeGreaterThan(0);
    const first = before.items[0];
    expect((await http().post(`${API}/notifications/${first.id}/read`).set(auth(outsider.session))).status).toBe(404);
    expect((await http().post(`${API}/notifications/${first.id}/read`).set(auth(requester.session))).status).toBe(201);
    expect((await notifications(requester.session)).unreadCount).toBe(before.unreadCount - 1);
    await http().post(`${API}/notifications/read-all`).set(auth(requester.session));
    expect((await notifications(requester.session)).unreadCount).toBe(0);
  });
});
