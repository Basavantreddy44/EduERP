import { HttpStatus, Injectable } from '@nestjs/common';
import { Channel, Language, NOTIFICATION_EVENTS, NotificationEventCode, PutPreferenceInput, renderTemplate } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { OutboxService, EVENTS } from '../../common/outbox.service';
import type { AuthContext } from '../../common/auth-context';
import { AppError, NotFound } from '../../common/problem';

export interface NotifyRequest {
  tenantId: string;
  userIds: string[];
  eventCode: NotificationEventCode;
  vars: Record<string, string | number | null | undefined>;
  entityType?: string;
  entityId?: string;
}

type Tpl = { tenantId: string | null; channel: string; language: string; subject: string | null; body: string };

/** Institution override beats platform default; requested language beats English. */
function pickTemplate(all: Tpl[], channel: Channel, lang: Language): Tpl | undefined {
  const order: [boolean, Language][] = [[true, lang], [false, lang], [true, 'en'], [false, 'en']];
  for (const [own, l] of order) {
    const t = all.find((x) => x.channel === channel && x.language === l && (own ? x.tenantId !== null : x.tenantId === null));
    if (t) return t;
  }
  return undefined;
}

/**
 * Notifications core. `notify` runs inside the caller's (tenant) transaction:
 *  - IN_APP: always written to the recipient's inbox.
 *  - EMAIL (and later SMS/WhatsApp/push): a delivery row plus an outbox event; the worker sends it.
 *    Opt-outs are honoured unless the event is mandatory; skipped deliveries are recorded with the reason.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly db: Db,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * An email to someone who is not a user (e.g. a parent). Recorded as an already-read notification of
   * the staff member who sent it (so it is traceable) with one email delivery, sent by the worker.
   */
  async emailExternal(tx: Tx, req: { tenantId: string; senderUserId: string; to: string; subject: string; body: string; eventCode: string; entityType?: string; entityId?: string }) {
    const n = await tx.notification.create({
      data: { tenantId: req.tenantId, userId: req.senderUserId, eventCode: req.eventCode, title: req.subject.slice(0, 200), message: `Sent to ${req.to}`, entityType: req.entityType ?? null, entityId: req.entityId ?? null, readAt: new Date() },
      select: { id: true },
    });
    const d = await tx.notificationDelivery.create({ data: { tenantId: req.tenantId, notificationId: n.id, channel: 'EMAIL', recipient: req.to, status: 'QUEUED' }, select: { id: true } });
    await this.outbox.add(tx, {
      tenantId: req.tenantId, eventType: EVENTS.NOTIFICATION_EMAIL, aggregateType: 'NOTIFICATION_DELIVERY', aggregateId: d.id,
      payload: { deliveryId: d.id, to: req.to, subject: req.subject.slice(0, 200), body: req.body, language: 'en' }, dedupeKey: `delivery:${d.id}`,
    });
    return d.id;
  }

  async notify(tx: Tx, req: NotifyRequest): Promise<{ notificationIds: string[] }> {
    const def = NOTIFICATION_EVENTS[req.eventCode];
    const userIds = [...new Set(req.userIds)];
    if (!userIds.length) return { notificationIds: [] };

    const [users, prefs, templates] = await Promise.all([
      tx.user.findMany({ where: { id: { in: userIds }, status: 'ACTIVE' }, select: { id: true, email: true, preferredLanguage: true } }),
      tx.notificationPreference.findMany({ where: { userId: { in: userIds }, eventCode: req.eventCode }, select: { userId: true, channel: true, isEnabled: true } }),
      tx.notificationTemplate.findMany({ where: { eventCode: req.eventCode, isActive: true }, select: { tenantId: true, channel: true, language: true, subject: true, body: true } }),
    ]);

    const ids: string[] = [];
    for (const user of users) {
      const lang: Language = user.preferredLanguage === 'kn' ? 'kn' : 'en';
      const inApp = pickTemplate(templates, 'IN_APP', lang);
      const title = renderTemplate(inApp?.subject ?? def.label, req.vars).slice(0, 200);
      const message = renderTemplate(inApp?.body ?? '', req.vars);
      const n = await tx.notification.create({
        data: { tenantId: req.tenantId, userId: user.id, eventCode: req.eventCode, title, message, entityType: req.entityType ?? null, entityId: req.entityId ?? null },
        select: { id: true },
      });
      ids.push(n.id);

      for (const channel of def.channels.filter((c) => c !== 'IN_APP') as Channel[]) {
        const optedOut = prefs.some((p) => p.userId === user.id && p.channel === channel && !p.isEnabled);
        const recipient = channel === 'EMAIL' ? user.email : null;
        const skip = !def.mandatory && optedOut ? 'opted-out' : !recipient ? `no-${channel.toLowerCase()}-address` : null;
        const delivery = await tx.notificationDelivery.create({
          data: { tenantId: req.tenantId, notificationId: n.id, channel, recipient: recipient ?? '-', status: skip ? 'SKIPPED' : 'QUEUED', errorMessage: skip },
          select: { id: true },
        });
        if (skip || channel !== 'EMAIL') continue;
        const tpl = pickTemplate(templates, 'EMAIL', lang);
        await this.outbox.add(tx, {
          tenantId: req.tenantId,
          eventType: EVENTS.NOTIFICATION_EMAIL,
          aggregateType: 'NOTIFICATION_DELIVERY',
          aggregateId: delivery.id,
          payload: { deliveryId: delivery.id, to: recipient, subject: renderTemplate(tpl?.subject ?? title, req.vars).slice(0, 200), body: renderTemplate(tpl?.body ?? message, req.vars), language: lang },
          dedupeKey: `delivery:${delivery.id}`,
        });
      }
    }
    return { notificationIds: ids };
  }

  // ───────────── Inbox (current user, current institution) ─────────────

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  inbox(auth: AuthContext, unreadOnly: boolean, limit: number) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const [items, unreadCount] = await Promise.all([
        tx.notification.findMany({
          where: { userId: auth.userId, ...(unreadOnly ? { readAt: null } : {}) },
          orderBy: { createdAt: 'desc' },
          take: limit,
          select: { id: true, eventCode: true, title: true, message: true, entityType: true, entityId: true, readAt: true, createdAt: true },
        }),
        tx.notification.count({ where: { userId: auth.userId, readAt: null } }),
      ]);
      return { items, unreadCount };
    });
  }

  async markRead(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const res = await tx.notification.updateMany({ where: { id, userId: auth.userId, readAt: null }, data: { readAt: new Date() } });
      if (!res.count && !(await tx.notification.findFirst({ where: { id, userId: auth.userId }, select: { id: true } }))) throw NotFound('Notification');
      return { id, read: true };
    });
  }

  markAllRead(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const res = await tx.notification.updateMany({ where: { userId: auth.userId, readAt: null }, data: { readAt: new Date() } });
      return { updated: res.count };
    });
  }

  preferences(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.notificationPreference.findMany({ where: { userId: auth.userId }, select: { eventCode: true, channel: true, isEnabled: true } });
      return Object.values(NOTIFICATION_EVENTS).flatMap((e) =>
        (e.channels as readonly Channel[])
          .filter((c) => c !== 'IN_APP')
          .map((channel) => ({
            eventCode: e.code,
            label: e.label,
            channel,
            mandatory: e.mandatory,
            isEnabled: e.mandatory ? true : rows.find((r) => r.eventCode === e.code && r.channel === channel)?.isEnabled ?? true,
          })),
      );
    });
  }

  async setPreference(input: PutPreferenceInput, auth: AuthContext) {
    const def = NOTIFICATION_EVENTS[input.eventCode];
    if (input.channel === 'IN_APP') throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'preference-in-app', 'The in-app inbox always receives notifications');
    if (!(def.channels as readonly string[]).includes(input.channel)) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'preference-channel', `${def.label} is not sent by ${input.channel}`);
    if (def.mandatory && !input.isEnabled) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'preference-mandatory', `${def.label} cannot be turned off`);
    return this.db.run(this.ctx(auth), (tx) =>
      tx.notificationPreference.upsert({
        where: { tenantId_userId_eventCode_channel: { tenantId: auth.tenantId!, userId: auth.userId, eventCode: input.eventCode, channel: input.channel } },
        update: { isEnabled: input.isEnabled },
        create: { tenantId: auth.tenantId!, userId: auth.userId, eventCode: input.eventCode, channel: input.channel, isEnabled: input.isEnabled },
        select: { eventCode: true, channel: true, isEnabled: true },
      }),
    );
  }
}

