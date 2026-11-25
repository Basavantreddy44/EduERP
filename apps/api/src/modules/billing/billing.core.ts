import { Prisma } from '@eduerp/db';
import { BillingCycle, DEFAULT_GRACE_DAYS, PERMISSIONS, addDays, financialYear, gstSplit, sameGstState, termEnd } from '@eduerp/shared';
import type { Tx } from '../../common/prisma.service';
import type { AuditService } from '../../common/audit.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { usersWithPermission } from '../engagement/complaints.service';

/**
 * Phase 22 billing rules shared by the platform console, the institution's bills page, plan
 * assignment and the hourly billing check (CD-133–CD-136). Every function runs inside the caller's
 * transaction, in platform context with the institution set (`app.tenant_id`).
 */
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
export const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
export const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
export const r2 = (n: number) => Math.round(n * 100) / 100;
export const inr = (v: number) => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const OPEN = ['UNPAID', 'PART_PAID'];

type PlanPrices = { priceMonthly: Prisma.Decimal | null; priceYearly: Prisma.Decimal | null; pricePerStudent: Prisma.Decimal; billingCycle: string };

/** Price per student for a cycle, or null when the plan is not sold that way. */
export function planRate(plan: PlanPrices, cycle: BillingCycle): number | null {
  const p = cycle === 'MONTHLY' ? plan.priceMonthly : plan.priceYearly;
  if (p != null) return Number(p);
  return plan.billingCycle === cycle && Number(plan.pricePerStudent) > 0 ? Number(plan.pricePerStudent) : null;
}

export async function loadSettings(tx: Tx) {
  const s = await tx.platformBillingSettings.findUnique({ where: { id: 1 } });
  return s ?? (await tx.platformBillingSettings.create({ data: { id: 1 } }));
}

export async function setTenant(tx: Tx, tenantId: string) {
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
}

export async function activeStudents(tx: Tx, tenantId: string): Promise<number> {
  return tx.student.count({ where: { tenantId, status: 'ACTIVE' } });
}

/** A new tax invoice for one term: next number of the financial year (row lock, no gaps), GST split by state. */
export async function raiseInvoice(
  tx: Tx,
  audit: AuditService,
  a: { tenantId: string; subscriptionId: string; planName: string; cycle: BillingCycle; rate: number; studentCount: number; periodStart: string; periodEnd: string; dueDate: string; kind: 'FIRST' | 'RENEWAL'; userId: string | null },
) {
  const settings = await loadSettings(tx);
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { name: true, address: true, city: true, district: true, state: true, pincode: true, billingState: true, gstin: true, edition: true } });
  const issueDate = todayIST();
  const fy = financialYear(issueDate);
  await tx.$executeRaw`INSERT INTO platform_invoice_counters (fy, last_no) VALUES (${fy}, 0) ON CONFLICT (fy) DO NOTHING`;
  const [{ last_no: seq }] = await tx.$queryRaw<{ last_no: number }[]>`UPDATE platform_invoice_counters SET last_no = last_no + 1 WHERE fy = ${fy} RETURNING last_no`;
  const taxable = r2(a.rate * a.studentCount);
  const gstRate = Number(settings.gstRate);
  const buyerState = t.billingState ?? t.state ?? null;
  const g = gstSplit(taxable, gstRate, sameGstState(settings.sellerState, buyerState, settings.sellerGstin, t.gstin));
  const inv = await tx.platformInvoice.create({
    data: {
      tenantId: a.tenantId, subscriptionId: a.subscriptionId, invoiceNo: `${settings.invoicePrefix}/${fy}/${String(seq).padStart(5, '0')}`, fy, seq, kind: a.kind,
      planName: a.planName, edition: t.edition, billingCycle: a.cycle, periodStart: day(a.periodStart), periodEnd: day(a.periodEnd), studentCount: a.studentCount,
      rate: a.rate, taxable, gstRate, cgst: g.cgst, sgst: g.sgst, igst: g.igst, total: g.total, issueDate: day(issueDate), dueDate: day(a.dueDate),
      buyer: { name: t.name, address: [t.address, t.city, t.district, t.pincode].filter(Boolean).join(', '), state: buyerState, gstin: t.gstin },
      seller: { name: settings.sellerName, address: settings.sellerAddress, state: settings.sellerState, gstin: settings.sellerGstin, sac: settings.sacCode, bankName: settings.bankName, bankAccountName: settings.bankAccountName, bankAccountNo: settings.bankAccountNo, bankIfsc: settings.bankIfsc, upiId: settings.upiId },
      createdBy: a.userId,
    },
  });
  await audit.log(tx, { tenantId: a.tenantId, userId: a.userId, action: 'CREATE', entityType: 'PLATFORM_INVOICE', entityId: inv.id, newValues: { invoiceNo: inv.invoiceNo, kind: a.kind, period: `${a.periodStart} – ${a.periodEnd}`, students: a.studentCount, total: g.total } });
  return inv;
}

