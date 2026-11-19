import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { PERMISSIONS, StatementMapping, financialYearOf, fromPaise, toPaise } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, scopeFor } from '../../common/auth-context';
import { Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { NumberingService } from '../numbering/numbering.service';
import { allocateNo } from '../students/student-records';
import { iso, ledgerAccounts, paise, postOpen, unprocessable, dec } from './books';

type Cell = string | number | Date | null;
const MONTHS: Record<string, number> = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const GUESS: Record<string, RegExp> = {
  dateColumn: /^(txn |transaction |value )?date$|^date/i,
  descriptionColumn: /narration|description|particulars|details|remarks/i,
  referenceColumn: /ref|chq|cheque|utr/i,
  debitColumn: /withdrawal|debit|dr\b|paid out/i,
  creditColumn: /deposit|credit|cr\b|paid in/i,
  balanceColumn: /balance/i,
};

/** Reads the first sheet of an .xlsx or a .csv into header names and rows. */
async function readTable(blob: { buffer: Buffer; originalname: string }): Promise<{ headers: string[]; rows: Cell[][] }> {
  let table: Cell[][];
  if (/\.csv$/i.test(blob.originalname)) {
    const text = blob.buffer.toString('utf8').replace(/^﻿/, '');
    table = [];
    let row: string[] = []; let cur = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((c) => c.trim())) table.push(row); row = []; }
      else cur += ch;
    }
    if (cur || row.length) { row.push(cur); if (row.some((c) => c.trim())) table.push(row); }
  } else if (/\.xlsx$/i.test(blob.originalname)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(blob.buffer as never);
    const ws = wb.worksheets[0];
    if (!ws) throw unprocessable('empty-file', 'The file has no sheet');
    table = [];
    ws.eachRow({ includeEmpty: false }, (r) => {
      const vals = (r.values as unknown[]).slice(1).map((v) => (v && typeof v === 'object' && !(v instanceof Date) ? ((v as { text?: string; result?: unknown }).text ?? String((v as { result?: unknown }).result ?? '')) : (v as Cell)) ?? null);
      table.push(vals as Cell[]);
    });
  } else throw unprocessable('bad-file', 'Upload the statement as .xlsx or .csv');
  // Banks put a few title lines first: the header is the first row that names a date column and an amount column.
  const h = table.findIndex((r) => r.some((c) => typeof c === 'string' && GUESS.dateColumn.test(c.trim())) && r.some((c) => typeof c === 'string' && (GUESS.debitColumn.test(c) || GUESS.creditColumn.test(c))));
  if (h < 0) throw unprocessable('no-header', 'Could not find the header row (a Date column and Debit / Credit columns)');
  const headers = table[h].map((c, i) => (c == null || String(c).trim() === '' ? `Column ${i + 1}` : String(c).trim()));
  return { headers, rows: table.slice(h + 1) };
}

function parseDate(v: Cell, fmt: StatementMapping['dateFormat']): string | null {
  if (v instanceof Date) return iso(v);
  if (v == null) return null;
  const s = String(v).trim();
  let d: number, m: number, y: number;
  if (fmt === 'YYYY-MM-DD') { const x = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (!x) return null; [y, m, d] = [Number(x[1]), Number(x[2]), Number(x[3])]; }
  else if (fmt === 'DD-MMM-YYYY') { const x = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3})[-\s/](\d{2,4})/); if (!x) return null; d = Number(x[1]); m = MONTHS[x[2].toUpperCase()] ?? 0; y = Number(x[3].length === 2 ? `20${x[3]}` : x[3]); }
  else { const x = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/); if (!x) return null; d = Number(x[1]); m = Number(x[2]); y = Number(x[3].length === 2 ? `20${x[3]}` : x[3]); }
  const out = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 && !Number.isNaN(Date.parse(`${out}T00:00:00Z`)) ? out : null;
}
function parseAmount(v: Cell): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Math.round(v * 100);
  const s = String(v).replace(/[₹,\s]/g, '').replace(/(Cr|Dr)\.?$/i, '');
  if (!s || s === '-') return 0;
  return Math.abs(toPaise(Number(s).toFixed(2)));
}

/**
 * Bank reconciliation (M13.4). Statements are imported from the bank's Excel / CSV with a column
 * mapping; each line gets a fingerprint so the same statement imported twice adds nothing. Lines are
 * matched to journal lines on that bank's ledger (money in ↔ debits, money out ↔ credits), each journal
 * line only once; suggestions use amount, date ± 3 days and the reference. Bank-only lines are ignored
 * with a reason or posted as a voucher (charges, interest). The statement explains the difference.
 */
