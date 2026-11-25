import { HttpStatus, Injectable } from '@nestjs/common';
import { BillingCycle, BillingSettingsInput, RecordPlatformPaymentInput, TenantBillingInput, financialYear } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import type { AuthContext } from '../../common/auth-context';
import type { ClientInfo } from '../../common/decorators';
import { AppError, NotFound } from '../../common/problem';
import { NotificationsService } from '../notifications/notifications.service';
import {
  accountState, activeStudents, applyAccountState, day, inr, iso, loadSettings, num, planRate, r2, raiseRenewal, sendReminders, setTenant, settleInvoice, todayIST,
} from './billing.core';

const bad = (type: string, msg: string) => new AppError(HttpStatus.UNPROCESSABLE_ENTITY, type, msg);
type Invoice = Awaited<ReturnType<Tx['platformInvoice']['findUniqueOrThrow']>>;
type Payment = Awaited<ReturnType<Tx['platformPayment']['findUniqueOrThrow']>>;

const invoiceOut = (i: Invoice, tenantName?: string) => ({
  id: i.id, tenantId: i.tenantId, tenantName: tenantName ?? null, invoiceNo: i.invoiceNo, kind: i.kind, planName: i.planName, edition: i.edition, billingCycle: i.billingCycle,
  periodStart: iso(i.periodStart), periodEnd: iso(i.periodEnd), studentCount: i.studentCount, rate: num(i.rate), taxable: num(i.taxable), gstRate: num(i.gstRate),
  cgst: num(i.cgst), sgst: num(i.sgst), igst: num(i.igst), total: num(i.total), paid: num(i.paid), balance: i.status === 'CANCELLED' ? 0 : r2(num(i.total) - num(i.paid)),
  issueDate: iso(i.issueDate), dueDate: iso(i.dueDate), status: i.status, overdue: ['UNPAID', 'PART_PAID'].includes(i.status) && iso(i.dueDate) < todayIST(),
  buyer: i.buyer, seller: i.seller, cancelReason: i.cancelReason,
});
const paymentOut = (p: Payment, invoiceNo?: string) => ({
  id: p.id, invoiceId: p.invoiceId, invoiceNo: invoiceNo ?? null, paidOn: iso(p.paidOn), amount: num(p.amount), mode: p.mode, reference: p.reference, note: p.note,
  status: p.status, reverseReason: p.reverseReason,
});
const settingsOut = (s: Awaited<ReturnType<typeof loadSettings>>) => ({
  graceDays: s.graceDays, renewLeadDays: s.renewLeadDays, gstRate: num(s.gstRate), invoicePrefix: s.invoicePrefix, sellerName: s.sellerName, sellerAddress: s.sellerAddress,
  sellerState: s.sellerState, sellerGstin: s.sellerGstin, sacCode: s.sacCode, bankName: s.bankName, bankAccountName: s.bankAccountName, bankAccountNo: s.bankAccountNo,
  bankIfsc: s.bankIfsc, upiId: s.upiId, updatedAt: s.updatedAt.toISOString(),
});

