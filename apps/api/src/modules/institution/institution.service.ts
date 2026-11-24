import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InstitutionProfileInput, LOGO_MAX_BYTES } from '@eduerp/shared';
import { Db } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import type { AuthContext } from '../../common/auth-context';
import { AppError, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { FilesService, UploadedBlob, sniffMime } from '../files/files.service';
import { STORAGE, StorageDriver } from '../files/storage';

const PROFILE = {
  name: true, nameLocal: true, slug: true, email: true, phone: true, website: true, address: true,
  city: true, district: true, state: true, pincode: true, logoFileId: true, edition: true,
} as const;

/**
 * Institution profile and branding (Phase 20 E4). The logo is the one piece of an institution that
 * is public — it shows on the institution's own sign-in page — so it is served without sign-in by
 * the institution's address; nothing else about the institution is.
 */
@Injectable()
export class InstitutionService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    @Inject(STORAGE) private readonly storage: StorageDriver,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  profile(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const t = await tx.tenant.findUnique({ where: { id: auth.tenantId! }, select: PROFILE });
      if (!t) throw NotFound('Institution');
      return t;
    });
  }

  saveProfile(input: InstitutionProfileInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const before = await tx.tenant.findUnique({ where: { id: auth.tenantId! }, select: PROFILE });
      if (!before) throw NotFound('Institution');
      const after = await tx.tenant.update({ where: { id: auth.tenantId! }, data: { ...input, updatedBy: auth.userId }, select: PROFILE });
      const changed = (Object.keys(input) as (keyof InstitutionProfileInput)[]).filter((k) => before[k] !== after[k]);
      if (changed.length) {
        await this.audit.log(tx, {
          tenantId: auth.tenantId!, userId: auth.userId, action: 'UPDATE', entityType: 'TENANT_PROFILE', entityId: auth.tenantId!,
          oldValues: Object.fromEntries(changed.map((k) => [k, before[k]])), newValues: Object.fromEntries(changed.map((k) => [k, after[k]])),
        }, client);
      }
      return after;
    });
  }

  async setLogo(blob: UploadedBlob | undefined, auth: AuthContext, client: ClientInfo) {
    if (!blob || !blob.size) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'file-missing', 'Choose a logo to upload');
    const mime = sniffMime(blob.buffer);
    if (!mime || mime === 'application/pdf') throw new AppError(HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'logo-type', 'The logo must be a PNG, JPEG or WebP image');
    if (blob.size > LOGO_MAX_BYTES) throw new AppError(HttpStatus.PAYLOAD_TOO_LARGE, 'logo-too-large', 'The logo must be 1 MB or smaller');
    const file = await this.files.store({ entityType: 'TENANT', entityId: auth.tenantId!, docType: 'LOGO' }, blob, auth, client);
    return this.db.run(this.ctx(auth), async (tx) => {
      const before = await tx.tenant.findUnique({ where: { id: auth.tenantId! }, select: { logoFileId: true } });
      if (before?.logoFileId) await tx.fileObject.update({ where: { id: before.logoFileId }, data: { status: 'DELETED' } });
      const after = await tx.tenant.update({ where: { id: auth.tenantId! }, data: { logoFileId: file.id, updatedBy: auth.userId }, select: PROFILE });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'UPDATE', entityType: 'TENANT_LOGO', entityId: auth.tenantId!, oldValues: { logoFileId: before?.logoFileId ?? null }, newValues: { logoFileId: file.id } }, client);
      return after;
    });
  }

  removeLogo(auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const before = await tx.tenant.findUnique({ where: { id: auth.tenantId! }, select: { logoFileId: true } });
      if (!before?.logoFileId) throw NotFound('Logo');
      await tx.fileObject.update({ where: { id: before.logoFileId }, data: { status: 'DELETED' } });
      const after = await tx.tenant.update({ where: { id: auth.tenantId! }, data: { logoFileId: null, updatedBy: auth.userId }, select: PROFILE });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'DELETE', entityType: 'TENANT_LOGO', entityId: auth.tenantId!, oldValues: { logoFileId: before.logoFileId }, newValues: null }, client);
      return after;
    });
  }

  // ───────────── Public (sign-in page, printed documents) ─────────────

  /** Name and logo of an institution by its address; nothing else. Closed institutions are not found. */
  async publicBranding(slug: string) {
    const t = await this.db.run({ isPlatform: true }, (tx) =>
      tx.tenant.findUnique({ where: { slug }, select: { name: true, nameLocal: true, slug: true, logoFileId: true, status: true } }),
    );
    if (!t || t.status === 'CLOSED') throw NotFound('Institution');
    return { name: t.name, nameLocal: t.nameLocal, slug: t.slug, logoVersion: t.logoFileId ? t.logoFileId.slice(0, 8) : null };
  }

  async publicLogo(slug: string) {
    const t = await this.db.run({ isPlatform: true }, (tx) => tx.tenant.findUnique({ where: { slug }, select: { id: true, logoFileId: true, status: true } }));
    if (!t || t.status === 'CLOSED' || !t.logoFileId) throw NotFound('Logo');
    const file = await this.db.run({ tenantId: t.id }, (tx) => tx.fileObject.findUnique({ where: { id: t.logoFileId! }, select: { storageKey: true, mimeType: true, sizeBytes: true, status: true } }));
    if (!file || file.status !== 'ACTIVE' || !file.mimeType.startsWith('image/')) throw NotFound('Logo');
    return { mimeType: file.mimeType, size: Number(file.sizeBytes), stream: await this.storage.open(file.storageKey) };
  }
}
