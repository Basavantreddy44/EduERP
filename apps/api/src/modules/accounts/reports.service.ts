import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AccountsReportQuery, PERMISSIONS, ReportCode, fromPaise, toPaise } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuthContext, scopeFor } from '../../common/auth-context';
import { NotFound } from '../../common/problem';
import { decryptField, masked } from '../../common/field-crypto';
import { ensureAccountsChart, iso, unprocessable, dec } from './books';

type Row = Record<string, string | number | null>;
export interface Report { title: string; subtitle: string; columns: { key: string; label: string; money?: boolean }[]; rows: Row[]; totals?: Row; notes?: string[] }
const n = (v: string | null | undefined) => toPaise(v ?? '0');
const f = fromPaise;

/**
 * Accounts reports (M13.5), all straight from journal lines: day book, cash / bank book, ledger, trial
 * balance, income & expenditure, balance sheet, receipts & payments, GST and TDS registers. Campus filter
 * applies to entries made for a campus (institution-wide entries are always included). Excel export.
 */
@Injectable()
export class AccountsReportsService {
  constructor(private readonly db: Db) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  run(code: ReportCode, q: AccountsReportQuery, auth: AuthContext): Promise<Report> {
    return this.db.run(this.ctx(auth), async (tx) => {
      await ensureAccountsChart(tx, auth.tenantId!);
      switch (code) {
        case 'DAY_BOOK': return this.dayBook(tx, q);
        case 'CASH_BOOK': return this.moneyBook(tx, q, 'CASH');
        case 'BANK_BOOK': return this.moneyBook(tx, q, 'BANK');
        case 'LEDGER': return this.ledger(tx, q);
        case 'TRIAL_BALANCE': return this.trialBalance(tx, q);
        case 'INCOME_EXPENDITURE': return this.incomeExpenditure(tx, q);
        case 'BALANCE_SHEET': return this.balanceSheet(tx, q);
        case 'RECEIPTS_PAYMENTS': return this.receiptsPayments(tx, q);
        case 'GST_REGISTER': return this.gstRegister(tx, q);
        case 'TDS_REGISTER': return this.tdsRegister(tx, q, !!scopeFor(auth, PERMISSIONS.ACC_REVEAL));
      }
    });
  }

  private sub(q: AccountsReportQuery) {
    const d = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    return `${d(q.from)} to ${d(q.to)}`;
  }

  /** Sum of each account's lines in a date range (or up to a date). */
  private async sums(tx: Tx, q: { from?: string | null; to: string; campusId?: string; excludeYearClose?: boolean }) {
    return tx.$queryRaw<{ account_id: string; dr: string; cr: string }[]>`
      SELECT l.account_id, SUM(l.debit)::text AS dr, SUM(l.credit)::text AS cr
        FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
       WHERE e.entry_date <= ${q.to}::date AND (${q.from ?? null}::date IS NULL OR e.entry_date >= ${q.from ?? null}::date)
         AND (${q.campusId ?? null}::uuid IS NULL OR e.campus_id IS NULL OR e.campus_id = ${q.campusId ?? null}::uuid)
         AND (${!!q.excludeYearClose} = false OR e.source_type <> 'YEAR_CLOSE')
       GROUP BY l.account_id`;
  }

  private async accounts(tx: Tx) {
    const rows = await tx.account.findMany({ select: { id: true, code: true, name: true, accountType: true, parentId: true, isGroup: true, systemKey: true } });
    return { list: rows, byId: new Map(rows.map((a) => [a.id, a])) };
  }

