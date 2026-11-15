import { config } from '../config';
import { setupJobs } from './jobs-setup';

/** `pnpm --filter @eduerp/api jobs:setup` — run after migrations on every deploy (idempotent). */
async function main(): Promise<void> {
  const c = config();
  if (!c.DATABASE_OWNER_URL) throw new Error('DATABASE_OWNER_URL is required for jobs:setup');
  await setupJobs({ ownerUrl: c.DATABASE_OWNER_URL, retryLimit: c.JOBS_RETRY_LIMIT, retryDelaySeconds: c.JOBS_RETRY_DELAY_SECONDS });
  console.log(`Jobs: pg-boss schema and queues ready (retry ${c.JOBS_RETRY_LIMIT}× from ${c.JOBS_RETRY_DELAY_SECONDS}s, exponential)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