@Injectable()
export class BankReconService {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly numbering: NumberingService) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  private bankRight(auth: AuthContext) {
    if (!scopeFor(auth, PERMISSIONS.ACC_BANK)) throw Forbidden('cannot-reconcile', 'You cannot reconcile bank accounts');
  }
  private async bank(tx: Tx, id: string) {
    const b = await tx.bankAccount.findUnique({ where: { id } });
    if (!b) throw NotFound('Bank account');
    return b;
  }

  /** Header names, a few rows and a suggested mapping, before importing. */
  async preview(blob: { buffer: Buffer; originalname: string } | undefined, auth: AuthContext) {
    this.bankRight(auth);
    if (!blob) throw unprocessable('no-file', 'Choose the statement file');
    const { headers, rows } = await readTable(blob);
    const suggest: Record<string, string | null> = {};
    for (const [k, re] of Object.entries(GUESS)) suggest[k] = headers.find((h) => re.test(h)) ?? null;
    const sample = rows.slice(0, 5).map((r) => headers.map((_, i) => (r[i] instanceof Date ? iso(r[i] as Date) : r[i] == null ? '' : String(r[i]))));
    const dateSample = rows.slice(0, 20).map((r) => r[headers.indexOf(suggest.dateColumn ?? '')]).find((v) => v != null);
    const dateFormat = dateSample instanceof Date ? 'YYYY-MM-DD' : /^\d{4}-/.test(String(dateSample ?? '')) ? 'YYYY-MM-DD' : /[A-Za-z]{3}/.test(String(dateSample ?? '')) ? 'DD-MMM-YYYY' : /^\d{1,2}-/.test(String(dateSample ?? '')) ? 'DD-MM-YYYY' : 'DD/MM/YYYY';
    return { headers, sample, rowCount: rows.length, suggested: { ...suggest, dateFormat } };
  }

  importStatement(blob: { buffer: Buffer; originalname: string } | undefined, m: StatementMapping, auth: AuthContext, client: ClientInfo) {
    this.bankRight(auth);
    if (!blob) throw unprocessable('no-file', 'Choose the statement file');
    return this.db.run(this.ctx(auth), async (tx) => {
      const b = await this.bank(tx, m.bankAccountId);
      const { headers, rows } = await readTable(blob);
      const col = (name: string | null | undefined) => (name ? headers.indexOf(name) : -1);
      const ix = { date: col(m.dateColumn), desc: col(m.descriptionColumn), ref: col(m.referenceColumn), dr: col(m.debitColumn), cr: col(m.creditColumn), bal: col(m.balanceColumn) };
      if (ix.date < 0 || ix.desc < 0 || ix.dr < 0 || ix.cr < 0) throw unprocessable('bad-mapping', 'Choose the date, description, debit and credit columns from the file');
      const parsed: { txnDate: string; description: string; referenceNo: string | null; debit: number; credit: number; balance: number | null }[] = [];
      const problems: string[] = [];
      rows.forEach((r, n) => {
        const date = parseDate(r[ix.date], m.dateFormat);
        const debit = parseAmount(r[ix.dr]);
        const credit = parseAmount(r[ix.cr]);
        if (!date && !debit && !credit) return; // blank / total lines
        if (!date) { problems.push(`Row ${n + 1}: date not understood`); return; }
        if ((debit > 0) === (credit > 0)) { if (debit || credit) problems.push(`Row ${n + 1}: both debit and credit`); return; }
        parsed.push({ txnDate: date, description: String(r[ix.desc] ?? '').trim().slice(0, 300) || '—', referenceNo: ix.ref >= 0 && r[ix.ref] != null && String(r[ix.ref]).trim() ? String(r[ix.ref]).trim().slice(0, 100) : null, debit, credit, balance: ix.bal >= 0 && r[ix.bal] != null && r[ix.bal] !== '' ? parseAmount(r[ix.bal]) : null });
      });
      if (!parsed.length) throw unprocessable('no-lines', problems[0] ?? 'No transactions found in the file');
      // Fingerprint: the line's own values plus how many identical lines came before it in this file.
      const seen = new Map<string, number>();
      const withFp = parsed.map((p) => {
        const key = [b.id, p.txnDate, p.description, p.referenceNo ?? '', p.debit, p.credit, p.balance ?? ''].join('|');
        const k = (seen.get(key) ?? 0) + 1;
        seen.set(key, k);
        return { ...p, fingerprint: createHash('sha256').update(`${key}|${k}`).digest('hex') };
      });
      const imp = await tx.bankStatementImport.create({ data: { tenantId: auth.tenantId!, bankAccountId: b.id, fileName: blob.originalname.slice(0, 200), lineCount: withFp.length, addedCount: 0, importedBy: auth.userId } });
      const res = await tx.bankStatementLine.createMany({ data: withFp.map((p) => ({ tenantId: auth.tenantId!, bankAccountId: b.id, importId: imp.id, txnDate: new Date(`${p.txnDate}T00:00:00Z`), description: p.description, referenceNo: p.referenceNo, debit: fromPaise(p.debit), credit: fromPaise(p.credit), balance: p.balance == null ? null : fromPaise(p.balance), fingerprint: p.fingerprint })), skipDuplicates: true });
      await tx.bankStatementImport.update({ where: { id: imp.id }, data: { addedCount: res.count } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'IMPORT', entityType: 'BANK_STATEMENT', entityId: imp.id, newValues: { bank: `${b.bankName} ••${b.accountNoLast4}`, lines: withFp.length, added: res.count } }, client);
      return { importId: imp.id, lines: withFp.length, added: res.count, skipped: withFp.length - res.count, problems: problems.slice(0, 20) };
    });
  }

  /** Journal lines on the bank's ledger that are not matched yet. */
  private async openBookLines(tx: Tx, accountId: string, upTo?: string) {
    return tx.$queryRaw<{ id: string; entry_no: string; entry_date: Date; narration: string; debit: string; credit: string }[]>`
      SELECT l.id, e.entry_no, e.entry_date, e.narration, l.debit::text, l.credit::text
        FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
       WHERE l.account_id = ${accountId}::uuid AND e.source_type <> 'OPENING' AND NOT EXISTS (SELECT 1 FROM bank_reconciliations r WHERE r.journal_line_id = l.id)
         AND (${upTo ?? null}::date IS NULL OR e.entry_date <= ${upTo ?? null}::date)
       ORDER BY e.entry_date, e.entry_no`;
  }

  /** The reconciliation screen: unmatched statement lines with suggestions, and unmatched book entries. */
  workbench(bankAccountId: string, auth: AuthContext) {
    this.bankRight(auth);
    return this.db.run(this.ctx(auth), async (tx) => {
      const b = await this.bank(tx, bankAccountId);
      const lines = await tx.bankStatementLine.findMany({ where: { bankAccountId, matchStatus: 'UNMATCHED' }, orderBy: [{ txnDate: 'asc' }, { createdAt: 'asc' }], take: 500 });
      const book = await this.openBookLines(tx, b.accountId);
      const suggestions = (l: (typeof lines)[number]) => {
        const amt = paise(l.credit) || paise(l.debit);
        const moneyIn = paise(l.credit) > 0;
        const t = l.txnDate.getTime();
        return book.filter((j) => (moneyIn ? toPaise(j.debit) : toPaise(j.credit)) === amt && Math.abs(j.entry_date.getTime() - t) <= 3 * 86_400_000)
          .map((j) => ({ journalLineId: j.id, entryNo: j.entry_no, date: iso(j.entry_date), narration: j.narration, refMatch: !!l.referenceNo && j.narration.toUpperCase().includes(l.referenceNo.toUpperCase()) }))
          .sort((a, c) => Number(c.refMatch) - Number(a.refMatch));
      };
      const matchedCount = await tx.bankStatementLine.count({ where: { bankAccountId, matchStatus: { not: 'UNMATCHED' } } });
      return {
        bank: { id: b.id, name: `${b.bankName} ••${b.accountNoLast4}`, accountId: b.accountId }, matchedCount,
        statementLines: lines.map((l) => ({ id: l.id, txnDate: iso(l.txnDate), description: l.description, referenceNo: l.referenceNo, debit: dec(l.debit), credit: dec(l.credit), balance: dec(l.balance) ?? null, suggestions: suggestions(l) })),
        bookLines: book.map((j) => ({ id: j.id, entryNo: j.entry_no, date: iso(j.entry_date), narration: j.narration, debit: j.debit, credit: j.credit })),
      };
    });
  }

  match(statementLineId: string, journalLineIds: string[], matchType: 'AUTO' | 'MANUAL', auth: AuthContext, client: ClientInfo) {
    this.bankRight(auth);
    return this.db.run(this.ctx(auth), (tx) => this.matchTx(tx, statementLineId, journalLineIds, matchType, auth, client));
  }

  private async matchTx(tx: Tx, statementLineId: string, journalLineIds: string[], matchType: 'AUTO' | 'MANUAL', auth: AuthContext, client: ClientInfo) {
    await tx.$queryRaw`SELECT id FROM bank_statement_lines WHERE id = ${statementLineId}::uuid FOR UPDATE`;
    const l = await tx.bankStatementLine.findUnique({ where: { id: statementLineId } });
    if (!l) throw NotFound('Statement line');
    if (l.matchStatus !== 'UNMATCHED') throw Conflict('line-matched', 'This statement line is already matched or ignored');
    const b = await this.bank(tx, l.bankAccountId);
    const jl = await tx.journalLine.findMany({ where: { id: { in: journalLineIds } } });
    if (jl.length !== new Set(journalLineIds).size) throw NotFound('Book entry');
    if (jl.some((j) => j.accountId !== b.accountId)) throw unprocessable('other-ledger', 'Choose entries on this bank account only', 'journalLineIds');
    const moneyIn = paise(l.credit) > 0;
    const sum = jl.reduce((s, j) => s + (moneyIn ? paise(j.debit) - paise(j.credit) : paise(j.credit) - paise(j.debit)), 0);
    if (sum !== (paise(l.credit) || paise(l.debit))) throw unprocessable('amount-mismatch', `The entries total ₹${fromPaise(sum)}, the bank line is ₹${fromPaise(paise(l.credit) || paise(l.debit))}`, 'journalLineIds');
    try {
      await tx.bankReconciliation.createMany({ data: jl.map((j) => ({ tenantId: l.tenantId, statementLineId: l.id, journalLineId: j.id, matchType, matchedBy: auth.userId })) });
    } catch {
      throw Conflict('entry-matched', 'One of these book entries is already matched to another statement line');
    }
    await tx.bankStatementLine.update({ where: { id: l.id }, data: { matchStatus: 'MATCHED' } });
    if (matchType === 'MANUAL') await this.audit.log(tx, { tenantId: l.tenantId, userId: auth.userId, action: 'MATCH', entityType: 'BANK_STATEMENT_LINE', entityId: l.id, newValues: { entries: jl.length } }, client);
    return { id: l.id, matchStatus: 'MATCHED' };
  }

  /** Matches every line that has exactly one suggestion (and that suggestion fits no other line). */
  autoMatch(bankAccountId: string, auth: AuthContext, client: ClientInfo) {
    this.bankRight(auth);
    return this.db.run(this.ctx(auth), async (tx) => {
      const w = await this.workbenchRaw(tx, bankAccountId);
      const counts = new Map<string, number>();
      for (const l of w) for (const s of l.cands) counts.set(s, (counts.get(s) ?? 0) + 1);
      let matched = 0;
      for (const l of w) {
        if (l.cands.length === 1 && counts.get(l.cands[0]) === 1) { await this.matchTx(tx, l.id, l.cands, 'AUTO', auth, client); matched++; }
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'MATCH', entityType: 'BANK_ACCOUNT', entityId: bankAccountId, newValues: { autoMatched: matched } }, client);
      return { matched };
    });
  }

  private async workbenchRaw(tx: Tx, bankAccountId: string) {
    const b = await this.bank(tx, bankAccountId);
    const lines = await tx.bankStatementLine.findMany({ where: { bankAccountId, matchStatus: 'UNMATCHED' } });
    const book = await this.openBookLines(tx, b.accountId);
    return lines.map((l) => {
      const amt = paise(l.credit) || paise(l.debit);
      const moneyIn = paise(l.credit) > 0;
      return { id: l.id, cands: book.filter((j) => (moneyIn ? toPaise(j.debit) : toPaise(j.credit)) === amt && Math.abs(j.entry_date.getTime() - l.txnDate.getTime()) <= 3 * 86_400_000).map((j) => j.id) };
    });
  }

  unmatch(statementLineId: string, auth: AuthContext, client: ClientInfo) {
    this.bankRight(auth);
    return this.db.run(this.ctx(auth), async (tx) => {
      const l = await tx.bankStatementLine.findUnique({ where: { id: statementLineId } });
      if (!l) throw NotFound('Statement line');
      if (l.matchStatus === 'UNMATCHED') throw Conflict('line-unmatched', 'This line is not matched');
      await tx.bankReconciliation.deleteMany({ where: { statementLineId } });
      await tx.bankStatementLine.update({ where: { id: l.id }, data: { matchStatus: 'UNMATCHED', ignoreReason: null } });
      await this.audit.log(tx, { tenantId: l.tenantId, userId: auth.userId, action: 'UNMATCH', entityType: 'BANK_STATEMENT_LINE', entityId: l.id }, client);
      return { id: l.id, matchStatus: 'UNMATCHED' };
    });
  }

  ignore(statementLineId: string, reason: string, auth: AuthContext, client: ClientInfo) {
    this.bankRight(auth);
    return this.db.run(this.ctx(auth), async (tx) => {
      const l = await tx.bankStatementLine.findUnique({ where: { id: statementLineId } });
      if (!l) throw NotFound('Statement line');
      if (l.matchStatus !== 'UNMATCHED') throw Conflict('line-matched', 'This line is already matched or ignored');
      await tx.bankStatementLine.update({ where: { id: l.id }, data: { matchStatus: 'IGNORED', ignoreReason: reason } });
      await this.audit.log(tx, { tenantId: l.tenantId, userId: auth.userId, action: 'IGNORE', entityType: 'BANK_STATEMENT_LINE', entityId: l.id, newValues: { reason } }, client);
      return { id: l.id, matchStatus: 'IGNORED' };
    });
  }

  /** A bank-only line (charges, interest) becomes a bank voucher and is matched to it at once. */
  postLine(statementLineId: string, accountId: string, narration: string, auth: AuthContext, client: ClientInfo) {
    this.bankRight(auth);
    if (!scopeFor(auth, PERMISSIONS.ACC_ENTRY)) throw Forbidden('cannot-post', 'You cannot post vouchers');
    return this.db.run(this.ctx(auth), async (tx) => {
      const l = await tx.bankStatementLine.findUnique({ where: { id: statementLineId } });
      if (!l) throw NotFound('Statement line');
      if (l.matchStatus !== 'UNMATCHED') throw Conflict('line-matched', 'This line is already matched or ignored');
      const b = await this.bank(tx, l.bankAccountId);
      const acc = (await ledgerAccounts(tx, [accountId])).get(accountId)!;
      if (accountId === b.accountId) throw unprocessable('same-account', 'Choose the other side (for example Bank charges or Bank interest)', 'accountId');
      const amt = paise(l.credit) || paise(l.debit);
      const moneyIn = paise(l.credit) > 0;
      const date = iso(l.txnDate);
      const voucherNo = await allocateNo(this.numbering, tx, 'VOUCHER', b.campusId ?? '', financialYearOf(date).name, auth.userId);
      const v = await tx.accountVoucher.create({ data: { tenantId: l.tenantId, campusId: b.campusId, voucherNo, voucherType: 'BANK', voucherDate: l.txnDate, amount: fromPaise(amt), referenceNo: l.referenceNo, narration, status: 'PENDING_APPROVAL', createdBy: auth.userId } });
      const lines = moneyIn ? [{ accountId: b.accountId, debitPaise: amt, creditPaise: 0 }, { accountId, debitPaise: 0, creditPaise: amt }] : [{ accountId, debitPaise: amt, creditPaise: 0 }, { accountId: b.accountId, debitPaise: 0, creditPaise: amt }];
      await tx.accountVoucherLine.createMany({ data: lines.map((x, i) => ({ tenantId: l.tenantId, voucherId: v.id, lineNo: i + 1, accountId: x.accountId, debit: fromPaise(x.debitPaise), credit: fromPaise(x.creditPaise) })) });
      const e = await postOpen(tx, this.numbering, { tenantId: l.tenantId, campusId: b.campusId, date, voucherType: moneyIn ? 'RECEIPT' : 'PAYMENT', sourceType: 'ACCOUNT_VOUCHER', sourceId: v.id, userId: auth.userId, narration: `${voucherNo} · ${narration} (${acc.name})`, lines });
      await tx.accountVoucher.update({ where: { id: v.id }, data: { status: 'POSTED', journalEntryId: e.id } });
      const bankLine = await tx.journalLine.findFirstOrThrow({ where: { journalEntryId: e.id, accountId: b.accountId }, select: { id: true } });
      await this.matchTx(tx, l.id, [bankLine.id], 'AUTO', auth, client);
      await this.audit.log(tx, { tenantId: l.tenantId, userId: auth.userId, action: 'CREATE', entityType: 'ACCOUNT_VOUCHER', entityId: v.id, newValues: { voucherNo, from: 'bank statement', amount: fromPaise(amt) } }, client);
      return { voucherNo, matchStatus: 'MATCHED' };
    });
  }

  /**
   * Reconciliation statement on a date: book balance, entries not yet in the bank (deposits not credited,
   * payments not presented), bank-only lines not yet in the books, and the bank balance they explain.
   */
  statement(bankAccountId: string, asOn: string, auth: AuthContext) {
    this.bankRight(auth);
    return this.db.run(this.ctx(auth), async (tx) => {
      const b = await this.bank(tx, bankAccountId);
      const bookBal = await tx.$queryRaw<{ dr: string | null; cr: string | null }[]>`
        SELECT SUM(l.debit)::text AS dr, SUM(l.credit)::text AS cr FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
         WHERE l.account_id = ${b.accountId}::uuid AND e.entry_date <= ${asOn}::date`;
      const book = paise(bookBal[0]?.dr ?? '0') - paise(bookBal[0]?.cr ?? '0');
      // Book entries up to the date not matched to a statement line dated on or before it.
      const open = await tx.$queryRaw<{ entry_no: string; entry_date: Date; narration: string; debit: string; credit: string }[]>`
        SELECT e.entry_no, e.entry_date, e.narration, l.debit::text, l.credit::text
          FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
         WHERE l.account_id = ${b.accountId}::uuid AND e.entry_date <= ${asOn}::date
           AND e.source_type <> 'OPENING' AND NOT EXISTS (SELECT 1 FROM bank_reconciliations r JOIN bank_statement_lines s ON s.id = r.statement_line_id WHERE r.journal_line_id = l.id AND s.txn_date <= ${asOn}::date)
         ORDER BY e.entry_date`;
      const bankOnly = await tx.bankStatementLine.findMany({ where: { bankAccountId, txnDate: { lte: new Date(`${asOn}T00:00:00Z`) }, matchStatus: 'UNMATCHED' }, orderBy: { txnDate: 'asc' } });
      const notCredited = open.filter((o) => toPaise(o.debit) > 0);
      const notPresented = open.filter((o) => toPaise(o.credit) > 0);
      const sum = (xs: { debit: string; credit: string }[], k: 'debit' | 'credit') => xs.reduce((s, x) => s + toPaise(x[k]), 0);
      const inBank = bankOnly.reduce((s, l) => s + paise(l.credit), 0);
      const outBank = bankOnly.reduce((s, l) => s + paise(l.debit), 0);
      const expected = book - sum(notCredited, 'debit') + sum(notPresented, 'credit') + inBank - outBank;
      const last = await tx.bankStatementLine.findFirst({ where: { bankAccountId, txnDate: { lte: new Date(`${asOn}T00:00:00Z`) }, balance: { not: null } }, orderBy: [{ txnDate: 'desc' }, { createdAt: 'desc' }], select: { balance: true, txnDate: true } });
      const row = (o: { entry_no: string; entry_date: Date; narration: string; debit: string; credit: string }) => ({ entryNo: o.entry_no, date: iso(o.entry_date), narration: o.narration, amount: toPaise(o.debit) > 0 ? o.debit : o.credit });
      return {
        bank: `${b.bankName} ••${b.accountNoLast4}`, asOn, bookBalance: fromPaise(book),
        depositsNotCredited: { total: fromPaise(sum(notCredited, 'debit')), items: notCredited.map(row) },
        paymentsNotPresented: { total: fromPaise(sum(notPresented, 'credit')), items: notPresented.map(row) },
        bankOnly: { moneyIn: fromPaise(inBank), moneyOut: fromPaise(outBank), items: bankOnly.map((l) => ({ date: iso(l.txnDate), description: l.description, debit: dec(l.debit), credit: dec(l.credit) })) },
        expectedBankBalance: fromPaise(expected),
        statementBalance: last?.balance ? { amount: dec(last.balance), on: iso(last.txnDate) } : null,
        difference: last?.balance ? fromPaise(paise(last.balance) - expected) : null,
      };
    });
  }
}