  private async dayBook(tx: Tx, q: AccountsReportQuery): Promise<Report> {
    const rows = await tx.$queryRaw<{ entry_no: string; entry_date: Date; voucher_type: string; narration: string; status: string; name: string; debit: string; credit: string }[]>`
      SELECT e.entry_no, e.entry_date, e.voucher_type, e.narration, e.status, a.name, l.debit::text, l.credit::text
        FROM journal_entries e JOIN journal_lines l ON l.journal_entry_id = e.id JOIN accounts a ON a.id = l.account_id
       WHERE e.entry_date BETWEEN ${q.from}::date AND ${q.to}::date
         AND (${q.campusId ?? null}::uuid IS NULL OR e.campus_id IS NULL OR e.campus_id = ${q.campusId ?? null}::uuid)
       ORDER BY e.entry_date, e.posted_at, e.entry_no, l.debit DESC`;
    let last = '';
    const out = rows.map((r) => { const first = r.entry_no !== last; last = r.entry_no; return { date: first ? iso(r.entry_date) : '', entryNo: first ? r.entry_no : '', type: first ? r.voucher_type : '', narration: first ? r.narration + (r.status === 'REVERSED' ? ' (reversed)' : '') : '', account: r.name, debit: n(r.debit) ? r.debit : '', credit: n(r.credit) ? r.credit : '' }; });
    const dr = rows.reduce((s, r) => s + n(r.debit), 0);
    return { title: 'Day book', subtitle: this.sub(q), columns: [{ key: 'date', label: 'Date' }, { key: 'entryNo', label: 'Entry' }, { key: 'type', label: 'Type' }, { key: 'narration', label: 'Narration' }, { key: 'account', label: 'Account' }, { key: 'debit', label: 'Debit', money: true }, { key: 'credit', label: 'Credit', money: true }], rows: out, totals: { narration: 'Total', debit: f(dr), credit: f(rows.reduce((s, r) => s + n(r.credit), 0)) } };
  }

  /** One account's lines with opening, running and closing balance (debit-positive). */
  private async accountLines(tx: Tx, accountIds: string[], q: AccountsReportQuery) {
    const open = await tx.$queryRaw<{ b: string | null }[]>`
      SELECT (SUM(l.debit) - SUM(l.credit))::text AS b FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
       WHERE l.account_id = ANY(${accountIds}::uuid[]) AND e.entry_date < ${q.from}::date
         AND (${q.costCentreId ?? null}::uuid IS NULL OR l.cost_centre_id = ${q.costCentreId ?? null}::uuid)
         AND (${q.campusId ?? null}::uuid IS NULL OR e.campus_id IS NULL OR e.campus_id = ${q.campusId ?? null}::uuid)`;
    const lines = await tx.$queryRaw<{ entry_no: string; entry_date: Date; narration: string; debit: string; credit: string; others: string | null }[]>`
      SELECT e.entry_no, e.entry_date, e.narration, l.debit::text, l.credit::text,
             (SELECT string_agg(DISTINCT a2.name, ', ') FROM journal_lines l2 JOIN accounts a2 ON a2.id = l2.account_id WHERE l2.journal_entry_id = e.id AND l2.account_id <> ALL(${accountIds}::uuid[])) AS others
        FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
       WHERE l.account_id = ANY(${accountIds}::uuid[]) AND e.entry_date BETWEEN ${q.from}::date AND ${q.to}::date
         AND (${q.costCentreId ?? null}::uuid IS NULL OR l.cost_centre_id = ${q.costCentreId ?? null}::uuid)
         AND (${q.campusId ?? null}::uuid IS NULL OR e.campus_id IS NULL OR e.campus_id = ${q.campusId ?? null}::uuid)
       ORDER BY e.entry_date, e.posted_at, e.entry_no`;
    let bal = n(open[0]?.b);
    const opening = bal;
    const rows = lines.map((l) => { bal += n(l.debit) - n(l.credit); return { date: iso(l.entry_date), entryNo: l.entry_no, particulars: l.others ?? '', narration: l.narration, debit: n(l.debit) ? l.debit : '', credit: n(l.credit) ? l.credit : '', balance: f(bal) }; });
    return { opening, closing: bal, rows, dr: lines.reduce((s, l) => s + n(l.debit), 0), cr: lines.reduce((s, l) => s + n(l.credit), 0) };
  }
  private ledgerReport(title: string, q: AccountsReportQuery, r: Awaited<ReturnType<AccountsReportsService['accountLines']>>): Report {
    return {
      title, subtitle: this.sub(q),
      columns: [{ key: 'date', label: 'Date' }, { key: 'entryNo', label: 'Entry' }, { key: 'particulars', label: 'Other account' }, { key: 'narration', label: 'Narration' }, { key: 'debit', label: 'Debit (in)', money: true }, { key: 'credit', label: 'Credit (out)', money: true }, { key: 'balance', label: 'Balance', money: true }],
      rows: [{ date: q.from, narration: 'Opening balance', balance: f(r.opening) }, ...r.rows],
      totals: { narration: 'Closing balance', debit: f(r.dr), credit: f(r.cr), balance: f(r.closing) },
    };
  }

