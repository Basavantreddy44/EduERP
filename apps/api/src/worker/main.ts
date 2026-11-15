import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { JobsRunner } from './jobs.runner';
import { FeeOnlineService } from '../modules/fees/online.service';
import { LateFeeService } from '../modules/fees/late-fee.service';
import { config } from '../config';

/** Background worker process: `pnpm --filter @eduerp/api worker`. Run one or more next to the API. */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['log', 'warn', 'error'] });
  const runner = app.get(JobsRunner);
  await runner.start();
  // Online payments: re-check unfinished gateway orders every few minutes (one pass at a time).
  const online = app.get(FeeOnlineService);
  let busy = false;
  const recheck = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const r = await online.reconcileAll();
      const paid = r.reduce((a, x) => a + x.paid, 0);
      if (paid) console.log(`Online payment re-check: ${paid} payment(s) recorded`);
    } catch (e) {
      console.error('Online payment re-check failed:', e instanceof Error ? e.message : e);
    } finally {
      busy = false;
    }
  }, config().PAYMENT_RECONCILE_SECONDS * 1000);
  // Late fees: hourly (a second pass on the same day adds nothing), first pass a minute after start.
  const lateFees = app.get(LateFeeService);
  const applyLateFees = () => lateFees.applyAll().then((r) => r.length && console.log(`Late fees added on ${r.reduce((a, x) => a + x.invoiceCount, 0)} bill(s)`)).catch((e) => console.error('Late fees failed:', e instanceof Error ? e.message : e));
  const lateFirst = setTimeout(applyLateFees, 60_000);
  const lateTimer = setInterval(applyLateFees, 3_600_000);
  const shutdown = async () => {
    clearInterval(recheck);
    clearTimeout(lateFirst);
    clearInterval(lateTimer);
    await runner.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
