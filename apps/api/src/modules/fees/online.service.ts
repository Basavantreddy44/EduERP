import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '@eduerp/db';
import { CreatePayLinkInput, PERMISSIONS, PermissionCode, RequestRefundInput, formatINR, fromPaise, toPaise } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, CampusScope, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { config } from '../../config';
import { NumberingService } from '../numbering/numbering.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { NotificationsService } from '../notifications/notifications.service';
import { todayIST } from '../students/student-records';
import { ensureChart, post } from './ledger';
import { FeeCollectionService } from './collection.service';
import { GatewayError, GatewayPayment, PAYMENT_GATEWAY, PaymentGateway, SimulatedGateway } from './gateway';

const paise = (d: Prisma.Decimal | string | number) => toPaise(d.toString());
const iso = (d: Date) => d.toISOString().slice(0, 10);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const REFUND_ACCOUNT: Record<string, string> = { ONLINE: 'GATEWAY_CLEARING', CASH: 'CASH', BANK_TRANSFER: 'BANK', CHEQUE: 'BANK' };
const LINE_ORDER: Record<string, number> = { ACADEMIC: 0, ADMISSION: 1, EXAM: 2, TRANSPORT: 3, HOSTEL: 3, MESS: 3, OTHER: 4, FINE: 6, DEPOSIT: 9 };
type StudentLite = { id: string; tenantId: string; campusId: string; firstName: string; lastName: string | null; admissionNo: string };

/**
 * Online payment (M2.4, W-04): payment links → gateway order → checkout → signature-verified
 * confirmation, webhook or re-check → one receipt per captured payment (idempotent everywhere).
 * Refunds need approval; online refunds go back through the gateway; every refund is posted.
 */