  private async moneyBook(tx: Tx, q: AccountsReportQuery, kind: 'CASH' | 'BANK'): Promise<Report> {
    const chart = await ensureAccountsChart(tx, (await tx.$queryRaw<{ t: string }[]>`SELECT app_current_tenant()::text AS t`)[0].t);
    let ids: string[];
    let title: string;
    if (kind === 'CASH') { ids = q.accountId ? [q.accountId] : [chart.get('CASH')!, chart.get('PETTY_CASH')!]; title = 'Cash book'; }
    else {
      const banks = await tx.bankAccount.findMany({ select: { accountId: true, bankName: true, accountNoLast4: true } });
      if (q.accountId && !banks.some((b) => b.accountId === q.accountId) && q.accountId !== chart.get('BANK')) throw unprocessable('not-bank', 'Choose a bank account', 'accountId');
      ids = q.accountId ? [q.accountId] : [chart.get('BANK')!, ...banks.map((b) => b.accountId)];
      const b = banks.find((x) => x.accountId === q.accountId);
      title = b ? `Bank book — ${b.bankName} ••${b.accountNoLast4}` : 'Bank book — all bank accounts';
    }
    return this.ledgerReport(title, q, await this.accountLines(tx, ids, q));
  }

  private async ledger(tx: Tx, q: AccountsReportQuery): Promise<Report> {
    if (!q.accountId) throw unprocessable('account-required', 'Choose an account', 'accountId');
    const a = await tx.account.findUnique({ where: { id: q.accountId } });
    if (!a) throw NotFound('Account');
    const { list } = await this.accounts(tx);
    // A group's ledger covers every account under it.
    const ids = [a.id];
    for (let i = 0; i < ids.length; i++) for (const c of list) if (c.parentId === ids[i]) ids.push(c.id);
    const cc = q.costCentreId ? await tx.costCentre.findUnique({ where: { id: q.costCentreId }, select: { name: true } }) : null;
    return this.ledgerReport(`Ledger — ${a.code} ${a.name}${cc ? ` · ${cc.name}` : ''}`, q, await this.accountLines(tx, ids, q));
  }

