import { DEFAULT_INCOME_ACCOUNT, FeeType, STARTER_CHART, financialYearOf, fromPaise, toPaise } from '@eduerp/shared';
import type { Tx } from '../../common/prisma.service';
import { NotFound } from '../../common/problem';
import type { NumberingService } from '../numbering/numbering.service';
import { allocateNo } from '../students/student-records';

/**
 * Basic accounts used by fees (B1 §11). The starter chart is created the first time an institution
 * touches fees; it is idempotent and safe under concurrency (unique code per tenant).
 */
export async function ensureChart(tx: Tx, tenantId: string): Promise<Map<string, string>> {
  const have = await tx.account.findMany({ where: { systemKey: { not: null } }, select: { id: true, systemKey: true } });
  const byKey = new Map(have.map((a) => [a.systemKey!, a.id]));
  if (STARTER_CHART.every((a) => byKey.has(a.key))) return byKey;
  for (const pass of [true, false]) {
    for (const a of STARTER_CHART.filter((x) => !!x.group === pass)) {
      if (byKey.has(a.key)) continue;
      const parentId = a.parent ? byKey.get(a.parent) ?? null : null;
      await tx.$executeRaw`
        INSERT INTO accounts (id, tenant_id, code, name, account_type, parent_id, is_group, is_system, system_key, updated_at)
        VALUES (gen_random_uuid(), ${tenantId}::uuid, ${a.code}, ${a.name}, ${a.type}, ${parentId}::uuid, ${!!a.group}, true, ${a.key}, now())
        ON CONFLICT DO NOTHING`;
      const row = await tx.account.findFirst({ where: { OR: [{ systemKey: a.key }, { code: a.code }] }, select: { id: true } });
      if (row) byKey.set(a.key, row.id);
    }
  }
  return byKey;
}

export async function systemAccount(tx: Tx, tenantId: string, key: string) {
  const id = (await ensureChart(tx, tenantId)).get(key);
  if (!id) throw NotFound(`Account ${key}`);
  return id;
}

export const defaultIncomeKey = (t: FeeType) => DEFAULT_INCOME_ACCOUNT[t];

/** The financial year containing a date (created on first use). */
export async function ensureFinancialYear(tx: Tx, tenantId: string, isoDate: string) {
  const fy = financialYearOf(isoDate);
  await tx.$executeRaw`
    INSERT INTO financial_years (id, tenant_id, name, start_date, end_date)
    VALUES (gen_random_uuid(), ${tenantId}::uuid, ${fy.name}, ${fy.startDate}::date, ${fy.endDate}::date)
    ON CONFLICT DO NOTHING`;
  return tx.financialYear.findFirstOrThrow({ where: { name: fy.name } });
}

export interface PostingLine { accountId: string; debitPaise?: number; creditPaise?: number; partyType?: 'STUDENT' | 'VENDOR'; partyId?: string; costCentreId?: string | null }

/**
 * Posts a balanced journal entry (W-04). Lines on the same account and side are merged; zero lines are
 * dropped. Debits must equal credits to the paisa; the database checks it again at commit.
 */
export async function post(
  tx: Tx,
  numbering: NumberingService,
  e: { tenantId: string; campusId: string | null; date: string; voucherType: 'RECEIPT' | 'PAYMENT' | 'JOURNAL' | 'SALES' | 'CONTRA' | 'PURCHASE'; sourceType: string; sourceId: string; narration: string; userId: string | null; lines: PostingLine[]; reversalOfId?: string },
) {
  const merged = new Map<string, PostingLine & { debitPaise: number; creditPaise: number }>();
  for (const l of e.lines) {
    const side = (l.debitPaise ?? 0) > 0 ? 'D' : 'C';
    const k = `${l.accountId}|${side}|${l.partyId ?? ''}|${l.costCentreId ?? ''}`;
    const m = merged.get(k) ?? { ...l, debitPaise: 0, creditPaise: 0 };
    m.debitPaise += l.debitPaise ?? 0;
    m.creditPaise += l.creditPaise ?? 0;
    merged.set(k, m);
  }
  const lines = [...merged.values()].filter((l) => l.debitPaise > 0 || l.creditPaise > 0);
  const debit = lines.reduce((a, l) => a + l.debitPaise, 0);
  const credit = lines.reduce((a, l) => a + l.creditPaise, 0);
  if (debit !== credit || debit === 0) throw new Error(`Unbalanced posting ${e.sourceType}: debit ${debit} ≠ credit ${credit}`);
  const fy = await ensureFinancialYear(tx, e.tenantId, e.date);
  const entryNo = await allocateNo(numbering, tx, 'JOURNAL', e.campusId ?? '', fy.name, e.userId || null);
  const entry = await tx.journalEntry.create({
    data: {
      tenantId: e.tenantId, campusId: e.campusId, entryNo, financialYearId: fy.id, entryDate: new Date(`${e.date}T00:00:00Z`), voucherType: e.voucherType,
      sourceType: e.sourceType, sourceId: e.sourceId, narration: e.narration.slice(0, 500), totalAmount: fromPaise(debit), reversalOfId: e.reversalOfId ?? null, postedBy: e.userId || null,
    },
  });
  await tx.journalLine.createMany({
    data: lines.map((l) => ({
      tenantId: e.tenantId, journalEntryId: entry.id, accountId: l.accountId, debit: fromPaise(l.debitPaise), credit: fromPaise(l.creditPaise), partyType: l.partyType ?? null, partyId: l.partyId ?? null, costCentreId: l.costCentreId ?? null,
    })),
  });
  return entry;
}

/** Reverses a posted entry with a mirror entry dated `date`; the original is marked REVERSED. */
export async function reverse(tx: Tx, numbering: NumberingService, entryId: string, date: string, narration: string, userId: string | null) {
  const orig = await tx.journalEntry.findUniqueOrThrow({ where: { id: entryId }, include: { lines: true } });
  if (orig.status !== 'POSTED') throw new Error(`Entry ${orig.entryNo} is already reversed`);
  const rev = await post(tx, numbering, {
    tenantId: orig.tenantId, campusId: orig.campusId, date, voucherType: orig.voucherType as 'JOURNAL', sourceType: orig.sourceType, sourceId: orig.sourceId!, narration, userId, reversalOfId: orig.id,
    lines: orig.lines.map((l) => ({ accountId: l.accountId, debitPaise: toPaise(l.credit.toString()), creditPaise: toPaise(l.debit.toString()), partyType: (l.partyType as 'STUDENT' | 'VENDOR') ?? undefined, partyId: l.partyId ?? undefined, costCentreId: l.costCentreId })),
  });
  await tx.journalEntry.update({ where: { id: orig.id }, data: { status: 'REVERSED' } });
  return rev;
}
