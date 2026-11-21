import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  CompanyInput, DRIVE_STATUSES, DriveInput, ExportInput, OfferInput, PERMISSIONS, PlacementProfileInput, ReportFilters, SavedReportInput,
  applicationUpdateSchema, companySchema, driveSchema, driveStatusSchema, exportSchema, offerSchema, offerStatusSchema, placementEnrolSchema, placementProfileSchema, reportFiltersSchema, savedReportSchema,
} from '@eduerp/shared';
import { Auth, Client, ClientInfo, PortalUser, RequireModule, RequirePermission, TenantMember } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import type { UploadedBlob } from '../files/files.service';
import { PlacementsService } from './placements.service';
import { ReportsService } from '../reports/reports.service';

const uuid = z.string().uuid();
const P = 'PLACEMENTS';
const HARD_LIMIT_BYTES = 10 * 1024 * 1024;

/** Placements (Phase 19 / B6 §4). */
@Controller('placements')
export class PlacementsController {
  constructor(private readonly p: PlacementsService) {}

  @RequireModule(P) @TenantMember() @Get('options')
  options(@Auth() auth: AuthContext) { return this.p.options(auth); }

  @RequireModule(P) @RequirePermission(PERMISSIONS.PLACE_READ) @Get('companies')
  companies(@Auth() auth: AuthContext) { return this.p.companies(auth); }

  @RequireModule(P) @RequirePermission(PERMISSIONS.PLACE_MANAGE) @Post('companies')
  addCompany(@Body(zod(companySchema)) b: CompanyInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.p.saveCompany(null, b, auth, c); }

  @RequireModule(P) @RequirePermission(PERMISSIONS.PLACE_MANAGE) @Put('companies/:id')
  editCompany(@Param('id', ParseUUIDPipe) id: string, @Body(zod(companySchema)) b: CompanyInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.p.saveCompany(id, b, auth, c); }

  @RequireModule(P) @RequirePermission(PERMISSIONS.PLACE_READ) @Get('students')
  students(@Query(zod(z.object({ campusId: uuid.optional(), programId: uuid.optional(), passingYear: z.coerce.number().int().optional(), q: z.string().trim().max(80).optional() }))) x: { campusId?: string; programId?: string; passingYear?: number; q?: string }, @Auth() auth: AuthContext) { return this.p.profiles(auth, x); }

  @RequireModule(P) @RequirePermission(PERMISSIONS.PLACE_MANAGE) @Put('students/:id/profile')
  profile(@Param('id', ParseUUIDPipe) id: string, @Body(zod(placementProfileSchema)) b: PlacementProfileInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.p.saveProfile(id, b, auth, c); }

