import PgBoss from 'pg-boss';
import { PrismaClient } from '@eduerp/db';
import { CONSUMER_QUEUES, DEAD_LETTER_QUEUE } from './consumers';

export interface JobsSetupOptions {
  ownerUrl: string;
  retryLimit: number;
  retryDelaySeconds: number;
  /** Extra queues (tests). */
  extraQueues?: string[];
  appRole?: string;
}

/**
 * One-time / per-deploy setup, run as the OWNER role: installs or upgrades the pg-boss schema,
 * creates the queues with their retry policy, and grants the runtime role row access only.
 * The runtime role (no DDL rights) then uses pg-boss with migrate:false.
 */
export async function setupJobs(o: JobsSetupOptions): Promise<void> {
  const role = o.appRole ?? 'eduerp_app';
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error('invalid role name');

  const boss = new PgBoss({ connectionString: o.ownerUrl, schema: 'pgboss', migrate: true, supervise: false, schedule: false, max: 2 });
  await boss.start();
  try {
    const policy = { retryLimit: o.retryLimit, retryDelay: o.retryDelaySeconds, retryBackoff: true, retentionDays: 7 };
    const ensure = async (name: string, opts: Omit<PgBoss.Queue, 'name'>) => {
      if (await boss.getQueue(name)) await boss.updateQueue(name, { name, ...opts });
      else await boss.createQueue(name, { name, ...opts });
    };
    await ensure(DEAD_LETTER_QUEUE, { retryLimit: 2, retryDelay: o.retryDelaySeconds, retentionDays: 30 });
    for (const q of [...CONSUMER_QUEUES, ...(o.extraQueues ?? [])]) await ensure(q, { ...policy, deadLetter: DEAD_LETTER_QUEUE });
  } finally {
    await boss.stop({ graceful: false, wait: true });
  }

  const owner = new PrismaClient({ datasourceUrl: o.ownerUrl });
  try {
    for (const sql of [
      `GRANT USAGE ON SCHEMA pgboss TO ${role}`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO ${role}`,
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO ${role}`,
      `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO ${role}`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
    ]) {
      await owner.$executeRawUnsafe(sql);
    }
  } finally {
    await owner.$disconnect();
  }
}
