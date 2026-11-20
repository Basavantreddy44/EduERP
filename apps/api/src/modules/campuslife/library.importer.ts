import { Injectable } from '@nestjs/common';
import { PERMISSIONS, bookSchema, toPaise } from '@eduerp/shared';
import type { Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import type { AuthContext } from '../../common/auth-context';
import type { ClientInfo } from '../../common/decorators';
import { ImportContext, Importer, baseContext, campusFrom, campusHelp, labelsOf, parseDate, zodErrors } from '../imports/importers';
import { LibraryService } from './library.service';

type BookRow = {
  accessionNo: string | null; campusId: string; barcode: string | null; price: string | null; purchaseDate: string | null; rackLocation: string | null;
  book: { isbn: string | null; title: string; authors: string | null; publisher: string | null; edition: string | null; publishYear: number | null; language: string | null; subject: string | null; callNo: string | null };
};
const bookKey = (b: { isbn: string | null; title: string; authors: string | null }) => (b.isbn ? `isbn:${b.isbn}` : `t:${b.title.toLowerCase().trim()}|${(b.authors ?? '').toLowerCase().trim()}`);

/** The existing accession register (M16.1): one row per copy; rows with the same ISBN (or title and author) become one book. */
@Injectable()
export class LibraryBooksImporter implements Importer<BookRow> {
  readonly type = 'LIBRARY_BOOKS' as const;
  readonly permission = PERMISSIONS.LIB_MANAGE;
  readonly module = 'LIBRARY' as const;
  constructor(private readonly audit: AuditService, private readonly library: LibraryService) {}

  async helpLists(tx: Tx) {
    return [await campusHelp(tx)];
  }

  async prepare(tx: Tx, auth: AuthContext) {
    const ctx = await baseContext(tx, auth, this.permission);
    const copies = await tx.libraryCopy.findMany({ select: { accessionNo: true, barcode: true } });
    ctx.accessions = new Set(copies.map((c) => c.accessionNo));
    ctx.barcodes = new Set(copies.map((c) => c.barcode).filter(Boolean));
    return ctx;
  }

  check(v: Record<string, string>, ctx: ImportContext, seen: Set<string>) {
    const errors: string[] = [];
    const campusId = campusFrom(v.campusCode ?? '', ctx, errors);
    if (campusId === null) errors.push('Campus code: required');
    const parsed = bookSchema.safeParse({ isbn: v.isbn ?? '', title: v.title ?? '', authors: v.authors, publisher: v.publisher, edition: v.edition, publishYear: v.publishYear ? v.publishYear : null, language: v.language, subject: v.subject, callNo: v.callNo });
    if (!parsed.success) errors.push(...zodErrors(parsed.error, labelsOf('LIBRARY_BOOKS')));
    const acc = (v.accessionNo ?? '').trim().toUpperCase() || null;
    if (acc && acc.length > 30) errors.push('Accession no: up to 30 characters');
    if (acc && (ctx.accessions as Set<string>).has(acc)) errors.push(`Accession no: ${acc} is already in the library`);
    if (acc && seen.has(`acc:${acc}`)) errors.push(`Accession no: ${acc} appears twice in this file`);
    if (acc) seen.add(`acc:${acc}`);
    const barcode = (v.barcode ?? '').trim() || null;
    if (barcode && ((ctx.barcodes as Set<string>).has(barcode) || seen.has(`bc:${barcode}`))) errors.push(`Barcode: ${barcode} is already used`);
    if (barcode) seen.add(`bc:${barcode}`);
    let price: string | null = null;
    if ((v.price ?? '').trim()) { try { const p = toPaise(v.price.replace(/[₹,\s]/g, '')); if (p < 0) throw new Error(); price = (p / 100).toFixed(2); } catch { errors.push('Price: enter rupees, e.g. 295'); } }
    const purchaseDate = (v.purchaseDate ?? '').trim() ? parseDate(v.purchaseDate) : null;
    if ((v.purchaseDate ?? '').trim() && !purchaseDate) errors.push('Purchase date: use YYYY-MM-DD or DD-MM-YYYY');
    if (errors.length || !parsed.success || !campusId) return { errors };
    const b = parsed.data;
    return { row: { accessionNo: acc, campusId, barcode, price, purchaseDate, rackLocation: (v.rackLocation ?? '').trim() || null, book: { isbn: b.isbn ?? null, title: b.title, authors: b.authors, publisher: b.publisher, edition: b.edition, publishYear: b.publishYear ?? null, language: b.language, subject: b.subject, callNo: b.callNo } }, errors };
  }

  async write(tx: Tx, row: BookRow, auth: AuthContext, client: ClientInfo) {
    const key = bookKey(row.book);
    let book = row.book.isbn
      ? await tx.libraryBook.findFirst({ where: { isbn: row.book.isbn } })
      : await tx.libraryBook.findFirst({ where: { isbn: null, title: { equals: row.book.title, mode: 'insensitive' }, authors: row.book.authors ? { equals: row.book.authors, mode: 'insensitive' } : null } });
    if (!book) book = await tx.libraryBook.create({ data: { ...row.book, tenantId: auth.tenantId!, createdBy: auth.userId } });
    const c = await this.library.createCopyInTx(tx, auth.tenantId!, book.id, { campusId: row.campusId, accessionNo: row.accessionNo, barcode: row.barcode, price: row.price, purchaseDate: row.purchaseDate, rackLocation: row.rackLocation });
    await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: row.campusId, action: 'CREATE', entityType: 'LIBRARY_COPY', entityId: c.id, newValues: { book: book.title, accessionNo: c.accessionNo, key }, reason: 'Bulk import' }, client);
    return c.id;
  }
}
