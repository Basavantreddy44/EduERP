import { Module } from '@nestjs/common';
import { Db } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { OutboxService } from '../common/outbox.service';
import { ApprovalsService } from '../modules/approvals/approvals.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { EmailSender } from '../modules/notifications/email.sender';
import { AccountMailer, ApprovalNotifier, CONSUMERS, Consumer, EmailConsumer } from './consumers';
import { JobsRunner } from './jobs.runner';
import { NumberingService } from '../modules/numbering/numbering.service';
import { FeeBillingService } from '../modules/fees/billing.service';
import { FeeCollectionService } from '../modules/fees/collection.service';
import { FeeOnlineService } from '../modules/fees/online.service';
import { PAYMENT_GATEWAY, createGateway } from '../modules/fees/gateway';
import { LateFeeService } from '../modules/fees/late-fee.service';
import { TransportFleetService } from '../modules/transport/fleet.service';
import { ComplaintsService } from '../modules/engagement/complaints.service';
import { LibraryService } from '../modules/campuslife/library.service';
import { InventoryService } from '../modules/inventory/inventory.service';

/** Everything the background worker needs; no HTTP. */
@Module({
  providers: [
    Db,
    AuditService,
    OutboxService,
    ApprovalsService,
    NotificationsService,
    EmailSender,
    ApprovalNotifier,
    EmailConsumer,
    AccountMailer,
    {
      provide: CONSUMERS,
      useFactory: (a: ApprovalNotifier, e: EmailConsumer, m: AccountMailer): Consumer[] => [a, e, m],
      inject: [ApprovalNotifier, EmailConsumer, AccountMailer],
    },
    JobsRunner,
    // Online payment re-check (missed webhooks / closed browsers).
    NumberingService,
    FeeBillingService,
    FeeCollectionService,
    FeeOnlineService,
    { provide: PAYMENT_GATEWAY, useFactory: createGateway },
    LateFeeService,
    // Transport: bus documents and driving licences expiring (30 / 15 / 7 days).
    TransportFleetService,
    ComplaintsService,
    // Library: overdue reminders and expired holds (daily, safe to repeat).
    LibraryService,
    // Inventory: low-stock notices to store keepers (once a day per item and store).
    InventoryService,
  ],
  exports: [JobsRunner, Db, FeeOnlineService, LateFeeService, TransportFleetService, ComplaintsService, LibraryService, InventoryService],
})
export class WorkerModule {}
