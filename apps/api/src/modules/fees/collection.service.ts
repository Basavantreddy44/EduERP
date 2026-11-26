import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@eduerp/db';
import { BounceInput, CollectInput, PERMISSIONS, PermissionCode, allocate, formatINR, fromPaise, toPaise } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, CampusScope, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { NumberingService } from '../numbering/numbering.service';
import { allocateNo, todayIST } from '../students/student-records';
import { ensureChart, ensureFinancialYear, post, reverse } from './ledger';
import { FeeBillingService } from './billing.service';
import { creditBalancePaise, lockCredit } from './credit-core';

const COLLECT = PERMISSIONS.FEE_COLLECT;
const CANCEL = PERMISSIONS.FEE_RECEIPT_CANCEL;
const paise = (d: Prisma.Decimal | string | number) => toPaise(d.toString());
const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (d: string) => new Date(`${d}T00:00:00Z`);

/** Where received money is held until banked. */
export const CASH_ACCOUNT: Record<string, string> = { CASH: 'CASH', CHEQUE: 'CHEQUES_IN_HAND', DD: 'CHEQUES_IN_HAND', UPI: 'BANK', CARD: 'BANK', BANK_TRANSFER: 'BANK', ONLINE: 'GATEWAY_CLEARING' };

const LINE_ORDER: Record<string, number> = { ACADEMIC: 0, ADMISSION: 1, EXAM: 2, TRANSPORT: 3, HOSTEL: 3, MESS: 3, OTHER: 4, FINE: 6, DEPOSIT: 9 };

const statusOf = (net: number, paid: number) => (paid <= 0 ? 'UNPAID' : paid >= net ? 'PAID' : 'PARTIAL');

/**
 * Counter collection (M2.3): a cashier opens a counter, collects fees (cash, cheque, DD, UPI, card,
 * bank transfer), each successful payment gets a gapless receipt number and posts Dr Cash / Bank /
 * Cheques in hand / Cr Student receivable; the counter closes with counted cash and its difference.
 * Receipts are cancelled or bounced (cheques) by reversal — never edited or deleted.
 */
