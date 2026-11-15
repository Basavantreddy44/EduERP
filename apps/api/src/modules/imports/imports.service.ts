import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { IMPORT_MAX_MB, IMPORT_TYPES, ImportTypeCode } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import type { AuthContext } from '../../common/auth-context';
import { AppError, Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { AnyImporter, IMPORTERS, asJson } from './importers';
import { buildSheet, buildTemplate, readSpreadsheet } from './spreadsheet';

type JobView = { id: string; entityType: string; fileName: string; status: string; totalRows: number; validRows: number; errorRows: number; importedRows: number; createdAt: Date; committedAt: Date | null };

/**
 * Import framework (G-12): upload → validate every row (dry run, nothing written to business tables)
 * → review errors → commit valid rows in one transaction. Re-validates at commit, because data may have
 * changed since the upload.
 */
@Injectable()
export class ImportsService {
  private readonly byType: Map<string, AnyImporter>;

  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    @Inject(IMPORTERS) importers: AnyImporter[],
  ) {
    this.byType = new Map(importers.map((i) => [i.type, i]));
  }

  private importer(type: string, auth: AuthContext): AnyImporter {
    const imp = this.byType.get(type);
    if (!imp) throw NotFound('Import type');
    if (!auth.permissions.has(imp.permission)) throw Forbidden();
    return imp;
  }

  /** Imports of a plan module are refused when the institution's plan does not include it. */
  private async moduleOn(tx: Tx, imp: AnyImporter) {
    if (!imp.module) return;
    const on = await tx.tenantModule.findFirst({ where: { moduleCode: imp.module, isEnabled: true }, select: { id: true } });
    if (!on) throw Forbidden('module-not-enabled', "This module is not part of your institution's plan");
  }

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  /** Types the current user may import, with their columns (drives the web wizard). */
  async types(auth: AuthContext) {
    const enabled = await this.db.run(this.ctx(auth), async (tx) => new Set((await tx.tenantModule.findMany({ where: { isEnabled: true }, select: { moduleCode: true } })).map((m) => m.moduleCode)));
    return Object.values(IMPORT_TYPES).filter((t) => {
      const imp = this.byType.get(t.type);
      return imp && auth.permissions.has(imp.permission) && (!imp.module || enabled.has(imp.module));
    });
  }

  async template(type: ImportTypeCode, auth: AuthContext): Promise<{ fileName: string; data: Buffer }> {
    const imp = this.importer(type, auth);
    const def = IMPORT_TYPES[type];
    const lists = await this.db.run(this.ctx(auth), async (tx) => {
      await this.moduleOn(tx, imp);
      return imp.helpLists(tx);
    });
    return { fileName: `EduERP ${def.label} template.xlsx`, data: await buildTemplate(def.label, def.columns, lists) };
  }

  async upload(type: ImportTypeCode, file: { buffer: Buffer; originalname: string; size: number } | undefined, auth: AuthContext): Promise<JobView> {
    const imp = this.importer(type, auth);
    if (!file?.size) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'file-missing', 'Choose a file to upload');
    if (file.size > IMPORT_MAX_MB * 1024 * 1024) throw new AppError(HttpStatus.PAYLOAD_TOO_LARGE, 'file-too-large', `Import files must be ${IMPORT_MAX_MB} MB or smaller`);
    const raw = await readSpreadsheet(file.buffer, IMPORT_TYPES[type].columns);

    return this.db.run(this.ctx(auth), async (tx) => {
      await this.moduleOn(tx, imp);
      const ctx = await imp.prepare(tx, auth);
      const seen = new Set<string>();
      const checked = raw.map((r) => ({ ...r, ...imp.check(r.values, ctx, seen) }));
      const errorRows = checked.filter((c) => c.errors.length).length;
      const job = await tx.importJob.create({
        data: {
          tenantId: auth.tenantId!,
          entityType: type,
          fileName: file.originalname.replace(/[\u0000-\u001f"<>|\\/]/g, '').slice(0, 200) || 'upload',
          totalRows: checked.length,
          validRows: checked.length - errorRows,
          errorRows,
          createdBy: auth.userId,
        },
      });
      await tx.importRow.createMany({
        data: checked.map((c) => ({ tenantId: auth.tenantId!, jobId: job.id, rowNo: c.rowNo, data: asJson(c.values), errors: c.errors.length ? asJson(c.errors) : undefined, status: c.errors.length ? 'INVALID' : 'VALID' })),
      });
      return job;
    });
  }

  list(auth: AuthContext) {
    return this.db.run(this.ctx(auth), (tx) => tx.importJob.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }));
  }

  async get(id: string, auth: AuthContext) {
    const job = await this.db.run(this.ctx(auth), (tx) => tx.importJob.findUnique({ where: { id } }));
    if (!job) throw NotFound('Import');
    this.importer(job.entityType, auth);
    return job;
  }

  async rows(id: string, q: { status?: string; page: number; pageSize: number }, auth: AuthContext) {
    await this.get(id, auth);
    return this.db.run(this.ctx(auth), async (tx) => {
      const where = { jobId: id, ...(q.status ? { status: q.status } : {}) };
      const [items, total] = await Promise.all([
        tx.importRow.findMany({ where, orderBy: { rowNo: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, select: { rowNo: true, data: true, errors: true, status: true } }),
        tx.importRow.count({ where }),
      ]);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  /** The uploaded rows with an "Errors" column: fix them in Excel and upload again. */
  async errorReport(id: string, auth: AuthContext): Promise<{ fileName: string; data: Buffer }> {
    const job = await this.get(id, auth);
    const cols = IMPORT_TYPES[job.entityType as ImportTypeCode].columns;
    const rows = await this.db.run(this.ctx(auth), (tx) => tx.importRow.findMany({ where: { jobId: id, status: 'INVALID' }, orderBy: { rowNo: 'asc' } }));
    const data = await buildSheet(
      'Rows to fix',
      [...cols.map((c) => c.header), 'Errors'],
      rows.map((r) => [...cols.map((c) => (r.data as Record<string, string>)[c.key] ?? ''), ((r.errors as string[]) ?? []).join('; ')]),
      true,
    );
    return { fileName: `Rows to fix - ${job.fileName.replace(/\.(xlsx|csv)$/i, '')}.xlsx`, data };
  }

  async commit(id: string, auth: AuthContext, client: ClientInfo) {
    const first = await this.get(id, auth);
    const imp = this.importer(first.entityType, auth);
    return this.db.run(this.ctx(auth), async (tx) => {
      // Lock the job: a double click or two tabs cannot import twice.
      const locked = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM import_jobs WHERE id = ${id}::uuid FOR UPDATE`;
      if (locked[0]?.status !== 'VALIDATED') throw Conflict('import-closed', `This import is already ${String(locked[0]?.status ?? 'gone').toLowerCase()}`);
      await this.moduleOn(tx, imp);

      const ctx = await imp.prepare(tx, auth);
      const seen = new Set<string>();
      const rows = await tx.importRow.findMany({ where: { jobId: id, status: 'VALID' }, orderBy: { rowNo: 'asc' } });
      let imported = 0;
      let skipped = 0;
      for (const r of rows) {
        const res = imp.check(r.data as Record<string, string>, ctx, seen); // data may have changed since upload
        if (!res.row) {
          skipped += 1;
          await tx.importRow.update({ where: { id: r.id }, data: { status: 'SKIPPED', errors: asJson(res.errors) } });
          continue;
        }
        const entityId = await imp.write(tx, res.row, auth, client);
        await tx.importRow.update({ where: { id: r.id }, data: { status: 'IMPORTED', entityId } });
        imported += 1;
      }
      const job = await tx.importJob.update({ where: { id }, data: { status: 'COMMITTED', importedRows: imported, committedAt: new Date(), committedBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'CREATE', entityType: 'IMPORT', entityId: id, newValues: { type: job.entityType, file: job.fileName, imported, skipped, invalid: job.errorRows } }, client);
      return { ...job, skippedRows: skipped };
    }, { timeout: 180_000 });
  }

  async cancel(id: string, auth: AuthContext) {
    await this.get(id, auth);
    return this.db.run(this.ctx(auth), async (tx) => {
      const res = await tx.importJob.updateMany({ where: { id, status: 'VALIDATED' }, data: { status: 'CANCELLED' } });
      if (!res.count) throw Conflict('import-closed', 'This import can no longer be cancelled');
      return { id, status: 'CANCELLED' };
    });
  }
}
