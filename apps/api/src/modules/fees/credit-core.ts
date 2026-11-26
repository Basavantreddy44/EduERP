import { randomUUID } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import type { Prisma } from '@eduerp/db';
import { allocate, formatINR, fromPaise, toPaise } from '@eduerp/shared';
import type { Tx } from '../../common/prisma.service';
import { AppError, Conflict, NotFound } from '../../common/problem';
import type { NumberingService } from '../numbering/numbering.service';
import { allocateNo, todayIST } from '../students/student-records';
import { ensureChart, ensureFinancialYear, post } from './ledger';

const paise = (d: Prisma.Decimal | string | number | null) => toPaise((d ?? 0).toString());
const iso = (d: Date) => d.toISOString().slice(0, 10);
const LINE_ORDER: Record<string, number> = { ACADEMIC: 0, ADMISSION: 1, EXAM: 2, TRANSPORT: 3, HOSTEL: 3, MESS: 3, OTHER: 4, FINE: 6, DEPOSIT: 9 };
const statusOf = (net: number, paid: number) => (paid <= 0 ? 'UNPAID' : paid >= net ? 'PAID' : 'PARTIAL');

/**
 * Student credit (Phase 23 F3). The credit balance is not stored anywhere: it is the student's balance
 * on the "Fees received in advance" account (credits minus debits on every line for that student,
 * reversals included), so it always matches the accounts.
 */

