import { HttpStatus } from '@nestjs/common';
import { ACCOUNTS_CHART, STARTER_TAX_CODES, STARTER_TDS_SECTIONS, StarterAccount, financialYearOf, fromPaise, toPaise } from '@eduerp/shared';
import { Tx } from '../../common/prisma.service';
import { AppError, Conflict } from '../../common/problem';
import { NumberingService } from '../numbering/numbering.service';
import { PostingLine, ensureChart, post } from '../fees/ledger';

/** Shared helpers of the accounts module (Phase 13). */

export const unprocessable = (code: string, detail: string, field?: string) =>
  new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, detail, field ? [{ field, message: detail }] : undefined);
export const paise = (d: { toString(): string } | null | undefined) => (d == null ? 0 : toPaise(d.toString()));
/** A stored decimal as money text with two decimals ("70800.00", "1.00"). */
export function dec(d: { toString(): string }): string;
export function dec(d: { toString(): string } | null | undefined): string | null;
export function dec(d: { toString(): string } | null | undefined) { return d == null ? null : fromPaise(paise(d)); }
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const monthStartOf = (isoDate: string) => `${isoDate.slice(0, 7)}-01`;

/** The fees starter chart plus the accounts-module accounts (idempotent; safe under concurrency). */
export async function ensureAccountsChart(tx: Tx, tenantId: string): Promise<Map<string, string>> {
  const byKey = await ensureChart(tx, tenantId);
  if (ACCOUNTS_CHART.every((a) => byKey.has(a.key))) return byKey;
  // Groups first, then their children (a group may itself sit under a starter group).
  const order: StarterAccount[] = [...ACCOUNTS_CHART.filter((a) => a.group), ...ACCOUNTS_CHART.filter((a) => !a.group)];
  for (const a of order) {
    if (byKey.has(a.key)) continue;
    const parentId = a.parent ? byKey.get(a.parent) ?? null : null;
    await tx.$executeRaw`
      INSERT INTO accounts (id, tenant_id, code, name, account_type, parent_id, is_group, is_system, system_key, created_at, updated_at)
      VALUES (gen_random_uuid(), ${tenantId}::uuid, ${a.code}, ${a.name}, ${a.type}, ${parentId}::uuid, ${!!a.group}, true, ${a.key}, now(), now())
      ON CONFLICT DO NOTHING`;
    const row = await tx.account.findFirst({ where: { OR: [{ systemKey: a.key }, { code: a.code }] }, select: { id: true } });
    if (row) byKey.set(a.key, row.id);
  }
  return byKey;
}

/** Starting GST codes and TDS sections (CD-85) — only when the institution has none yet. */
export async function ensureStatutory(tx: Tx, tenantId: string) {
  if (!(await tx.taxCode.count())) {
    await tx.taxCode.createMany({ data: STARTER_TAX_CODES.map((t) => ({ tenantId, code: t.code, name: t.name, ratePercent: t.ratePercent, itcClaimable: t.itcClaimable, effectiveFrom: new Date(`${t.effectiveFrom}T00:00:00Z`) })), skipDuplicates: true });
  }
  if (!(await tx.tdsSection.count())) {
    await tx.tdsSection.createMany({ data: STARTER_TDS_SECTIONS.map((s) => ({ tenantId, sectionCode: s.sectionCode, description: s.description, rateIndividual: s.rateIndividual, rateOthers: s.rateOthers, rateNoPan: s.rateNoPan, thresholdSingle: s.thresholdSingle, thresholdAnnual: s.thresholdAnnual, effectiveFrom: new Date(`${s.effectiveFrom}T00:00:00Z`) })), skipDuplicates: true });
  }
}

/** Refuses a date in a locked month or a closed financial year (the database checks again). */
export async function assertOpen(tx: Tx, isoDate: string) {
  const lock = await tx.periodLock.findFirst({ where: { monthStart: new Date(`${monthStartOf(isoDate)}T00:00:00Z`), status: { not: 'UNLOCKED' } }, select: { id: true } });
  if (lock) throw Conflict('period-locked', `${new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })} is locked — ask the accountant to unlock it first`);
  const fy = await tx.financialYear.findFirst({ where: { name: financialYearOf(isoDate).name }, select: { isClosed: true, name: true } });
  if (fy?.isClosed) throw Conflict('year-closed', `The financial year ${fy.name} is closed`);
}

/** Posts a balanced entry after checking the period; returns the entry. */
export async function postOpen(tx: Tx, numbering: NumberingService, e: Parameters<typeof post>[2]) {
  await assertOpen(tx, e.date);
  return post(tx, numbering, e);
}

/** Accounts a voucher may use: active, not a group. */
export async function ledgerAccounts(tx: Tx, ids: string[]) {
  const rows = await tx.account.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true, isGroup: true, isActive: true, accountType: true, systemKey: true } });
  const map = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    const a = map.get(id);
    if (!a) throw unprocessable('account-not-found', 'Account not found', 'accountId');
    if (a.isGroup) throw unprocessable('account-is-group', `${a.name} is a group — choose an account under it`, 'accountId');
    if (!a.isActive) throw unprocessable('account-inactive', `${a.name} is no longer in use`, 'accountId');
  }
  return map;
}

/** Cash, petty cash and bank ledgers (what money can be paid from / into). */
export async function moneyAccountIds(tx: Tx, tenantId: string) {
  const chart = await ensureAccountsChart(tx, tenantId);
  const banks = await tx.bankAccount.findMany({ where: { isActive: true }, select: { accountId: true } });
  return new Set([chart.get('CASH')!, chart.get('PETTY_CASH')!, chart.get('BANK')!, ...banks.map((b) => b.accountId)]);
}

export type Line = PostingLine;
export { fromPaise, toPaise };
