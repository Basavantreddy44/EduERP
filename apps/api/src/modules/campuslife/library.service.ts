import { Injectable } from '@nestjs/common';
import { AddCopiesInput, BookInput, CopyInput, IssueInput, LibrarySettingsInput, MemberType, PERMISSIONS, fromPaise, toPaise } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { unprocessable, dec } from '../accounts/books';
import { FeeBillingService } from '../fees/billing.service';
import { NotificationsService } from '../notifications/notifications.service';
import { addDays, day, daysBetween, fullName, iso, prettyDate, scopeCampuses, searchPeople, tellParents, todayIST } from './common';

const CIRC = PERMISSIONS.LIB_CIRCULATE;
const MANAGE = PERMISSIONS.LIB_MANAGE;
type Member = { type: MemberType; id: string; name: string; code: string; campusId: string; userId: string | null };

/**
 * Library (M16.1, M16.2): catalogue and copies, issue / return / renew, reservations held for the first
 * in line, lost and damaged copies, fines billed to the student's fees, overdue reminders and stock
 * verification. A copy can never be out to two people (partial unique index); issues lock the copy row.
 */
@Injectable()
export class LibraryService {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly billing: FeeBillingService, private readonly notifications: NotificationsService) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  private can(auth: AuthContext, perm: typeof CIRC | typeof MANAGE, campusId: string) {
    const s = scopeFor(auth, perm);
    return !!s && canAccessCampus(s, campusId);
  }
  private need(auth: AuthContext, perm: typeof CIRC | typeof MANAGE, campusId: string) {
    if (!this.can(auth, perm, campusId)) throw NotFound('Campus');
  }

  async settingsOf(tx: Tx, tenantId: string) {
    const s = await tx.librarySettings.findFirst();
    if (s) return s;
    await tx.$executeRaw`INSERT INTO library_settings (id, tenant_id, updated_at) VALUES (gen_random_uuid(), ${tenantId}::uuid, now()) ON CONFLICT DO NOTHING`;
    return tx.librarySettings.findFirstOrThrow();
  }
  private shapeSettings(s: Awaited<ReturnType<LibraryService['settingsOf']>>) {
    return { studentLoanDays: s.studentLoanDays, staffLoanDays: s.staffLoanDays, studentMaxBooks: s.studentMaxBooks, staffMaxBooks: s.staffMaxBooks, maxRenewals: s.maxRenewals, finePerDay: dec(s.finePerDay), graceDays: s.graceDays, holdDays: s.holdDays, nextAccession: s.nextAccession };
  }

  settings(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => this.shapeSettings(await this.settingsOf(tx, auth.tenantId!)));
  }

  saveSettings(input: LibrarySettingsInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const old = await this.settingsOf(tx, auth.tenantId!);
      const row = await tx.librarySettings.update({ where: { id: old.id }, data: { ...input, updatedBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'UPDATE', entityType: 'LIBRARY_SETTINGS', entityId: row.id, oldValues: this.shapeSettings(old), newValues: input }, client);
      return this.shapeSettings(row);
    });
  }

  // ───────────── Catalogue ─────────────

  books(auth: AuthContext, q?: string, campusId?: string) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const term = (q ?? '').trim();
      const byCopy = term ? await tx.libraryCopy.findMany({ where: { OR: [{ accessionNo: term.toUpperCase() }, { barcode: term }] }, select: { bookId: true } }) : [];
      const words = term.split(/\s+/).filter(Boolean).slice(0, 4);
      const rows = await tx.libraryBook.findMany({
        where: term ? { OR: [{ id: { in: byCopy.map((c) => c.bookId) } }, { isbn: term.replace(/[\s-]/g, '').toUpperCase() }, { AND: words.map((w) => ({ OR: [{ title: { contains: w, mode: 'insensitive' as const } }, { authors: { contains: w, mode: 'insensitive' as const } }, { subject: { contains: w, mode: 'insensitive' as const } }] })) }] } : {},
        orderBy: { title: 'asc' }, take: 100,
        include: { copies: { where: campusId ? { campusId } : {}, select: { status: true } } },
      });
      return rows.map((b) => ({
        id: b.id, title: b.title, authors: b.authors, isbn: b.isbn, publisher: b.publisher, edition: b.edition, publishYear: b.publishYear, subject: b.subject, callNo: b.callNo, language: b.language,
        copies: b.copies.filter((c) => c.status !== 'WITHDRAWN').length, available: b.copies.filter((c) => c.status === 'AVAILABLE').length,
      }));
    });
  }

  book(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const b = await tx.libraryBook.findUnique({ where: { id }, include: { copies: { orderBy: { accessionNo: 'asc' } } } });
      if (!b) throw NotFound('Book');
      const out = await tx.libraryIssue.findMany({ where: { copyId: { in: b.copies.map((c) => c.id) }, status: 'ISSUED' } });
      const res = await tx.libraryReservation.findMany({ where: { bookId: b.id, status: { in: ['WAITING', 'READY'] } }, orderBy: { createdAt: 'asc' } });
      const names = await this.names(tx, [...out, ...res]);
      const campus = new Map((await tx.campus.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
      return {
        id: b.id, title: b.title, authors: b.authors, isbn: b.isbn, publisher: b.publisher, edition: b.edition, publishYear: b.publishYear, language: b.language, subject: b.subject, callNo: b.callNo,
        canManage: !!scopeFor(auth, MANAGE),
        copies: b.copies.map((c) => {
          const i = out.find((x) => x.copyId === c.id);
          return { id: c.id, accessionNo: c.accessionNo, barcode: c.barcode, campusId: c.campusId, campus: campus.get(c.campusId) ?? '', rackLocation: c.rackLocation, price: dec(c.price), purchaseDate: iso(c.purchaseDate), status: c.status, remarks: c.remarks, issuedTo: i ? names.get(i.studentId ?? i.employeeId!) ?? null : null, dueDate: i ? iso(i.dueDate) : null };
        }),
        queue: res.map((r) => ({ id: r.id, name: names.get(r.studentId ?? r.employeeId!) ?? '', status: r.status, campus: campus.get(r.campusId) ?? '', expiresOn: iso(r.expiresOn), since: r.createdAt })),
      };
    });
  }

  private async names(tx: Tx, rows: { studentId: string | null; employeeId: string | null }[]) {
    const sIds = rows.map((r) => r.studentId).filter((x): x is string => !!x);
    const eIds = rows.map((r) => r.employeeId).filter((x): x is string => !!x);
    const m = new Map<string, string>();
    for (const s of await tx.student.findMany({ where: { id: { in: sIds } }, select: { id: true, firstName: true, lastName: true, admissionNo: true } })) m.set(s.id, `${fullName(s)} (${s.admissionNo})`);
    for (const e of await tx.employee.findMany({ where: { id: { in: eIds } }, select: { id: true, firstName: true, lastName: true, employeeCode: true } })) m.set(e.id, `${fullName(e)} (${e.employeeCode})`);
    return m;
  }

  saveBook(id: string | null, input: BookInput, auth: AuthContext, client: ClientInfo) {
    if (!scopeFor(auth, MANAGE)) throw NotFound('Book');
    return this.db.run(this.ctx(auth), async (tx) => {
      const old = id ? await tx.libraryBook.findUnique({ where: { id } }) : null;
      if (id && !old) throw NotFound('Book');
      if (input.isbn) {
        const dup = await tx.libraryBook.findFirst({ where: { isbn: input.isbn, ...(id ? { id: { not: id } } : {}) }, select: { id: true, title: true } });
        if (dup) throw Conflict('duplicate-isbn', `"${dup.title}" already has ISBN ${input.isbn} — add copies to it instead`);
      }
      const data = { isbn: input.isbn ?? null, title: input.title, authors: input.authors, publisher: input.publisher, edition: input.edition, publishYear: input.publishYear ?? null, language: input.language, subject: input.subject, callNo: input.callNo };
      const b = old ? await tx.libraryBook.update({ where: { id: old.id }, data }) : await tx.libraryBook.create({ data: { ...data, tenantId: auth.tenantId!, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: old ? 'UPDATE' : 'CREATE', entityType: 'LIBRARY_BOOK', entityId: b.id, oldValues: old ?? undefined, newValues: data }, client);
      return { id: b.id };
    });
  }

  /** Next free automatic accession number (settings row locked; typed numbers are skipped). */
  async nextAccession(tx: Tx, tenantId: string) {
    const s = await this.settingsOf(tx, tenantId);
    await tx.$queryRaw`SELECT id FROM library_settings WHERE id = ${s.id}::uuid FOR UPDATE`;
    let n = (await tx.librarySettings.findUniqueOrThrow({ where: { id: s.id } })).nextAccession;
    while (await tx.libraryCopy.findFirst({ where: { accessionNo: String(n) }, select: { id: true } })) n++;
    await tx.librarySettings.update({ where: { id: s.id }, data: { nextAccession: n + 1 } });
    return String(n);
  }

  async createCopyInTx(tx: Tx, tenantId: string, bookId: string, c: CopyInput) {
    const accessionNo = c.accessionNo ?? (await this.nextAccession(tx, tenantId));
    if (await tx.libraryCopy.findFirst({ where: { accessionNo }, select: { id: true } })) throw Conflict('duplicate-accession', `Accession number ${accessionNo} is already used`);
    if (c.barcode && (await tx.libraryCopy.findFirst({ where: { barcode: c.barcode }, select: { id: true } }))) throw Conflict('duplicate-barcode', `Barcode ${c.barcode} is already used`);
    return tx.libraryCopy.create({ data: { tenantId, bookId, campusId: c.campusId, accessionNo, barcode: c.barcode, purchaseDate: c.purchaseDate ? day(c.purchaseDate) : null, price: c.price ?? null, rackLocation: c.rackLocation } });
  }

  addCopies(bookId: string, input: AddCopiesInput, auth: AuthContext, client: ClientInfo) {
    this.need(auth, MANAGE, input.campusId);
    return this.db.run(this.ctx(auth), async (tx) => {
      const b = await tx.libraryBook.findUnique({ where: { id: bookId } });
      if (!b) throw NotFound('Book');
      if (input.count > 1 && (input.accessionNo || input.barcode)) throw unprocessable('one-at-a-time', 'Type an accession number or barcode only when adding one copy', 'accessionNo');
      const made: string[] = [];
      for (let i = 0; i < input.count; i++) made.push((await this.createCopyInTx(tx, auth.tenantId!, b.id, input)).accessionNo);
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: input.campusId, action: 'CREATE', entityType: 'LIBRARY_COPY', entityId: b.id, newValues: { book: b.title, accessionNos: made } }, client);
      return { accessionNos: made };
    });
  }

  editCopy(id: string, input: CopyInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = await tx.libraryCopy.findUnique({ where: { id } });
      if (!c) throw NotFound('Copy');
      this.need(auth, MANAGE, c.campusId);
      this.need(auth, MANAGE, input.campusId);
      if (input.campusId !== c.campusId && c.status === 'ISSUED') throw Conflict('copy-out', 'The copy is out — move it after it comes back');
      if (input.accessionNo && input.accessionNo !== c.accessionNo && (await tx.libraryCopy.findFirst({ where: { accessionNo: input.accessionNo }, select: { id: true } }))) throw Conflict('duplicate-accession', `Accession number ${input.accessionNo} is already used`);
      if (input.barcode && input.barcode !== c.barcode && (await tx.libraryCopy.findFirst({ where: { barcode: input.barcode }, select: { id: true } }))) throw Conflict('duplicate-barcode', `Barcode ${input.barcode} is already used`);
      const data = { campusId: input.campusId, accessionNo: input.accessionNo ?? c.accessionNo, barcode: input.barcode, purchaseDate: input.purchaseDate ? day(input.purchaseDate) : null, price: input.price ?? null, rackLocation: input.rackLocation };
      await tx.libraryCopy.update({ where: { id }, data });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: c.campusId, action: 'UPDATE', entityType: 'LIBRARY_COPY', entityId: id, oldValues: c, newValues: data }, client);
      return { id };
    });
  }

  withdrawCopy(id: string, remarks: string | null, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await tx.$queryRaw`SELECT id FROM library_copies WHERE id = ${id}::uuid FOR UPDATE`;
      const c = await tx.libraryCopy.findUnique({ where: { id } });
      if (!c) throw NotFound('Copy');
      this.need(auth, MANAGE, c.campusId);
      if (['ISSUED', 'ON_HOLD'].includes(c.status)) throw Conflict('copy-busy', c.status === 'ISSUED' ? 'The copy is out — it can be withdrawn after it comes back' : 'The copy is kept for a reservation');
      if (c.status === 'WITHDRAWN') throw Conflict('copy-withdrawn', 'Already withdrawn');
      await tx.libraryCopy.update({ where: { id }, data: { status: 'WITHDRAWN', remarks } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: c.campusId, action: 'STATUS_CHANGE', entityType: 'LIBRARY_COPY', entityId: id, oldValues: { status: c.status }, newValues: { status: 'WITHDRAWN', remarks } }, client);
      return { status: 'WITHDRAWN' };
    });
  }

  // ───────────── Members ─────────────

  members(q: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), (tx) => searchPeople(tx, q, scopeCampuses(scopeFor(auth, CIRC)), ['STUDENT', 'EMPLOYEE']));
  }

  private async member(tx: Tx, type: MemberType, id: string): Promise<Member> {
    if (type === 'STUDENT') {
      const s = await tx.student.findUnique({ where: { id }, select: { id: true, firstName: true, lastName: true, admissionNo: true, campusId: true, status: true, userId: true } });
      if (!s) throw NotFound('Student');
      if (s.status !== 'ACTIVE') throw Conflict('member-inactive', `${fullName(s)} is not a current student`);
      return { type, id: s.id, name: fullName(s), code: s.admissionNo, campusId: s.campusId, userId: s.userId };
    }
    const e = await tx.employee.findUnique({ where: { id }, select: { id: true, firstName: true, lastName: true, employeeCode: true, campusId: true, status: true, userId: true } });
    if (!e) throw NotFound('Staff member');
    if (['RESIGNED', 'TERMINATED'].includes(e.status)) throw Conflict('member-inactive', `${fullName(e)} has left`);
    return { type, id: e.id, name: fullName(e), code: e.employeeCode, campusId: e.campusId, userId: e.userId };
  }
  private whose = (m: { type: MemberType; id: string }) => (m.type === 'STUDENT' ? { studentId: m.id } : { employeeId: m.id });

  /** A member's loans, reservations and limits. */
  memberView(type: MemberType, id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const m = await this.member(tx, type, id);
      this.need(auth, CIRC, m.campusId);
      return this.loansOf(tx, auth.tenantId!, m);
    });
  }

  private async loansOf(tx: Tx, tenantId: string, m: Member) {
    const s = await this.settingsOf(tx, tenantId);
    const issues = await tx.libraryIssue.findMany({ where: this.whose(m), orderBy: { issueDate: 'desc' }, take: 40 });
    const copies = new Map((await tx.libraryCopy.findMany({ where: { id: { in: issues.map((i) => i.copyId) } }, include: { book: { select: { id: true, title: true, authors: true } } } })).map((c) => [c.id, c]));
    const res = await tx.libraryReservation.findMany({ where: { ...this.whose(m), status: { in: ['WAITING', 'READY'] } }, orderBy: { createdAt: 'asc' } });
    const books = new Map((await tx.libraryBook.findMany({ where: { id: { in: res.map((r) => r.bookId) } }, select: { id: true, title: true } })).map((b) => [b.id, b.title]));
    const today = todayIST();
    const max = m.type === 'STUDENT' ? s.studentMaxBooks : s.staffMaxBooks;
    const out = issues.filter((i) => i.status === 'ISSUED');
    const shape = (i: (typeof issues)[number]) => {
      const c = copies.get(i.copyId)!;
      const late = i.status === 'ISSUED' ? Math.max(0, daysBetween(iso(i.dueDate)!, today)) : 0;
      const fine = m.type === 'STUDENT' && late > s.graceDays ? (late - s.graceDays) * toPaise(dec(s.finePerDay)) : 0;
      return {
        id: i.id, bookId: c.book.id, title: c.book.title, authors: c.book.authors, accessionNo: c.accessionNo, issueDate: iso(i.issueDate), dueDate: iso(i.dueDate), returnDate: iso(i.returnDate), status: i.status,
        renewCount: i.renewCount, canRenew: i.status === 'ISSUED' && i.renewCount < s.maxRenewals && late === 0, daysLate: late, fineSoFar: fromPaise(fine),
        fineAmount: dec(i.fineAmount), fineStatus: i.fineStatus,
      };
    };
    return {
      member: { type: m.type, id: m.id, name: m.name, code: m.code },
      limit: max, out: out.length, overdue: out.filter((i) => iso(i.dueDate)! < today).length,
      loans: out.map(shape), history: issues.filter((i) => i.status !== 'ISSUED').slice(0, 20).map(shape),
      reservations: res.map((r) => ({ id: r.id, bookId: r.bookId, title: books.get(r.bookId) ?? '', status: r.status, expiresOn: iso(r.expiresOn) })),
    };
  }

  /** The signed-in staff member's own library. */
  my(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await tx.employee.findFirst({ where: { userId: auth.userId }, select: { id: true } });
      // Not on the staff list (e.g. an office login): an explicit empty answer, never an empty body.
      if (!e) return { member: null, limit: 0, out: 0, overdue: 0, loans: [], history: [], reservations: [] };
      return this.loansOf(tx, auth.tenantId!, await this.member(tx, 'EMPLOYEE', e.id));
    });
  }

  /** A child's library in the parent / student app. */
  child(studentId: string, auth: AuthContext) {
    if (!(auth.portalStudentIds ?? []).includes(studentId)) throw NotFound('Student');
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.student.findUnique({ where: { id: studentId }, select: { id: true, firstName: true, lastName: true, admissionNo: true, campusId: true, userId: true } });
      if (!s) throw NotFound('Student');
      const v = await this.loansOf(tx, auth.tenantId!, { type: 'STUDENT', id: s.id, name: fullName(s), code: s.admissionNo, campusId: s.campusId, userId: s.userId });
      return { loans: v.loans.map(({ id, title, authors, dueDate, daysLate, fineSoFar }) => ({ id, title, authors, dueDate, daysLate, fineSoFar })), history: v.history.slice(0, 10).map(({ id, title, returnDate, fineAmount, fineStatus }) => ({ id, title, returnDate, fineAmount, fineStatus })), reservations: v.reservations };
    });
  }

  // ───────────── Circulation ─────────────

  private async copyByCode(tx: Tx, code: string, lock = true) {
    const c = await tx.libraryCopy.findFirst({ where: { OR: [{ accessionNo: code.trim().toUpperCase() }, { barcode: code.trim() }] }, include: { book: { select: { id: true, title: true } } } });
    if (!c) throw unprocessable('copy-not-found', `No copy with accession number or barcode "${code}"`, 'code');
    if (lock) await tx.$queryRaw`SELECT id FROM library_copies WHERE id = ${c.id}::uuid FOR UPDATE`;
    return (await tx.libraryCopy.findUniqueOrThrow({ where: { id: c.id }, include: { book: { select: { id: true, title: true } } } }));
  }

  issue(input: IssueInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = await this.copyByCode(tx, input.code);
      this.need(auth, CIRC, c.campusId);
      const m = await this.member(tx, input.memberType, input.memberId);
      const s = await this.settingsOf(tx, auth.tenantId!);
      const today = todayIST();
      let held: string | null = null;
      if (c.status === 'ON_HOLD') {
        const r = await tx.libraryReservation.findFirst({ where: { copyId: c.id, status: 'READY' } });
        if (!r || (r.studentId ?? r.employeeId) !== m.id) throw Conflict('copy-held', `This copy of "${c.book.title}" is kept for someone who reserved it`);
        held = r.id;
      } else if (c.status !== 'AVAILABLE') {
        throw Conflict('copy-unavailable', c.status === 'ISSUED' ? `${c.accessionNo} is already issued — return it first` : `${c.accessionNo} is ${c.status.toLowerCase()} and cannot be issued`);
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`library-member:${m.id}`}))`;
      const out = await tx.libraryIssue.findMany({ where: { ...this.whose(m), status: 'ISSUED' }, select: { dueDate: true } });
      const max = m.type === 'STUDENT' ? s.studentMaxBooks : s.staffMaxBooks;
      if (out.some((o) => iso(o.dueDate)! < today)) throw Conflict('member-overdue', `${m.name} has an overdue book — it must come back first`);
      if (out.length >= max) throw Conflict('member-limit', `${m.name} already has ${out.length} book(s) — the limit is ${max}`);
      const due = input.dueDate ?? addDays(today, m.type === 'STUDENT' ? s.studentLoanDays : s.staffLoanDays);
      if (due < today) throw unprocessable('due-past', 'The due date is in the past', 'dueDate');
      const i = await tx.libraryIssue.create({ data: { tenantId: auth.tenantId!, campusId: c.campusId, copyId: c.id, memberType: m.type, ...this.whose(m), issueDate: day(today), dueDate: day(due), issuedBy: auth.userId } });
      await tx.libraryCopy.update({ where: { id: c.id }, data: { status: 'ISSUED' } });
      if (held) await tx.libraryReservation.update({ where: { id: held }, data: { status: 'COLLECTED' } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: c.campusId, action: 'CREATE', entityType: 'LIBRARY_ISSUE', entityId: i.id, newValues: { copy: c.accessionNo, book: c.book.title, member: `${m.name} (${m.code})`, due } }, client);
      return { id: i.id, title: c.book.title, accessionNo: c.accessionNo, member: m.name, dueDate: due };
    });
  }

  /** Bills a student a library charge under a Fine fee head; returns the bill. */
  private async charge(tx: Tx, studentId: string, amountPaise: number, description: string, userId: string) {
    const head = await tx.feeHead.findFirst({ where: { feeType: 'FINE', status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!head) throw Conflict('no-fine-head', 'Add a fee head of type Fine in Fees → Setup first (or waive the charge)');
    const s = await tx.student.findUniqueOrThrow({ where: { id: studentId }, select: { id: true, tenantId: true, campusId: true, firstName: true, lastName: true, admissionNo: true } });
    return this.billing.chargeInTx(tx, s, { feeHeadId: head.id, amount: fromPaise(amountPaise), dueDate: todayIST(), description: description.slice(0, 200) }, userId);
  }

  returnBook(input: { code: string; condition: 'GOOD' | 'DAMAGED'; remarks: string | null; waive?: boolean }, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = await this.copyByCode(tx, input.code);
      this.need(auth, CIRC, c.campusId);
      const i = await tx.libraryIssue.findFirst({ where: { copyId: c.id, status: 'ISSUED' } });
      if (!i) throw Conflict('not-issued', `${c.accessionNo} is not out`);
      const s = await this.settingsOf(tx, auth.tenantId!);
      const today = todayIST();
      const late = Math.max(0, daysBetween(iso(i.dueDate)!, today));
      const finePaise = i.memberType === 'STUDENT' && late > s.graceDays ? (late - s.graceDays) * toPaise(dec(s.finePerDay)) : 0;
      let fineStatus = 'NONE';
      let fineInvoiceId: string | null = null;
      if (finePaise > 0) {
        if (input.waive) {
          if (!this.can(auth, PERMISSIONS.LIB_WAIVE as typeof CIRC, c.campusId)) throw Conflict('no-waive-right', 'You cannot waive library fines');
          fineStatus = 'WAIVED';
        } else {
          const inv = await this.charge(tx, i.studentId!, finePaise, `Library fine · "${c.book.title}" (${c.accessionNo}) returned ${late} day(s) late`, auth.userId);
          fineStatus = 'CHARGED';
          fineInvoiceId = inv.id;
        }
      }
      await tx.libraryIssue.update({ where: { id: i.id }, data: { status: 'RETURNED', returnDate: day(today), returnedTo: auth.userId, fineAmount: fromPaise(finePaise), fineStatus, fineInvoiceId, remarks: input.remarks } });
      const next = input.condition === 'DAMAGED' ? null : await this.holdForNext(tx, c.id, c.book.id, c.book.title, c.campusId, s.holdDays, auth.userId);
      await tx.libraryCopy.update({ where: { id: c.id }, data: { status: input.condition === 'DAMAGED' ? 'DAMAGED' : next ? 'ON_HOLD' : 'AVAILABLE', ...(input.condition === 'DAMAGED' ? { remarks: input.remarks ?? 'Returned damaged' } : {}) } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: c.campusId, action: 'UPDATE', entityType: 'LIBRARY_ISSUE', entityId: i.id, oldValues: { status: 'ISSUED' }, newValues: { status: 'RETURNED', daysLate: late, fine: fromPaise(finePaise), fineStatus, condition: input.condition, heldFor: next } }, client);
      return { title: c.book.title, accessionNo: c.accessionNo, daysLate: late, fine: fromPaise(finePaise), fineStatus, heldFor: next };
    });
  }

  /** Keeps a copy for the first person waiting for the book at that campus; tells them. Returns their name. */
  private async holdForNext(tx: Tx, copyId: string, bookId: string, title: string, campusId: string, holdDays: number, userId: string | null) {
    const r = await tx.libraryReservation.findFirst({ where: { bookId, campusId, status: 'WAITING' }, orderBy: { createdAt: 'asc' } });
    if (!r) return null;
    const until = addDays(todayIST(), holdDays);
    await tx.libraryReservation.update({ where: { id: r.id }, data: { status: 'READY', copyId, readyAt: new Date(), expiresOn: day(until) } });
    const who = r.studentId ? await tx.student.findUnique({ where: { id: r.studentId }, select: { firstName: true, lastName: true, userId: true } }) : await tx.employee.findUnique({ where: { id: r.employeeId! }, select: { firstName: true, lastName: true, userId: true } });
    const name = who ? fullName(who) : '';
    const vars = { who: name, title, until: prettyDate(until) };
    if (who?.userId) await this.notifications.notify(tx, { tenantId: r.tenantId, userIds: [who.userId], eventCode: 'LIBRARY_READY', vars, entityType: 'LIBRARY_RESERVATION', entityId: r.id });
    if (r.studentId) await tellParents(tx, this.notifications, { tenantId: r.tenantId, senderUserId: userId ?? '', studentId: r.studentId, eventCode: 'LIBRARY_READY', vars, emailSubject: `Reserved book ready: ${title}`, emailBody: `Hello,\n\n"${title}" is now kept for ${name} at the library until ${prettyDate(until)}. Please collect it before then.`, entityType: 'LIBRARY_RESERVATION', entityId: r.id });
    return name;
  }

  renew(issueId: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await tx.$queryRaw`SELECT id FROM library_issues WHERE id = ${issueId}::uuid FOR UPDATE`;
      const i = await tx.libraryIssue.findUnique({ where: { id: issueId } });
      if (!i) throw NotFound('Loan');
      const me = await tx.employee.findFirst({ where: { userId: auth.userId }, select: { id: true } });
      if (!this.can(auth, CIRC, i.campusId) && i.employeeId !== me?.id) throw NotFound('Loan');
      if (i.status !== 'ISSUED') throw Conflict('not-issued', 'This book has already come back');
      const s = await this.settingsOf(tx, auth.tenantId!);
      const today = todayIST();
      if (iso(i.dueDate)! < today) throw Conflict('overdue', 'An overdue book cannot be renewed — return it');
      if (i.renewCount >= s.maxRenewals) throw Conflict('renew-limit', `Already renewed ${i.renewCount} time(s) — the limit is ${s.maxRenewals}`);
      const c = await tx.libraryCopy.findUniqueOrThrow({ where: { id: i.copyId }, include: { book: { select: { id: true, title: true } } } });
      if (await tx.libraryReservation.findFirst({ where: { bookId: c.book.id, campusId: c.campusId, status: 'WAITING' }, select: { id: true } })) throw Conflict('reserved', `Someone is waiting for "${c.book.title}" — it cannot be renewed`);
      const due = addDays(iso(i.dueDate)! > today ? iso(i.dueDate)! : today, i.memberType === 'STUDENT' ? s.studentLoanDays : s.staffLoanDays);
      await tx.libraryIssue.update({ where: { id: i.id }, data: { dueDate: day(due), renewCount: i.renewCount + 1 } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: i.campusId, action: 'UPDATE', entityType: 'LIBRARY_ISSUE', entityId: i.id, oldValues: { dueDate: iso(i.dueDate) }, newValues: { dueDate: due, renewCount: i.renewCount + 1 } }, client);
      return { dueDate: due, renewCount: i.renewCount + 1 };
    });
  }

  markLost(issueId: string, remarks: string | null, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await tx.$queryRaw`SELECT id FROM library_issues WHERE id = ${issueId}::uuid FOR UPDATE`;
      const i = await tx.libraryIssue.findUnique({ where: { id: issueId } });
      if (!i) throw NotFound('Loan');
      this.need(auth, CIRC, i.campusId);
      if (i.status !== 'ISSUED') throw Conflict('not-issued', 'This book is not out');
      const c = await tx.libraryCopy.findUniqueOrThrow({ where: { id: i.copyId }, include: { book: { select: { title: true } } } });
      let lostInvoiceId: string | null = null;
      if (i.studentId && c.price && toPaise(dec(c.price)) > 0) lostInvoiceId = (await this.charge(tx, i.studentId, toPaise(dec(c.price)), `Lost library book · "${c.book.title}" (${c.accessionNo})`, auth.userId)).id;
      await tx.libraryIssue.update({ where: { id: i.id }, data: { status: 'LOST', returnDate: day(todayIST()), returnedTo: auth.userId, lostInvoiceId, remarks } });
      await tx.libraryCopy.update({ where: { id: c.id }, data: { status: 'LOST', remarks: remarks ?? 'Lost by the borrower' } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: i.campusId, action: 'STATUS_CHANGE', entityType: 'LIBRARY_ISSUE', entityId: i.id, oldValues: { status: 'ISSUED' }, newValues: { status: 'LOST', charged: lostInvoiceId ? dec(c.price) : null } }, client);
      return { status: 'LOST', charged: lostInvoiceId ? dec(c.price) : null };
    });
  }

  reserve(input: { memberType: MemberType; memberId: string; bookId: string; campusId: string }, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const me = await tx.employee.findFirst({ where: { userId: auth.userId }, select: { id: true } });
      const self = input.memberType === 'EMPLOYEE' && input.memberId === me?.id;
      if (!self) this.need(auth, CIRC, input.campusId);
      const m = await this.member(tx, input.memberType, input.memberId);
      const b = await tx.libraryBook.findUnique({ where: { id: input.bookId }, select: { id: true, title: true } });
      if (!b) throw NotFound('Book');
      const copies = await tx.libraryCopy.findMany({ where: { bookId: b.id, campusId: input.campusId, status: { not: 'WITHDRAWN' } }, select: { id: true, status: true } });
      if (!copies.length) throw Conflict('no-copy', `"${b.title}" has no copy at this campus`);
      if (copies.some((c) => c.status === 'AVAILABLE')) throw Conflict('on-shelf', `A copy of "${b.title}" is on the shelf — issue it instead`);
      if (await tx.libraryIssue.findFirst({ where: { ...this.whose(m), status: 'ISSUED', copyId: { in: copies.map((c) => c.id) } }, select: { id: true } })) throw Conflict('already-has', `${m.name} already has this book`);
      if (await tx.libraryReservation.findFirst({ where: { bookId: b.id, ...this.whose(m), status: { in: ['WAITING', 'READY'] } }, select: { id: true } })) throw Conflict('already-reserved', `${m.name} is already waiting for this book`);
      const r = await tx.libraryReservation.create({ data: { tenantId: auth.tenantId!, bookId: b.id, campusId: input.campusId, memberType: m.type, ...this.whose(m), createdBy: auth.userId } });
      const ahead = await tx.libraryReservation.count({ where: { bookId: b.id, campusId: input.campusId, status: 'WAITING', createdAt: { lt: r.createdAt } } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: input.campusId, action: 'CREATE', entityType: 'LIBRARY_RESERVATION', entityId: r.id, newValues: { book: b.title, member: m.name } }, client);
      return { id: r.id, position: ahead + 1 };
    });
  }

  cancelReservation(id: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await tx.$queryRaw`SELECT id FROM library_reservations WHERE id = ${id}::uuid FOR UPDATE`;
      const r = await tx.libraryReservation.findUnique({ where: { id } });
      if (!r) throw NotFound('Reservation');
      const me = await tx.employee.findFirst({ where: { userId: auth.userId }, select: { id: true } });
      if (!this.can(auth, CIRC, r.campusId) && r.employeeId !== me?.id) throw NotFound('Reservation');
      if (!['WAITING', 'READY'].includes(r.status)) throw Conflict('reservation-closed', 'This reservation is already closed');
      await tx.libraryReservation.update({ where: { id }, data: { status: 'CANCELLED' } });
      if (r.status === 'READY' && r.copyId) await this.releaseHold(tx, r.copyId, auth.userId);
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: r.campusId, action: 'CANCEL', entityType: 'LIBRARY_RESERVATION', entityId: id, oldValues: { status: r.status } }, client);
      return { status: 'CANCELLED' };
    });
  }

  /** A held copy goes to the next in line, or back on the shelf. */
  private async releaseHold(tx: Tx, copyId: string, userId: string | null) {
    const c = await tx.libraryCopy.findUniqueOrThrow({ where: { id: copyId }, include: { book: { select: { id: true, title: true } } } });
    const s = await tx.librarySettings.findFirstOrThrow();
    const next = await this.holdForNext(tx, c.id, c.book.id, c.book.title, c.campusId, s.holdDays, userId);
    await tx.libraryCopy.update({ where: { id: c.id }, data: { status: next ? 'ON_HOLD' : 'AVAILABLE' } });
  }

  /** Books out now (optionally only overdue), for the desk. */
  loans(auth: AuthContext, o: { campusId?: string; overdue?: boolean; q?: string }) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = scopeFor(auth, CIRC)!;
      const today = todayIST();
      const rows = await tx.libraryIssue.findMany({
        where: { status: 'ISSUED', ...(o.campusId ? { campusId: o.campusId } : {}), ...(s.all ? {} : { campusId: { in: s.campusIds } }), ...(o.overdue ? { dueDate: { lt: day(today) } } : {}) },
        orderBy: { dueDate: 'asc' }, take: 500,
      });
      const copies = new Map((await tx.libraryCopy.findMany({ where: { id: { in: rows.map((r) => r.copyId) } }, include: { book: { select: { title: true } } } })).map((c) => [c.id, c]));
      const names = await this.names(tx, rows);
      const term = (o.q ?? '').trim().toLowerCase();
      return rows
        .map((i) => { const c = copies.get(i.copyId)!; return { id: i.id, title: c.book.title, accessionNo: c.accessionNo, memberType: i.memberType, memberId: i.studentId ?? i.employeeId, member: names.get(i.studentId ?? i.employeeId!) ?? '', issueDate: iso(i.issueDate), dueDate: iso(i.dueDate), daysLate: Math.max(0, daysBetween(iso(i.dueDate)!, today)), renewCount: i.renewCount, lastReminder: iso(i.lastReminder) }; })
        .filter((r) => !term || `${r.title} ${r.accessionNo} ${r.member}`.toLowerCase().includes(term));
    });
  }

  /** Daily: overdue reminders (once a day per loan, in-app) and expired holds released. */
  async remindAll() {
    const tenants = await this.db.run({ isPlatform: true }, (tx) => tx.tenant.findMany({ where: { status: { in: ['ACTIVE', 'TRIAL', 'GRACE'] } }, select: { id: true } }));
    let n = 0;
    for (const t of tenants) {
      n += await this.db.run({ tenantId: t.id, userId: null }, async (tx) => {
        const today = todayIST();
        let count = 0;
        const expired = await tx.libraryReservation.findMany({ where: { status: 'READY', expiresOn: { lt: day(today) } } });
        for (const r of expired) {
          await tx.libraryReservation.update({ where: { id: r.id }, data: { status: 'EXPIRED' } });
          if (r.copyId) await this.releaseHold(tx, r.copyId, null);
        }
        const due = await tx.libraryIssue.findMany({ where: { status: 'ISSUED', dueDate: { lt: day(today) }, OR: [{ lastReminder: null }, { lastReminder: { lt: day(today) } }] }, take: 1000 });
        for (const i of due) {
          const claimed = await tx.libraryIssue.updateMany({ where: { id: i.id, OR: [{ lastReminder: null }, { lastReminder: { lt: day(today) } }] }, data: { lastReminder: day(today) } });
          if (!claimed.count) continue;
          const c = await tx.libraryCopy.findUniqueOrThrow({ where: { id: i.copyId }, include: { book: { select: { title: true } } } });
          const person = i.studentId ? await tx.student.findUnique({ where: { id: i.studentId }, select: { firstName: true, lastName: true, userId: true } }) : await tx.employee.findUnique({ where: { id: i.employeeId! }, select: { firstName: true, lastName: true, userId: true } });
          if (!person) continue;
          const vars = { who: fullName(person), title: c.book.title, dueDate: prettyDate(iso(i.dueDate)!), days: String(daysBetween(iso(i.dueDate)!, today)) };
          if (person.userId) await this.notifications.notify(tx, { tenantId: t.id, userIds: [person.userId], eventCode: 'LIBRARY_OVERDUE', vars, entityType: 'LIBRARY_ISSUE', entityId: i.id });
          if (i.studentId) await tellParents(tx, this.notifications, { tenantId: t.id, senderUserId: '', studentId: i.studentId, eventCode: 'LIBRARY_OVERDUE', vars, emailSubject: '', emailBody: '', entityType: 'LIBRARY_ISSUE', entityId: i.id });
          count++;
        }
        return count;
      });
    }
    return n;
  }

  // ───────────── Stock verification ─────────────

  stockCheck(campusId: string, auth: AuthContext) {
    this.need(auth, MANAGE, campusId);
    return this.db.run(this.ctx(auth), (tx) => this.checkView(tx, campusId));
  }

  private async checkView(tx: Tx, campusId: string) {
    const ck = await tx.libraryStockCheck.findFirst({ where: { campusId, status: 'OPEN' } });
    const last = await tx.libraryStockCheck.findFirst({ where: { campusId, status: 'CLOSED' }, orderBy: { closedAt: 'desc' } });
    if (!ck) return { open: null, lastClosed: last ? { startedOn: iso(last.startedOn), closedAt: last.closedAt } : null };
    const expected = await tx.libraryCopy.findMany({ where: { campusId, status: { in: ['AVAILABLE', 'ON_HOLD', 'DAMAGED'] } }, include: { book: { select: { title: true } } }, orderBy: { accessionNo: 'asc' } });
    const scans = await tx.libraryStockScan.findMany({ where: { checkId: ck.id }, select: { copyId: true } });
    const seen = new Set(scans.map((x) => x.copyId));
    const missing = expected.filter((c) => !seen.has(c.id));
    const out = await tx.libraryCopy.count({ where: { campusId, status: 'ISSUED' } });
    return {
      open: { id: ck.id, startedOn: iso(ck.startedOn), scanned: seen.size, expected: expected.length, out, missingCount: missing.length, missing: missing.slice(0, 300).map((c) => ({ id: c.id, accessionNo: c.accessionNo, title: c.book.title, rackLocation: c.rackLocation })) },
      lastClosed: last ? { startedOn: iso(last.startedOn), closedAt: last.closedAt } : null,
    };
  }

  startCheck(campusId: string, auth: AuthContext, client: ClientInfo) {
    this.need(auth, MANAGE, campusId);
    return this.db.run(this.ctx(auth), async (tx) => {
      if (await tx.libraryStockCheck.findFirst({ where: { campusId, status: 'OPEN' }, select: { id: true } })) throw Conflict('check-open', 'A stock verification is already going on at this campus');
      const ck = await tx.libraryStockCheck.create({ data: { tenantId: auth.tenantId!, campusId, startedOn: day(todayIST()), createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId, action: 'CREATE', entityType: 'LIBRARY_STOCK_CHECK', entityId: ck.id }, client);
      return this.checkView(tx, campusId);
    });
  }

  scan(checkId: string, code: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const ck = await tx.libraryStockCheck.findUnique({ where: { id: checkId } });
      if (!ck || ck.status !== 'OPEN') throw NotFound('Stock verification');
      this.need(auth, MANAGE, ck.campusId);
      const c = await this.copyByCode(tx, code, false);
      if (c.campusId !== ck.campusId) throw Conflict('other-campus', `${c.accessionNo} belongs to another campus`);
      const fresh = !(await tx.libraryStockScan.findUnique({ where: { checkId_copyId: { checkId, copyId: c.id } } }));
      if (fresh) await tx.libraryStockScan.create({ data: { tenantId: auth.tenantId!, checkId, copyId: c.id, scannedBy: auth.userId } });
      const note = c.status === 'ISSUED' ? 'The register shows this copy as issued — check it in at the desk' : c.status === 'LOST' ? 'This copy was marked lost — it has been found' : c.status === 'WITHDRAWN' ? 'This copy was withdrawn' : null;
      if (c.status === 'LOST') await tx.libraryCopy.update({ where: { id: c.id }, data: { status: 'AVAILABLE', remarks: 'Found at stock verification' } });
      return { accessionNo: c.accessionNo, title: c.book.title, already: !fresh, note, ...(await this.checkView(tx, ck.campusId)).open };
    });
  }

  closeCheck(checkId: string, markLost: boolean, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const ck = await tx.libraryStockCheck.findUnique({ where: { id: checkId } });
      if (!ck || ck.status !== 'OPEN') throw NotFound('Stock verification');
      this.need(auth, MANAGE, ck.campusId);
      const v = (await this.checkView(tx, ck.campusId)).open!;
      let lost = 0;
      if (markLost) {
        const ids = (await tx.libraryCopy.findMany({ where: { campusId: ck.campusId, status: { in: ['AVAILABLE', 'DAMAGED'] }, id: { notIn: (await tx.libraryStockScan.findMany({ where: { checkId }, select: { copyId: true } })).map((x) => x.copyId) } }, select: { id: true } })).map((c) => c.id);
        lost = (await tx.libraryCopy.updateMany({ where: { id: { in: ids } }, data: { status: 'LOST', remarks: `Missing at stock verification ${iso(ck.startedOn)}` } })).count;
      }
      await tx.libraryStockCheck.update({ where: { id: ck.id }, data: { status: 'CLOSED', closedAt: new Date() } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: ck.campusId, action: 'CLOSE', entityType: 'LIBRARY_STOCK_CHECK', entityId: ck.id, newValues: { scanned: v.scanned, expected: v.expected, missing: v.missingCount, markedLost: lost } }, client);
      return { scanned: v.scanned, missing: v.missingCount, markedLost: lost };
    });
  }
}