@Injectable()
export class FeeOnlineService implements OnModuleInit {
  private readonly log = new Logger('FeeOnline');
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly approvals: ApprovalsService,
    private readonly notifications: NotificationsService,
    private readonly collection: FeeCollectionService,
    @Inject(PAYMENT_GATEWAY) readonly gateway: PaymentGateway,
  ) {}

  onModuleInit() {
    this.approvals.onComplete('REFUND', (tx, d) => this.refundDecided(tx, d));
  }

  private scope(auth: AuthContext, code: PermissionCode): CampusScope {
    return scopeFor(auth, code)!;
  }
  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  private requireGateway() {
    if (this.gateway.mode === 'off') throw Conflict('gateway-off', 'Online payment is not set up for this installation yet');
  }

  /** Open bills (chosen ones, or all) and what is still due on them. */
  private async openBills(tx: Tx, studentId: string, invoiceIds?: string[]) {
    const bills = await tx.feeInvoice.findMany({
      where: { studentId, status: { in: ['UNPAID', 'PARTIAL'] }, ...(invoiceIds?.length ? { id: { in: invoiceIds } } : {}) },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, invoiceNo: true, description: true, dueDate: true, balanceAmount: true },
    });
    return { bills, duePaise: bills.reduce((a, b) => a + paise(b.balanceAmount), 0) };
  }

  // ───────────── Payment links (staff) ─────────────

  async createLink(input: CreatePayLinkInput, auth: AuthContext, client: ClientInfo) {
    this.requireGateway();
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.student.findUnique({ where: { id: input.studentId }, select: { id: true, tenantId: true, campusId: true, firstName: true, lastName: true, admissionNo: true } });
      if (!s || !canAccessCampus(this.scope(auth, PERMISSIONS.FEE_COLLECT), s.campusId)) throw NotFound('Student');
      const { bills, duePaise } = await this.openBills(tx, s.id, input.invoiceIds);
      if (!duePaise) throw Conflict('nothing-due', 'Nothing is due from this student');
      const token = randomBytes(24).toString('base64url');
      const link = await tx.paymentLink.create({
        data: {
          tenantId: s.tenantId, campusId: s.campusId, studentId: s.id, tokenHash: sha(token), invoiceIds: bills.map((b) => b.id), amount: fromPaise(duePaise),
          expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000), createdBy: auth.userId,
        },
      });
      await tx.publicPaymentRoute.create({ data: { key: `link:${link.tokenHash}`, tenantId: s.tenantId } });
      const url = `${config().WEB_ORIGIN}/pay/${token}`;
      let sentTo: string | null = null;
      if (input.sendEmail) {
        const main = await tx.studentGuardian.findFirst({ where: { studentId: s.id, isPrimary: true }, select: { guardian: { select: { name: true, email: true } } } });
        if (!main?.guardian.email) throw Conflict('no-parent-email', 'The main contact has no email address. Copy the link and send it another way.');
        const school = (await tx.tenant.findUnique({ where: { id: s.tenantId }, select: { name: true } }))?.name ?? 'School';
        await this.notifications.emailExternal(tx, {
          tenantId: s.tenantId, senderUserId: auth.userId, to: main.guardian.email, eventCode: 'PAYMENT_LINK', entityType: 'PAYMENT_LINK', entityId: link.id,
          subject: `${school}: fee payment for ${s.firstName} ${s.lastName ?? ''}`.trim(),
          body: `Dear ${main.guardian.name},\n\nFees of ${formatINR(duePaise)} are due for ${s.firstName} ${s.lastName ?? ''} (${s.admissionNo}).\n\nPay securely online (UPI, card or net banking):\n${url}\n\nThis link works until ${link.expiresAt.toDateString()}. A receipt is shown as soon as the payment is confirmed.\n\n${school}`,
        });
        sentTo = main.guardian.email;
        await tx.paymentLink.update({ where: { id: link.id }, data: { sentTo } });
      }
      await this.audit.log(tx, { tenantId: s.tenantId, userId: auth.userId, campusId: s.campusId, action: 'CREATE', entityType: 'PAYMENT_LINK', entityId: link.id, newValues: { amount: link.amount, bills: bills.length, sentTo, expiresAt: link.expiresAt } }, client);
      return { id: link.id, url, amount: link.amount, expiresAt: link.expiresAt, sentTo };
    });
  }

  links(studentId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.student.findUnique({ where: { id: studentId }, select: { campusId: true } });
      if (!s || !canAccessCampus(this.scope(auth, PERMISSIONS.FEE_READ), s.campusId)) throw NotFound('Student');
      const rows = await tx.paymentLink.findMany({ where: { studentId }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, amount: true, status: true, expiresAt: true, sentTo: true, createdAt: true, paidPaymentId: true } });
      const now = new Date();
      return rows.map((r) => ({ ...r, status: r.status === 'ACTIVE' && r.expiresAt < now ? 'EXPIRED' : r.status }));
    });
  }

  async cancelLink(id: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const l = await tx.paymentLink.findUnique({ where: { id } });
      if (!l || !canAccessCampus(this.scope(auth, PERMISSIONS.FEE_COLLECT), l.campusId)) throw NotFound('Payment link');
      if (l.status !== 'ACTIVE') throw Conflict('link-closed', `This link is already ${l.status.toLowerCase()}`);
      const c = await tx.paymentLink.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.log(tx, { tenantId: l.tenantId, userId: auth.userId, campusId: l.campusId, action: 'UPDATE', entityType: 'PAYMENT_LINK', entityId: id, oldValues: { status: 'ACTIVE' }, newValues: { status: 'CANCELLED' } }, client);
      return c;
    });
  }

  // ───────────── Public pay page ─────────────

  /** Finds the institution of a public token / order and runs `work` in its tenant context. */
  private async routed<T>(key: string, work: (tx: Tx, tenantId: string) => Promise<T>): Promise<T> {
    const route = await this.db.run({}, (tx) => tx.publicPaymentRoute.findUnique({ where: { key } }));
    if (!route) throw NotFound('Payment link');
    return this.db.run({ tenantId: route.tenantId }, (tx) => work(tx, route.tenantId));
  }

  private async linkByToken(tx: Tx, token: string) {
    const l = await tx.paymentLink.findUnique({ where: { tokenHash: sha(token) }, include: { student: { select: { id: true, tenantId: true, campusId: true, firstName: true, lastName: true, admissionNo: true } } } });
    if (!l) throw NotFound('Payment link');
    return l;
  }

  async publicView(token: string) {
    return this.routed(`link:${sha(token)}`, async (tx, tenantId) => {
      const l = await this.linkByToken(tx, token);
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true, nameLocal: true, slug: true, logoFileId: true } });
      const campus = await tx.campus.findUnique({ where: { id: l.campusId }, select: { name: true, city: true } });
      const { bills, duePaise } = await this.openBills(tx, l.studentId, l.invoiceIds);
      const paid = l.status === 'PAID' ? await tx.payment.findUnique({ where: { id: l.paidPaymentId! }, select: { id: true, receiptNo: true, amount: true, paymentDate: true } }) : null;
      const status = l.status === 'ACTIVE' && l.expiresAt < new Date() ? 'EXPIRED' : l.status === 'ACTIVE' && !duePaise ? 'NOTHING_DUE' : l.status;
      return {
        status, school: tenant?.name ?? '', schoolLocal: tenant?.nameLocal ?? null,
        brand: tenant ? { slug: tenant.slug, logoVersion: tenant.logoFileId ? tenant.logoFileId.slice(0, 8) : null } : null,
        campus: campus ? `${campus.name}${campus.city ? `, ${campus.city}` : ''}` : '',
        student: { name: `${l.student.firstName} ${l.student.lastName ?? ''}`.trim(), admissionNo: l.student.admissionNo },
        bills: bills.map((b) => ({ invoiceNo: b.invoiceNo, description: b.description, dueDate: b.dueDate, balance: b.balanceAmount })),
        amount: fromPaise(duePaise), expiresAt: l.expiresAt, gateway: this.gateway.mode, receipt: paid,
      };
    });
  }

  async publicOrder(token: string) {
    this.requireGateway();
    return this.routed(`link:${sha(token)}`, async (tx) => {
      const l = await this.linkByToken(tx, token);
      if (l.status !== 'ACTIVE' || l.expiresAt < new Date()) throw Conflict('link-closed', 'This payment link can no longer be used');
      const { duePaise } = await this.openBills(tx, l.studentId, l.invoiceIds);
      if (!duePaise) throw Conflict('nothing-due', 'Nothing is due on this link any more');
      let order: { id: string; amountPaise: number };
      try {
        order = await this.gateway.createOrder(duePaise, `link-${l.id.slice(0, 8)}`, { student: l.student.admissionNo, link: l.id });
      } catch (e) {
        throw new AppError(HttpStatus.BAD_GATEWAY, 'gateway-error', `The payment gateway did not respond: ${(e as Error).message}. Please try again.`);
      }
      await tx.onlineOrder.create({ data: { tenantId: l.tenantId, campusId: l.campusId, linkId: l.id, studentId: l.studentId, gatewayOrderId: order.id, amount: fromPaise(order.amountPaise) } });
      await tx.publicPaymentRoute.create({ data: { key: `order:${order.id}`, tenantId: l.tenantId } });
      const main = await tx.studentGuardian.findFirst({ where: { studentId: l.studentId, isPrimary: true }, select: { guardian: { select: { name: true, email: true, phone: true } } } });
      return {
        orderId: order.id, amountPaise: order.amountPaise, currency: 'INR', keyId: this.gateway.keyId, gateway: this.gateway.mode,
        description: `Fees · ${l.student.firstName} ${l.student.lastName ?? ''} (${l.student.admissionNo})`.trim(),
        prefill: { name: main?.guardian.name ?? '', email: main?.guardian.email ?? '', contact: main?.guardian.phone ?? '' },
      };
    });
  }

  /** Simulated gateway only: what the checkout window would return. */
  async publicSimulate(token: string, orderId: string, outcome: 'success' | 'failure') {
    if (!(this.gateway instanceof SimulatedGateway)) throw NotFound('Simulator');
    await this.routed(`link:${sha(token)}`, async (tx) => {
      const l = await this.linkByToken(tx, token);
      if (!(await tx.onlineOrder.findFirst({ where: { linkId: l.id, gatewayOrderId: orderId }, select: { id: true } }))) throw NotFound('Order');
    });
    const r = (this.gateway as SimulatedGateway).pay(orderId, outcome);
    return { orderId, paymentId: r.payment.id, signature: r.signature, error: r.payment.error };
  }

  /** Browser confirmation after checkout. The signature proves the gateway issued this payment for this order. */
  async publicConfirm(token: string, orderId: string, paymentId: string, signature: string) {
    if (!this.gateway.verifyCheckout(orderId, paymentId, signature)) {
      this.log.warn(`Rejected checkout confirmation with a bad signature for order ${orderId}`);
      throw new AppError(HttpStatus.BAD_REQUEST, 'signature-invalid', 'The payment could not be verified');
    }
    return this.routed(`link:${sha(token)}`, async (tx) => {
      const l = await this.linkByToken(tx, token);
      const order = await tx.onlineOrder.findFirst({ where: { linkId: l.id, gatewayOrderId: orderId } });
      if (!order) throw NotFound('Order');
      const gp = await this.fetchPayment(paymentId);
      const p = await this.settle(tx, order.id, gp, 'checkout');
      return p ? { status: 'PAID', receiptId: p.id, receiptNo: p.receiptNo, amount: p.amount } : { status: 'PENDING', message: gp.error ?? 'The payment is not complete yet' };
    });
  }

  private async fetchPayment(paymentId: string) {
    try {
      return await this.gateway.fetchPayment(paymentId);
    } catch (e) {
      throw new AppError(HttpStatus.BAD_GATEWAY, 'gateway-error', `The payment gateway did not respond: ${(e as Error).message}`);
    }
  }

  /**
   * Turns a captured gateway payment into exactly one receipt (locks the order row; a second caller —
   * webhook, re-check or browser — finds it PAID and gets the same receipt). Not captured → no receipt.
   */
  private async settle(tx: Tx, orderId: string, gp: GatewayPayment, source: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM online_orders WHERE id = ${orderId}::uuid FOR UPDATE`;
    if (!rows.length) return null;
    const order = await tx.onlineOrder.findUniqueOrThrow({ where: { id: orderId }, include: { link: true } });
    if (gp.orderId !== order.gatewayOrderId) throw new AppError(HttpStatus.BAD_REQUEST, 'payment-mismatch', 'This payment belongs to another order');
    if (order.status === 'PAID') return tx.payment.findUnique({ where: { id: order.paymentId! } });
    if (gp.status === 'authorized') gp = await this.gateway.capture(gp.id, gp.amountPaise);
    if (gp.status !== 'captured') {
      if (gp.status === 'failed') await tx.onlineOrder.update({ where: { id: orderId }, data: { failureReason: (gp.error ?? 'Payment failed').slice(0, 300), lastCheckedAt: new Date() } });
      return null;
    }
    const s = (await tx.student.findUniqueOrThrow({ where: { id: order.studentId }, select: { id: true, tenantId: true, campusId: true, firstName: true, lastName: true, admissionNo: true } })) as StudentLite;
    const main = await tx.studentGuardian.findFirst({ where: { studentId: s.id, isPrimary: true }, select: { guardian: { select: { name: true } } } });
    const p = await this.collection.record(tx, s, {
      amountPaise: gp.amountPaise, mode: 'ONLINE', date: iso(todayIST()), payerName: main?.guardian.name ?? `Parent of ${s.firstName}`, referenceNo: gp.id, chequeDate: null, bankName: null,
      notes: `Online · ${order.gatewayOrderId}${gp.method ? ` · ${gp.method}` : ''}`, invoiceIds: order.link.invoiceIds, sessionId: null, idempotencyKey: `gw:${gp.id}`, userId: null, allowExcess: true,
    });
    await tx.onlineOrder.update({ where: { id: orderId }, data: { status: 'PAID', gatewayPaymentId: gp.id, paymentId: p.id, lastCheckedAt: new Date(), failureReason: null } });
    await tx.paymentLink.update({ where: { id: order.linkId }, data: { status: 'PAID', paidPaymentId: p.id } });
    await this.audit.log(tx, { tenantId: s.tenantId, userId: null, campusId: s.campusId, action: 'CREATE', entityType: 'PAYMENT', entityId: p.id, newValues: { receiptNo: p.receiptNo, amount: p.amount, mode: 'ONLINE', gatewayPaymentId: gp.id, source } });
    return p;
  }

  // ───────────── Webhook & re-check ─────────────

  /** Gateway webhook: logged as received; a bad signature or a repeated event changes nothing. */
  async webhook(rawBody: Buffer, signature: string | undefined, eventId: string | undefined) {
    const valid = !!signature && this.gateway.verifyWebhook(rawBody, signature);
    let payload: { event?: string; payload?: { payment?: { entity?: { id: string; order_id: string; amount: number; status: GatewayPayment['status']; method?: string; error_description?: string } } } } = {};
    try { payload = JSON.parse(rawBody.toString('utf8')); } catch { /* logged below as received */ }
    const id = await this.db.run({}, async (tx) => {
      if (eventId && (await tx.paymentWebhookEvent.findFirst({ where: { provider: 'RAZORPAY', eventId }, select: { id: true } }))) return null;
      return (await tx.paymentWebhookEvent.create({ data: { provider: 'RAZORPAY', eventId: eventId ?? null, eventType: payload.event?.slice(0, 60) ?? null, payload: payload as Prisma.InputJsonValue, signatureValid: valid } })).id;
    });
    if (!id) return { received: true, duplicate: true };
    if (!valid) throw new AppError(HttpStatus.BAD_REQUEST, 'signature-invalid', 'Invalid webhook signature');
    const pe = payload.payload?.payment?.entity;
    let result = 'ignored';
    let tenantId: string | null = null;
    if (pe?.order_id && ['payment.captured', 'payment.authorized', 'order.paid', 'payment.failed'].includes(payload.event ?? '')) {
      try {
        result = await this.routed(`order:${pe.order_id}`, async (tx, t) => {
          tenantId = t;
          const order = await tx.onlineOrder.findUnique({ where: { gatewayOrderId: pe.order_id } });
          if (!order) return 'unknown-order';
          const p = await this.settle(tx, order.id, { id: pe.id, orderId: pe.order_id, amountPaise: pe.amount, status: pe.status, method: pe.method ?? null, error: pe.error_description ?? null }, 'webhook');
          return p ? `receipt ${p.receiptNo}` : `not captured (${pe.status})`;
        });
      } catch (e) {
        result = `error: ${(e as Error).message}`.slice(0, 300);
      }
    }
    await this.db.run({}, (tx) => tx.paymentWebhookEvent.update({ where: { id }, data: { processedAt: new Date(), result, tenantId } }));
    return { received: true };
  }

  /** Re-checks unfinished orders of one institution with the gateway (missed webhooks, closed browsers). */
  async reconcileTenant(tenantId: string) {
    const out = { checked: 0, paid: 0, abandoned: 0 };
    const orders = await this.db.run({ tenantId }, (tx) =>
      tx.onlineOrder.findMany({ where: { status: 'CREATED', createdAt: { lt: new Date(Date.now() - 60_000) } }, orderBy: { createdAt: 'asc' }, take: 100 }),
    );
    for (const o of orders) {
      out.checked += 1;
      try {
        const payments = await this.gateway.fetchOrderPayments(o.gatewayOrderId);
        const captured = payments.find((p) => p.status === 'captured' || p.status === 'authorized');
        await this.db.run({ tenantId }, async (tx) => {
          if (captured && (await this.settle(tx, o.id, captured, 'recheck'))) out.paid += 1;
          else if (o.createdAt < new Date(Date.now() - 3 * 86_400_000)) {
            await tx.onlineOrder.update({ where: { id: o.id }, data: { status: 'FAILED', failureReason: 'Not paid within 3 days', lastCheckedAt: new Date() } });
            out.abandoned += 1;
          } else await tx.onlineOrder.update({ where: { id: o.id }, data: { lastCheckedAt: new Date() } });
        });
      } catch (e) {
        if (!(e instanceof GatewayError)) throw e;
        this.log.warn(`Re-check of ${o.gatewayOrderId} failed: ${e.message}`);
      }
    }
    return out;
  }

  /** All institutions with recent orders (worker). */
  async reconcileAll() {
    if (this.gateway.mode === 'off') return [];
    const tenants = await this.db.run({}, (tx) =>
      tx.publicPaymentRoute.findMany({ where: { key: { startsWith: 'order:' }, createdAt: { gt: new Date(Date.now() - 4 * 86_400_000) } }, distinct: ['tenantId'], select: { tenantId: true } }),
    );
    const results = [];
    for (const t of tenants) results.push({ tenantId: t.tenantId, ...(await this.reconcileTenant(t.tenantId)) });
    return results;
  }

  async reconcileMine(auth: AuthContext) {
    return this.reconcileTenant(auth.tenantId!);
  }

  // ───────────── Refunds ─────────────

  async requestRefund(paymentId: string, input: RequestRefundInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM payments WHERE id = ${paymentId}::uuid FOR UPDATE`;
      const p = rows.length ? await tx.payment.findUnique({ where: { id: paymentId }, include: { student: { select: { firstName: true, lastName: true, admissionNo: true } } } }) : null;
      if (!p || !canAccessCampus(this.scope(auth, PERMISSIONS.FEE_COLLECT), p.campusId)) throw NotFound('Receipt');
      if (p.status !== 'SUCCESS') throw Conflict('receipt-final', `This receipt is ${p.status.toLowerCase()}`);
      const mode = p.paymentMode === 'ONLINE' ? 'ONLINE' : input.refundMode;
      if (!mode) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'validation-failed', 'Choose how the money goes back', [{ field: 'refundMode', message: 'Choose how the money goes back' }]);
      const taken = await tx.refund.aggregate({ where: { paymentId, status: { in: ['PENDING', 'PAID'] } }, _sum: { amount: true } });
      const left = paise(p.amount) - paise(taken._sum.amount ?? 0);
      if (toPaise(input.amount) > left) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'more-than-paid', `At most ${formatINR(left)} can be refunded on this receipt`, [{ field: 'amount', message: `At most ${formatINR(left)}` }]);
      const r = await tx.refund.create({
        data: { tenantId: p.tenantId, campusId: p.campusId, paymentId, studentId: p.studentId, amount: input.amount, reason: input.reason, refundMode: mode, createdBy: auth.userId },
      });
      const req = await this.approvals.submit(tx, {
        tenantId: p.tenantId, requestedBy: auth.userId, entityType: 'REFUND', entityId: r.id, campusId: p.campusId, amount: toPaise(input.amount) / 100,
        summary: `Refund ${formatINR(toPaise(input.amount))} of receipt ${p.receiptNo} (${p.student.firstName} ${p.student.lastName ?? ''}, ${p.student.admissionNo}) by ${mode.toLowerCase().replace('_', ' ')}: ${input.reason}`,
      }, client);
      if (!req) throw new AppError(HttpStatus.CONFLICT, 'approval-rule-missing', 'No one is set up to approve refunds yet. Ask the administrator to add an approval rule for refunds (Approvals → Rules).');
      const saved = await tx.refund.update({ where: { id: r.id }, data: { approvalRequestId: req.id } });
      await this.audit.log(tx, { tenantId: p.tenantId, userId: auth.userId, campusId: p.campusId, action: 'CREATE', entityType: 'REFUND', entityId: r.id, newValues: saved }, client);
      return saved;
    });
  }

  /**
   * Approval decided (same transaction). Approved: online refunds go back through the gateway first
   * (a gateway error marks the refund FAILED and changes nothing else); then the refunded amount is
   * due again on the receipt's bills (deposits and fines first) and posted Dr Receivable / Cr money.
   */
  private async refundDecided(tx: Tx, d: { entityId: string; decision: 'APPROVED' | 'REJECTED' | 'CANCELLED'; userId: string; tenantId: string }) {
    const r = await tx.refund.findUnique({ where: { id: d.entityId }, include: { payment: { include: { allocations: { include: { item: { include: { feeHead: { select: { feeType: true } } } }, invoice: { select: { dueDate: true } } } } } } } });
    if (!r || r.status !== 'PENDING') return;
    if (d.decision !== 'APPROVED') {
      await tx.refund.update({ where: { id: r.id }, data: { status: d.decision === 'REJECTED' ? 'REJECTED' : 'CANCELLED', decidedAt: new Date() } });
      return;
    }
    const amount = paise(r.amount);
    let gatewayRefundId: string | null = null;
    if (r.refundMode === 'ONLINE') {
      try {
        gatewayRefundId = (await this.gateway.refund(r.payment.referenceNo!, amount, { refund: r.id })).id;
      } catch (e) {
        await tx.refund.update({ where: { id: r.id }, data: { status: 'FAILED', failureReason: (e as Error).message.slice(0, 300), decidedAt: new Date() } });
        return;
      }
    }
    // What earlier refunds already reopened, so the same rupee is not reopened twice.
    const before = await tx.refund.aggregate({ where: { paymentId: r.paymentId, status: 'PAID' }, _sum: { amount: true } });
    let skip = paise(before._sum.amount ?? 0);
    let left = amount;
    const allocs = [...r.payment.allocations].sort((a, b) => b.invoice.dueDate.getTime() - a.invoice.dueDate.getTime() || (LINE_ORDER[b.item.feeHead.feeType] ?? 5) - (LINE_ORDER[a.item.feeHead.feeType] ?? 5));
    const moves: { itemId: string; invoiceId: string; paise: number }[] = [];
    for (const a of allocs) {
      let avail = paise(a.amount);
      const used = Math.min(skip, avail);
      skip -= used;
      avail -= used;
      const take = Math.min(avail, left);
      if (take > 0) { moves.push({ itemId: a.invoiceItemId, invoiceId: a.invoiceId, paise: take }); left -= take; }
      if (left <= 0) break;
    }
    const invoices = await tx.feeInvoice.findMany({ where: { id: { in: [...new Set(moves.map((m) => m.invoiceId))] } }, include: { items: true } });
    for (const inv of invoices) {
      const mine = moves.filter((m) => m.invoiceId === inv.id);
      for (const m of mine) {
        const it = inv.items.find((i) => i.id === m.itemId)!;
        await tx.feeInvoiceItem.update({ where: { id: it.id }, data: { paidAmount: fromPaise(paise(it.paidAmount) - m.paise) } });
      }
      const paid = paise(inv.paidAmount) - mine.reduce((a, m) => a + m.paise, 0);
      const net = paise(inv.netAmount);
      await tx.feeInvoice.update({ where: { id: inv.id }, data: { paidAmount: fromPaise(paid), balanceAmount: fromPaise(net - paid), status: paid <= 0 ? 'UNPAID' : paid >= net ? 'PAID' : 'PARTIAL' } });
    }
    const reopened = amount - left;
    const chart = await ensureChart(tx, r.tenantId);
    const entry = await post(tx, this.numbering, {
      tenantId: r.tenantId, campusId: r.campusId, date: iso(todayIST()), voucherType: 'PAYMENT', sourceType: 'REFUND', sourceId: r.id, userId: d.userId,
      narration: `Refund of receipt ${r.payment.receiptNo}: ${r.reason}`,
      lines: [
        { accountId: chart.get('STUDENT_RECEIVABLE')!, debitPaise: reopened, partyType: 'STUDENT', partyId: r.studentId },
        { accountId: chart.get('FEE_ADVANCE')!, debitPaise: amount - reopened, partyType: 'STUDENT', partyId: r.studentId },
        { accountId: chart.get(REFUND_ACCOUNT[r.refundMode])!, creditPaise: amount },
      ],
    });
    await tx.refund.update({ where: { id: r.id }, data: { status: 'PAID', gatewayRefundId, journalEntryId: entry.id, decidedAt: new Date() } });
  }

  refunds(studentId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.student.findUnique({ where: { id: studentId }, select: { campusId: true } });
      if (!s || !canAccessCampus(this.scope(auth, PERMISSIONS.FEE_READ), s.campusId)) throw NotFound('Student');
      return tx.refund.findMany({ where: { studentId }, orderBy: { createdAt: 'desc' }, include: { payment: { select: { receiptNo: true, paymentMode: true } } } });
    });
  }
}