/** Recomputes an invoice from its payments; a paid renewal extends the term, an unpaid one gives it back. */
export async function settleInvoice(tx: Tx, invoiceId: string) {
  const inv = await tx.platformInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (inv.status === 'CANCELLED') return inv;
  const agg = await tx.platformPayment.aggregate({ where: { invoiceId, status: 'RECORDED' }, _sum: { amount: true } });
  const paid = r2(num(agg._sum.amount));
  const total = num(inv.total);
  const status = paid >= total && total > 0 ? 'PAID' : paid > 0 ? 'PART_PAID' : total === 0 ? 'PAID' : 'UNPAID';
  const after = await tx.platformInvoice.update({ where: { id: invoiceId }, data: { paid, status } });
  if (inv.kind === 'RENEWAL') {
    const sub = await tx.tenantSubscription.findUnique({ where: { id: inv.subscriptionId } });
    if (sub && ['ACTIVE', 'TRIAL'].includes(sub.status)) {
      const before = addDays(iso(inv.periodStart), -1);
      if (status === 'PAID' && iso(sub.endDate) === before) await tx.tenantSubscription.update({ where: { id: sub.id }, data: { endDate: inv.periodEnd } });
      if (status !== 'PAID' && iso(sub.endDate) === iso(inv.periodEnd)) await tx.tenantSubscription.update({ where: { id: sub.id }, data: { endDate: day(before) } });
    }
  }
  return after;
}

export interface AccountState {
  status: string;
  graceDays: number;
  /** Something unpaid past its due date (or a trial that ended). */
  overdue: null | { kind: 'INVOICE' | 'TRIAL'; invoiceId: string | null; invoiceNo: string | null; amount: number; dueDate: string; lastDay: string };
  /** Next open invoice not yet due. */
  upcoming: null | { invoiceId: string; invoiceNo: string; amount: number; dueDate: string };
}

/** Where an institution stands today: overdue amount, last day before read-only, next bill. */
export async function accountState(tx: Tx, tenantId: string, today = todayIST()): Promise<AccountState> {
  const [t, settings, open, sub] = await Promise.all([
    tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { status: true, graceDays: true } }),
    loadSettings(tx),
    tx.platformInvoice.findMany({ where: { tenantId, status: { in: OPEN } }, orderBy: { dueDate: 'asc' } }),
    tx.tenantSubscription.findFirst({ where: { tenantId, status: { in: ['TRIAL', 'ACTIVE'] } } }),
  ]);
  const graceDays = t.graceDays ?? settings.graceDays ?? DEFAULT_GRACE_DAYS;
  const late = open.filter((i) => iso(i.dueDate) < today);
  const bal = (i: (typeof open)[number]) => r2(num(i.total) - num(i.paid));
  let overdue: AccountState['overdue'] = null;
  if (late.length) {
    const first = late[0];
    overdue = { kind: 'INVOICE', invoiceId: first.id, invoiceNo: first.invoiceNo, amount: r2(late.reduce((s, i) => s + bal(i), 0)), dueDate: iso(first.dueDate), lastDay: addDays(iso(first.dueDate), graceDays) };
  } else if (sub?.status === 'TRIAL' && iso(sub.endDate) < today) {
    const due = addDays(iso(sub.endDate), 1);
    overdue = { kind: 'TRIAL', invoiceId: null, invoiceNo: null, amount: 0, dueDate: due, lastDay: addDays(iso(sub.endDate), graceDays) };
  }
  const next = open.find((i) => iso(i.dueDate) >= today);
  return { status: t.status, graceDays, overdue, upcoming: next ? { invoiceId: next.id, invoiceNo: next.invoiceNo, amount: bal(next), dueDate: iso(next.dueDate) } : null };
}