@Injectable()
export class FeeCollectionService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly billing: FeeBillingService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  private scope(auth: AuthContext, code: PermissionCode): CampusScope {
    return scopeFor(auth, code)!;
  }

  // ───────────── Counter ─────────────

  private async sessionTotals(tx: Tx, sessionId: string) {
    const rows = await tx.payment.groupBy({ by: ['paymentMode', 'status'], where: { cashierSessionId: sessionId }, _sum: { amount: true }, _count: true });
    const byMode: Record<string, { amount: string; count: number }> = {};
    let cash = 0;
    let cancelled = 0;
    for (const r of rows) {
      const a = paise(r._sum.amount ?? 0);
      if (r.status !== 'SUCCESS') { cancelled += r._count; continue; }
      byMode[r.paymentMode] = { amount: fromPaise(a), count: r._count };
      if (r.paymentMode === 'CASH') cash += a;
    }
    return { byMode, cashPaise: cash, cancelledCount: cancelled };
  }

  /** The current user's open counter (if any), its totals and today's receipts. */
  async counter(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.cashierSession.findFirst({ where: { cashierId: auth.userId, status: 'OPEN' } });
      const campuses = await tx.campus.findMany({ where: this.scope(auth, COLLECT).all ? {} : { id: { in: (this.scope(auth, COLLECT) as { campusIds: string[] }).campusIds } }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } });
      if (!s) return { session: null, campuses };
      const t = await this.sessionTotals(tx, s.id);
      const receipts = await tx.payment.findMany({
        where: { cashierSessionId: s.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, receiptNo: true, amount: true, paymentMode: true, status: true, createdAt: true, payerName: true, student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } } },
      });
      return { session: { ...s, expectedCash: fromPaise(paise(s.openingCash) + t.cashPaise), byMode: t.byMode, cancelledCount: t.cancelledCount }, receipts, campuses };
    });
  }

  async openCounter(campusId: string, openingCash: string, auth: AuthContext, client: ClientInfo) {
    if (!canAccessCampus(this.scope(auth, COLLECT), campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      if (await tx.cashierSession.findFirst({ where: { cashierId: auth.userId, status: 'OPEN' }, select: { id: true } })) throw Conflict('counter-open', 'Your counter is already open');
      const s = await tx.cashierSession.create({ data: { tenantId: auth.tenantId!, campusId, cashierId: auth.userId, openingCash } });
      await this.audit.log(tx, { tenantId: s.tenantId, userId: auth.userId, campusId, action: 'CREATE', entityType: 'CASHIER_SESSION', entityId: s.id, newValues: s }, client);
      return s;
    });
  }

  async closeCounter(id: string, countedCash: string, remarks: string | null | undefined, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM cashier_sessions WHERE id = ${id}::uuid FOR UPDATE`;
      const s = rows.length ? await tx.cashierSession.findUnique({ where: { id } }) : null;
      if (!s || s.cashierId !== auth.userId) throw NotFound('Counter');
      if (s.status !== 'OPEN') throw Conflict('counter-closed', 'This counter is already closed');
      const t = await this.sessionTotals(tx, id);
      const expected = paise(s.openingCash) + t.cashPaise;
      const diff = toPaise(countedCash) - expected;
      const c = await tx.cashierSession.update({
        where: { id },
        data: { status: 'CLOSED', closedAt: new Date(), systemCashTotal: fromPaise(t.cashPaise), countedCash, difference: fromPaise(diff), remarks: remarks ?? null },
      });
      await this.audit.log(tx, { tenantId: s.tenantId, userId: auth.userId, campusId: s.campusId, action: 'UPDATE', entityType: 'CASHIER_SESSION', entityId: id, oldValues: { status: 'OPEN' }, newValues: { status: 'CLOSED', expectedCash: fromPaise(expected), countedCash, difference: fromPaise(diff), byMode: t.byMode } }, client);
      return { ...c, expectedCash: fromPaise(expected), byMode: t.byMode };
    });
  }

  // ───────────── Collect ─────────────

  async collect(input: CollectInput, idempotencyKey: string | null, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      if (idempotencyKey) {
        const again = await tx.payment.findFirst({ where: { idempotencyKey } });
        if (again) return again; // a retried "Collect" returns the first receipt
      }
      const s = await tx.student.findUnique({ where: { id: input.studentId }, select: { id: true, tenantId: true, campusId: true, firstName: true, lastName: true, admissionNo: true } });
      if (!s || !canAccessCampus(this.scope(auth, COLLECT), s.campusId)) throw NotFound('Student');
      const date = input.paymentDate ?? iso(todayIST());
      if (date > iso(todayIST())) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'future-date', 'The payment date cannot be in the future', [{ field: 'paymentDate', message: 'Cannot be in the future' }]);

      const session = await tx.cashierSession.findFirst({ where: { cashierId: auth.userId, status: 'OPEN' } });
      if (input.mode === 'CASH' && !session) throw Conflict('counter-closed', 'Open your cash counter before collecting cash');
      if (session && session.campusId !== s.campusId && input.mode === 'CASH') throw Conflict('other-campus', 'Your open counter is for another campus');

      const saved = await this.record(tx, s, {
        amountPaise: toPaise(input.amount), mode: input.mode, date, payerName: input.payerName, referenceNo: input.referenceNo ?? null,
        chequeDate: input.chequeDate ?? null, bankName: input.bankName ?? null, notes: input.notes ?? null, invoiceIds: input.invoiceIds, keepCredit: !!input.keepCredit,
        sessionId: session && session.campusId === s.campusId ? session.id : null, idempotencyKey, userId: auth.userId,
      });
      await this.audit.log(tx, { tenantId: s.tenantId, userId: auth.userId, campusId: s.campusId, action: 'CREATE', entityType: 'PAYMENT', entityId: saved.id, newValues: { receiptNo: saved.receiptNo, amount: input.amount, mode: input.mode } }, client);
      return saved;
    });
  }

  /**
   * Records received money (counter and online alike) inside the caller's transaction: locks the
   * student's open bills, allocates (chosen bills first; within a bill fees before deposits), gives the
   * receipt number and posts it. Counter payments may not exceed what is due. Online money is already
   * taken by the gateway, so it is never refused: anything beyond the chosen bills pays other open
   * bills, and a remainder is held as "fees received in advance".
   */
  async record(
    tx: Tx,
    s: { id: string; tenantId: string; campusId: string; firstName: string; lastName: string | null; admissionNo: string },
    r: {
      amountPaise: number; mode: string; date: string; payerName: string; referenceNo: string | null; chequeDate: string | null; bankName: string | null; notes: string | null;
      invoiceIds?: string[]; sessionId: string | null; idempotencyKey: string | null; userId: string | null; allowExcess?: boolean;
      /** Phase 23 (counter): money over the chosen bills is kept as the student's credit. */
      keepCredit?: boolean;
    },
  ) {
    // Lock the student's open bills: two counters (or a counter and the gateway) cannot spend the same balance.
    await tx.$queryRaw`SELECT id FROM fee_invoices WHERE student_id = ${s.id}::uuid AND status IN ('UNPAID','PARTIAL') FOR UPDATE`;
    const all = await tx.feeInvoice.findMany({
      where: { studentId: s.id, status: { in: ['UNPAID', 'PARTIAL'] } },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      include: { items: { include: { feeHead: { select: { feeType: true, name: true } } } } },
    });
    // Within a bill: fees first, fines next, refundable deposits last (a part payment pays the fees).
    for (const inv of all) inv.items.sort((x, y) => (LINE_ORDER[x.feeHead.feeType] ?? 5) - (LINE_ORDER[y.feeHead.feeType] ?? 5) || x.feeHead.name.localeCompare(y.feeHead.name));
    const chosen = r.invoiceIds?.length ? r.invoiceIds.map((id) => all.find((o) => o.id === id)).filter((x): x is (typeof all)[number] => !!x) : all;
    if (r.invoiceIds?.length && chosen.length !== new Set(r.invoiceIds).size && !r.allowExcess && !r.keepCredit) throw Conflict('bill-not-open', 'One of the chosen bills is not open any more');
    const ordered = r.allowExcess ? [...chosen, ...all.filter((a) => !chosen.includes(a))] : chosen;
    const lines = ordered.flatMap((inv) => inv.items.map((it) => ({ id: it.id, invoiceId: inv.id, duePaise: paise(it.netAmount) - paise(it.paidAmount) })));
    const due = lines.reduce((a, l) => a + l.duePaise, 0);
    if (!r.allowExcess && !r.keepCredit) {
      if (due === 0) throw Conflict('nothing-due', 'Nothing is due from this student');
      if (r.amountPaise > due) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'more-than-due', `Only ${formatINR(due)} is due on the chosen bills`, [{ field: 'amount', message: `At most ${formatINR(due)}` }]);
    }
    const { allocations, leftPaise } = allocate(r.amountPaise, lines);

    const fy = await ensureFinancialYear(tx, s.tenantId, r.date);
    const receiptNo = await allocateNo(this.numbering, tx, 'RECEIPT', s.campusId, fy.name, r.userId);
    const p = await tx.payment.create({
      data: {
        tenantId: s.tenantId, campusId: s.campusId, receiptNo, studentId: s.id, payerName: r.payerName, paymentDate: day(r.date), amount: fromPaise(r.amountPaise), paymentMode: r.mode,
        referenceNo: r.referenceNo, chequeDate: r.chequeDate ? day(r.chequeDate) : null, bankName: r.bankName, notes: r.notes,
        cashierSessionId: r.sessionId, idempotencyKey: r.idempotencyKey, createdBy: r.userId,
      },
    });
    if (allocations.length) {
      await tx.paymentAllocation.createMany({
        data: allocations.map((a) => ({ tenantId: s.tenantId, paymentId: p.id, invoiceId: lines.find((l) => l.id === a.id)!.invoiceId, invoiceItemId: a.id, amount: fromPaise(a.amountPaise) })),
      });
      await this.applyAllocations(tx, ordered, allocations.map((a) => ({ itemId: a.id, paise: a.amountPaise })));
    }

    const chart = await ensureChart(tx, s.tenantId);
    const entry = await post(tx, this.numbering, {
      tenantId: s.tenantId, campusId: s.campusId, date: r.date, voucherType: 'RECEIPT', sourceType: 'PAYMENT', sourceId: p.id, userId: r.userId,
      narration: `Receipt ${receiptNo} · ${s.admissionNo} ${s.firstName} ${s.lastName ?? ''} · ${r.mode}${r.referenceNo ? ` ${r.referenceNo}` : ''}`,
      lines: [
        { accountId: chart.get(CASH_ACCOUNT[r.mode])!, debitPaise: r.amountPaise },
        { accountId: chart.get('STUDENT_RECEIVABLE')!, creditPaise: r.amountPaise - leftPaise, partyType: 'STUDENT', partyId: s.id },
        { accountId: chart.get('FEE_ADVANCE')!, creditPaise: leftPaise, partyType: 'STUDENT', partyId: s.id },
      ],
    });
    return tx.payment.update({ where: { id: p.id }, data: { journalEntryId: entry.id } });
  }

  /** Adds (or with negative paise removes) paid amounts on bill lines and bills, and resets bill status. */
  private async applyAllocations(tx: Tx, invoices: { id: string; netAmount: Prisma.Decimal; paidAmount: Prisma.Decimal; items: { id: string; paidAmount: Prisma.Decimal }[] }[], moves: { itemId: string; paise: number }[]) {
    for (const inv of invoices) {
      const mine = moves.filter((m) => inv.items.some((i) => i.id === m.itemId));
      if (!mine.length) continue;
      for (const m of mine) {
        const it = inv.items.find((i) => i.id === m.itemId)!;
        await tx.feeInvoiceItem.update({ where: { id: it.id }, data: { paidAmount: fromPaise(paise(it.paidAmount) + m.paise) } });
      }
      const paid = paise(inv.paidAmount) + mine.reduce((a, m) => a + m.paise, 0);
      const net = paise(inv.netAmount);
      await tx.feeInvoice.update({ where: { id: inv.id }, data: { paidAmount: fromPaise(paid), balanceAmount: fromPaise(net - paid), status: statusOf(net, paid) } });
    }
  }

  // ───────────── Cancel & bounce ─────────────

  private async undo(tx: Tx, id: string, auth: AuthContext, status: 'CANCELLED' | 'BOUNCED', reason: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM payments WHERE id = ${id}::uuid FOR UPDATE`;
    const p = rows.length ? await tx.payment.findUnique({ where: { id }, include: { allocations: true } }) : null;
    if (!p || !canAccessCampus(this.scope(auth, CANCEL), p.campusId)) throw NotFound('Receipt');
    if (p.status !== 'SUCCESS') throw Conflict('receipt-final', `This receipt is already ${p.status.toLowerCase()}`);
    if (status === 'BOUNCED' && !['CHEQUE', 'DD'].includes(p.paymentMode)) throw Conflict('not-a-cheque', 'Only a cheque or DD can bounce');
    if (await tx.refund.count({ where: { paymentId: id, status: { in: ['PENDING', 'PAID'] } } })) throw Conflict('receipt-refunded', 'This receipt has a refund; it cannot be cancelled');
    if (p.paymentMode === 'ONLINE') throw Conflict('online-receipt', 'An online payment is returned with a refund, not cancelled');
    // Phase 23: money this receipt left as credit must still be there (not used on another bill).
    const toCredit = paise(p.amount) - p.allocations.reduce((a, x) => a + paise(x.amount), 0);
    if (toCredit > 0) {
      await lockCredit(tx, p.studentId);
      const credit = await creditBalancePaise(tx, p.tenantId, p.studentId);
      if (toCredit > credit) throw Conflict('credit-used', `${formatINR(toCredit)} of this receipt was kept as credit and has since been used. Cancel that credit adjustment first.`);
    }
    const invIds = [...new Set(p.allocations.map((a) => a.invoiceId))];
    await tx.$queryRaw`SELECT id FROM fee_invoices WHERE id = ANY(${invIds}::uuid[]) FOR UPDATE`;
    const invoices = await tx.feeInvoice.findMany({ where: { id: { in: invIds } }, include: { items: true } });
    await this.applyAllocations(tx, invoices, p.allocations.map((a) => ({ itemId: a.invoiceItemId, paise: -paise(a.amount) })));
    if (p.journalEntryId) await reverse(tx, this.numbering, p.journalEntryId, iso(todayIST()), `${status === 'BOUNCED' ? 'Bounced' : 'Cancelled'} receipt ${p.receiptNo}: ${reason}`, auth.userId);
    return { p, updated: await tx.payment.update({ where: { id }, data: { status, cancelledReason: reason, cancelledAt: new Date(), cancelledBy: auth.userId } }) };
  }

  async cancel(id: string, reason: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const { p, updated } = await this.undo(tx, id, auth, 'CANCELLED', reason);
      await this.audit.log(tx, { tenantId: p.tenantId, userId: auth.userId, campusId: p.campusId, action: 'UPDATE', entityType: 'PAYMENT', entityId: id, oldValues: { status: 'SUCCESS' }, newValues: { status: 'CANCELLED', reason }, reason }, client);
      return updated;
    });
  }

  /** A cheque / DD came back unpaid: the dues reopen; optionally a bounce charge is billed. */
  async bounce(id: string, input: BounceInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const { p, updated } = await this.undo(tx, id, auth, 'BOUNCED', input.reason);
      let charge = null;
      if (input.chargeAmount && toPaise(input.chargeAmount) > 0) {
        const s = await tx.student.findUniqueOrThrow({ where: { id: p.studentId }, select: { id: true, tenantId: true, campusId: true, firstName: true, lastName: true, admissionNo: true } });
        charge = await this.billing.chargeInTx(tx, s, { feeHeadId: input.chargeFeeHeadId!, amount: input.chargeAmount, dueDate: iso(todayIST()), description: `Cheque bounce charge (${p.referenceNo ?? p.receiptNo})` }, auth.userId);
      }
      await this.audit.log(tx, { tenantId: p.tenantId, userId: auth.userId, campusId: p.campusId, action: 'UPDATE', entityType: 'PAYMENT', entityId: id, oldValues: { status: 'SUCCESS' }, newValues: { status: 'BOUNCED', reason: input.reason, charge: charge?.invoiceNo ?? null }, reason: input.reason }, client);
      return { ...updated, chargeInvoiceNo: charge?.invoiceNo ?? null };
    });
  }

  // ───────────── Receipt ─────────────

  async receipt(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const p = await tx.payment.findUnique({
        where: { id },
        include: {
          student: { select: { id: true, firstName: true, lastName: true, admissionNo: true, campus: { select: { name: true, code: true, address: true, city: true, phone: true } } } },
          allocations: { include: { invoice: { select: { invoiceNo: true, description: true } }, item: { select: { feeHead: { select: { name: true, code: true } } } } } },
        },
      });
      const read = this.scope(auth, PERMISSIONS.FEE_READ);
      if (!p || !canAccessCampus(read, p.campusId)) throw NotFound('Receipt');
      const tenant = await tx.tenant.findUnique({ where: { id: p.tenantId }, select: { name: true, nameLocal: true } });
      const cashier = p.createdBy ? await tx.user.findUnique({ where: { id: p.createdBy }, select: { fullName: true } }) : null;
      const enrol = await tx.studentEnrollment.findFirst({ where: { studentId: p.studentId, status: 'ACTIVE' }, orderBy: { enrolledOn: 'desc' }, select: { section: { select: { name: true, level: { select: { name: true } } } } } });
      const balance = await tx.feeInvoice.aggregate({ where: { studentId: p.studentId, status: { in: ['UNPAID', 'PARTIAL'] } }, _sum: { balanceAmount: true } });
      return {
        ...p,
        institution: tenant?.name ?? '',
        institutionLocal: tenant?.nameLocal ?? null,
        cashierName: cashier?.fullName ?? null,
        className: enrol ? `${enrol.section.level.name} – ${enrol.section.name}` : null,
        balanceAfter: fromPaise(paise(balance._sum.balanceAmount ?? 0)),
      };
    });
  }
}