  /** multipart/form-data: `file` (PDF). */
  @RequireModule(P) @RequirePermission(PERMISSIONS.PLACE_MANAGE) @Post('students/:id/resume')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: HARD_LIMIT_BYTES, files: 1, fields: 2 } }))
  resume(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: UploadedBlob | undefined, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.p.uploadResume(id, file, auth, c); }

  @RequireModule(P) @RequirePermission(PERMISSIONS.PLACE_READ) @Get('people')
  people(@Query(zod(z.object({ q: z.string().trim().max(80).default('') }))) x: { q: string }, @Auth() auth: AuthContext) { return this.p.people(auth, x.q); }

  @RequireModule(P) @RequirePermission(PERMISSIONS.PLACE_READ) @Get('stats')
  stats(@Query(zod(z.object({ passingYear: z.coerce.number().int().optional(), campusId: uuid.optional() }))) x: { passingYear?: number; campusId?: string }, @Auth() auth: AuthContext) { return this.p.stats(auth, x); }

  @RequireModule(P) @RequirePermission(PERMISSIONS.PLACE_READ) @Get('drives')
  drives(@Query(zod(z.object({ status: z.enum(DRIVE_STATUSES).optional(), campusId: uuid.optional() }))) x: { status?: string; campusId?: string }, @Auth() auth: AuthContext) { return this.p.drives(auth, x); }

  @RequireModule(P) @RequirePermission(PERMISSIONS.PLACE_MANAGE) @Post('drives')
  addDrive(@Body(zod(driveSchema)) b: DriveInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.p.saveDrive(null, b, auth, c); }

  @RequireModule(P) @RequirePermission(PERMISSIONS.PLACE_READ) @Get('drives/:id')
  drive(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.p.drive(id, auth); }

  @RequireModule(P) @RequirePermission(PERMISSIONS.PLACE_MANAGE) @Put('drives/:id')
  editDrive(@Param('id', ParseUUIDPipe) id: string, @Body(zod(driveSchema)) b: DriveInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.p.saveDrive(id, b, auth, c); }

  @RequireModule(P) @RequirePermission(PERMISSIONS.PLACE_MANAGE) @Post('drives/:id/status') @HttpCode(200)
  driveStatus(@Param('id', ParseUUIDPipe) id: string, @Body(zod(driveStatusSchema)) b: { status: 'OPEN' | 'CLOSED' | 'COMPLETED' | 'CANCELLED' }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.p.setDriveStatus(id, b.status, auth, c); }

  @RequireModule(P) @RequirePermission(PERMISSIONS.PLACE_READ) @Get('drives/:id/eligible')
  eligible(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.p.eligible(id, auth); }

  @RequireModule(P) @RequirePermission(PERMISSIONS.PLACE_MANAGE) @Post('drives/:id/applications')
  enrol(@Param('id', ParseUUIDPipe) id: string, @Body(zod(placementEnrolSchema)) b: { studentIds: string[] }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.p.enrol(id, b.studentIds, auth, c); }

  @RequireModule(P) @RequirePermission(PERMISSIONS.PLACE_MANAGE) @Put('applications/:id')
  application(@Param('id', ParseUUIDPipe) id: string, @Body(zod(applicationUpdateSchema)) b: { status: string; currentRound?: string | null; remarks?: string | null }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.p.updateApplication(id, b, auth, c); }

  @RequireModule(P) @RequirePermission(PERMISSIONS.PLACE_MANAGE) @Post('applications/:id/offer')
  offer(@Param('id', ParseUUIDPipe) id: string, @Body(zod(offerSchema)) b: OfferInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.p.makeOffer(id, b, auth, c); }

  @RequireModule(P) @RequirePermission(PERMISSIONS.PLACE_MANAGE) @Post('offers/:id/status') @HttpCode(200)
  offerStatus(@Param('id', ParseUUIDPipe) id: string, @Body(zod(offerStatusSchema)) b: { status: 'ACCEPTED' | 'DECLINED' | 'REVOKED'; remarks?: string | null }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.p.offerStatus(id, b.status, b.remarks ?? null, auth, c); }

  /** multipart/form-data: `file` (PDF). */
  @RequireModule(P) @RequirePermission(PERMISSIONS.PLACE_MANAGE) @Post('offers/:id/letter')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: HARD_LIMIT_BYTES, files: 1, fields: 2 } }))
  letter(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: UploadedBlob | undefined, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.p.uploadOfferLetter(id, file, auth, c); }

  // ───── Student app ─────
  @RequireModule(P) @PortalUser() @Get('children/:id')
  child(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.p.forChild(id, auth); }

  @RequireModule(P) @PortalUser() @Post('children/:id/drives/:driveId/apply')
  apply(@Param('id', ParseUUIDPipe) id: string, @Param('driveId', ParseUUIDPipe) driveId: string, @Auth() auth: AuthContext) { return this.p.childApply(id, driveId, auth); }

  @RequireModule(P) @PortalUser() @Post('children/:id/applications/:appId/withdraw') @HttpCode(200)
  withdraw(@Param('id', ParseUUIDPipe) id: string, @Param('appId', ParseUUIDPipe) appId: string, @Auth() auth: AuthContext) { return this.p.childWithdraw(id, appId, auth); }

  @RequireModule(P) @PortalUser() @Post('children/:id/offers/:offerId') @HttpCode(200)
  answer(@Param('id', ParseUUIDPipe) id: string, @Param('offerId', ParseUUIDPipe) offerId: string, @Body(zod(z.object({ status: z.enum(['ACCEPTED', 'DECLINED']) }))) b: { status: 'ACCEPTED' | 'DECLINED' }, @Auth() auth: AuthContext) { return this.p.childOffer(id, offerId, b.status, auth); }
}

/** Reports & exports (Phase 19 / B6 §5). Each report checks its own module right; the catalogue is a core module. */
@Controller('reports')
export class ReportsController {
  constructor(private readonly r: ReportsService) {}

  @TenantMember() @Get('catalogue')
  catalogue(@Auth() auth: AuthContext) { return this.r.catalogue(auth); }

  @TenantMember() @Get('options')
  options(@Auth() auth: AuthContext) { return this.r.options(auth); }

  @TenantMember() @Post('run/:code') @HttpCode(200)
  run(@Param('code') code: string, @Body(zod(reportFiltersSchema)) f: ReportFilters, @Auth() auth: AuthContext) { return this.r.run(code, f, auth); }

  @TenantMember() @Get('saved')
  saved(@Auth() auth: AuthContext) { return this.r.saved(auth); }

  @TenantMember() @Post('saved')
  addSaved(@Body(zod(savedReportSchema)) b: SavedReportInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.r.saveReport(null, b, auth, c); }

  @TenantMember() @Put('saved/:id')
  editSaved(@Param('id', ParseUUIDPipe) id: string, @Body(zod(savedReportSchema)) b: SavedReportInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.r.saveReport(id, b, auth, c); }

  @TenantMember() @Post('saved/:id/delete') @HttpCode(200)
  deleteSaved(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.r.deleteReport(id, auth, c); }

  @TenantMember() @Post('exports')
  exportIt(@Body(zod(exportSchema)) b: ExportInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.r.requestExport(b, auth, c); }

  @TenantMember() @Get('exports')
  exports(@Auth() auth: AuthContext) { return this.r.exports(auth); }

  @TenantMember() @Get('exports/:id/file')
  async file(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    const f = await this.r.download(id, auth);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(f.stream, { type: f.mime, length: f.size, disposition: `attachment; filename="${f.fileName}"; filename*=UTF-8''${encodeURIComponent(f.fileName)}` });
  }
}
