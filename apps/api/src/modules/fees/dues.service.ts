import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@eduerp/db';
import { DuesQuery, PERMISSIONS, PermissionCode, RemindInput, ReportQuery, formatINR, fromPaise, toPaise } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, CampusScope, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { NotificationsService } from '../notifications/notifications.service';
import { todayIST } from '../students/student-records';
import { LateFeeService } from './late-fee.service';
import { FeeOnlineService } from './online.service';

const READ = PERMISSIONS.FEE_READ;
const BILL = PERMISSIONS.FEE_BILL;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const paise = (d: Prisma.Decimal | string | number | null) => toPaise((d ?? 0).toString());
const NIL = '00000000-0000-0000-0000-000000000000';

export interface DuesRow {
  studentId: string; admissionNo: string; firstName: string; lastName: string | null; status: string; campusId: string;
  levelName: string | null; sectionName: string | null; programName: string | null; guardianName: string | null; guardianPhone: string | null; guardianEmail: string | null;
  bills: number; balance: string; overdue: string; notDue: string; d1_30: string; d31_60: string; d61_90: string; d90_plus: string; oldestDue: Date | null; lastReminder: Date | null;
}

/** The no-dues answer for one student (used by the Transfer Certificate in M1.4). */
export async function noDuesOf(tx: Tx, studentId: string) {
  const open = await tx.feeInvoice.findMany({ where: { studentId, status: { in: ['UNPAID', 'PARTIAL'] } }, select: { invoiceNo: true, description: true, dueDate: true, balanceAmount: true } });
  const pendingRefunds = await tx.refund.count({ where: { studentId, status: 'PENDING' } });
  const balance = open.reduce((a, b) => a + paise(b.balanceAmount), 0);
  const today = todayIST();
  const overdue = open.filter((b) => b.dueDate < today).reduce((a, b) => a + paise(b.balanceAmount), 0);
  return { clear: balance === 0 && pendingRefunds === 0, balance: fromPaise(balance), overdue: fromPaise(overdue), openBills: open.filter((b) => paise(b.balanceAmount) > 0), pendingRefunds };
}

/**
 * Dues & reports (M2.5): the dues list with ageing (from open bills, to the paisa), late fees (apply
 * now / waive), reminders to parents (optionally with a payment link), the no-dues check, and the
 * collection, fee-head and dues reports — each checked against the accounts.
 */
