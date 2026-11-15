import { Injectable } from '@nestjs/common';
import type { Prisma } from '@eduerp/db';
import { fromPaise, lateFee, toPaise } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { todayIST } from '../students/student-records';
import { ensureChart, post } from './ledger';

const paise = (d: Prisma.Decimal | string | number) => toPaise(d.toString());
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

type Rule = { id: string; campusId: string | null; feeHeadId: string | null; graceDays: number; fineType: 'FIXED' | 'PER_DAY' | 'PERCENT'; fineValue: Prisma.Decimal; maxFine: Prisma.Decimal | null };

/** The most specific active rule for a bill line: fee head + campus beats fee head beats campus beats "all". */
export function ruleFor(rules: Rule[], campusId: string, feeHeadId: string): Rule | null {
  let best: Rule | null = null;
  let bestScore = -1;
  for (const r of rules) {
    if (r.campusId && r.campusId !== campusId) continue;
    if (r.feeHeadId && r.feeHeadId !== feeHeadId) continue;
    const score = (r.feeHeadId ? 2 : 0) + (r.campusId ? 1 : 0);
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return best;
}

/**
 * Late fees (M2.5). For every open bill past its due date (and not waived), each line's late fee is
 * worked out from its rule on what is still unpaid of the line's fees (payments cover fees before
 * fines). A fine only ever grows (up to the rule's cap); running again the same day adds nothing.
 * Every increase posts Dr Student receivable / Cr Fines & late fees.
 */
@Injectable()
export class LateFeeService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  async apply(tenantId: string, opts: { today?: string; source: 'SCHEDULE' | 'MANUAL'; userId: string | null; campusIds?: string[] | null }) {
    const today = opts.today ?? iso(todayIST());
    return this.db.run({ tenantId, userId: opts.userId }, async (tx) => {
      const rules = (await tx.lateFeeRule.findMany({ where: { status: 'ACTIVE' } })) as Rule[];
      if (!rules.length) return { invoiceCount: 0, totalFine: '0.00' };
      // One pass at a time per institution.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`late-fees:${tenantId}`}))`;
      const bills = await tx.feeInvoice.findMany({
        where: { status: { in: ['UNPAID', 'PARTIAL'] }, fineWaived: false, dueDate: { lt: new Date(`${today}T00:00:00Z`) }, ...(opts.campusIds ? { campusId: { in: opts.campusIds } } : {}) },
        include: { items: true },
      });
      const chart = await ensureChart(tx, tenantId);
      let count = 0;
      let total = 0;
      for (const inv of bills) {
        const days = daysBetween(iso(inv.dueDate), today);
        let delta = 0;
        for (const it of inv.items) {
          const r = ruleFor(rules, inv.campusId, it.feeHeadId);
          if (!r) continue;
          const principal = paise(it.amount) - paise(it.concession);
          const unpaid = Math.max(0, principal - paise(it.paidAmount));
          const target = lateFee({ graceDays: r.graceDays, fineType: r.fineType, fineValuePaise: paise(r.fineValue), maxFinePaise: r.maxFine ? paise(r.maxFine) : null }, unpaid, days);
          const add = target - paise(it.fine);
          if (add <= 0) continue;
          await tx.feeInvoiceItem.update({ where: { id: it.id }, data: { fine: fromPaise(paise(it.fine) + add), netAmount: fromPaise(paise(it.netAmount) + add) } });
          delta += add;
        }
        if (!delta) continue;
        await tx.feeInvoice.update({
          where: { id: inv.id },
          data: { fineAmount: fromPaise(paise(inv.fineAmount) + delta), netAmount: fromPaise(paise(inv.netAmount) + delta), balanceAmount: fromPaise(paise(inv.balanceAmount) + delta), status: paise(inv.paidAmount) > 0 ? 'PARTIAL' : 'UNPAID' },
        });
        await post(tx, this.numbering, {
          tenantId, campusId: inv.campusId, date: today, voucherType: 'JOURNAL', sourceType: 'FEE_INVOICE', sourceId: inv.id, userId: opts.userId,
          narration: `Late fee on bill ${inv.invoiceNo} (${days} days late)`,
          lines: [
            { accountId: chart.get('STUDENT_RECEIVABLE')!, debitPaise: delta, partyType: 'STUDENT', partyId: inv.studentId },
            { accountId: chart.get('INCOME_FINE')!, creditPaise: delta },
          ],
        });
        count += 1;
        total += delta;
      }
      if (count) {
        const run = await tx.lateFeeRun.create({ data: { tenantId, runDate: new Date(`${today}T00:00:00Z`), invoiceCount: count, totalFine: fromPaise(total), source: opts.source, createdBy: opts.userId } });
        await this.audit.log(tx, { tenantId, userId: opts.userId, action: 'CREATE', entityType: 'LATE_FEE_RUN', entityId: run.id, newValues: { invoiceCount: count, totalFine: fromPaise(total), date: today } });
      }
      return { invoiceCount: count, totalFine: fromPaise(total) };
    }, { timeout: 180_000 });
  }

  /** Every institution with an active late-fee rule (worker, hourly; same-day repeats add nothing). */
  async applyAll() {
    // Institutions are listed in platform context; each pass then runs inside its own tenant (RLS).
    const tenants = await this.db.run({ isPlatform: true }, (tx) => tx.tenant.findMany({ where: { status: { in: ['ACTIVE', 'TRIAL', 'GRACE'] } }, select: { id: true } }));
    const out = [];
    for (const t of tenants) {
      const r = await this.apply(t.id, { source: 'SCHEDULE', userId: null });
      if (r.invoiceCount) out.push({ tenantId: t.id, ...r });
    }
    return out;
  }

  /** Removes a bill's late fee (with a reason) and stops it coming back; reverses its postings. */
  async waive(tx: Tx, invoiceId: string, reason: string, userId: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM fee_invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`;
    const inv = rows.length ? await tx.feeInvoice.findUnique({ where: { id: invoiceId }, include: { items: true } }) : null;
    if (!inv) return null;
    const fine = paise(inv.fineAmount);
    return { inv, fine, apply: async () => {
      for (const it of inv.items) {
        if (!paise(it.fine)) continue;
        await tx.feeInvoiceItem.update({ where: { id: it.id }, data: { fine: '0', netAmount: fromPaise(paise(it.netAmount) - paise(it.fine)) } });
      }
      const net = paise(inv.netAmount) - fine;
      const paid = paise(inv.paidAmount);
      const updated = await tx.feeInvoice.update({
        where: { id: inv.id },
        data: { fineAmount: '0', netAmount: fromPaise(net), balanceAmount: fromPaise(net - paid), status: paid >= net ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID', fineWaived: true, fineWaiveReason: reason },
      });
      if (fine) {
        const chart = await ensureChart(tx, inv.tenantId);
        await post(tx, this.numbering, {
          tenantId: inv.tenantId, campusId: inv.campusId, date: iso(todayIST()), voucherType: 'JOURNAL', sourceType: 'FEE_INVOICE', sourceId: inv.id, userId,
          narration: `Late fee waived on bill ${inv.invoiceNo}: ${reason}`,
          lines: [
            { accountId: chart.get('INCOME_FINE')!, debitPaise: fine },
            { accountId: chart.get('STUDENT_RECEIVABLE')!, creditPaise: fine, partyType: 'STUDENT', partyId: inv.studentId },
          ],
        });
      }
      return updated;
    } };
  }
}
