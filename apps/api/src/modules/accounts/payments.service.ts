import { Injectable, OnModuleInit } from '@nestjs/common';
import { ContraInput, ExpenseVoucherInput, JournalVoucherInput, PERMISSIONS, VendorPaymentInput, financialYearOf, fromPaise, toPaise } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { ApprovalsService } from '../approvals/approvals.service';
import { NumberingService } from '../numbering/numbering.service';
import { allocateNo } from '../students/student-records';
import { reverse } from '../fees/ledger';
import { assertOpen, ensureAccountsChart, iso, ledgerAccounts, moneyAccountIds, paise, postOpen, unprocessable, dec } from './books';

const today = () => iso(new Date(Date.now() + 330 * 60_000));
const MODE_TEXT: Record<string, string> = { CASH: 'cash', CHEQUE: 'cheque', NEFT: 'NEFT', RTGS: 'RTGS', UPI: 'UPI' };

/**
 * Payments & vouchers (M13.3). Vendor payments go against bills (partly or fully) and / or as an
 * advance; an advance is later adjusted against a bill. Expense / petty-cash, contra and journal
 * vouchers. Each is numbered, waits for approval when a rule applies (the approver is never the
 * preparer — approvals engine), and posts one balanced entry; nothing posts into a locked month.
 * Bill balances are checked with the bills locked, so two payments at once cannot overpay.
 */
