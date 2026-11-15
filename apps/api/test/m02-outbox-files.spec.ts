/** AC11 transactional outbox + worker (exactly-once effect, retry, dead letter); AC12 files. */
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import type { OutboxEvent } from '@eduerp/db';
import { Db, Tx } from '../src/common/prisma.service';
import { OutboxService } from '../src/common/outbox.service';
import { WorkerModule } from '../src/worker/worker.module';
import { JobsRunner } from '../src/worker/jobs.runner';
import type { Consumer } from '../src/worker/consumers';
import { API, PLATFORM_ADMIN, addMember, auth, createTenant, login, ownerDb, startApp, waitFor, Session } from './helpers';

let app: INestApplication;
let worker: INestApplicationContext;
let runner: JobsRunner;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
const http = () => request(app.getHttpServer());

/** Writes one audit row per handled event, so "how many times did it run" is countable. */
const okConsumer: Consumer = {
  name: 'test-ok',
  events: ['test.ok'],
  handle: async (tx: Tx, e: OutboxEvent) => {
    await tx.auditLog.create({ data: { tenantId: e.tenantId!, action: 'CREATE', entityType: 'TEST_CONSUMER', entityId: e.id } });
  },
};
const failingConsumer: Consumer = {
  name: 'test-failing',
  events: ['test.failing'],
  handle: async () => {
    throw new Error('boom');
  },
};

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'OutA');
  B = await createTenant(app, platform, 'OutB');
  worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
  runner = worker.get(JobsRunner);
  runner.register(okConsumer);
  runner.register(failingConsumer);
  await runner.start({ pollSeconds: 0.5 });
}, 60_000);

afterAll(async () => {
  await runner?.stop();
  await worker?.close();
  await app?.close();
});

const outboxOf = async (dedupeKey: string) => {
  const db = ownerDb();
  const row = await db.outboxEvent.findUnique({ where: { dedupeKey } });
  await db.$disconnect();
  return row;
};
const handledCount = async (eventId: string) => {
  const db = ownerDb();
  const n = await db.auditLog.count({ where: { entityType: 'TEST_CONSUMER', entityId: eventId } });
  await db.$disconnect();
  return n;
};

describe('AC11 outbox and worker', () => {
  it('an event written in a rolled-back transaction never exists', async () => {
    const db = app.get(Db);
    const outbox = app.get(OutboxService);
    await expect(
      db.run({ tenantId: A.tenantId }, async (tx) => {
        await outbox.add(tx, { tenantId: A.tenantId, eventType: 'test.ok', aggregateType: 'TEST', payload: {}, dedupeKey: 'test:rolled-back' });
        throw new Error('business failure');
      }),
    ).rejects.toThrow('business failure');
    expect(await outboxOf('test:rolled-back')).toBeNull();
  });

  it('a committed event is delivered once; a duplicate dispatch has no extra effect', async () => {
    const db = app.get(Db);
    const outbox = app.get(OutboxService);
    await db.run({ tenantId: A.tenantId }, (tx) => outbox.add(tx, { tenantId: A.tenantId, eventType: 'test.ok', aggregateType: 'TEST', payload: { n: 1 }, dedupeKey: 'test:ok-1' }));
    const event = (await outboxOf('test:ok-1'))!;

    await waitFor(async () => (await handledCount(event.id)) === 1, 15_000, 'first delivery');
    expect((await outboxOf('test:ok-1'))!.status).toBe('DISPATCHED');

    // Simulate a crash between "job sent" and "row marked dispatched": the relay sends it again.
    const owner = ownerDb();
    await owner.outboxEvent.update({ where: { id: event.id }, data: { status: 'PENDING' } });
    await owner.$disconnect();
    await waitFor(async () => (await outboxOf('test:ok-1'))!.status === 'DISPATCHED', 10_000, 're-dispatch');
    await new Promise((r) => setTimeout(r, 2000));
    expect(await handledCount(event.id)).toBe(1);
  }, 40_000);

  it('a failing handler is retried with backoff, then parked as FAILED with the error', async () => {
    const db = app.get(Db);
    const outbox = app.get(OutboxService);
    await db.run({ tenantId: A.tenantId }, (tx) => outbox.add(tx, { tenantId: A.tenantId, eventType: 'test.failing', aggregateType: 'TEST', payload: {}, dedupeKey: 'test:failing-1' }));
    const failed = await waitFor(async () => {
      const row = await outboxOf('test:failing-1');
      return row?.status === 'FAILED' ? row : null;
    }, 45_000, 'dead letter');
    expect(failed.attempts).toBe(3); // first try + 2 retries (test queue policy)
    expect(failed.lastError).toContain('test-failing: boom');
  }, 60_000);

  it('the relay is the only cross-tenant reader: tenant B cannot see A’s events', async () => {
    const db = app.get(Db);
    const seen = await db.run({ tenantId: B.tenantId }, (tx) => tx.outboxEvent.count({ where: { tenantId: A.tenantId } }));
    expect(seen).toBe(0);
  });
});

