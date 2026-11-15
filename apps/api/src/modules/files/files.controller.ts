import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes } from '@nestjs/swagger';
import type { Response } from 'express';
import type { z } from 'zod';
import { PERMISSIONS, UploadFileInput, listFilesQuerySchema, uploadFileSchema } from '@eduerp/shared';
import { Auth, Client, ClientInfo, RequirePermission } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { FilesService, UploadedBlob } from './files.service';

/** Hard ceiling for the multipart parser; the per-institution limit (files.max_upload_mb, ≤ 25) is checked in the service. */
const HARD_LIMIT_BYTES = 25 * 1024 * 1024;

@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /** multipart/form-data: `file` plus the fields of the upload schema. */
  @RequirePermission(PERMISSIONS.FILES_FILE_UPLOAD)
  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: HARD_LIMIT_BYTES, files: 1, fields: 10 } }))
  upload(@UploadedFile() file: UploadedBlob | undefined, @Body(zod(uploadFileSchema)) body: UploadFileInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.files.upload(body, file, auth, client);
  }

  @RequirePermission(PERMISSIONS.FILES_FILE_READ)
  @Get()
  list(@Query(zod(listFilesQuerySchema)) q: z.infer<typeof listFilesQuerySchema>, @Auth() auth: AuthContext) {
    return this.files.list(q.entityType, q.entityId, auth);
  }

  @RequirePermission(PERMISSIONS.FILES_FILE_READ)
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.files.get(id, auth);
  }

  /** Streams the bytes as an attachment; never rendered inline, never cached by shared caches. */
  @RequirePermission(PERMISSIONS.FILES_FILE_READ)
  @Get(':id/content')
  async content(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    const { file, stream } = await this.files.open(id, auth);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(stream, {
      type: file.mimeType,
      length: file.sizeBytes,
      disposition: `attachment; filename="${file.fileName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    });
  }
}
