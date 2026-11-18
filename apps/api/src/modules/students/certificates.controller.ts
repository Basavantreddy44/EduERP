import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CertRequestInput, CertTemplateInput, PERMISSIONS, certCancelSchema, certRequestSchema, certTemplateSchema, verifyCodeSchema } from '@eduerp/shared';
import { z } from 'zod';
import { Auth, Client, ClientInfo, Public, RequireModule, RequirePermission } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { CertificatesService } from './certificates.service';

/** Certificates (M10.3): templates, requests, issue, cancel. */
@RequireModule('STUDENTS')
@Controller('certificates')
export class CertificatesController {
  constructor(private readonly certs: CertificatesService) {}

  @RequirePermission(PERMISSIONS.CERT_READ) @Get('templates')
  templates(@Auth() auth: AuthContext) { return this.certs.templates(auth); }

  @RequirePermission(PERMISSIONS.CERT_SETUP) @Post('templates')
  createTemplate(@Body(zod(certTemplateSchema)) b: CertTemplateInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.certs.saveTemplate(null, b, auth, c); }

  @RequirePermission(PERMISSIONS.CERT_SETUP) @Put('templates/:id')
  updateTemplate(@Param('id', ParseUUIDPipe) id: string, @Body(zod(certTemplateSchema)) b: CertTemplateInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.certs.saveTemplate(id, b, auth, c); }

  /** Adds the ready-made templates (English and Kannada) that are missing. */
  @RequirePermission(PERMISSIONS.CERT_SETUP) @Post('templates/defaults') @HttpCode(200)
  defaults(@Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.certs.addDefaults(auth, c); }

  @RequirePermission(PERMISSIONS.CERT_READ) @Get()
  list(@Query(zod(z.object({ studentId: z.string().uuid().optional() }))) q: { studentId?: string }, @Auth() auth: AuthContext) { return this.certs.list(auth, q.studentId); }

  @RequirePermission(PERMISSIONS.CERT_ISSUE) @Post()
  request(@Body(zod(certRequestSchema)) b: CertRequestInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.certs.request(b, auth, c); }

  @RequirePermission(PERMISSIONS.CERT_READ) @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.certs.get(id, auth); }

  @RequirePermission(PERMISSIONS.CERT_ISSUE) @Post(':id/cancel') @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body(zod(certCancelSchema)) b: { reason: string }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.certs.cancel(id, b.reason, auth, c); }
}

/** Public check of a certificate's code (the QR on the certificate opens this). */
@Controller('public/verify')
export class CertificateVerifyController {
  constructor(private readonly certs: CertificatesService) {}

  @Public() @Get(':code')
  verify(@Param('code') code: string) {
    const ok = verifyCodeSchema.safeParse(code);
    return ok.success ? this.certs.verify(ok.data) : { valid: false };
  }
}