/**
 * Moves an institution between Active, Grace and read-only as its bills require (CD-135). A manual
 * suspension (billing_hold false) is never lifted here. Returns what changed, if anything.
 */
export async function applyAccountState(tx: Tx, audit: AuditService, notifications: NotificationsService | null, tenantId: string, userId: string | null, today = todayIST()): Promise<'GRACE' | 'READ_ONLY' | 'ACTIVE' | null> {
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { status: true, billingHold: true } });
  if (t.status === 'CLOSED' || (t.status === 'SUSPENDED' && !t.billingHold)) return null;
  const st = await accountState(tx, tenantId, today);
  const o = st.overdue;
  const what = o ? (o.kind === 'TRIAL' ? `Trial ended on ${addDays(o.dueDate, -1)}` : `Invoice ${o.invoiceNo} unpaid since ${o.dueDate}`) : 'Bills paid';
  let to: { status: string; billingHold: boolean; change: 'GRACE' | 'READ_ONLY' | 'ACTIVE' } | null = null;
  if (o && today > o.lastDay) {
    if (t.status !== 'SUSPENDED') to = { status: 'SUSPENDED', billingHold: true, change: 'READ_ONLY' };
  } else if (o) {
    if (t.status !== 'GRACE') to = { status: 'GRACE', billingHold: false, change: 'GRACE' };
  } else if (t.status === 'GRACE' || (t.status === 'SUSPENDED' && t.billingHold)) {
    to = { status: 'ACTIVE', billingHold: false, change: 'ACTIVE' };
  }
  if (!to) return null;
  await tx.tenant.update({ where: { id: tenantId }, data: { status: to.status, billingHold: to.billingHold, updatedBy: userId } });
  await audit.log(tx, { tenantId, userId, action: 'STATUS_CHANGE', entityType: 'TENANT', entityId: tenantId, oldValues: { status: t.status }, newValues: { status: to.status, billingHold: to.billingHold }, reason: `Billing: ${what}` });
  if (to.change === 'READ_ONLY' && notifications && o?.invoiceId) {
    const fresh = await tx.billingReminder.createMany({ data: [{ tenantId, refId: o.invoiceId, kind: 'READONLY' }], skipDuplicates: true });
    if (fresh.count) await notifyAdmins(tx, notifications, tenantId, 'BILLING_READONLY', { invoiceNo: o.invoiceNo ?? '', amount: inr(o.amount) }, o.invoiceId);
  }
  return to.change;
}

export async function notifyAdmins(tx: Tx, notifications: NotificationsService, tenantId: string, eventCode: 'BILLING_DUE' | 'BILLING_OVERDUE' | 'BILLING_READONLY', vars: Record<string, string>, invoiceId: string) {
  const userIds = await usersWithPermission(tx, PERMISSIONS.ORG_BILLING, null);
  if (userIds.length) await notifications.notify(tx, { tenantId, userIds, eventCode, vars, entityType: 'PLATFORM_INVOICE', entityId: invoiceId });
  return userIds.length;
}