/** Phase 22 SaaS billing: platform console, the institution's bills, and the hourly billing check. */
@Injectable()
export class BillingService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ───────────── Settings (S1) ─────────────

  settings() {
    return this.db.run({ isPlatform: true }, async (tx) => settingsOut(await loadSettings(tx)));
  }

  /** Platform-wide settings keep who changed them last; per-institution changes go to its audit log. */
  saveSettings(input: BillingSettingsInput, auth: AuthContext) {
    return this.db.run({ isPlatform: true, userId: auth.userId }, async (tx) => {
      await loadSettings(tx);
      return settingsOut(await tx.platformBillingSettings.update({ where: { id: 1 }, data: { ...input, updatedBy: auth.userId } }));
    });
  }

  // ───────────── Console overview and invoices (S3, S6) ─────────────

  summary() {
    return this.db.run({ isPlatform: true }, async (tx) => {
      const today = todayIST();
      const fy = financialYear(today);
      const fyStart = day(`${fy.slice(0, 4)}-04-01`);
      const [billed, received, open, grace, readOnly] = await Promise.all([
        tx.platformInvoice.aggregate({ where: { fy, status: { not: 'CANCELLED' } }, _sum: { total: true }, _count: true }),
        tx.platformPayment.aggregate({ where: { status: 'RECORDED', paidOn: { gte: fyStart } }, _sum: { amount: true } }),
        tx.platformInvoice.findMany({ where: { status: { in: ['UNPAID', 'PART_PAID'] } }, select: { total: true, paid: true, dueDate: true } }),
        tx.tenant.count({ where: { status: 'GRACE' } }),
        tx.tenant.count({ where: { status: 'SUSPENDED', billingHold: true } }),
      ]);
      const bal = (i: { total: unknown; paid: unknown }) => num(i.total as never) - num(i.paid as never);
      return {
        financialYear: fy, billed: num(billed._sum.total), invoices: billed._count, received: num(received._sum.amount),
        outstanding: r2(open.reduce((s, i) => s + bal(i), 0)), overdue: r2(open.filter((i) => iso(i.dueDate) < today).reduce((s, i) => s + bal(i), 0)),
        inGrace: grace, readOnly,
      };
    });
  }

  invoices(q: { status?: string; tenantId?: string }) {
    return this.db.run({ isPlatform: true }, async (tx) => {
      const today = day(todayIST());
      const where = {
        ...(q.tenantId ? { tenantId: q.tenantId } : {}),
        ...(q.status === 'OVERDUE' ? { status: { in: ['UNPAID', 'PART_PAID'] }, dueDate: { lt: today } } : q.status ? { status: q.status } : {}),
      };
      const rows = await tx.platformInvoice.findMany({ where, orderBy: [{ issueDate: 'desc' }, { seq: 'desc' }], take: 500 });
      const names = await this.tenantNames(tx, rows.map((r) => r.tenantId));
      return rows.map((r) => invoiceOut(r, names.get(r.tenantId)));
    });
  }

  invoice(id: string) {
    return this.db.run({ isPlatform: true }, async (tx) => this.invoiceDetail(tx, id));
  }

  private async invoiceDetail(tx: Tx, id: string) {
    const inv = await tx.platformInvoice.findUnique({ where: { id }, include: { payments: { orderBy: { paidOn: 'asc' } } } });
    if (!inv) throw NotFound('Invoice');
    const t = await tx.tenant.findUnique({ where: { id: inv.tenantId }, select: { name: true, logoFileId: true } });
    return { ...invoiceOut(inv, t?.name), payments: inv.payments.map((p) => paymentOut(p)) };
  }

  private async tenantNames(tx: Tx, ids: string[]) {
    const rows = await tx.tenant.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** Locks the invoice row and switches the transaction to its institution (audit, notifications). */
  private async lockInvoice(tx: Tx, id: string) {
    const rows = await tx.$queryRaw<{ id: string; tenant_id: string }[]>`SELECT id, tenant_id FROM platform_invoices WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows.length) throw NotFound('Invoice');
    await setTenant(tx, rows[0].tenant_id);
    return tx.platformInvoice.findUniqueOrThrow({ where: { id } });
  }

  // ───────────── Payments (S4) ─────────────

  recordPayment(invoiceId: string, input: RecordPlatformPaymentInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run({ isPlatform: true, userId: auth.userId }, async (tx) => {
      const inv = await this.lockInvoice(tx, invoiceId);
      if (inv.status === 'CANCELLED') throw bad('invoice-cancelled', 'This invoice was cancelled');
      if (inv.status === 'PAID') throw bad('invoice-paid', 'This invoice is already paid in full');
      if (input.paidOn > todayIST()) throw bad('payment-future', 'The payment date cannot be in the future');
      const balance = r2(num(inv.total) - num(inv.paid));
      if (input.amount > balance) throw bad('payment-over-balance', `Only ${inr(balance)} is due on this invoice`);
      const p = await tx.platformPayment.create({
        data: { tenantId: inv.tenantId, invoiceId, paidOn: day(input.paidOn), amount: input.amount, mode: input.mode, reference: input.reference, note: input.note, createdBy: auth.userId },
      });
      await settleInvoice(tx, invoiceId);
      await this.audit.log(tx, { tenantId: inv.tenantId, userId: auth.userId, action: 'CREATE', entityType: 'PLATFORM_PAYMENT', entityId: p.id, newValues: { invoiceNo: inv.invoiceNo, amount: input.amount, mode: input.mode, reference: input.reference, paidOn: input.paidOn } }, client);
      const change = await applyAccountState(tx, this.audit, this.notifications, inv.tenantId, auth.userId);
      return { ...(await this.invoiceDetail(tx, invoiceId)), accountChange: change };
    });
  }

  reversePayment(paymentId: string, reason: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run({ isPlatform: true, userId: auth.userId }, async (tx) => {
      const p = await tx.platformPayment.findUnique({ where: { id: paymentId } });
      if (!p) throw NotFound('Payment');
      const inv = await this.lockInvoice(tx, p.invoiceId);
      if (p.status === 'REVERSED') throw bad('payment-reversed', 'This payment was already reversed');
      await tx.platformPayment.update({ where: { id: paymentId }, data: { status: 'REVERSED', reverseReason: reason, reversedAt: new Date(), reversedBy: auth.userId } });
      await settleInvoice(tx, p.invoiceId);
      await this.audit.log(tx, { tenantId: p.tenantId, userId: auth.userId, action: 'CANCEL', entityType: 'PLATFORM_PAYMENT', entityId: p.id, oldValues: { invoiceNo: inv.invoiceNo, amount: num(p.amount), status: 'RECORDED' }, newValues: { status: 'REVERSED' }, reason }, client);
      const change = await applyAccountState(tx, this.audit, this.notifications, p.tenantId, auth.userId);
      return { ...(await this.invoiceDetail(tx, p.invoiceId)), accountChange: change };
    });
  }

  cancelInvoice(id: string, reason: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run({ isPlatform: true, userId: auth.userId }, async (tx) => {
      const inv = await this.lockInvoice(tx, id);
      if (inv.status === 'CANCELLED') throw bad('invoice-cancelled', 'This invoice was already cancelled');
      if (num(inv.paid) > 0) throw bad('invoice-has-payments', 'Reverse the payments on this invoice first');
      await tx.platformInvoice.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason, cancelledAt: new Date(), cancelledBy: auth.userId } });
      await this.audit.log(tx, { tenantId: inv.tenantId, userId: auth.userId, action: 'CANCEL', entityType: 'PLATFORM_INVOICE', entityId: id, oldValues: { invoiceNo: inv.invoiceNo, status: inv.status }, newValues: { status: 'CANCELLED' }, reason }, client);
      const change = await applyAccountState(tx, this.audit, this.notifications, inv.tenantId, auth.userId);
      return { ...(await this.invoiceDetail(tx, id)), accountChange: change };
    });
  }

  // ───────────── One institution in the console (S1, S2, S4) ─────────────

  tenantBilling(tenantId: string) {
    return this.db.run({ isPlatform: true, tenantId }, async (tx) => {
      const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, status: true, billingHold: true, graceDays: true, gstin: true, billingState: true, state: true, edition: true } });
      if (!t) throw NotFound('Institution');
      return { tenant: t, ...(await this.overviewOf(tx, tenantId)) };
    });
  }

  updateTenantBilling(tenantId: string, input: TenantBillingInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run({ isPlatform: true, tenantId, userId: auth.userId }, async (tx) => {
      const before = await tx.tenant.findUnique({ where: { id: tenantId }, select: { graceDays: true, gstin: true, billingState: true } });
      if (!before) throw NotFound('Institution');
      await tx.tenant.update({ where: { id: tenantId }, data: { graceDays: input.graceDays, gstin: input.gstin ?? null, billingState: input.billingState, updatedBy: auth.userId } });
      await this.audit.log(tx, { tenantId, userId: auth.userId, action: 'UPDATE', entityType: 'TENANT_BILLING', entityId: tenantId, oldValues: before, newValues: { graceDays: input.graceDays, gstin: input.gstin ?? null, billingState: input.billingState } }, client);
      // A longer grace period can lift read-only at once; a shorter one waits for the next check.
      await applyAccountState(tx, this.audit, this.notifications, tenantId, auth.userId);
      return this.tenantBillingIn(tx, tenantId);
    });
  }

  private async tenantBillingIn(tx: Tx, tenantId: string) {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { id: true, name: true, status: true, billingHold: true, graceDays: true, gstin: true, billingState: true, state: true, edition: true } });
    return { tenant: t, ...(await this.overviewOf(tx, tenantId)) };
  }

  /** Monthly or yearly from the next renewal — by the platform or the institution's administrator. */
  changeCycle(tenantId: string, cycle: BillingCycle, auth: AuthContext, client: ClientInfo) {
    return this.db.run({ isPlatform: true, tenantId, userId: auth.userId }, async (tx) => {
      const sub = await tx.tenantSubscription.findFirst({ where: { tenantId, status: { in: ['TRIAL', 'ACTIVE'] } }, include: { plan: true } });
      if (!sub) throw bad('no-subscription', 'There is no plan to change yet');
      if (planRate(sub.plan, cycle) === null) throw bad('plan-cycle-not-offered', `${sub.plan.name} is not sold ${cycle === 'MONTHLY' ? 'monthly' : 'yearly'}`);
      const next = cycle === sub.billingCycle ? null : cycle;
      await tx.tenantSubscription.update({ where: { id: sub.id }, data: { nextCycle: next } });
      await this.audit.log(tx, { tenantId, userId: auth.userId, action: 'UPDATE', entityType: 'SUBSCRIPTION', entityId: sub.id, oldValues: { billingCycle: sub.billingCycle, nextCycle: sub.nextCycle }, newValues: { nextCycle: next ?? sub.billingCycle } }, client);
      return this.overviewOf(tx, tenantId);
    });
  }

  /** Plan, term, cycle, balance, students and the statement with its running balance. */
  private async overviewOf(tx: Tx, tenantId: string) {
    const [sub, invoices, payments, active, account, settings] = await Promise.all([
      tx.tenantSubscription.findFirst({ where: { tenantId, status: { in: ['TRIAL', 'ACTIVE'] } }, include: { plan: true } }),
      tx.platformInvoice.findMany({ where: { tenantId }, orderBy: [{ issueDate: 'desc' }, { seq: 'desc' }] }),
      tx.platformPayment.findMany({ where: { tenantId }, orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }] }),
      activeStudents(tx, tenantId),
      accountState(tx, tenantId),
      loadSettings(tx),
    ]);
    const invNo = new Map(invoices.map((i) => [i.id, i.invoiceNo]));
    type Line = { date: string; at: number; kind: string; ref: string; debit: number; credit: number; balance?: number };
    const lines: Line[] = [];
    for (const i of invoices) {
      lines.push({ date: iso(i.issueDate), at: i.createdAt.getTime(), kind: 'INVOICE', ref: i.invoiceNo, debit: num(i.total), credit: 0 });
      if (i.status === 'CANCELLED' && i.cancelledAt) lines.push({ date: iso(new Date(i.cancelledAt.getTime() + 330 * 60_000)), at: i.cancelledAt.getTime(), kind: 'CANCELLED', ref: i.invoiceNo, debit: 0, credit: num(i.total) });
    }
    for (const p of payments) {
      lines.push({ date: iso(p.paidOn), at: p.createdAt.getTime(), kind: 'PAYMENT', ref: `${invNo.get(p.invoiceId) ?? ''}${p.reference ? ` · ${p.reference}` : ''}`, debit: 0, credit: num(p.amount) });
      if (p.status === 'REVERSED' && p.reversedAt) lines.push({ date: iso(new Date(p.reversedAt.getTime() + 330 * 60_000)), at: p.reversedAt.getTime(), kind: 'REVERSAL', ref: invNo.get(p.invoiceId) ?? '', debit: num(p.amount), credit: 0 });
    }
    lines.sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at);
    let run = 0;
    for (const l of lines) l.balance = run = r2(run + l.debit - l.credit);
    return {
      subscription: sub ? {
        id: sub.id, plan: { id: sub.plan.id, name: sub.plan.name, code: sub.plan.code, priceMonthly: sub.plan.priceMonthly == null ? null : num(sub.plan.priceMonthly), priceYearly: sub.plan.priceYearly == null ? null : num(sub.plan.priceYearly), monthly: planRate(sub.plan, 'MONTHLY'), yearly: planRate(sub.plan, 'YEARLY') },
        status: sub.status, billingCycle: sub.billingCycle, nextCycle: sub.nextCycle, rate: num(sub.rate), studentCount: sub.studentCount, amount: num(sub.amount), startDate: iso(sub.startDate), endDate: iso(sub.endDate),
      } : null,
      activeStudents: active,
      account,
      balance: r2(invoices.filter((i) => i.status !== 'CANCELLED').reduce((s, i) => s + num(i.total) - num(i.paid), 0)),
      invoices: invoices.map((i) => invoiceOut(i)),
      payments: payments.map((p) => paymentOut(p, invNo.get(p.invoiceId))),
      statement: lines.reverse().map(({ at: _at, ...l }) => l),
      payTo: { name: settings.sellerName, bankName: settings.bankName, bankAccountName: settings.bankAccountName, bankAccountNo: settings.bankAccountNo, bankIfsc: settings.bankIfsc, upiId: settings.upiId },
    };
  }

  // ───────────── The institution's own view (S6) ─────────────

  mine(auth: AuthContext) {
    return this.db.run({ isPlatform: true, tenantId: auth.tenantId, userId: auth.userId }, (tx) => this.overviewOf(tx, auth.tenantId!));
  }

  myInvoice(id: string, auth: AuthContext) {
    return this.db.run({ isPlatform: true, tenantId: auth.tenantId, userId: auth.userId }, async (tx) => {
      const inv = await tx.platformInvoice.findFirst({ where: { id, tenantId: auth.tenantId! }, select: { id: true } });
      if (!inv) throw NotFound('Invoice');
      return this.invoiceDetail(tx, id);
    });
  }

  /** For every signed-in member: the banner during grace and read-only (no amounts for non-admins). */
  async account(tenantId: string) {
    return this.db.run({ isPlatform: true, tenantId }, (tx) => accountState(tx, tenantId));
  }

  // ───────────── The billing check (S5) ─────────────

  /** Hourly in the worker, and on demand from the console: renewals, account state, reminders. */
  async runAll(today = todayIST(), only?: string[]) {
    // Institutions with a plan, an open bill, or a billing status to lift.
    const tenants = await this.db.run({ isPlatform: true }, async (tx) => {
      const [held, subs, open] = await Promise.all([
        tx.tenant.findMany({ where: { OR: [{ status: 'GRACE' }, { billingHold: true }] }, select: { id: true } }),
        tx.tenantSubscription.findMany({ where: { status: { in: ['TRIAL', 'ACTIVE'] } }, select: { tenantId: true } }),
        tx.platformInvoice.findMany({ where: { status: { in: ['UNPAID', 'PART_PAID'] } }, select: { tenantId: true } }),
      ]);
      const all = [...new Set([...held.map((x) => x.id), ...subs.map((s) => s.tenantId), ...open.map((o) => o.tenantId)])];
      return only ? all.filter((id) => only.includes(id)) : all;
    });
    const out = { institutions: tenants.length, invoices: 0, reminders: 0, grace: 0, readOnly: 0, reactivated: 0, failed: 0 };
    for (const id of tenants) {
      try {
        await this.db.run({ isPlatform: true, tenantId: id }, async (tx) => {
          if (await raiseRenewal(tx, this.audit, id, today)) out.invoices++;
          const change = await applyAccountState(tx, this.audit, this.notifications, id, null, today);
          if (change === 'GRACE') out.grace++;
          if (change === 'READ_ONLY') out.readOnly++;
          if (change === 'ACTIVE') out.reactivated++;
          out.reminders += await sendReminders(tx, this.notifications, id, today);
        });
      } catch (e) {
        out.failed++;
        console.error(`Billing check failed for ${id}:`, e instanceof Error ? e.message : e);
      }
    }
    return out;
  }
}