  private async trialBalance(tx: Tx, q: AccountsReportQuery): Promise<Report> {
    const { byId } = await this.accounts(tx);
    const sums = await this.sums(tx, { to: q.to, campusId: q.campusId });
    const rows = sums.map((s) => ({ a: byId.get(s.account_id)!, net: n(s.dr) - n(s.cr) })).filter((x) => x.net !== 0).sort((x, y) => x.a.code.localeCompare(y.a.code));
    const dr = rows.reduce((s, r) => s + Math.max(r.net, 0), 0);
    const cr = rows.reduce((s, r) => s + Math.max(-r.net, 0), 0);
    return {
      title: 'Trial balance', subtitle: `As on ${new Date(`${q.to}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`,
      columns: [{ key: 'code', label: 'Code' }, { key: 'account', label: 'Account' }, { key: 'type', label: 'Type' }, { key: 'debit', label: 'Debit', money: true }, { key: 'credit', label: 'Credit', money: true }],
      rows: rows.map((r) => ({ code: r.a.code, account: r.a.name, type: r.a.accountType, debit: r.net > 0 ? f(r.net) : '', credit: r.net < 0 ? f(-r.net) : '' })),
      totals: { account: 'Total', debit: f(dr), credit: f(cr) },
      notes: [dr === cr ? 'Debits equal credits.' : `Debits and credits differ by ${f(Math.abs(dr - cr))} — please report this.`],
    };
  }

  /** Income and expense by group for the period (year-closing entries left out). */
  private async incomeExpenditureData(tx: Tx, q: { from: string; to: string; campusId?: string }) {
    const { byId } = await this.accounts(tx);
    const sums = await this.sums(tx, { from: q.from, to: q.to, campusId: q.campusId, excludeYearClose: true });
    const lines = sums.map((s) => ({ a: byId.get(s.account_id)!, net: n(s.dr) - n(s.cr) })).filter((x) => (x.a.accountType === 'INCOME' || x.a.accountType === 'EXPENSE') && x.net !== 0);
    const income = lines.filter((l) => l.a.accountType === 'INCOME').map((l) => ({ group: l.a.parentId ? byId.get(l.a.parentId)?.name ?? '' : '', account: l.a.name, amount: -l.net }));
    const expense = lines.filter((l) => l.a.accountType === 'EXPENSE').map((l) => ({ group: l.a.parentId ? byId.get(l.a.parentId)?.name ?? '' : '', account: l.a.name, amount: l.net }));
    const ti = income.reduce((s, x) => s + x.amount, 0);
    const te = expense.reduce((s, x) => s + x.amount, 0);
    return { income, expense, ti, te, surplus: ti - te };
  }

  private async incomeExpenditure(tx: Tx, q: AccountsReportQuery): Promise<Report> {
    const d = await this.incomeExpenditureData(tx, q);
    const sort = (xs: { group: string; account: string; amount: number }[]) => xs.sort((a, b) => a.group.localeCompare(b.group) || b.amount - a.amount);
    return {
      title: 'Income & expenditure', subtitle: this.sub(q),
      columns: [{ key: 'side', label: '' }, { key: 'account', label: 'Account' }, { key: 'amount', label: 'Amount', money: true }],
      rows: [
        { side: 'Income' }, ...sort(d.income).map((x) => ({ side: '', account: x.account, amount: f(x.amount) })), { side: '', account: 'Total income', amount: f(d.ti) },
        { side: 'Expenditure' }, ...sort(d.expense).map((x) => ({ side: '', account: x.account, amount: f(x.amount) })), { side: '', account: 'Total expenditure', amount: f(d.te) },
      ],
      totals: { account: d.surplus >= 0 ? 'Surplus (income more than expenditure)' : 'Deficit (expenditure more than income)', amount: f(Math.abs(d.surplus)) },
    };
  }

  /** Balances as on the date; the income & expenditure not yet closed into the fund appears as the current surplus. */
  private async balanceSheet(tx: Tx, q: AccountsReportQuery): Promise<Report> {
    const { byId } = await this.accounts(tx);
    const sums = await this.sums(tx, { to: q.to, campusId: q.campusId });
    const lines = sums.map((s) => ({ a: byId.get(s.account_id)!, net: n(s.dr) - n(s.cr) })).filter((x) => x.net !== 0);
    const pick = (t: string, sign: 1 | -1) => lines.filter((l) => l.a.accountType === t).map((l) => ({ account: l.a.name, amount: sign * l.net })).sort((a, b) => b.amount - a.amount);
    const assets = pick('ASSET', 1);
    const liabilities = pick('LIABILITY', -1);
    const funds = pick('EQUITY', -1);
    const surplus = -lines.filter((l) => l.a.accountType === 'INCOME' || l.a.accountType === 'EXPENSE').reduce((s, l) => s + l.net, 0);
    const ta = assets.reduce((s, x) => s + x.amount, 0);
    const tl = liabilities.reduce((s, x) => s + x.amount, 0) + funds.reduce((s, x) => s + x.amount, 0) + surplus;
    return {
      title: 'Balance sheet', subtitle: `As on ${new Date(`${q.to}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`,
      columns: [{ key: 'side', label: '' }, { key: 'account', label: 'Account' }, { key: 'amount', label: 'Amount', money: true }],
      rows: [
        { side: 'Funds & liabilities' }, ...funds.map((x) => ({ side: '', account: x.account, amount: f(x.amount) })), { side: '', account: surplus >= 0 ? 'Surplus not yet closed' : 'Deficit not yet closed', amount: f(surplus) },
        ...liabilities.map((x) => ({ side: '', account: x.account, amount: f(x.amount) })), { side: '', account: 'Total funds & liabilities', amount: f(tl) },
        { side: 'Assets' }, ...assets.map((x) => ({ side: '', account: x.account, amount: f(x.amount) })), { side: '', account: 'Total assets', amount: f(ta) },
      ],
      notes: [ta === tl ? 'Assets equal funds and liabilities.' : `Assets and funds + liabilities differ by ${f(Math.abs(ta - tl))} — please report this.`],
    };
  }

  /** Money in and out of cash and bank, by the other side of each entry; transfers between them are left out. */
  private async receiptsPayments(tx: Tx, q: AccountsReportQuery): Promise<Report> {
    const tenant = (await tx.$queryRaw<{ t: string }[]>`SELECT app_current_tenant()::text AS t`)[0].t;
    const chart = await ensureAccountsChart(tx, tenant);
    const money = [chart.get('CASH')!, chart.get('PETTY_CASH')!, chart.get('BANK')!, ...(await tx.bankAccount.findMany({ select: { accountId: true } })).map((b) => b.accountId)];
    const lines = await tx.$queryRaw<{ entry_id: string; account_id: string; name: string; debit: string; credit: string }[]>`
      SELECT l.journal_entry_id AS entry_id, l.account_id, a.name, l.debit::text, l.credit::text
        FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id JOIN accounts a ON a.id = l.account_id
       WHERE e.entry_date BETWEEN ${q.from}::date AND ${q.to}::date
         AND (${q.campusId ?? null}::uuid IS NULL OR e.campus_id IS NULL OR e.campus_id = ${q.campusId ?? null}::uuid)
         AND EXISTS (SELECT 1 FROM journal_lines m WHERE m.journal_entry_id = e.id AND m.account_id = ANY(${money}::uuid[]))`;
    const isMoney = new Set(money);
    const byEntry = new Map<string, typeof lines>();
    for (const l of lines) byEntry.set(l.entry_id, [...(byEntry.get(l.entry_id) ?? []), l]);
    const rec = new Map<string, number>();
    const pay = new Map<string, number>();
    for (const ls of byEntry.values()) {
      for (const l of ls.filter((x) => !isMoney.has(x.account_id))) {
        if (n(l.credit)) rec.set(l.name, (rec.get(l.name) ?? 0) + n(l.credit)); // money came in against this account
        if (n(l.debit)) pay.set(l.name, (pay.get(l.name) ?? 0) + n(l.debit));
      }
    }
    const opening = await this.accountLines(tx, money, q);
    const tr = [...rec.values()].reduce((s, x) => s + x, 0);
    const tp = [...pay.values()].reduce((s, x) => s + x, 0);
    return {
      title: 'Receipts & payments', subtitle: this.sub(q),
      columns: [{ key: 'side', label: '' }, { key: 'account', label: 'Account' }, { key: 'amount', label: 'Amount', money: true }],
      rows: [
        { side: 'Opening cash & bank', amount: f(opening.opening) },
        { side: 'Receipts' }, ...[...rec.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ side: '', account: k, amount: f(v) })), { side: '', account: 'Total receipts', amount: f(tr) },
        { side: 'Payments' }, ...[...pay.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ side: '', account: k, amount: f(v) })), { side: '', account: 'Total payments', amount: f(tp) },
      ],
      totals: { side: 'Closing cash & bank', amount: f(opening.closing) },
      notes: [opening.opening + tr - tp === opening.closing ? 'Opening + receipts − payments = closing.' : 'Some entries move money between cash and bank and other money accounts in one entry; see the cash and bank books.'],
    };
  }

  private async gstRegister(tx: Tx, q: AccountsReportQuery): Promise<Report> {
    const items = await tx.vendorBillItem.findMany({
      where: { bill: { billDate: { gte: new Date(`${q.from}T00:00:00Z`), lte: new Date(`${q.to}T00:00:00Z`) }, status: { in: ['APPROVED', 'PARTIAL', 'PAID'] }, ...(q.campusId ? { campusId: q.campusId } : {}) }, OR: [{ cgst: { gt: 0 } }, { igst: { gt: 0 } }, { taxCodeId: { not: null } }] },
      include: { bill: { select: { internalNo: true, billNo: true, billDate: true, vendor: { select: { name: true, gstin: true, stateCode: true } } } } },
      orderBy: [{ bill: { billDate: 'asc' } }, { lineNo: 'asc' }],
    });
    const sum = (k: 'amount' | 'cgst' | 'sgst' | 'igst') => f(items.reduce((s, i) => s + n(dec(i[k])), 0));
    return {
      title: 'GST register (purchases)', subtitle: this.sub(q),
      columns: [{ key: 'date', label: 'Bill date' }, { key: 'bill', label: 'Bill' }, { key: 'vendor', label: 'Vendor' }, { key: 'gstin', label: 'GSTIN' }, { key: 'rate', label: 'Rate %' }, { key: 'taxable', label: 'Taxable value', money: true }, { key: 'cgst', label: 'CGST', money: true }, { key: 'sgst', label: 'SGST', money: true }, { key: 'igst', label: 'IGST', money: true }, { key: 'claim', label: 'Input tax' }],
      rows: items.map((i) => ({ date: iso(i.bill.billDate), bill: `${i.bill.internalNo} / ${i.bill.billNo}`, vendor: i.bill.vendor.name, gstin: i.bill.vendor.gstin ?? '—', rate: dec(i.taxRate), taxable: dec(i.amount), cgst: dec(i.cgst), sgst: dec(i.sgst), igst: dec(i.igst), claim: i.itcClaimable ? 'Claimable' : 'Part of cost' })),
      totals: { vendor: 'Total', taxable: sum('amount'), cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst') },
    };
  }

  private async tdsRegister(tx: Tx, q: AccountsReportQuery, reveal: boolean): Promise<Report> {
    const bills = await tx.vendorBill.findMany({
      where: { billDate: { gte: new Date(`${q.from}T00:00:00Z`), lte: new Date(`${q.to}T00:00:00Z`) }, status: { in: ['APPROVED', 'PARTIAL', 'PAID'] }, tdsAmount: { gt: 0 }, ...(q.campusId ? { campusId: q.campusId } : {}) },
      include: { vendor: { select: { name: true, panEnc: true, panLast4: true } } }, orderBy: { billDate: 'asc' },
    });
    const secs = new Map((await tx.tdsSection.findMany({ select: { id: true, sectionCode: true } })).map((s) => [s.id, s.sectionCode]));
    return {
      title: 'TDS register', subtitle: this.sub(q),
      columns: [{ key: 'date', label: 'Bill date' }, { key: 'section', label: 'Section' }, { key: 'vendor', label: 'Deductee' }, { key: 'pan', label: 'PAN' }, { key: 'bill', label: 'Bill' }, { key: 'amount', label: 'Amount paid / credited', money: true }, { key: 'rate', label: 'Rate %' }, { key: 'tds', label: 'TDS', money: true }],
      rows: bills.map((b) => ({ date: iso(b.billDate), section: b.tdsSectionId ? secs.get(b.tdsSectionId) ?? '' : '', vendor: b.vendor.name, pan: b.vendor.panEnc ? (reveal ? decryptField(b.vendor.panEnc) : masked(b.vendor.panLast4)) : 'No PAN', bill: `${b.internalNo} / ${b.billNo}`, amount: dec(b.subTotal), rate: dec(b.tdsRate) ?? '', tds: dec(b.tdsAmount) })),
      totals: { vendor: 'Total', amount: f(bills.reduce((s, b) => s + n(dec(b.subTotal)), 0)), tds: f(bills.reduce((s, b) => s + n(dec(b.tdsAmount)), 0)) },
      notes: reveal ? ['Full PANs are shown because you have the reveal right.'] : ['PANs show the last 4 characters; staff with the reveal right see them in full for the return.'],
    };
  }

  /** Any report as an Excel file (numbers as numbers, rupee format). */
  async excel(r: Report): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(r.title.slice(0, 31));
    ws.addRow([r.title]).font = { bold: true, size: 14 };
    ws.addRow([r.subtitle]);
    ws.addRow([]);
    const head = ws.addRow(r.columns.map((c) => c.label));
    head.font = { bold: true };
    const cell = (c: Report['columns'][number], v: string | number | null | undefined) => (c.money && v !== '' && v != null ? Number(v) : v ?? '');
    for (const row of r.rows) ws.addRow(r.columns.map((c) => cell(c, row[c.key])));
    if (r.totals) ws.addRow(r.columns.map((c) => cell(c, r.totals![c.key]))).font = { bold: true };
    for (const note of r.notes ?? []) ws.addRow([note]);
    r.columns.forEach((c, i) => { const col = ws.getColumn(i + 1); col.width = c.money ? 16 : Math.min(48, Math.max(10, c.label.length + 4)); if (c.money) col.numFmt = '#,##,##0.00'; });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