@Injectable()
export class AccountPaymentsService implements OnModuleInit {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly numbering: NumberingService, private readonly approvals: ApprovalsService) {}

  onModuleInit() {
    this.approvals.onComplete('VENDOR_PAYMENT', (tx, d) => this.paymentDecided(tx, d));
    this.approvals.onComplete('ACCOUNT_VOUCHER', (tx, d) => this.voucherDecided(tx, d));
  }

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  private entry(auth: AuthContext, campusId: string | null) {
    const s = scopeFor(auth, PERMISSIONS.ACC_ENTRY);
    if (!s || (campusId ? !canAccessCampus(s, campusId) : !s.all)) throw NotFound('Campus');
  }

  /** Locks the bills and checks each allocation fits what is still due. */
  private async checkBills(tx: Tx, vendorId: string, allocations: { billId: string; amount: string }[], excludePaymentId?: string) {
    if (!allocations.length) return;
    const ids = allocations.map((a) => a.billId);
    await tx.$queryRaw`SELECT id FROM vendor_bills WHERE id = ANY(${ids}::uuid[]) FOR UPDATE`;
    const bills = new Map((await tx.vendorBill.findMany({ where: { id: { in: ids } } })).map((b) => [b.id, b]));
    // Amounts already promised by other payments still waiting for approval.
    const pending = await tx.vendorPaymentAllocation.findMany({ where: { billId: { in: ids }, isAdjustment: false, payment: { status: 'PENDING_APPROVAL', ...(excludePaymentId ? { id: { not: excludePaymentId } } : {}) } }, select: { billId: true, amount: true } });
    for (const a of allocations) {
      const b = bills.get(a.billId);
      if (!b || b.vendorId !== vendorId) throw NotFound('Bill');
      if (!['APPROVED', 'PARTIAL'].includes(b.status)) throw Conflict('bill-not-payable', `${b.internalNo} is ${b.status === 'PAID' ? 'already paid' : 'not approved yet'}`);
      const held = pending.filter((p) => p.billId === b.id).reduce((s, p) => s + paise(p.amount), 0);
      const left = paise(b.payableAmount) - paise(b.paidAmount) - held;
      if (toPaise(a.amount) > left) throw unprocessable('overpayment', `${b.internalNo}: only ₹${fromPaise(Math.max(0, left))} is still due${held ? ' (part is in a payment waiting for approval)' : ''}`, 'allocations');
    }
  }

  private async moneyLedger(tx: Tx, tenantId: string, mode: string, bankAccountId: string | null | undefined) {
    const chart = await ensureAccountsChart(tx, tenantId);
    if (mode === 'CASH') return { accountId: chart.get('CASH')!, label: 'Cash' };
    const b = await tx.bankAccount.findUnique({ where: { id: bankAccountId! } });
    if (!b || !b.isActive) throw NotFound('Bank account');
    return { accountId: b.accountId, label: `${b.bankName} ••${b.accountNoLast4}` };
  }

  // ───────────── Vendor payments ─────────────

  createPayment(input: VendorPaymentInput, auth: AuthContext, client: ClientInfo) {
    this.entry(auth, input.campusId);
    return this.db.run(this.ctx(auth), async (tx) => {
      const vendor = await tx.vendor.findUnique({ where: { id: input.vendorId } });
      if (!vendor) throw NotFound('Vendor');
      if (vendor.status !== 'ACTIVE') throw Conflict('vendor-blocked', `${vendor.name} is blocked`);
      await this.moneyLedger(tx, auth.tenantId!, input.mode, input.bankAccountId);
      await assertOpen(tx, input.paymentDate);
      await this.checkBills(tx, vendor.id, input.allocations);
      const amount = input.allocations.reduce((s, a) => s + toPaise(a.amount), 0) + toPaise(input.advanceAmount);
      const paymentNo = await allocateNo(this.numbering, tx, 'VENDOR_PAYMENT', input.campusId, financialYearOf(input.paymentDate).name, auth.userId);
      const p = await tx.vendorPayment.create({
        data: {
          tenantId: auth.tenantId!, campusId: input.campusId, paymentNo, vendorId: vendor.id, paymentDate: new Date(`${input.paymentDate}T00:00:00Z`), amount: fromPaise(amount), advanceAmount: input.advanceAmount,
          mode: input.mode, bankAccountId: input.mode === 'CASH' ? null : input.bankAccountId!, referenceNo: input.referenceNo ?? null, narration: input.narration ?? null, status: 'PENDING_APPROVAL', createdBy: auth.userId,
        },
      });
      if (input.allocations.length) await tx.vendorPaymentAllocation.createMany({ data: input.allocations.map((a) => ({ tenantId: auth.tenantId!, paymentId: p.id, billId: a.billId, amount: a.amount, createdBy: auth.userId })) });
      const req = await this.approvals.submit(tx, { tenantId: auth.tenantId!, requestedBy: auth.userId, entityType: 'VENDOR_PAYMENT', entityId: p.id, campusId: input.campusId, amount: amount / 100, summary: `${paymentNo} · pay ${vendor.name} ₹${fromPaise(amount)} by ${MODE_TEXT[input.mode]}` }, client);
      if (req) await tx.vendorPayment.update({ where: { id: p.id }, data: { approvalRequestId: req.id } });
      else await this.pay(tx, p.id, auth.userId);
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: input.campusId, action: 'CREATE', entityType: 'VENDOR_PAYMENT', entityId: p.id, newValues: { paymentNo, vendor: vendor.name, amount: fromPaise(amount), mode: input.mode, bills: input.allocations.length, advance: input.advanceAmount, needsApproval: !!req } }, client);
      return { id: p.id, paymentNo, status: req ? 'PENDING_APPROVAL' : 'PAID', amount: fromPaise(amount) };
    });
  }

  /** Pays: re-checks the bills, posts Dr vendor / Dr advances · Cr cash or bank, updates the bills. */
  private async pay(tx: Tx, paymentId: string, userId: string) {
    const p = await tx.vendorPayment.findUniqueOrThrow({ where: { id: paymentId }, include: { allocations: true, vendor: { select: { name: true } } } });
    await this.checkBills(tx, p.vendorId, p.allocations.map((a) => ({ billId: a.billId, amount: dec(a.amount) })), p.id);
    const chart = await ensureAccountsChart(tx, p.tenantId);
    const money = await this.moneyLedger(tx, p.tenantId, p.mode, p.bankAccountId);
    const toBills = p.allocations.reduce((s, a) => s + paise(a.amount), 0);
    const e = await postOpen(tx, this.numbering, {
      tenantId: p.tenantId, campusId: p.campusId, date: iso(p.paymentDate), voucherType: 'PAYMENT', sourceType: 'VENDOR_PAYMENT', sourceId: p.id, userId,
      narration: `${p.paymentNo} · paid ${p.vendor.name} by ${MODE_TEXT[p.mode]}${p.referenceNo ? ` (${p.referenceNo})` : ''}`,
      lines: [
        { accountId: chart.get('VENDORS_PAYABLE')!, debitPaise: toBills, partyType: 'VENDOR', partyId: p.vendorId },
        { accountId: chart.get('VENDOR_ADVANCES')!, debitPaise: paise(p.advanceAmount), partyType: 'VENDOR', partyId: p.vendorId },
        { accountId: money.accountId, creditPaise: paise(p.amount) },
      ] as never,
    });
    for (const a of p.allocations) await this.applyToBill(tx, a.billId, paise(a.amount));
    await tx.vendorPayment.update({ where: { id: p.id }, data: { status: 'PAID', journalEntryId: e.id } });
  }

  private async applyToBill(tx: Tx, billId: string, deltaPaise: number) {
    const b = await tx.vendorBill.findUniqueOrThrow({ where: { id: billId } });
    const paid = paise(b.paidAmount) + deltaPaise;
    await tx.vendorBill.update({ where: { id: billId }, data: { paidAmount: fromPaise(paid), status: paid <= 0 ? 'APPROVED' : paid >= paise(b.payableAmount) ? 'PAID' : 'PARTIAL' } });
  }

  private async paymentDecided(tx: Tx, d: { entityId: string; decision: 'APPROVED' | 'REJECTED' | 'CANCELLED'; userId: string }) {
    const p = await tx.vendorPayment.findUnique({ where: { id: d.entityId }, select: { id: true, status: true } });
    if (!p || p.status !== 'PENDING_APPROVAL') return;
    if (d.decision === 'APPROVED') await this.pay(tx, p.id, d.userId);
    else await tx.vendorPayment.update({ where: { id: p.id }, data: { status: 'REJECTED' } });
  }

  /** Uses part of an earlier advance against a bill: Dr vendor / Cr advances. */
  adjustAdvance(paymentId: string, billId: string, amount: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await tx.$queryRaw`SELECT id FROM vendor_payments WHERE id = ${paymentId}::uuid FOR UPDATE`;
      const p = await tx.vendorPayment.findUnique({ where: { id: paymentId }, include: { vendor: { select: { name: true } } } });
      if (!p) throw NotFound('Payment');
      this.entry(auth, p.campusId);
      if (p.status !== 'PAID') throw Conflict('payment-not-paid', 'Only a paid advance can be adjusted');
      const left = paise(p.advanceAmount) - paise(p.advanceUsed);
      if (toPaise(amount) > left) throw unprocessable('advance-short', `Only ₹${fromPaise(left)} of this advance is left`, 'amount');
      await this.checkBills(tx, p.vendorId, [{ billId, amount }]);
      const on = today();
      const chart = await ensureAccountsChart(tx, p.tenantId);
      const bill = await tx.vendorBill.findUniqueOrThrow({ where: { id: billId }, select: { internalNo: true } });
      const e = await postOpen(tx, this.numbering, {
        tenantId: p.tenantId, campusId: p.campusId, date: on, voucherType: 'JOURNAL', sourceType: 'ADVANCE_ADJUSTMENT', sourceId: p.id, userId: auth.userId,
        narration: `Advance ${p.paymentNo} adjusted against ${bill.internalNo} (${p.vendor.name})`,
        lines: [{ accountId: chart.get('VENDORS_PAYABLE')!, debitPaise: toPaise(amount), partyType: 'VENDOR', partyId: p.vendorId }, { accountId: chart.get('VENDOR_ADVANCES')!, creditPaise: toPaise(amount), partyType: 'VENDOR', partyId: p.vendorId }] as never,
      });
      await tx.vendorPaymentAllocation.create({ data: { tenantId: p.tenantId, paymentId: p.id, billId, amount, isAdjustment: true, journalEntryId: e.id, createdBy: auth.userId } });
      await tx.vendorPayment.update({ where: { id: p.id }, data: { advanceUsed: fromPaise(paise(p.advanceUsed) + toPaise(amount)) } });
      await this.applyToBill(tx, billId, toPaise(amount));
      await this.audit.log(tx, { tenantId: p.tenantId, userId: auth.userId, campusId: p.campusId, action: 'UPDATE', entityType: 'VENDOR_PAYMENT', entityId: p.id, newValues: { adjustedTo: bill.internalNo, amount } }, client);
      return { id: p.id, adjusted: amount };
    });
  }

  payments(auth: AuthContext, q: { vendorId?: string }) {
    const s = scopeFor(auth, PERMISSIONS.ACC_READ)!;
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.vendorPayment.findMany({ where: { ...(q.vendorId ? { vendorId: q.vendorId } : {}), ...(s.all ? {} : { campusId: { in: s.campusIds } }) }, orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }], take: 300, include: { vendor: { select: { name: true } }, allocations: { include: { bill: { select: { internalNo: true, billNo: true } } } } } });
      const banks = new Map((await tx.bankAccount.findMany({ select: { id: true, bankName: true, accountNoLast4: true } })).map((b) => [b.id, `${b.bankName} ••${b.accountNoLast4}`]));
      return rows.map((p) => ({
        id: p.id, paymentNo: p.paymentNo, vendorId: p.vendorId, vendor: p.vendor.name, paymentDate: iso(p.paymentDate), amount: dec(p.amount), mode: p.mode, bank: p.bankAccountId ? banks.get(p.bankAccountId) ?? null : null, referenceNo: p.referenceNo, status: p.status,
        advance: dec(p.advanceAmount), advanceLeft: fromPaise(paise(p.advanceAmount) - paise(p.advanceUsed)),
        bills: p.allocations.map((a) => ({ internalNo: a.bill.internalNo, billNo: a.bill.billNo, amount: dec(a.amount), isAdjustment: a.isAdjustment })),
      }));
    });
  }

  /** Cancels a payment: reverses it and gives the bills their balance back. Not once its advance is used. */
  cancelPayment(id: string, reason: string, date: string | undefined, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const p = await tx.vendorPayment.findUnique({ where: { id }, include: { allocations: true } });
      if (!p) throw NotFound('Payment');
      this.entry(auth, p.campusId);
      if (['CANCELLED', 'REJECTED'].includes(p.status)) throw Conflict('payment-cancelled', 'This payment is already cancelled');
      if (paise(p.advanceUsed) > 0) throw Conflict('advance-used', 'Part of this advance is already adjusted against bills');
      if (p.status === 'PAID') {
        const on = date ?? today();
        await assertOpen(tx, on);
        await reverse(tx, this.numbering, p.journalEntryId!, on, `Cancelled ${p.paymentNo}: ${reason}`, auth.userId);
        for (const a of p.allocations.filter((x) => !x.isAdjustment)) await this.applyToBill(tx, a.billId, -paise(a.amount));
      }
      await tx.vendorPayment.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason } });
      await this.audit.log(tx, { tenantId: p.tenantId, userId: auth.userId, campusId: p.campusId, action: 'CANCEL', entityType: 'VENDOR_PAYMENT', entityId: id, newValues: { reason } }, client);
      return { id, status: 'CANCELLED' };
    });
  }

  // ───────────── Expense, contra and journal vouchers ─────────────

  private async createVoucher(tx: Tx, auth: AuthContext, client: ClientInfo, v: { campusId: string | null; type: 'EXPENSE' | 'CONTRA' | 'JOURNAL'; date: string; paidTo?: string | null; referenceNo?: string | null; narration: string; lines: { accountId: string; costCentreId?: string | null; debitPaise: number; creditPaise: number }[] }) {
    await assertOpen(tx, v.date);
    const amount = v.lines.reduce((s, l) => s + l.debitPaise, 0);
    const voucherNo = await allocateNo(this.numbering, tx, 'VOUCHER', v.campusId ?? '', financialYearOf(v.date).name, auth.userId);
    const row = await tx.accountVoucher.create({ data: { tenantId: auth.tenantId!, campusId: v.campusId, voucherNo, voucherType: v.type, voucherDate: new Date(`${v.date}T00:00:00Z`), amount: fromPaise(amount), paidTo: v.paidTo ?? null, referenceNo: v.referenceNo ?? null, narration: v.narration, status: 'PENDING_APPROVAL', createdBy: auth.userId } });
    await tx.accountVoucherLine.createMany({ data: v.lines.map((l, i) => ({ tenantId: auth.tenantId!, voucherId: row.id, lineNo: i + 1, accountId: l.accountId, costCentreId: l.costCentreId ?? null, debit: fromPaise(l.debitPaise), credit: fromPaise(l.creditPaise) })) });
    const label = { EXPENSE: 'Expense', CONTRA: 'Contra', JOURNAL: 'Journal' }[v.type];
    const req = await this.approvals.submit(tx, { tenantId: auth.tenantId!, requestedBy: auth.userId, entityType: 'ACCOUNT_VOUCHER', entityId: row.id, campusId: v.campusId, amount: amount / 100, summary: `${voucherNo} · ${label} voucher ₹${fromPaise(amount)}: ${v.narration}` }, client);
    if (req) await tx.accountVoucher.update({ where: { id: row.id }, data: { approvalRequestId: req.id } });
    else await this.postVoucher(tx, row.id, auth.userId);
    await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: v.campusId, action: 'CREATE', entityType: 'ACCOUNT_VOUCHER', entityId: row.id, newValues: { voucherNo, type: v.type, amount: fromPaise(amount), needsApproval: !!req } }, client);
    return { id: row.id, voucherNo, status: req ? 'PENDING_APPROVAL' : 'POSTED' };
  }

  private async postVoucher(tx: Tx, id: string, userId: string) {
    const v = await tx.accountVoucher.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    const e = await postOpen(tx, this.numbering, {
      tenantId: v.tenantId, campusId: v.campusId, date: iso(v.voucherDate), voucherType: v.voucherType === 'EXPENSE' ? 'PAYMENT' : v.voucherType === 'CONTRA' ? 'CONTRA' : 'JOURNAL', sourceType: 'ACCOUNT_VOUCHER', sourceId: v.id, userId,
      narration: `${v.voucherNo} · ${v.paidTo ? `${v.paidTo}: ` : ''}${v.narration}`,
      lines: v.lines.map((l) => ({ accountId: l.accountId, costCentreId: l.costCentreId, debitPaise: paise(l.debit), creditPaise: paise(l.credit) })) as never,
    });
    await tx.accountVoucher.update({ where: { id }, data: { status: 'POSTED', journalEntryId: e.id } });
  }

  private async voucherDecided(tx: Tx, d: { entityId: string; decision: 'APPROVED' | 'REJECTED' | 'CANCELLED'; userId: string }) {
    const v = await tx.accountVoucher.findUnique({ where: { id: d.entityId }, select: { id: true, status: true } });
    if (!v || v.status !== 'PENDING_APPROVAL') return;
    if (d.decision === 'APPROVED') await this.postVoucher(tx, v.id, d.userId);
    else await tx.accountVoucher.update({ where: { id: v.id }, data: { status: 'REJECTED' } });
  }

  expense(input: ExpenseVoucherInput, auth: AuthContext, client: ClientInfo) {
    this.entry(auth, input.campusId);
    return this.db.run(this.ctx(auth), async (tx) => {
      const accts = await ledgerAccounts(tx, [input.expenseAccountId, input.paidFromAccountId]);
      if (accts.get(input.expenseAccountId)!.accountType !== 'EXPENSE') throw unprocessable('not-expense', 'Choose an expense account', 'expenseAccountId');
      if (!(await moneyAccountIds(tx, auth.tenantId!)).has(input.paidFromAccountId)) throw unprocessable('not-money', 'Pay from cash, petty cash or a bank account', 'paidFromAccountId');
      if (input.costCentreId && !(await tx.costCentre.findUnique({ where: { id: input.costCentreId }, select: { id: true } }))) throw NotFound('Cost centre');
      const amt = toPaise(input.amount);
      return this.createVoucher(tx, auth, client, { campusId: input.campusId, type: 'EXPENSE', date: input.voucherDate, paidTo: input.paidTo, narration: input.narration, lines: [{ accountId: input.expenseAccountId, costCentreId: input.costCentreId ?? null, debitPaise: amt, creditPaise: 0 }, { accountId: input.paidFromAccountId, debitPaise: 0, creditPaise: amt }] });
    });
  }

  contra(input: ContraInput, auth: AuthContext, client: ClientInfo) {
    this.entry(auth, input.campusId ?? null);
    return this.db.run(this.ctx(auth), async (tx) => {
      const money = await moneyAccountIds(tx, auth.tenantId!);
      if (!money.has(input.fromAccountId) || !money.has(input.toAccountId)) throw unprocessable('not-money', 'A contra moves money between cash, petty cash and bank accounts', 'fromAccountId');
      const amt = toPaise(input.amount);
      return this.createVoucher(tx, auth, client, { campusId: input.campusId ?? null, type: 'CONTRA', date: input.voucherDate, referenceNo: input.referenceNo, narration: input.narration, lines: [{ accountId: input.toAccountId, debitPaise: amt, creditPaise: 0 }, { accountId: input.fromAccountId, debitPaise: 0, creditPaise: amt }] });
    });
  }

  journal(input: JournalVoucherInput, auth: AuthContext, client: ClientInfo) {
    this.entry(auth, input.campusId ?? null);
    return this.db.run(this.ctx(auth), async (tx) => {
      const accts = await ledgerAccounts(tx, input.lines.map((l) => l.accountId));
      const chart = await ensureAccountsChart(tx, auth.tenantId!);
      // Party accounts (students, vendors) are changed only through their own screens.
      const guarded = new Set([chart.get('STUDENT_RECEIVABLE'), chart.get('VENDORS_PAYABLE'), chart.get('VENDOR_ADVANCES')]);
      for (const l of input.lines) if (guarded.has(l.accountId)) throw unprocessable('party-account', `${accts.get(l.accountId)!.name} is changed only through fees or vendor screens`, 'lines');
      return this.createVoucher(tx, auth, client, { campusId: input.campusId ?? null, type: 'JOURNAL', date: input.voucherDate, narration: input.narration, lines: input.lines.map((l) => ({ accountId: l.accountId, costCentreId: l.costCentreId ?? null, debitPaise: toPaise(l.debit), creditPaise: toPaise(l.credit) })) });
    });
  }

  vouchers(auth: AuthContext, q: { type?: string }) {
    const s = scopeFor(auth, PERMISSIONS.ACC_READ)!;
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.accountVoucher.findMany({ where: { voucherType: q.type ? q.type : { in: ['EXPENSE', 'CONTRA', 'JOURNAL', 'BANK'] }, ...(s.all ? {} : { OR: [{ campusId: null }, { campusId: { in: s.campusIds } }] }) }, orderBy: [{ voucherDate: 'desc' }, { createdAt: 'desc' }], take: 300, include: { lines: { orderBy: { lineNo: 'asc' } } } });
      const accts = new Map((await tx.account.findMany({ where: { id: { in: rows.flatMap((r) => r.lines.map((l) => l.accountId)) } }, select: { id: true, name: true } })).map((a) => [a.id, a.name]));
      return rows.map((v) => ({ id: v.id, voucherNo: v.voucherNo, voucherType: v.voucherType, voucherDate: iso(v.voucherDate), amount: dec(v.amount), paidTo: v.paidTo, referenceNo: v.referenceNo, narration: v.narration, status: v.status, lines: v.lines.map((l) => ({ account: accts.get(l.accountId) ?? '', debit: dec(l.debit), credit: dec(l.credit) })) }));
    });
  }

  cancelVoucher(id: string, reason: string, date: string | undefined, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const v = await tx.accountVoucher.findUnique({ where: { id } });
      if (!v) throw NotFound('Voucher');
      this.entry(auth, v.campusId);
      if (['CANCELLED', 'REJECTED'].includes(v.status)) throw Conflict('voucher-cancelled', 'This voucher is already cancelled');
      if (v.journalEntryId) {
        if (await tx.bankReconciliation.findFirst({ where: { journalLineId: { in: (await tx.journalLine.findMany({ where: { journalEntryId: v.journalEntryId }, select: { id: true } })).map((l) => l.id) } }, select: { id: true } })) throw Conflict('reconciled', 'This voucher is matched to a bank statement line — unmatch it first');
        const on = date ?? today();
        await assertOpen(tx, on);
        await reverse(tx, this.numbering, v.journalEntryId, on, `Cancelled ${v.voucherNo}: ${reason}`, auth.userId);
      }
      await tx.accountVoucher.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason } });
      await this.audit.log(tx, { tenantId: v.tenantId, userId: auth.userId, campusId: v.campusId, action: 'CANCEL', entityType: 'ACCOUNT_VOUCHER', entityId: id, newValues: { reason } }, client);
      return { id, status: 'CANCELLED' };
    });
  }
}
