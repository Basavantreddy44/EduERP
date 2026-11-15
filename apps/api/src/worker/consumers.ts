import { Injectable } from '@nestjs/common';
import type { OutboxEvent } from '@eduerp/db';
import type { Tx } from '../common/prisma.service';
import { EVENTS } from '../common/outbox.service';
import { ApprovalsService, entityLabel } from '../modules/approvals/approvals.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { EmailSender } from '../modules/notifications/email.sender';
import { ACCOUNT_EVENTS, AccountLinksService, INVITE_TTL_DAYS, RESET_TTL_MINUTES } from '../modules/auth/account-links.service';
import { config } from '../config';

/**
 * A consumer handles some event types. Each consumer has its own pg-boss queue (same name), so a slow
 * or failing consumer never blocks the others. `handle` runs in a tenant transaction together with
 * the consumer's idempotency marker: its database effects happen exactly once.
 */
export interface Consumer {
  name: string;
  events: string[];
  handle(tx: Tx, event: OutboxEvent): Promise<void>;
  /** Called once the retries are exhausted (dead letter). */
  onFailed?(tx: Tx, event: OutboxEvent, error: string): Promise<void>;
}

export const CONSUMERS = Symbol('Consumers');
export const DEAD_LETTER_QUEUE = 'dead-letter';

/** Queue names created by `jobs:setup` (one per consumer). */
export const CONSUMER_QUEUES = ['approvals-notifier', 'email-sender', 'account-mailer'] as const;

/** Tells approvers when a request reaches their level, and the requester when it is decided. */
@Injectable()
export class ApprovalNotifier implements Consumer {
  readonly name = 'approvals-notifier';
  readonly events = [EVENTS.APPROVAL_PENDING, EVENTS.APPROVAL_COMPLETED];

  constructor(
    private readonly approvals: ApprovalsService,
    private readonly notifications: NotificationsService,
  ) {}

  async handle(tx: Tx, e: OutboxEvent): Promise<void> {
    if (!e.tenantId) return; // approval events always belong to an institution
    const tenantId = e.tenantId;
    const p = e.payload as { requestId: string; levelNo?: number; decision?: string; remarks?: string | null };
    const r = await tx.approvalRequest.findUnique({ where: { id: p.requestId }, select: { entityType: true, summary: true, requestedBy: true } });
    if (!r) return;
    const vars = { entityLabel: entityLabel(r.entityType), summary: r.summary ?? '' };

    if (e.eventType === EVENTS.APPROVAL_PENDING) {
      const requester = await tx.user.findUnique({ where: { id: r.requestedBy }, select: { fullName: true } });
      const userIds = await this.approvals.approversFor(tx, p.requestId, p.levelNo ?? 1);
      await this.notifications.notify(tx, { tenantId, userIds, eventCode: 'APPROVAL_PENDING', vars: { ...vars, requesterName: requester?.fullName ?? '' }, entityType: 'APPROVAL_REQUEST', entityId: p.requestId });
    } else if (p.decision === 'APPROVED' || p.decision === 'REJECTED') {
      await this.notifications.notify(tx, {
        tenantId,
        userIds: [r.requestedBy],
        eventCode: p.decision === 'APPROVED' ? 'APPROVAL_APPROVED' : 'APPROVAL_REJECTED',
        vars: { ...vars, remarks: p.remarks ?? '' },
        entityType: 'APPROVAL_REQUEST',
        entityId: p.requestId,
      });
    }
  }
}

