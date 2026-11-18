import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { ALLOWED_FILE_TYPES, PERMISSIONS, UploadFileInput } from '@eduerp/shared';
import { Db } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { SettingsService } from '../settings/settings.service';
import { STORAGE, StorageDriver } from './storage';

export interface UploadedBlob {
  buffer: Buffer;
  originalname: string;
  size: number;
}

type AllowedMime = keyof typeof ALLOWED_FILE_TYPES;

/** Detects the real type from the first bytes. The browser-supplied type and extension are ignored. */
export function sniffMime(buf: Buffer): AllowedMime | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** Display name only (never used as a path): no directories, no control characters, bounded length. */
export function cleanFileName(name: string): string {
  const base = path.basename(name.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f"<>|]/g, '').trim();
  return (base || 'file').slice(0, 200);
}

/** API shape: the storage key stays internal; BigInt size becomes a number. */
const view = <F extends { sizeBytes: bigint; storageKey: string }>(f: F): Omit<F, 'storageKey' | 'sizeBytes'> & { sizeBytes: number } => {
  const { storageKey: _key, sizeBytes, ...rest } = f;
  return { ...rest, sizeBytes: Number(sizeBytes) };
};

@Injectable()
export class FilesService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    @Inject(STORAGE) private readonly storage: StorageDriver,
  ) {}

  async upload(input: UploadFileInput, blob: UploadedBlob | undefined, auth: AuthContext, client: ClientInfo) {
    if (!blob || !blob.size) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'file-missing', 'Choose a file to upload');
    const scope = scopeFor(auth, PERMISSIONS.FILES_FILE_UPLOAD)!;
    const campusId = input.campusId ?? null;
    if (campusId ? !canAccessCampus(scope, campusId) : !scope.all) {
      if (campusId) throw NotFound('Campus');
      throw Forbidden('scope-insufficient', 'Choose a campus for this document');
    }
    return this.store(input, blob, auth, client);
  }

  /**
   * Stores a file for a caller that has already checked the user may attach it (e.g. a teacher's
   * study material for their own class). Same type sniffing, size limit and audit as any upload.
   */
  async store(input: UploadFileInput, blob: UploadedBlob | undefined, auth: AuthContext, client: ClientInfo) {
    if (!blob || !blob.size) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'file-missing', 'Choose a file to upload');
    const campusId = input.campusId ?? null;
    const mime = sniffMime(blob.buffer);
    if (!mime) throw new AppError(HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'file-type-not-allowed', 'Only PDF, JPEG, PNG and WebP files can be uploaded');

    const ctx = { tenantId: auth.tenantId, userId: auth.userId };
    const maxMb = await this.db.run(ctx, (tx) => this.settings.effective<number>(tx, 'files.max_upload_mb'));
    if (blob.size > maxMb * 1024 * 1024) throw new AppError(HttpStatus.PAYLOAD_TOO_LARGE, 'file-too-large', `Files must be ${maxMb} MB or smaller`);

    const tenantId = auth.tenantId!;
    const now = new Date();
    const key = `t/${tenantId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${ALLOWED_FILE_TYPES[mime]}`;
    const sha256 = createHash('sha256').update(blob.buffer).digest('hex');

    await this.storage.put(key, blob.buffer, mime);
    try {
      return await this.db.run(ctx, async (tx) => {
        if (campusId && !(await tx.campus.findUnique({ where: { id: campusId }, select: { id: true } }))) throw NotFound('Campus');
        const file = await tx.fileObject.create({
          data: { tenantId, campusId, entityType: input.entityType, entityId: input.entityId ?? null, docType: input.docType, fileName: cleanFileName(blob.originalname), storageKey: key, mimeType: mime, sizeBytes: BigInt(blob.size), sha256, createdBy: auth.userId },
        });
        await this.audit.log(tx, { tenantId, userId: auth.userId, campusId, action: 'UPLOAD', entityType: 'FILE', entityId: file.id, newValues: view(file) }, client);
        return view(file);
      });
    } catch (e) {
      await this.storage.remove(key).catch(() => undefined); // no orphan bytes when the record is not saved
      throw e;
    }
  }

  async list(entityType: string, entityId: string | undefined, auth: AuthContext) {
    const scope = scopeFor(auth, PERMISSIONS.FILES_FILE_READ)!;
    const rows = await this.db.run({ tenantId: auth.tenantId, userId: auth.userId }, (tx) =>
      tx.fileObject.findMany({
        where: { entityType, ...(entityId ? { entityId } : {}), status: 'ACTIVE', ...(scope.all ? {} : { campusId: { in: scope.campusIds } }) },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
    return rows.map(view);
  }

  /** Other tenants' files and out-of-scope files are both 404. */
  private async find(id: string, auth: AuthContext) {
    const scope = scopeFor(auth, PERMISSIONS.FILES_FILE_READ)!;
    const file = await this.db.run({ tenantId: auth.tenantId, userId: auth.userId }, (tx) => tx.fileObject.findUnique({ where: { id } }));
    if (!file || file.status !== 'ACTIVE') throw NotFound('File');
    if (file.campusId ? !canAccessCampus(scope, file.campusId) : !scope.all) throw NotFound('File');
    return file;
  }

  async get(id: string, auth: AuthContext) {
    return view(await this.find(id, auth));
  }

  async open(id: string, auth: AuthContext) {
    const file = await this.find(id, auth);
    return { file: view(file), stream: await this.storage.open(file.storageKey) };
  }

  /** Opens a file of the institution for a caller that has already checked access (e.g. a parent's own child's study material). */
  async openChecked(id: string, auth: AuthContext) {
    const file = await this.db.run({ tenantId: auth.tenantId, userId: auth.userId }, (tx) => tx.fileObject.findUnique({ where: { id } }));
    if (!file || file.status !== 'ACTIVE') throw NotFound('File');
    return { file: view(file), stream: await this.storage.open(file.storageKey) };
  }
}
