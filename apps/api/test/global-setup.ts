import { execSync } from 'node:child_process';
import path from 'node:path';
import { hash } from '@node-rs/argon2';
import { PrismaClient, seedMasters } from '@eduerp/db';
import { setupJobs } from '../src/worker/jobs-setup';

/** Extra pg-boss queues used only by the outbox tests. */
export const TEST_QUEUES = ['test-ok', 'test-failing'];

export const PLATFORM_ADMIN = { email: 'platform@test.local', password: 'Platform@Test123' };

/** Rebuilds the test database from migrations (exactly as production would get it), then seeds masters. */
export default async function globalSetup(): Promise<void> {
  const ownerUrl = process.env.TEST_DATABASE_OWNER_URL!;
  const owner = new PrismaClient({ datasourceUrl: ownerUrl });
  try {
    await owner.$executeRawUnsafe('DROP SCHEMA IF EXISTS pgboss CASCADE');
    await owner.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await owner.$executeRawUnsafe('CREATE SCHEMA public');
    await owner.$executeRawUnsafe('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await owner.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO eduerp_app');
    await owner.$executeRawUnsafe('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eduerp_app');
    await owner.$executeRawUnsafe('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO eduerp_app');
    await owner.$executeRawUnsafe('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO eduerp_app');

    execSync('npx prisma migrate deploy', {
      cwd: path.resolve(__dirname, '../../../packages/db'),
      env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, DATABASE_OWNER_URL: ownerUrl },
      stdio: 'pipe',
    });

    await seedMasters(owner);
    // Fast retries so retry and dead-letter behaviour is observable in seconds.
    await setupJobs({ ownerUrl, retryLimit: 2, retryDelaySeconds: 1, extraQueues: TEST_QUEUES });
    await owner.user.create({
      data: { email: PLATFORM_ADMIN.email, fullName: 'Test Platform Admin', passwordHash: await hash(PLATFORM_ADMIN.password), platformRole: 'SUPER_ADMIN' },
    });
  } finally {
    await owner.$disconnect();
  }
}