const ACCOUNT_MAIL = {
  RESET: {
    en: (name: string, link: string) => ({
      subject: 'Reset your EduERP password',
      text: `Hello ${name},\n\nWe received a request to reset your EduERP password. Open this link within ${RESET_TTL_MINUTES} minutes to choose a new one:\n\n${link}\n\nIf you did not ask for this, you can ignore this email; your password stays the same.`,
    }),
    kn: (name: string, link: string) => ({
      subject: 'ನಿಮ್ಮ EduERP ಪಾಸ್‌ವರ್ಡ್ ಮರುಹೊಂದಿಸಿ',
      text: `ನಮಸ್ಕಾರ ${name},\n\nನಿಮ್ಮ EduERP ಪಾಸ್‌ವರ್ಡ್ ಮರುಹೊಂದಿಸಲು ವಿನಂತಿ ಬಂದಿದೆ. ಹೊಸ ಪಾಸ್‌ವರ್ಡ್ ಆಯ್ಕೆ ಮಾಡಲು ${RESET_TTL_MINUTES} ನಿಮಿಷಗಳ ಒಳಗೆ ಈ ಲಿಂಕ್ ತೆರೆಯಿರಿ:\n\n${link}\n\nನೀವು ಇದನ್ನು ಕೇಳದಿದ್ದರೆ, ಈ ಇಮೇಲ್ ಅನ್ನು ನಿರ್ಲಕ್ಷಿಸಿ; ನಿಮ್ಮ ಪಾಸ್‌ವರ್ಡ್ ಬದಲಾಗುವುದಿಲ್ಲ.`,
    }),
  },
  INVITE: {
    en: (name: string, link: string, institution: string) => ({
      subject: `You're invited to ${institution} on EduERP`,
      text: `Hello ${name},\n\n${institution} has given you access to EduERP. Open this link within ${INVITE_TTL_DAYS} days to set your password:\n\n${link}`,
    }),
    kn: (name: string, link: string, institution: string) => ({
      subject: `EduERP ನಲ್ಲಿ ${institution} ಗೆ ನಿಮಗೆ ಆಹ್ವಾನ`,
      text: `ನಮಸ್ಕಾರ ${name},\n\n${institution} ನಿಮಗೆ EduERP ಪ್ರವೇಶ ನೀಡಿದೆ. ನಿಮ್ಮ ಪಾಸ್‌ವರ್ಡ್ ಹೊಂದಿಸಲು ${INVITE_TTL_DAYS} ದಿನಗಳ ಒಳಗೆ ಈ ಲಿಂಕ್ ತೆರೆಯಿರಿ:\n\n${link}`,
    }),
  },
  ADDED: {
    en: (name: string, link: string, institution: string) => ({
      subject: `You now have access to ${institution}`,
      text: `Hello ${name},\n\n${institution} has given you access to EduERP. Sign in with your existing password:\n\n${link}`,
    }),
    kn: (name: string, link: string, institution: string) => ({
      subject: `${institution} ಗೆ ನಿಮಗೆ ಪ್ರವೇಶ ದೊರೆತಿದೆ`,
      text: `ನಮಸ್ಕಾರ ${name},\n\n${institution} ನಿಮಗೆ EduERP ಪ್ರವೇಶ ನೀಡಿದೆ. ನಿಮ್ಮ ಈಗಿನ ಪಾಸ್‌ವರ್ಡ್‌ನೊಂದಿಗೆ ಲಾಗಿನ್ ಮಾಡಿ:\n\n${link}`,
    }),
  },
};

/** Account emails: invite (set password) and password reset. Creates the one-time link and sends it. */
@Injectable()
export class AccountMailer implements Consumer {
  readonly name = 'account-mailer';
  readonly events = [ACCOUNT_EVENTS.PASSWORD_RESET, ACCOUNT_EVENTS.INVITE];

  constructor(private readonly sender: EmailSender) {}

  async handle(tx: Tx, e: OutboxEvent): Promise<void> {
    const p = e.payload as { userId: string };
    const user = await tx.user.findUnique({ where: { id: p.userId }, select: { id: true, email: true, fullName: true, preferredLanguage: true, passwordHash: true, status: true } });
    if (!user?.email || user.status === 'DISABLED') return;
    if (!this.sender.configured) throw new Error('email-not-configured');
    const lang = user.preferredLanguage === 'kn' ? 'kn' : 'en';

    let mail: { subject: string; text: string };
    if (e.eventType === ACCOUNT_EVENTS.PASSWORD_RESET) {
      mail = ACCOUNT_MAIL.RESET[lang](user.fullName, await AccountLinksService.issue(tx, user.id, null, 'RESET'));
    } else {
      const tenant = e.tenantId ? await tx.tenant.findUnique({ where: { id: e.tenantId }, select: { name: true } }) : null;
      const institution = tenant?.name ?? 'Your institution';
      mail = user.passwordHash
        ? ACCOUNT_MAIL.ADDED[lang](user.fullName, `${config().WEB_ORIGIN}/login`, institution)
        : ACCOUNT_MAIL.INVITE[lang](user.fullName, await AccountLinksService.issue(tx, user.id, e.tenantId, 'INVITE'), institution);
    }
    await this.sender.send({ to: user.email, subject: mail.subject, text: mail.text });
  }
}

/** Sends queued email deliveries and records the outcome on the delivery row. */
@Injectable()
export class EmailConsumer implements Consumer {
  readonly name = 'email-sender';
  readonly events = [EVENTS.NOTIFICATION_EMAIL];

  constructor(private readonly sender: EmailSender) {}

  async handle(tx: Tx, e: OutboxEvent): Promise<void> {
    const p = e.payload as { deliveryId: string; to: string; subject: string; body: string };
    const d = await tx.notificationDelivery.findUnique({ where: { id: p.deliveryId }, select: { status: true, attempts: true } });
    if (!d || d.status !== 'QUEUED') return; // already handled
    if (!this.sender.configured) {
      await tx.notificationDelivery.update({ where: { id: p.deliveryId }, data: { status: 'SKIPPED', errorMessage: 'email-not-configured' } });
      return;
    }
    const sent = await this.sender.send({ to: p.to, subject: p.subject, text: p.body });
    await tx.notificationDelivery.update({
      where: { id: p.deliveryId },
      data: { status: 'SENT', provider: sent.provider, providerMsgId: sent.messageId.slice(0, 200), sentAt: new Date(), attempts: d.attempts + 1, errorMessage: null },
    });
  }

  async onFailed(tx: Tx, e: OutboxEvent, error: string): Promise<void> {
    const p = e.payload as { deliveryId: string };
    await tx.notificationDelivery.updateMany({ where: { id: p.deliveryId, status: 'QUEUED' }, data: { status: 'FAILED', errorMessage: error.slice(0, 300) } });
  }
}