/**
 * Reminders for open invoices (CD-135): N (renewal lead), 7 and 1 days before the due date, on the
 * due date and 7 days before read-only — each once. When several are due at once (a late run), only
 * the latest is sent and the earlier ones are recorded as skipped.
 */
export async function sendReminders(tx: Tx, notifications: NotificationsService, tenantId: string, today = todayIST()): Promise<number> {
  const st = await accountState(tx, tenantId, today);
  const settings = await loadSettings(tx);
  const open = await tx.platformInvoice.findMany({ where: { tenantId, status: { in: OPEN } } });
  let sent = 0;
  for (const inv of open) {
    const due = iso(inv.dueDate);
    const lastDay = addDays(due, st.graceDays);
    const steps: { kind: string; at: string; until: string }[] = [
      ...[...new Set([settings.renewLeadDays, 7, 1])].sort((a, b) => b - a).map((d) => ({ kind: `BEFORE_${d}`, at: addDays(due, -d), until: addDays(due, -1) })),
      { kind: 'DUE', at: due, until: due },
      { kind: 'LAST_7', at: addDays(lastDay, -7), until: lastDay },
    ];
    const due_ = steps.filter((s) => s.at <= today);
    if (!due_.length) continue;
    const done = new Set((await tx.billingReminder.findMany({ where: { refId: inv.id }, select: { kind: true } })).map((r) => r.kind));
    const latest = due_[due_.length - 1];
    const toRecord = due_.filter((s) => !done.has(s.kind));
    if (!toRecord.length) continue;
    await tx.billingReminder.createMany({ data: toRecord.map((s) => ({ tenantId, refId: inv.id, kind: s.kind, sent: s.kind === latest.kind && today <= s.until })), skipDuplicates: true });
    if (done.has(latest.kind) || today > latest.until) continue;
    const amount = inr(r2(num(inv.total) - num(inv.paid)));
    const n = latest.kind === 'LAST_7'
      ? await notifyAdmins(tx, notifications, tenantId, 'BILLING_OVERDUE', { invoiceNo: inv.invoiceNo, amount, dueDate: due, lastDay }, inv.id)
      : await notifyAdmins(tx, notifications, tenantId, 'BILLING_DUE', { invoiceNo: inv.invoiceNo, amount, dueDate: due }, inv.id);
    if (n) sent++;
  }
  return sent;
}

/** Raises the next term's invoice once the live paid term is within the lead days of its end. */
export async function raiseRenewal(tx: Tx, audit: AuditService, tenantId: string, today = todayIST()) {
  const sub = await tx.tenantSubscription.findFirst({ where: { tenantId, status: 'ACTIVE' }, include: { plan: true } });
  if (!sub) return null;
  const settings = await loadSettings(tx);
  const end = iso(sub.endDate);
  if (today < addDays(end, -settings.renewLeadDays)) return null;
  const start = addDays(end, 1);
  if (await tx.platformInvoice.findFirst({ where: { subscriptionId: sub.id, periodStart: day(start), status: { not: 'CANCELLED' } }, select: { id: true } })) return null;
  const cycle = (sub.nextCycle ?? sub.billingCycle) as BillingCycle;
  const rate = planRate(sub.plan, cycle) ?? (cycle === sub.billingCycle ? num(sub.rate) : null);
  if (rate === null) return null;
  const count = Math.max(sub.studentCount, await activeStudents(tx, tenantId));
  await tx.tenantSubscription.update({ where: { id: sub.id }, data: { billingCycle: cycle, nextCycle: null, rate, studentCount: count, amount: r2(rate * count) } });
  return raiseInvoice(tx, audit, { tenantId, subscriptionId: sub.id, planName: sub.plan.name, cycle, rate, studentCount: count, periodStart: start, periodEnd: termEnd(start, cycle), dueDate: start > today ? start : today, kind: 'RENEWAL', userId: null });
}