@Injectable()
export class FeeDuesService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly lateFees: LateFeeService,
    private readonly online: FeeOnlineService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  private scope(auth: AuthContext, code: PermissionCode): CampusScope {
    return scopeFor(auth, code)!;
  }
  private campusSql(scope: CampusScope, campusId: string | undefined, col: Prisma.Sql) {
    if (campusId) return Prisma.sql`${col} = ${campusId}::uuid`;
    return scope.all ? Prisma.sql`TRUE` : Prisma.sql`${col} = ANY(${scope.campusIds}::uuid[])`;
  }

  // ───────────── Dues list ─────────────

  async dues(auth: AuthContext, q: DuesQuery) {
    const scope = this.scope(auth, READ);
    if (q.campusId && !canAccessCampus(scope, q.campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      const today = iso(todayIST());
      const year = (await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true, name: true } })) ?? (await tx.academicYear.findFirst({ orderBy: { startDate: 'desc' }, select: { id: true, name: true } }));
      const where: Prisma.Sql[] = [this.campusSql(scope, q.campusId, Prisma.sql`s.campus_id`)];
      if (q.programLevelId) where.push(Prisma.sql`sec.program_level_id = ${q.programLevelId}::uuid`);
      if (q.sectionId) where.push(Prisma.sql`e.section_id = ${q.sectionId}::uuid`);
      if (q.q) {
        const like = `%${q.q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        where.push(Prisma.sql`(lower(s.first_name || ' ' || coalesce(s.last_name, '')) LIKE ${like} OR lower(s.admission_no) LIKE ${like})`);
      }
      const having: Prisma.Sql[] = [Prisma.sql`sum(f.balance_amount) > 0`];
      if (q.minBalance) having.push(Prisma.sql`sum(f.balance_amount) >= ${q.minBalance}::numeric`);
      if (q.minDaysOverdue !== undefined) having.push(Prisma.sql`min(f.due_date) FILTER (WHERE f.balance_amount > 0) <= (${today}::date - ${q.minDaysOverdue}::int) AND sum(f.balance_amount) FILTER (WHERE f.due_date < ${today}::date) > 0`);
      const order = {
        balance: Prisma.sql`balance DESC, name_key`, overdue: Prisma.sql`overdue DESC, balance DESC, name_key`, name: Prisma.sql`name_key, admission_no`,
        class: Prisma.sql`program_name NULLS LAST, level_seq NULLS LAST, section_name NULLS LAST, name_key`, oldest: Prisma.sql`oldest_due NULLS LAST, name_key`,
      }[q.sort];
      const base = Prisma.sql`
        SELECT s.id AS student_id, s.admission_no, s.first_name, s.last_name, s.status, s.campus_id,
               lower(s.first_name || ' ' || coalesce(s.last_name, '')) AS name_key,
               l.name AS level_name, l.sequence AS level_seq, sec.name AS section_name, p.name AS program_name,
               count(*) FILTER (WHERE f.balance_amount > 0) AS bills,
               sum(f.balance_amount) AS balance,
               coalesce(sum(f.balance_amount) FILTER (WHERE f.due_date < ${today}::date), 0) AS overdue,
               coalesce(sum(f.balance_amount) FILTER (WHERE f.due_date >= ${today}::date), 0) AS not_due,
               coalesce(sum(f.balance_amount) FILTER (WHERE ${today}::date - f.due_date BETWEEN 1 AND 30), 0) AS d1_30,
               coalesce(sum(f.balance_amount) FILTER (WHERE ${today}::date - f.due_date BETWEEN 31 AND 60), 0) AS d31_60,
               coalesce(sum(f.balance_amount) FILTER (WHERE ${today}::date - f.due_date BETWEEN 61 AND 90), 0) AS d61_90,
               coalesce(sum(f.balance_amount) FILTER (WHERE ${today}::date - f.due_date > 90), 0) AS d90_plus,
               min(f.due_date) FILTER (WHERE f.balance_amount > 0) AS oldest_due
          FROM fee_invoices f
          JOIN students s ON s.id = f.student_id
          LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = ${year?.id ?? NIL}::uuid AND e.status = 'ACTIVE'
          LEFT JOIN sections sec ON sec.id = e.section_id
          LEFT JOIN program_levels l ON l.id = sec.program_level_id
          LEFT JOIN programs p ON p.id = l.program_id
         WHERE f.status IN ('UNPAID', 'PARTIAL') AND ${Prisma.join(where, ' AND ')}
         GROUP BY s.id, l.name, l.sequence, sec.name, p.name
        HAVING ${Prisma.join(having, ' AND ')}`;
      const rows = await tx.$queryRaw<(Record<string, unknown> & { total_rows: bigint })[]>`
        WITH d AS (${base})
        SELECT d.*, g.name AS guardian_name, g.phone AS guardian_phone, g.email AS guardian_email,
               (SELECT max(r.created_at) FROM fee_reminders r WHERE r.student_id = d.student_id AND r.status = 'SENT') AS last_reminder,
               count(*) OVER () AS total_rows
          FROM d
          LEFT JOIN LATERAL (SELECT gg.name, gg.phone, gg.email FROM student_guardians sg JOIN guardians gg ON gg.id = sg.guardian_id WHERE sg.student_id = d.student_id ORDER BY sg.is_primary DESC LIMIT 1) g ON true
         ORDER BY ${order}
         LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`;
      const totals = await tx.$queryRaw<Record<string, Prisma.Decimal | bigint | null>[]>`
        WITH d AS (${base})
        SELECT count(*) AS students, coalesce(sum(balance), 0) AS balance, coalesce(sum(overdue), 0) AS overdue, coalesce(sum(not_due), 0) AS not_due,
               coalesce(sum(d1_30), 0) AS d1_30, coalesce(sum(d31_60), 0) AS d31_60, coalesce(sum(d61_90), 0) AS d61_90, coalesce(sum(d90_plus), 0) AS d90_plus
          FROM d`;
      const t = totals[0];
      const money = (v: unknown) => fromPaise(paise(v as Prisma.Decimal));
      return {
        year,
        today,
        total: rows.length ? Number(rows[0].total_rows) : Number(t.students),
        page: q.page,
        pageSize: q.pageSize,
        totals: { students: Number(t.students), balance: money(t.balance), overdue: money(t.overdue), notDue: money(t.not_due), d1_30: money(t.d1_30), d31_60: money(t.d31_60), d61_90: money(t.d61_90), d90_plus: money(t.d90_plus) },
        items: rows.map((r): DuesRow => ({
          studentId: r.student_id as string, admissionNo: r.admission_no as string, firstName: r.first_name as string, lastName: r.last_name as string | null, status: r.status as string, campusId: r.campus_id as string,
          levelName: r.level_name as string | null, sectionName: r.section_name as string | null, programName: r.program_name as string | null,
          guardianName: r.guardian_name as string | null, guardianPhone: r.guardian_phone as string | null, guardianEmail: r.guardian_email as string | null,
          bills: Number(r.bills), balance: money(r.balance), overdue: money(r.overdue), notDue: money(r.not_due), d1_30: money(r.d1_30), d31_60: money(r.d31_60), d61_90: money(r.d61_90), d90_plus: money(r.d90_plus),
          oldestDue: r.oldest_due as Date | null, lastReminder: r.last_reminder as Date | null,
        })),
      };
    });
  }

  // ───────────── Late fees ─────────────

  async applyLateFees(auth: AuthContext, client: ClientInfo) {
    const scope = this.scope(auth, BILL);
    const r = await this.lateFees.apply(auth.tenantId!, { source: 'MANUAL', userId: auth.userId, campusIds: scope.all ? null : scope.campusIds });
    return r;
  }

  async waiveFine(invoiceId: string, reason: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const w = await this.lateFees.waive(tx, invoiceId, reason, auth.userId);
      if (!w || !canAccessCampus(this.scope(auth, BILL), w.inv.campusId)) throw NotFound('Bill');
      if (w.inv.status === 'CANCELLED') throw Conflict('invoice-cancelled', 'This bill is cancelled');
      if (w.inv.fineWaived) throw Conflict('fine-waived', 'The late fee on this bill is already waived');
      if (!w.fine) throw Conflict('no-fine', 'This bill has no late fee');
      if (paise(w.inv.paidAmount) > paise(w.inv.netAmount) - w.fine) throw Conflict('fine-paid', 'Part of the late fee has already been paid; refund it instead');
      const updated = await w.apply();
      await this.audit.log(tx, { tenantId: w.inv.tenantId, userId: auth.userId, campusId: w.inv.campusId, action: 'UPDATE', entityType: 'FEE_INVOICE', entityId: invoiceId, oldValues: { fineAmount: w.inv.fineAmount }, newValues: { fineAmount: '0', fineWaived: true }, reason }, client);
      return updated;
    });
  }

  // ───────────── Reminders ─────────────

  /** Emails each chosen student's main contact what is due (with a payment link when online payment is on). */
  async remind(input: RemindInput, auth: AuthContext, client: ClientInfo) {
    const scope = this.scope(auth, BILL);
    const out = { sent: 0, skipped: [] as { studentId: string; reason: string }[] };
    for (const studentId of [...new Set(input.studentIds)]) {
      const info = await this.db.run(this.ctx(auth), async (tx) => {
        const s = await tx.student.findUnique({ where: { id: studentId }, select: { id: true, tenantId: true, campusId: true, firstName: true, lastName: true, admissionNo: true } });
        if (!s || !canAccessCampus(scope, s.campusId)) return null;
        const nd = await noDuesOf(tx, s.id);
        const main = await tx.studentGuardian.findFirst({ where: { studentId: s.id, isPrimary: true }, select: { guardian: { select: { name: true, email: true } } } });
        const school = (await tx.tenant.findUnique({ where: { id: s.tenantId }, select: { name: true } }))?.name ?? 'School';
        return { s, nd, main, school };
      });
      if (!info) { out.skipped.push({ studentId, reason: 'not-found' }); continue; }
      const { s, nd, main, school } = info;
      const balance = toPaise(nd.balance);
      const skip = !balance ? 'nothing-due' : !main?.guardian.email ? 'no-email' : null;
      let url: string | null = null;
      let linkId: string | null = null;
      if (!skip && input.includePayLink && this.online.gateway.mode !== 'off') {
        const l = await this.online.createLink({ studentId, expiresInDays: 14, sendEmail: false }, auth, client).catch(() => null);
        url = l?.url ?? null;
        linkId = l?.id ?? null;
      }
      await this.db.run(this.ctx(auth), async (tx) => {
        if (!skip) {
          const lines = nd.openBills.map((b) => `• ${b.description} (${b.invoiceNo}) — ${formatINR(paise(b.balanceAmount))}, due ${iso(b.dueDate)}`).join('\n');
          await this.notifications.emailExternal(tx, {
            tenantId: s.tenantId, senderUserId: auth.userId, to: main!.guardian.email!, eventCode: 'FEE_REMINDER', entityType: 'STUDENT', entityId: s.id,
            subject: `${school}: fees due for ${s.firstName} ${s.lastName ?? ''}`.trim(),
            body: `Dear ${main!.guardian.name},\n\nThis is a reminder that ${formatINR(balance)} is due for ${s.firstName} ${s.lastName ?? ''} (${s.admissionNo})${toPaise(nd.overdue) ? `, of which ${formatINR(toPaise(nd.overdue))} is past its due date` : ''}:\n\n${lines}\n\n${url ? `Pay securely online: ${url}\n\n` : ''}You can also pay at the school office. Please ignore this message if you have already paid.\n\n${school}`,
          });
        }
        await tx.feeReminder.create({ data: { tenantId: s.tenantId, studentId: s.id, sentTo: skip ? null : main!.guardian.email, amount: fromPaise(balance), linkId, status: skip ? 'SKIPPED' : 'SENT', note: skip, createdBy: auth.userId } });
      });
      if (skip) out.skipped.push({ studentId, reason: skip });
      else out.sent += 1;
    }
    await this.db.run(this.ctx(auth), (tx) => this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'CREATE', entityType: 'FEE_REMINDER', newValues: { sent: out.sent, skipped: out.skipped.length, includePayLink: input.includePayLink } }, client));
    return out;
  }

  // ───────────── No dues ─────────────

  async noDues(studentId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.student.findUnique({ where: { id: studentId }, select: { campusId: true } });
      if (!s || !canAccessCampus(this.scope(auth, READ), s.campusId)) throw NotFound('Student');
      return noDuesOf(tx, studentId);
    });
  }

  // ───────────── Reports ─────────────

  private checkRange(q: ReportQuery, auth: AuthContext) {
    const scope = this.scope(auth, READ);
    if (q.campusId && !canAccessCampus(scope, q.campusId)) throw NotFound('Campus');
    if (q.to > iso(todayIST())) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'future-date', 'The report cannot end in the future', [{ field: 'to', message: 'Cannot be in the future' }]);
    return scope;
  }

  /** Money received in a period: by day, by mode and by cashier — and the same total from the accounts. */
  async collection(q: ReportQuery, auth: AuthContext) {
    const scope = this.checkRange(q, auth);
    return this.db.run(this.ctx(auth), async (tx) => {
      const campus = this.campusSql(scope, q.campusId, Prisma.sql`p.campus_id`);
      const rows = await tx.$queryRaw<{ day: Date; mode: string; cashier: string | null; n: bigint; amount: Prisma.Decimal }[]>`
        SELECT p.payment_date AS day, p.payment_mode AS mode, u.full_name AS cashier, count(*) AS n, sum(p.amount) AS amount
          FROM payments p LEFT JOIN users u ON u.id = p.created_by
         WHERE p.status = 'SUCCESS' AND p.payment_date BETWEEN ${q.from}::date AND ${q.to}::date AND ${campus}
         GROUP BY p.payment_date, p.payment_mode, u.full_name
         ORDER BY p.payment_date`;
      const ledger = await tx.$queryRaw<{ amount: Prisma.Decimal | null }[]>`
        SELECT sum(l.debit) AS amount
          FROM journal_entries j JOIN journal_lines l ON l.journal_entry_id = j.id JOIN accounts a ON a.id = l.account_id
         WHERE j.source_type = 'PAYMENT' AND j.status = 'POSTED' AND j.reversal_of_id IS NULL
           AND j.entry_date BETWEEN ${q.from}::date AND ${q.to}::date
           AND a.system_key IN ('CASH', 'BANK', 'CHEQUES_IN_HAND', 'GATEWAY_CLEARING')
           AND ${this.campusSql(scope, q.campusId, Prisma.sql`j.campus_id`)}`;
      const sumBy = (key: (r: (typeof rows)[number]) => string) => {
        const m = new Map<string, { amount: number; count: number }>();
        for (const r of rows) {
          const k = key(r);
          const x = m.get(k) ?? { amount: 0, count: 0 };
          x.amount += paise(r.amount);
          x.count += Number(r.n);
          m.set(k, x);
        }
        return [...m.entries()].map(([k, v]) => ({ key: k, amount: fromPaise(v.amount), count: v.count }));
      };
      const total = rows.reduce((a, r) => a + paise(r.amount), 0);
      return {
        from: q.from, to: q.to,
        total: fromPaise(total), receipts: rows.reduce((a, r) => a + Number(r.n), 0),
        byDay: sumBy((r) => iso(r.day)), byMode: sumBy((r) => r.mode), byCashier: sumBy((r) => (r.mode === 'ONLINE' ? 'ONLINE' : r.cashier ?? '—')),
        ledgerTotal: fromPaise(paise(ledger[0]?.amount ?? 0)),
        matchesAccounts: paise(ledger[0]?.amount ?? 0) === total,
      };
    });
  }

  /** What the money in a period paid for, by fee head (from allocations); any excess held as advance. */
  async byHead(q: ReportQuery, auth: AuthContext) {
    const scope = this.checkRange(q, auth);
    return this.db.run(this.ctx(auth), async (tx) => {
      const campus = this.campusSql(scope, q.campusId, Prisma.sql`p.campus_id`);
      const heads = await tx.$queryRaw<{ name: string; code: string; fee_type: string; amount: Prisma.Decimal }[]>`
        SELECT h.name, h.code, h.fee_type, sum(a.amount) AS amount
          FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
          JOIN fee_invoice_items i ON i.id = a.invoice_item_id JOIN fee_heads h ON h.id = i.fee_head_id
         WHERE p.status = 'SUCCESS' AND p.payment_date BETWEEN ${q.from}::date AND ${q.to}::date AND ${campus}
         GROUP BY h.name, h.code, h.fee_type ORDER BY sum(a.amount) DESC`;
      const totals = await tx.$queryRaw<{ received: Prisma.Decimal | null; allocated: Prisma.Decimal | null }[]>`
        SELECT sum(p.amount) AS received, (SELECT sum(a.amount) FROM payment_allocations a JOIN payments p2 ON p2.id = a.payment_id
                                            WHERE p2.status = 'SUCCESS' AND p2.payment_date BETWEEN ${q.from}::date AND ${q.to}::date AND ${this.campusSql(scope, q.campusId, Prisma.sql`p2.campus_id`)}) AS allocated
          FROM payments p WHERE p.status = 'SUCCESS' AND p.payment_date BETWEEN ${q.from}::date AND ${q.to}::date AND ${campus}`;
      const received = paise(totals[0]?.received ?? 0);
      const allocated = paise(totals[0]?.allocated ?? 0);
      return { from: q.from, to: q.to, heads: heads.map((h) => ({ name: h.name, code: h.code, feeType: h.fee_type, amount: fromPaise(paise(h.amount)) })), advance: fromPaise(received - allocated), total: fromPaise(received) };
    });
  }

  /** Dues by class today, and the student-receivable balance in the accounts for comparison. */
  async duesByClass(auth: AuthContext, campusId?: string) {
    const scope = this.scope(auth, READ);
    if (campusId && !canAccessCampus(scope, campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      const today = iso(todayIST());
      const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
      const campus = this.campusSql(scope, campusId, Prisma.sql`f.campus_id`);
      const rows = await tx.$queryRaw<{ program_name: string | null; level_name: string | null; level_seq: number | null; students: bigint; gross: Prisma.Decimal; concession: Prisma.Decimal; fine: Prisma.Decimal; paid: Prisma.Decimal; balance: Prisma.Decimal; overdue: Prisma.Decimal }[]>`
        SELECT p.name AS program_name, l.name AS level_name, l.sequence AS level_seq,
               count(DISTINCT f.student_id) FILTER (WHERE f.balance_amount > 0) AS students,
               sum(f.gross_amount) AS gross, sum(f.concession_amount) AS concession, sum(f.fine_amount) AS fine, sum(f.paid_amount) AS paid,
               sum(f.balance_amount) AS balance, coalesce(sum(f.balance_amount) FILTER (WHERE f.due_date < ${today}::date), 0) AS overdue
          FROM fee_invoices f
          LEFT JOIN student_enrollments e ON e.student_id = f.student_id AND e.academic_year_id = ${year?.id ?? NIL}::uuid AND e.status = 'ACTIVE'
          LEFT JOIN sections sec ON sec.id = e.section_id LEFT JOIN program_levels l ON l.id = sec.program_level_id LEFT JOIN programs p ON p.id = l.program_id
         WHERE f.status <> 'CANCELLED' AND ${campus}
         GROUP BY p.name, l.name, l.sequence
         ORDER BY p.name NULLS LAST, l.sequence NULLS LAST`;
      const ledger = await tx.$queryRaw<{ amount: Prisma.Decimal | null }[]>`
        SELECT sum(l.debit - l.credit) AS amount
          FROM journal_lines l JOIN accounts a ON a.id = l.account_id JOIN journal_entries j ON j.id = l.journal_entry_id
         WHERE a.system_key = 'STUDENT_RECEIVABLE' AND ${this.campusSql(scope, campusId, Prisma.sql`j.campus_id`)}`;
      const m = (v: Prisma.Decimal) => fromPaise(paise(v));
      const classes = rows.map((r) => ({ programName: r.program_name, levelName: r.level_name, students: Number(r.students), gross: m(r.gross), concession: m(r.concession), fine: m(r.fine), paid: m(r.paid), balance: m(r.balance), overdue: m(r.overdue) }));
      const balance = rows.reduce((a, r) => a + paise(r.balance), 0);
      const ledgerBalance = paise(ledger[0]?.amount ?? 0);
      return { today, classes, totalBalance: fromPaise(balance), ledgerReceivable: fromPaise(ledgerBalance), matchesAccounts: balance === ledgerBalance };
    });
  }
}
