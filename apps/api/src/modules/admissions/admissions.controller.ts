import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  AddFollowupInput, CreateApplicationInput, CreateEnquiryInput, DecideApplicationInput, DuplicateCheckInput, EnrolInput, PERMISSIONS, UpdateApplicationInput,
  addFollowupSchema, applicationQuerySchema, createApplicationSchema, createEnquirySchema, decideApplicationSchema, duplicateCheckSchema, enquiryQuerySchema,
  enrolSchema, updateApplicationSchema,
} from '@eduerp/shared';
import { Auth, Client, ClientInfo, RequireModule, RequirePermission, TenantMember } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { AdmissionsService } from './admissions.service';

export const cancelApplicationSchema = z.object({ remarks: z.string().trim().min(5).max(500) });

@RequireModule('ADMISSIONS')
@Controller('admissions')
export class AdmissionsController {
  constructor(private readonly admissions: AdmissionsService) {}

  /** Years and classes for the admission forms (needs either admissions permission; checked in the service). */
  @TenantMember()
  @Get('options')
  options(@Auth() auth: AuthContext) {
    return this.admissions.options(auth);
  }

  // Enquiries

  @RequirePermission(PERMISSIONS.ADM_ENQUIRY_MANAGE)
  @Get('enquiries')
  enquiries(@Query(zod(enquiryQuerySchema)) q: z.infer<typeof enquiryQuerySchema>, @Auth() auth: AuthContext) {
    return this.admissions.enquiries(auth, q);
  }

  @RequirePermission(PERMISSIONS.ADM_ENQUIRY_MANAGE)
  @Get('enquiries/:id')
  enquiry(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.admissions.enquiry(id, auth);
  }

  @RequirePermission(PERMISSIONS.ADM_ENQUIRY_MANAGE)
  @Post('enquiries')
  createEnquiry(@Body(zod(createEnquirySchema)) body: CreateEnquiryInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.admissions.createEnquiry(body, auth, client);
  }

  @RequirePermission(PERMISSIONS.ADM_ENQUIRY_MANAGE)
  @Post('enquiries/:id/followups')
  addFollowup(@Param('id', ParseUUIDPipe) id: string, @Body(zod(addFollowupSchema)) body: AddFollowupInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.admissions.addFollowup(id, body, auth, client);
  }

  // Applications

  @RequirePermission(PERMISSIONS.ADM_APPLICATION_MANAGE)
  @Post('duplicate-check')
  duplicateCheck(@Body(zod(duplicateCheckSchema)) body: DuplicateCheckInput, @Auth() auth: AuthContext) {
    return this.admissions.duplicateCheck(body, auth);
  }

  @RequirePermission(PERMISSIONS.ADM_APPLICATION_MANAGE)
  @Get('applications')
  applications(@Query(zod(applicationQuerySchema)) q: z.infer<typeof applicationQuerySchema>, @Auth() auth: AuthContext) {
    return this.admissions.applications(auth, q);
  }

  @RequirePermission(PERMISSIONS.ADM_APPLICATION_MANAGE)
  @Get('applications/:id')
  application(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.admissions.application(id, auth);
  }

  @RequirePermission(PERMISSIONS.ADM_APPLICATION_MANAGE)
  @Post('applications')
  createApplication(@Body(zod(createApplicationSchema)) body: CreateApplicationInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.admissions.createApplication(body, auth, client);
  }

  @RequirePermission(PERMISSIONS.ADM_APPLICATION_MANAGE)
  @Patch('applications/:id')
  updateApplication(@Param('id', ParseUUIDPipe) id: string, @Body(zod(updateApplicationSchema)) body: UpdateApplicationInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.admissions.updateApplication(id, body, auth, client);
  }

  @RequirePermission(PERMISSIONS.ADM_APPLICATION_DECIDE)
  @Post('applications/:id/decision')
  decide(@Param('id', ParseUUIDPipe) id: string, @Body(zod(decideApplicationSchema)) body: DecideApplicationInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.admissions.decide(id, body, auth, client);
  }

  @RequirePermission(PERMISSIONS.ADM_APPLICATION_MANAGE)
  @Post('applications/:id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body(zod(cancelApplicationSchema)) body: { remarks: string }, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.admissions.cancel(id, body.remarks, auth, client);
  }

  // Enrolment

  @RequirePermission(PERMISSIONS.ADM_ENROL)
  @Get('applications/:id/sections')
  enrolOptions(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.admissions.enrolOptions(id, auth);
  }

  @RequirePermission(PERMISSIONS.ADM_ENROL)
  @Post('applications/:id/enrol')
  enrol(@Param('id', ParseUUIDPipe) id: string, @Body(zod(enrolSchema)) body: EnrolInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.admissions.enrol(id, body, auth, client);
  }
}
