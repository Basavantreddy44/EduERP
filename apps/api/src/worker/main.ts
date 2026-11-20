import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { JobsRunner } from './jobs.runner';
import { FeeOnlineService } from '../modules/fees/online.service';
import { LateFeeService } from '../modules/fees/late-fee.service';
import { TransportFleetService } from '../modules/transport/fleet.service';
import { ComplaintsService } from '../modules/engagement/complaints.service';
import { LibraryService } from '../modules/campuslife/library.service';
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
  // Transport expiry alerts: hourly (each threshold is sent once), first pass two minutes after start.
  const fleet = app.get(TransportFleetService);
  const alertExpiry = () => fleet.alertAll().then((n) => n && console.log(`Transport expiry alerts: ${n}`)).catch((e) => console.error('Transport alerts failed:', e instanceof Error ? e.message : e));
  const expiryFirst = setTimeout(alertExpiry, 120_000);
  const expiryTimer = setInterval(alertExpiry, 3_600_000);
  // Overdue complaints: hourly (each is escalated once), first pass three minutes after start.
  const complaints = app.get(ComplaintsService);
  const escalate = () => complaints.escalateAll().then((n) => n && console.log(`Complaints escalated: ${n}`)).catch((e) => console.error('Complaint escalation failed:', e instanceof Error ? e.message : e));
  const escalateFirst = setTimeout(escalate, 180_000);
  const escalateTimer = setInterval(escalate, 3_600_000);
  // Library: overdue reminders (once a day per loan) and expired holds; hourly, first pass four minutes after start.
  const library = app.get(LibraryService);
  const remind = () => library.remindAll().then((n) => n && console.log(`Library overdue reminders: ${n}`)).catch((e) => console.error('Library reminders failed:', e instanceof Error ? e.message : e));
  const libraryFirst = setTimeout(remind, 240_000);
  const libraryTimer = setInterval(remind, 3_600_000);
  const shutdown = async () => {
    clearTimeout(libraryFirst);
    clearInterval(libraryTimer);
    clearInterval(recheck);
    clearTimeout(lateFirst);
    clearInterval(lateTimer);
    clearTimeout(expiryFirst);
    clearInterval(expiryTimer);
    clearTimeout(escalateFirst);
    clearInterval(escalateTimer);
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