describe('AC12 files', () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n');
  let fileId: string;

  it('uploads an allowed file; the stored key never contains the uploaded name', async () => {
    const res = await http()
      .post(`${API}/files`)
      .set(auth(A.session))
      .field('entityType', 'GENERAL')
      .field('docType', 'OTHER')
      .attach('file', pdf, { filename: '../../etc/secret report.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    expect(res.body.fileName).toBe('secret report.pdf');
    expect(res.body.mimeType).toBe('application/pdf');
    expect(res.body).not.toHaveProperty('storageKey');
    fileId = res.body.id;

    const db = ownerDb();
    const row = await db.fileObject.findUniqueOrThrow({ where: { id: fileId } });
    await db.$disconnect();
    expect(row.storageKey).toMatch(new RegExp(`^t/${A.tenantId}/\\d{4}/\\d{2}/[0-9a-f-]{36}\\.pdf$`));
  });

  it('downloads as an attachment with the same bytes', async () => {
    const res = await http().get(`${API}/files/${fileId}/content`).set(auth(A.session)).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['cache-control']).toContain('no-store');
    expect(Buffer.compare(res.body as Buffer, pdf)).toBe(0);
  });

  it('rejects files whose content is not an allowed type, whatever their name says (415)', async () => {
    const res = await http()
      .post(`${API}/files`)
      .set(auth(A.session))
      .field('entityType', 'GENERAL')
      .field('docType', 'PHOTO')
      .attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'photo.png', contentType: 'image/png' });
    expect(res.status).toBe(415);
    expect(res.body.type).toBe('file-type-not-allowed');
  });

  it('enforces the institution size limit (413)', async () => {
    expect((await http().put(`${API}/settings/files.max_upload_mb`).set(auth(A.session)).send({ value: 1 })).status).toBe(200);
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(1024 * 1024 + 10)]);
    const res = await http().post(`${API}/files`).set(auth(A.session)).field('entityType', 'GENERAL').field('docType', 'PHOTO').attach('file', big, 'big.png');
    expect(res.status).toBe(413);
    expect(res.body.type).toBe('file-too-large');
  });

  it('another institution gets 404 for the file and its content', async () => {
    expect((await http().get(`${API}/files/${fileId}`).set(auth(B.session))).status).toBe(404);
    expect((await http().get(`${API}/files/${fileId}/content`).set(auth(B.session))).status).toBe(404);
  });

  it('a member without files.file.read is refused (403); a missing file part is 422', async () => {
    const viewer = await addMember(app, A.session, { label: 'FileViewer', roleCode: 'CAMPUS_VIEWER' });
    expect((await http().get(`${API}/files/${fileId}`).set(auth(viewer.session))).status).toBe(403);
    const none = await http().post(`${API}/files`).set(auth(A.session)).field('entityType', 'GENERAL').field('docType', 'OTHER');
    expect(none.status).toBe(422);
  });
});
