import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import PgBoss from 'pg-boss';
import { Db } from '../common/prisma.service';
import { config } from '../config';
import { CONSUMERS, Consumer, DEAD_LETTER_QUEUE } from './consumers';

interface JobData {
  eventId: string;
  tenantId: string | null;
  consumer: string;
}

/** Deterministic job id per (consumer, event): re-sending the same event creates no second job. */
export function jobId(consumer: string, eventId: string): string {
  const h = createHash('sha1').update(`${consumer}:${eventId}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50; // UUID version 5
  h[8] = (h[8] & 0x3f) | 0x80; // RFC 4122 variant
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** Tenant events run under that tenant's RLS; platform-level events (tenant NULL) in system context. */
const ctxFor = (d: JobData) => (d.tenantId ? { tenantId: d.tenantId } : { isSystem: true, isPlatform: true });

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 400);

/**
 * Outbox relay + job processing (ADR-006).
 *  relay:   PENDING outbox rows → one pg-boss job per subscribed consumer → row marked DISPATCHED.
 *  process: job → tenant transaction { skip if already processed; handle; mark processed }.
 *  failure: pg-boss retries with exponential backoff; after the last retry the job lands in the
 *           dead-letter queue, which marks the outbox row FAILED and calls the consumer's onFailed.
 */
@Injectable()
export class JobsRunner {
  private readonly log = new Logger('Jobs');
  private boss: PgBoss | null = null;
  private timer: NodeJS.Timeout | null = null;
  private relaying = false;
  private stopped = true;

  constructor(
    private readonly db: Db,
    @Inject(CONSUMERS) private readonly consumers: Consumer[],
  ) {}

  /** Tests register extra consumers before start(); their queues must exist (jobs:setup). */
  register(c: Consumer): void {
    if (!this.stopped) throw new Error('register consumers before start()');
    this.consumers.push(c);
  }

  async start(opts: { relay?: boolean; pollSeconds?: number } = {}): Promise<void> {
    const boss = new PgBoss({ connectionString: config().DATABASE_URL, schema: 'pgboss', migrate: false, schedule: false, supervise: true, max: 5 });
    boss.on('error', (e) => this.log.error(`pg-boss: ${errText(e)}`));
    await boss.start();
    this.boss = boss;
    this.stopped = false;
    const pollingIntervalSeconds = opts.pollSeconds ?? 1;
    for (const c of this.consumers) {
      await boss.work<JobData>(c.name, { pollingIntervalSeconds, batchSize: 1 }, async ([job]) => this.process(c, job.data));
    }
    await boss.work<JobData>(DEAD_LETTER_QUEUE, { pollingIntervalSeconds, batchSize: 1 }, async ([job]) => this.deadLetter(job.data));
    if (opts.relay !== false) this.scheduleRelay(0);
    this.log.log(`started: ${this.consumers.map((c) => c.name).join(', ')}`);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    while (this.relaying) await new Promise((r) => setTimeout(r, 20));
    await this.boss?.stop({ graceful: true, wait: true, timeout: 10_000 });
    this.boss = null;
  }

  private scheduleRelay(delay: number): void {
    this.timer = setTimeout(async () => {
      try {
        await this.relayOnce();
      } catch (e) {
        this.log.error(`relay failed: ${errText(e)}`);
      }
      if (!this.stopped) this.scheduleRelay(config().OUTBOX_POLL_MS);
    }, delay);
  }

  /** Moves up to 100 pending events to their consumers' queues. Returns how many were dispatched. */
  async relayOnce(): Promise<number> {
    if (!this.boss || this.relaying) return 0;
    this.relaying = true;
    try {
      return await this.db.run({ isSystem: true }, async (tx) => {
        const rows = await tx.$queryRaw<{ id: string; tenant_id: string | null; event_type: string }[]>`
          SELECT id, tenant_id, event_type FROM outbox_events
           WHERE status = 'PENDING' ORDER BY occurred_at LIMIT 100 FOR UPDATE SKIP LOCKED`;
        for (const e of rows) {
          for (const c of this.consumers.filter((x) => x.events.includes(e.event_type))) {
            await this.boss!.send(c.name, { eventId: e.id, tenantId: e.tenant_id, consumer: c.name } satisfies JobData, { id: jobId(c.name, e.id) });
          }
        }
        if (rows.length) {
          await tx.$executeRaw`UPDATE outbox_events SET status = 'DISPATCHED', dispatched_at = now() WHERE id = ANY(${rows.map((r) => r.id)}::uuid[])`;
        }
        return rows.length;
      });
    } finally {
      this.relaying = false;
    }
  }

  private async process(c: Consumer, data: JobData): Promise<void> {
    try {
      await this.db.run(ctxFor(data), async (tx) => {
        const done = await tx.processedEvent.findUnique({ where: { consumer_eventId: { consumer: c.name, eventId: data.eventId } }, select: { eventId: true } });
        if (done) return;
        const event = await tx.outboxEvent.findUnique({ where: { id: data.eventId } });
        if (!event) return;
        await c.handle(tx, event);
        await tx.processedEvent.create({ data: { consumer: c.name, eventId: data.eventId, tenantId: data.tenantId } });
      });
    } catch (e) {
      await this.db
        .run({ isSystem: true }, (tx) => tx.$executeRaw`UPDATE outbox_events SET attempts = attempts + 1, last_error = ${`${c.name}: ${errText(e)}`} WHERE id = ${data.eventId}::uuid`)
        .catch(() => undefined);
      throw e; // pg-boss schedules the retry
    }
  }

  private async deadLetter(data: JobData): Promise<void> {
    const last = await this.db.run({ isSystem: true }, async (tx) => {
      await tx.$executeRaw`UPDATE outbox_events SET status = 'FAILED' WHERE id = ${data.eventId}::uuid`;
      const r = await tx.$queryRaw<{ last_error: string | null }[]>`SELECT last_error FROM outbox_events WHERE id = ${data.eventId}::uuid`;
      return r[0]?.last_error ?? 'failed';
    });
    const c = this.consumers.find((x) => x.name === data.consumer);
    if (c?.onFailed) {
      await this.db.run(ctxFor(data), async (tx) => {
        const event = await tx.outboxEvent.findUnique({ where: { id: data.eventId } });
        if (event) await c.onFailed!(tx, event, last);
      });
    }
    this.log.warn(`event ${data.eventId} parked as FAILED for ${data.consumer}: ${last}`);
  }
}