/** Serialises everything that spends one student's credit (adjustments, credit refunds, receipt cancels). */
export async function lockCredit(tx: Tx, studentId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`credit:${studentId}`}))`;
}

export async function creditBalancePaise(tx: Tx, tenantId: string, studentId: string): Promise<number> {
  const chart = await ensureChart(tx, tenantId);
  const rows = await tx.$queryRaw<{ bal: Prisma.Decimal | null }[]>`
    SELECT sum(l.credit - l.debit) AS bal FROM journal_lines l
     WHERE l.account_id = ${chart.get('FEE_ADVANCE')!}::uuid AND l.party_type = 'STUDENT' AND l.party_id = ${studentId}::uuid`;
  return paise(rows[0]?.bal ?? 0);
}

/** Credit that can still be used: the balance less credit refunds waiting for approval. */
export async function creditAvailablePaise(tx: Tx, tenantId: string, studentId: string): Promise<{ balance: number; pendingRefunds: number; available: number }> {
  const balance = await creditBalancePaise(tx, tenantId, studentId);
  const pending = await tx.refund.aggregate({ where: { studentId, kind: 'CREDIT', status: 'PENDING' }, _sum: { amount: true } });
  const pendingRefunds = paise(pending._sum.amount ?? 0);
  return { balance, pendingRefunds, available: Math.max(0, balance - pendingRefunds) };
}

/**
 * Uses credit against one open bill inside the caller's transaction: allocates to the bill's lines
 * (fees first, deposits last), gives an adjustment number and posts Dr Fees received in advance /
 * Cr Student receivable. Never more than the bill's balance or the available credit.
 */
export async function adjustCreditInTx(
  tx: Tx,
  numbering: NumberingService,
  a: { tenantId: string; student: { id: string; campusId: string; admissionNo: string; firstName: string; lastName: string | null }; invoiceId: string; amountPaise: number | 'ALL'; source: 'MANUAL' | 'AUTO'; note: string | null; userId: string | null },
) {
  await lockCredit(tx, a.student.id);
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM fee_invoices WHERE id = ${a.invoiceId}::uuid FOR UPDATE`;
  const inv = locked.length ? await tx.feeInvoice.findUnique({ where: { id: a.invoiceId }, include: { items: { include: { feeHead: { select: { feeType: true, name: true } } } } } }) : null;
  if (!inv || inv.studentId !== a.student.id) throw NotFound('Bill');
  if (!['UNPAID', 'PARTIAL'].includes(inv.status)) throw Conflict('bill-not-open', 'This bill is not open');
  const { available } = await creditAvailablePaise(tx, a.tenantId, a.student.id);
  const billDue = paise(inv.balanceAmount);
  const want = a.amountPaise === 'ALL' ? Math.min(available, billDue) : a.amountPaise;
  if (want <= 0) return null;
  if (want > available) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'more-than-credit', `Only ${formatINR(available)} of credit can be used`, [{ field: 'amount', message: `At most ${formatINR(available)}` }]);
  if (want > billDue) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'more-than-due', `Only ${formatINR(billDue)} is due on this bill`, [{ field: 'amount', message: `At most ${formatINR(billDue)}` }]);

  inv.items.sort((x, y) => (LINE_ORDER[x.feeHead.feeType] ?? 5) - (LINE_ORDER[y.feeHead.feeType] ?? 5) || x.feeHead.name.localeCompare(y.feeHead.name));
  const lines = inv.items.map((it) => ({ id: it.id, invoiceId: inv.id, duePaise: paise(it.netAmount) - paise(it.paidAmount) }));
  const { allocations } = allocate(want, lines);

  const date = iso(todayIST());
  const fy = await ensureFinancialYear(tx, a.tenantId, date);
  const adjustmentNo = await allocateNo(numbering, tx, 'FEE_ADJUSTMENT', a.student.campusId, fy.name, a.userId);
  const id = randomUUID();
  const chart = await ensureChart(tx, a.tenantId);
  const entry = await post(tx, numbering, {
    tenantId: a.tenantId, campusId: a.student.campusId, date, voucherType: 'JOURNAL', sourceType: 'FEE_CREDIT_ADJUSTMENT', sourceId: id, userId: a.userId,
    narration: `Credit used ${adjustmentNo} · bill ${inv.invoiceNo} · ${a.student.admissionNo} ${a.student.firstName} ${a.student.lastName ?? ''}`,
    lines: [
      { accountId: chart.get('FEE_ADVANCE')!, debitPaise: want, partyType: 'STUDENT', partyId: a.student.id },
      { accountId: chart.get('STUDENT_RECEIVABLE')!, creditPaise: want, partyType: 'STUDENT', partyId: a.student.id },
    ],
  });
  const adj = await tx.feeCreditAdjustment.create({
    data: { id, tenantId: a.tenantId, campusId: a.student.campusId, studentId: a.student.id, adjustmentNo, adjustedOn: new Date(`${date}T00:00:00Z`), amount: fromPaise(want), source: a.source, note: a.note, createdBy: a.userId, journalEntryId: entry.id },
  });
  await tx.feeCreditAdjustmentLine.createMany({ data: allocations.map((x) => ({ tenantId: a.tenantId, adjustmentId: id, invoiceId: inv.id, invoiceItemId: x.id, amount: fromPaise(x.amountPaise) })) });
  await moveBillPaid(tx, inv, allocations.map((x) => ({ itemId: x.id, paise: x.amountPaise })));
  return adj;
}

/** Adds (or with negative paise removes) paid amounts on one bill's lines and resets its status. */
export async function moveBillPaid(tx: Tx, inv: { id: string; netAmount: Prisma.Decimal; paidAmount: Prisma.Decimal; items: { id: string; paidAmount: Prisma.Decimal }[] }, moves: { itemId: string; paise: number }[]) {
  for (const m of moves) {
    const it = inv.items.find((i) => i.id === m.itemId)!;
    await tx.feeInvoiceItem.update({ where: { id: it.id }, data: { paidAmount: fromPaise(paise(it.paidAmount) + m.paise) } });
  }
  const paid = paise(inv.paidAmount) + moves.reduce((s, m) => s + m.paise, 0);
  const net = paise(inv.netAmount);
  await tx.feeInvoice.update({ where: { id: inv.id }, data: { paidAmount: fromPaise(paid), balanceAmount: fromPaise(net - paid), status: statusOf(net, paid) } });
}
