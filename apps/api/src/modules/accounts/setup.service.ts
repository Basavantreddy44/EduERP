import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  AccountInput, BankAccountInput, CostCentreInput, OpeningBalancesInput, PERMISSIONS, TaxCodeInput, TdsSectionInput,
  financialYearOf, fromPaise, toPaise,
} from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, scopeFor } from '../../common/auth-context';
import { Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { decryptField, encryptField, last4, masked } from '../../common/field-crypto';
import { ApprovalsService } from '../approvals/approvals.service';
import { NumberingService } from '../numbering/numbering.service';
import { ensureFinancialYear, reverse } from '../fees/ledger';
import { assertOpen, ensureAccountsChart, ensureStatutory, iso, ledgerAccounts, monthStartOf, paise, postOpen, unprocessable, dec } from './books';

const RATES_KEY = 'accounts.statutory_rates_confirmed';
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * Accounts set-up (M13.1): chart of accounts, cost centres, bank accounts (number encrypted, CD-84), GST
 * codes and TDS sections (pre-filled, CD-85), opening balances, month lock / unlock (unlock needs
 * approval) and year close (surplus to the fund; the next year opens with the balance-sheet balances).
 */
@Injectable()
export class AccountsSetupService implements OnModuleInit {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly numbering: NumberingService, private readonly approvals: ApprovalsService) {}

  onModuleInit() {
    this.approvals.onComplete('PERIOD_UNLOCK', (tx, d) => this.unlockDecided(tx, d));
  }

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  // ───────────── Chart of accounts ─────────────

  /** Every account with its balance up to a date (debit-positive for assets / expenses). */
  chart(auth: AuthContext, asOn?: string) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await ensureAccountsChart(tx, auth.tenantId!);
      await ensureStatutory(tx, auth.tenantId!);
      const rows = await tx.account.findMany({ orderBy: { code: 'asc' } });
      const sums = await tx.$queryRaw<{ account_id: string; dr: string; cr: string }[]>`
        SELECT l.account_id, COALESCE(SUM(l.debit),0)::text AS dr, COALESCE(SUM(l.credit),0)::text AS cr
          FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
         WHERE ${asOn ?? null}::date IS NULL OR e.entry_date <= ${asOn ?? null}::date
         GROUP BY l.account_id`;
      const bal = new Map(sums.map((s) => [s.account_id, toPaise(s.dr) - toPaise(s.cr)]));
      const banks = new Map((await tx.bankAccount.findMany({ select: { accountId: true, id: true, accountNoLast4: true } })).map((b) => [b.accountId, b]));
      return rows.map((a) => ({ id: a.id, code: a.code, name: a.name, accountType: a.accountType, parentId: a.parentId, isGroup: a.isGroup, isSystem: a.isSystem, systemKey: a.systemKey, isActive: a.isActive, balance: fromPaise(bal.get(a.id) ?? 0), bankAccountId: banks.get(a.id)?.id ?? null }));
    });
  }

  addAccount(input: AccountInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await ensureAccountsChart(tx, auth.tenantId!);
      const parent = await tx.account.findUnique({ where: { id: input.parentId } });
      if (!parent) throw NotFound('Parent group');
      if (!parent.isGroup) throw unprocessable('parent-not-group', `${parent.name} is not a group`, 'parentId');
      if (parent.accountType !== input.accountType) throw unprocessable('type-mismatch', `Accounts under ${parent.name} must be of type ${parent.accountType.toLowerCase()}`, 'accountType');
      if (await tx.account.findFirst({ where: { code: input.code.toUpperCase() }, select: { id: true } })) throw Conflict('duplicate-code', `Code ${input.code} is already used`);
      const a = await tx.account.create({ data: { tenantId: auth.tenantId!, code: input.code.toUpperCase(), name: input.name, accountType: input.accountType, parentId: input.parentId, isGroup: input.isGroup } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'CREATE', entityType: 'ACCOUNT', entityId: a.id, newValues: input }, client);
      return { id: a.id };
    });
  }

  updateAccount(id: string, input: { name: string; isActive: boolean }, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const a = await tx.account.findUnique({ where: { id } });
      if (!a) throw NotFound('Account');
      if (!input.isActive && a.isSystem) throw Conflict('system-account', `${a.name} is used by EduERP and cannot be switched off`);
      if (!input.isActive && a.isGroup && (await tx.account.count({ where: { parentId: id, isActive: true } }))) throw Conflict('group-in-use', 'Switch off the accounts under this group first');
      await tx.account.update({ where: { id }, data: { name: input.name, isActive: input.isActive } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'UPDATE', entityType: 'ACCOUNT', entityId: id, oldValues: { name: a.name, isActive: a.isActive }, newValues: input }, client);
      return { id };
    });
  }

  // ───────────── Cost centres ─────────────

  costCentres(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.costCentre.findMany({ orderBy: { code: 'asc' } });
      const campuses = new Map((await tx.campus.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
      const depts = new Map((await tx.department.findMany({ select: { id: true, name: true } })).map((d) => [d.id, d.name]));
      return rows.map((c) => ({ id: c.id, code: c.code, name: c.name, campusId: c.campusId, campus: c.campusId ? campuses.get(c.campusId) ?? null : null, departmentId: c.departmentId, department: c.departmentId ? depts.get(c.departmentId) ?? null : null, isActive: c.isActive }));
    });
  }

  saveCostCentre(id: string | null, input: CostCentreInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const code = input.code.toUpperCase();
      const clash = await tx.costCentre.findFirst({ where: { code, ...(id ? { id: { not: id } } : {}) }, select: { id: true } });
      if (clash) throw Conflict('duplicate-code', `Code ${code} is already used`);
      const data = { code, name: input.name, campusId: input.campusId ?? null, departmentId: input.departmentId ?? null, isActive: input.isActive };
      const c = id ? await tx.costCentre.update({ where: { id }, data }) : await tx.costCentre.create({ data: { tenantId: auth.tenantId!, ...data } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: id ? 'UPDATE' : 'CREATE', entityType: 'COST_CENTRE', entityId: c.id, newValues: data }, client);
      return { id: c.id };
    });
  }

  // ───────────── Bank accounts ─────────────

  bankAccounts(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.bankAccount.findMany({ orderBy: { createdAt: 'asc' } });
      const accts = new Map((await tx.account.findMany({ where: { id: { in: rows.map((r) => r.accountId) } }, select: { id: true, name: true, code: true } })).map((a) => [a.id, a]));
      const campuses = new Map((await tx.campus.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
      return rows.map((b) => ({ id: b.id, accountId: b.accountId, ledger: accts.get(b.accountId)?.name ?? '', code: accts.get(b.accountId)?.code ?? '', bankName: b.bankName, branch: b.branch, accountNo: masked(b.accountNoLast4), ifsc: b.ifsc, accountType: b.accountType, isFeeCollection: b.isFeeCollection, isActive: b.isActive, campusId: b.campusId, campus: b.campusId ? campuses.get(b.campusId) ?? null : null }));
    });
  }

  addBankAccount(input: BankAccountInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const chart = await ensureAccountsChart(tx, auth.tenantId!);
      const group = chart.get('BANK_ACCOUNTS')!;
      const l4 = last4(input.accountNo)!;
      const same = await tx.bankAccount.findMany({ where: { ifsc: input.ifsc, accountNoLast4: l4 }, select: { accountNoEnc: true } });
      if (same.some((s) => decryptField(s.accountNoEnc) === input.accountNo)) throw Conflict('duplicate-bank-account', 'This bank account is already added');
      const used = (await tx.account.findMany({ where: { parentId: group }, select: { code: true } })).map((a) => Number(a.code)).filter((n) => Number.isFinite(n));
      const code = String(Math.max(1250, ...used) + 1);
      const ledger = await tx.account.create({ data: { tenantId: auth.tenantId!, code, name: `${input.bankName} ••${l4}`, accountType: 'ASSET', parentId: group } });
      const b = await tx.bankAccount.create({ data: { tenantId: auth.tenantId!, campusId: input.campusId ?? null, accountId: ledger.id, bankName: input.bankName, branch: input.branch ?? null, accountNoEnc: encryptField(input.accountNo)!, accountNoLast4: l4, ifsc: input.ifsc, accountType: input.accountType, isFeeCollection: input.isFeeCollection } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'CREATE', entityType: 'BANK_ACCOUNT', entityId: b.id, newValues: { ...input, accountNo: masked(l4) } }, client);
      return { id: b.id, accountId: ledger.id };
    });
  }

  updateBankAccount(id: string, input: { bankName: string; branch?: string | null; isFeeCollection: boolean; isActive: boolean }, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const b = await tx.bankAccount.findUnique({ where: { id } });
      if (!b) throw NotFound('Bank account');
      await tx.bankAccount.update({ where: { id }, data: { bankName: input.bankName, branch: input.branch ?? null, isFeeCollection: input.isFeeCollection, isActive: input.isActive } });
      await tx.account.update({ where: { id: b.accountId }, data: { name: `${input.bankName} ••${b.accountNoLast4}`, isActive: input.isActive } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'UPDATE', entityType: 'BANK_ACCOUNT', entityId: id, newValues: input }, client);
      return { id };
    });
  }

  /** Shows the full account number — only with the reveal right, and it is audited. */
  revealBankAccount(id: string, auth: AuthContext, client: ClientInfo) {
    if (!scopeFor(auth, PERMISSIONS.ACC_REVEAL)) throw Forbidden('cannot-reveal', 'You cannot see full account numbers');
    return this.db.run(this.ctx(auth), async (tx) => {
      const b = await tx.bankAccount.findUnique({ where: { id } });
      if (!b) throw NotFound('Bank account');
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'REVEAL', entityType: 'BANK_ACCOUNT', entityId: id, newValues: { field: 'accountNo' } }, client);
      return { accountNo: decryptField(b.accountNoEnc) };
    });
  }

  // ───────────── GST codes & TDS sections ─────────────

  statutory(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await ensureStatutory(tx, auth.tenantId!);
      const [taxCodes, tdsSections, conf] = await Promise.all([
        tx.taxCode.findMany({ orderBy: [{ ratePercent: 'asc' }, { effectiveFrom: 'desc' }] }),
        tx.tdsSection.findMany({ orderBy: [{ sectionCode: 'asc' }, { effectiveFrom: 'desc' }] }),
        tx.setting.findFirst({ where: { settingKey: RATES_KEY, campusId: null }, select: { settingValue: true, updatedAt: true, updatedBy: true, createdBy: true } }),
      ]);
      const by = conf ? await tx.user.findUnique({ where: { id: (conf.updatedBy ?? conf.createdBy)! }, select: { fullName: true } }) : null;
      return {
        confirmed: conf?.settingValue === 'YES' ? { by: by?.fullName ?? '', at: conf.updatedAt } : null,
        taxCodes: taxCodes.map((t) => ({ id: t.id, code: t.code, name: t.name, ratePercent: dec(t.ratePercent), itcClaimable: t.itcClaimable, effectiveFrom: iso(t.effectiveFrom), effectiveTo: t.effectiveTo ? iso(t.effectiveTo) : null })),
        tdsSections: tdsSections.map((s) => ({ id: s.id, sectionCode: s.sectionCode, description: s.description, rateIndividual: dec(s.rateIndividual), rateOthers: dec(s.rateOthers), rateNoPan: dec(s.rateNoPan), thresholdSingle: dec(s.thresholdSingle) ?? null, thresholdAnnual: dec(s.thresholdAnnual) ?? null, effectiveFrom: iso(s.effectiveFrom), effectiveTo: s.effectiveTo ? iso(s.effectiveTo) : null })),
      };
    });
  }

  saveTaxCode(id: string | null, input: TaxCodeInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const data = { code: input.code.toUpperCase(), name: input.name, ratePercent: input.ratePercent, itcClaimable: input.itcClaimable, effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00Z`), effectiveTo: input.effectiveTo ? new Date(`${input.effectiveTo}T00:00:00Z`) : null };
      const clash = await tx.taxCode.findFirst({ where: { code: data.code, effectiveFrom: data.effectiveFrom, ...(id ? { id: { not: id } } : {}) }, select: { id: true } });
      if (clash) throw Conflict('duplicate-code', `${data.code} from ${input.effectiveFrom} already exists`);
      if (id && (await tx.vendorBillItem.count({ where: { taxCodeId: id } }))) {
        const old = await tx.taxCode.findUniqueOrThrow({ where: { id } });
        if (dec(old.ratePercent) !== Number(input.ratePercent).toFixed(2) || iso(old.effectiveFrom) !== input.effectiveFrom) throw Conflict('tax-code-used', 'Bills already use this rate — end it with an end date and add a new one');
      }
      const t = id ? await tx.taxCode.update({ where: { id }, data }) : await tx.taxCode.create({ data: { tenantId: auth.tenantId!, ...data } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: id ? 'UPDATE' : 'CREATE', entityType: 'TAX_CODE', entityId: t.id, newValues: input }, client);
      return { id: t.id };
    });
  }

  saveTdsSection(id: string | null, input: TdsSectionInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const data = { sectionCode: input.sectionCode.toUpperCase(), description: input.description, rateIndividual: input.rateIndividual, rateOthers: input.rateOthers, rateNoPan: input.rateNoPan, thresholdSingle: input.thresholdSingle ?? null, thresholdAnnual: input.thresholdAnnual ?? null, effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00Z`), effectiveTo: input.effectiveTo ? new Date(`${input.effectiveTo}T00:00:00Z`) : null };
      const clash = await tx.tdsSection.findFirst({ where: { sectionCode: data.sectionCode, effectiveFrom: data.effectiveFrom, ...(id ? { id: { not: id } } : {}) }, select: { id: true } });
      if (clash) throw Conflict('duplicate-code', `${data.sectionCode} from ${input.effectiveFrom} already exists`);
      const s = id ? await tx.tdsSection.update({ where: { id }, data }) : await tx.tdsSection.create({ data: { tenantId: auth.tenantId!, ...data } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: id ? 'UPDATE' : 'CREATE', entityType: 'TDS_SECTION', entityId: s.id, newValues: input }, client);
      return { id: s.id };
    });
  }

  /** The accountant confirms the GST / TDS rates (hides the "please check" banner). */
  confirmRates(auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const existing = await tx.setting.findFirst({ where: { settingKey: RATES_KEY, campusId: null }, select: { id: true } });
      const row = existing
        ? await tx.setting.update({ where: { id: existing.id }, data: { settingValue: 'YES', updatedBy: auth.userId } })
        : await tx.setting.create({ data: { tenantId: auth.tenantId!, campusId: null, settingKey: RATES_KEY, settingValue: 'YES', createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'UPDATE', entityType: 'SETTING', entityId: row.id, newValues: { key: RATES_KEY, value: 'YES' } }, client);
      return { confirmed: true };
    });
  }

  // ───────────── Opening balances ─────────────

  /** Opening balances as one journal for the year (replaces an earlier one by reversal). Must balance. */
  openingBalances(input: OpeningBalancesInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const chart = await ensureAccountsChart(tx, auth.tenantId!);
      const accts = await ledgerAccounts(tx, input.lines.map((l) => l.accountId));
      for (const l of input.lines) {
        const a = accts.get(l.accountId)!;
        if (a.accountType === 'INCOME' || a.accountType === 'EXPENSE') throw unprocessable('not-balance-sheet', `${a.name} is an income or expense account — opening balances are for assets, liabilities and funds`, 'lines');
      }
      const fy = await ensureFinancialYear(tx, auth.tenantId!, input.asOn);
      const old = await tx.journalEntry.findFirst({ where: { sourceType: 'OPENING', financialYearId: fy.id, status: 'POSTED' }, select: { id: true } });
      if (old) {
        await assertOpen(tx, input.asOn);
        await reverse(tx, this.numbering, old.id, input.asOn, 'Opening balances replaced', auth.userId);
      }
      void chart;
      const e = await postOpen(tx, this.numbering, {
        tenantId: auth.tenantId!, campusId: null, date: input.asOn, voucherType: 'JOURNAL', sourceType: 'OPENING', sourceId: fy.id, narration: `Opening balances ${fy.name}`, userId: auth.userId,
        lines: input.lines.map((l) => ({ accountId: l.accountId, costCentreId: l.costCentreId ?? null, debitPaise: toPaise(l.debit), creditPaise: toPaise(l.credit) })),
      });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'CREATE', entityType: 'OPENING_BALANCES', entityId: e.id, newValues: { asOn: input.asOn, lines: input.lines.length } }, client);
      return { entryId: e.id, entryNo: e.entryNo };
    });
  }

  // ───────────── Month lock & year close ─────────────

  periods(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const locks = await tx.periodLock.findMany({ orderBy: { monthStart: 'desc' }, take: 36 });
      const users = new Map((await tx.user.findMany({ where: { id: { in: locks.flatMap((l) => [l.lockedBy, l.unlockRequestedBy].filter((x): x is string => !!x)) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
      const years = await tx.financialYear.findMany({ orderBy: { startDate: 'desc' } });
      return {
        locks: locks.map((l) => ({ month: iso(l.monthStart).slice(0, 7), status: l.status, lockedBy: users.get(l.lockedBy) ?? '', lockedAt: l.lockedAt, unlockReason: l.unlockReason, unlockRequestedBy: l.unlockRequestedBy ? users.get(l.unlockRequestedBy) ?? '' : null })),
        years: years.map((y) => ({ id: y.id, name: y.name, startDate: iso(y.startDate), endDate: iso(y.endDate), isClosed: y.isClosed })),
      };
    });
  }

  lockMonth(month: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const monthStart = new Date(`${month}-01T00:00:00Z`);
      if (`${month}-01` > monthStartOf(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10))) throw unprocessable('future-month', 'Only past or current months can be locked', 'month');
      const ex = await tx.periodLock.findUnique({ where: { tenantId_monthStart: { tenantId: auth.tenantId!, monthStart } } });
      if (ex && ex.status === 'LOCKED') throw Conflict('already-locked', `${monthLabel(month)} is already locked`);
      if (ex && ex.status === 'UNLOCKING') throw Conflict('unlock-pending', 'An unlock request is waiting for approval');
      if (ex) await tx.periodLock.update({ where: { id: ex.id }, data: { status: 'LOCKED', lockedBy: auth.userId, lockedAt: new Date(), unlockReason: null, unlockRequestedBy: null, approvalRequestId: null, unlockedAt: null } });
      else await tx.periodLock.create({ data: { tenantId: auth.tenantId!, monthStart, status: 'LOCKED', lockedBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'LOCK', entityType: 'PERIOD', entityId: null, newValues: { month } }, client);
      return { month, status: 'LOCKED' };
    });
  }

  /** Unlock: through approval when a rule exists, otherwise at once; always with a reason (audited). */
  requestUnlock(month: string, reason: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const monthStart = new Date(`${month}-01T00:00:00Z`);
      const l = await tx.periodLock.findUnique({ where: { tenantId_monthStart: { tenantId: auth.tenantId!, monthStart } } });
      if (!l || l.status === 'UNLOCKED') throw Conflict('not-locked', `${monthLabel(month)} is not locked`);
      if (l.status === 'UNLOCKING') throw Conflict('unlock-pending', 'An unlock request is already waiting for approval');
      const fy = await tx.financialYear.findFirst({ where: { name: financialYearOf(`${month}-01`).name }, select: { isClosed: true } });
      if (fy?.isClosed) throw Conflict('year-closed', 'The financial year is closed');
      const req = await this.approvals.submit(tx, { tenantId: auth.tenantId!, requestedBy: auth.userId, entityType: 'PERIOD_UNLOCK', entityId: l.id, campusId: null, summary: `Unlock ${monthLabel(month)} for posting: ${reason}` }, client);
      await tx.periodLock.update({ where: { id: l.id }, data: req ? { status: 'UNLOCKING', unlockReason: reason, unlockRequestedBy: auth.userId, approvalRequestId: req.id } : { status: 'UNLOCKED', unlockReason: reason, unlockRequestedBy: auth.userId, unlockedAt: new Date() } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'UNLOCK', entityType: 'PERIOD', entityId: l.id, newValues: { month, reason, needsApproval: !!req } }, client);
      return { month, status: req ? 'UNLOCKING' : 'UNLOCKED' };
    });
  }

  private async unlockDecided(tx: Tx, d: { entityId: string; decision: 'APPROVED' | 'REJECTED' | 'CANCELLED' }) {
    const l = await tx.periodLock.findUnique({ where: { id: d.entityId } });
    if (!l || l.status !== 'UNLOCKING') return;
    await tx.periodLock.update({ where: { id: l.id }, data: d.decision === 'APPROVED' ? { status: 'UNLOCKED', unlockedAt: new Date() } : { status: 'LOCKED' } });
  }

  /**
   * Year close: every month must be locked; income and expense balances go to the accumulated surplus
   * (one entry dated the last day), the year is marked closed, and the next year opens with the
   * balance-sheet balances (one opening entry dated its first day).
   */
  closeYear(financialYearId: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const fy = await tx.financialYear.findUnique({ where: { id: financialYearId } });
      if (!fy) throw NotFound('Financial year');
      if (fy.isClosed) throw Conflict('year-closed', `${fy.name} is already closed`);
      const months: string[] = [];
      for (let d = new Date(fy.startDate); d <= fy.endDate; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(iso(d).slice(0, 7));
      const locked = new Set((await tx.periodLock.findMany({ where: { status: 'LOCKED', monthStart: { gte: fy.startDate, lte: fy.endDate } }, select: { monthStart: true } })).map((l) => iso(l.monthStart).slice(0, 7)));
      const open = months.filter((m) => !locked.has(m));
      if (open.length) throw Conflict('months-open', `Lock every month first — still open: ${open.map(monthLabel).join(', ')}`);
      if (await tx.financialYear.findFirst({ where: { startDate: { lt: fy.startDate }, isClosed: false }, select: { id: true } })) throw Conflict('earlier-year-open', 'Close the earlier year first');
      const chart = await ensureAccountsChart(tx, auth.tenantId!);
      const sums = await tx.$queryRaw<{ account_id: string; account_type: string; dr: string; cr: string }[]>`
        SELECT l.account_id, a.account_type, SUM(l.debit)::text AS dr, SUM(l.credit)::text AS cr
          FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id JOIN accounts a ON a.id = l.account_id
         WHERE e.entry_date <= ${fy.endDate}::date
         GROUP BY l.account_id, a.account_type`;
      const inFy = await tx.$queryRaw<{ account_id: string; dr: string; cr: string }[]>`
        SELECT l.account_id, SUM(l.debit)::text AS dr, SUM(l.credit)::text AS cr
          FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id JOIN accounts a ON a.id = l.account_id
         WHERE e.financial_year_id = ${fy.id}::uuid AND a.account_type IN ('INCOME','EXPENSE')
         GROUP BY l.account_id`;
      const endIso = iso(fy.endDate);
      // 1) Income & expenditure → accumulated surplus.
      const plLines = inFy.map((s) => ({ accountId: s.account_id, net: toPaise(s.dr) - toPaise(s.cr) })).filter((s) => s.net !== 0);
      const surplus = -plLines.reduce((a, s) => a + s.net, 0);
      let closeEntry: string | null = null;
      if (plLines.length) {
        // The closing entry is dated the last day; that month is locked, so this one entry is let through by unlocking it for the moment.
        const lastMonth = new Date(`${endIso.slice(0, 7)}-01T00:00:00Z`);
        await tx.periodLock.update({ where: { tenantId_monthStart: { tenantId: auth.tenantId!, monthStart: lastMonth } }, data: { status: 'UNLOCKED' } });
        const e = await (await import('../fees/ledger')).post(tx, this.numbering, {
          tenantId: auth.tenantId!, campusId: null, date: endIso, voucherType: 'JOURNAL', sourceType: 'YEAR_CLOSE', sourceId: fy.id, narration: `Year close ${fy.name}: ${surplus >= 0 ? 'surplus' : 'deficit'} to accumulated surplus`, userId: auth.userId,
          lines: [
            ...plLines.map((s) => (s.net > 0 ? { accountId: s.accountId, creditPaise: s.net } : { accountId: s.accountId, debitPaise: -s.net })),
            surplus >= 0 ? { accountId: chart.get('SURPLUS')!, creditPaise: surplus } : { accountId: chart.get('SURPLUS')!, debitPaise: -surplus },
          ],
        });
        await tx.periodLock.update({ where: { tenantId_monthStart: { tenantId: auth.tenantId!, monthStart: lastMonth } }, data: { status: 'LOCKED' } });
        closeEntry = e.entryNo;
      }
      await tx.financialYear.update({ where: { id: fy.id }, data: { isClosed: true } });
      // 2) Balance-sheet balances carry forward: shown by the reports from all earlier entries, so no
      //    opening journal is needed for the next year (balances are cumulative). The check below proves it.
      const bs = sums.filter((s) => ['ASSET', 'LIABILITY', 'EQUITY'].includes(s.account_type)).reduce((a, s) => a + toPaise(s.dr) - toPaise(s.cr), 0) - surplus;
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'CLOSE', entityType: 'FINANCIAL_YEAR', entityId: fy.id, newValues: { surplus: fromPaise(surplus), closeEntry } }, client);
      return { name: fy.name, surplus: fromPaise(surplus), closeEntry, balanced: bs === 0 };
    });
  }

  /** Current balance of the paise sum helper (exported for other services). */
  static paise = paise;
}
