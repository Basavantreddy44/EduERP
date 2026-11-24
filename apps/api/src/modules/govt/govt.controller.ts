import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  DietScaleInput, GOV_EXPORT_CODES, GovExportCode, GovLayoutInput, GovProfileInput, GovStaffInput, MealCountsInput, PERMISSIONS, WelfareGiveInput, WelfareSchemeInput,
  ddoSchema, dietScaleSchema, govLayoutSchema, govProfileSchema, govStaffSchema, mealCountsSchema, welfareGiveSchema, welfareSchemeSchema,
} from '@eduerp/shared';
import { Auth, Client, ClientInfo, RequireModule, RequirePermission, TenantMember } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { GovtService } from './govt.service';
import { WelfareService } from './welfare.service';
import { DietService } from './diet.service';

const uuid = z.string().uuid();
const date = z.string().date();
const codeSchema = z.enum(GOV_EXPORT_CODES);

/** Government data (G1), staff details (G4) and the overview of schools (G5). */
@Controller('govt')
export class GovtController {
  constructor(private readonly govt: GovtService) {}

  @RequireModule('STUDENTS') @RequirePermission(PERMISSIONS.STU_STUDENT_READ) @Get('students/:id')
  card(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.govt.card(id, auth); }

  @RequireModule('STUDENTS') @RequirePermission(PERMISSIONS.STU_STUDENT_MANAGE) @Put('students/:id')
  saveCard(@Param('id', ParseUUIDPipe) id: string, @Body(zod(govProfileSchema)) b: GovProfileInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.govt.saveCard(id, b, auth, c); }

  @RequireModule('STUDENTS') @RequirePermission(PERMISSIONS.STU_STUDENT_READ) @Get('layouts')
  layouts(@Auth() auth: AuthContext) { return this.govt.layouts(auth); }

  @RequireModule('STUDENTS') @RequirePermission(PERMISSIONS.GOV_EXPORT_MANAGE) @Put('layouts/:code')
  saveLayout(@Param('code', zod(codeSchema)) code: GovExportCode, @Body(zod(govLayoutSchema)) b: GovLayoutInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.govt.saveLayout(code, b, auth, c); }

  @RequireModule('STUDENTS') @RequirePermission(PERMISSIONS.GOV_EXPORT_MANAGE) @Post('layouts/:code/reset') @HttpCode(200)
  resetLayout(@Param('code', zod(codeSchema)) code: GovExportCode, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.govt.saveLayout(code, null, auth, c); }

  @RequireModule('STUDENTS') @RequirePermission(PERMISSIONS.STU_STUDENT_READ) @Get('readiness')
  readiness(@Query(zod(z.object({ campusId: uuid.optional() }))) q: { campusId?: string }, @Auth() auth: AuthContext) { return this.govt.readiness(auth, q.campusId); }

  @RequirePermission(PERMISSIONS.HR_PROFILE_READ) @Get('staff/:id')
  staff(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.govt.staff(id, auth); }

  @RequirePermission(PERMISSIONS.HR_PROFILE_MANAGE) @Put('staff/:id')
  saveStaff(@Param('id', ParseUUIDPipe) id: string, @Body(zod(govStaffSchema)) b: GovStaffInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.govt.saveStaff(id, b, auth, c); }

  @RequirePermission(PERMISSIONS.ORG_CAMPUS_UPDATE) @Put('campuses/:id/ddo')
  saveDdo(@Param('id', ParseUUIDPipe) id: string, @Body(zod(ddoSchema)) b: { ddoCode: string | null }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.govt.saveDdo(id, b.ddoCode, auth, c); }

  @RequirePermission(PERMISSIONS.OVERVIEW_READ) @Get('overview')
  overview(@Query(zod(z.object({ district: z.string().trim().max(100).optional() }))) q: { district?: string }, @Auth() auth: AuthContext) { return this.govt.overview(auth, q.district || undefined); }
}

/** Welfare items and allowances (G2). */
@Controller('welfare')
export class WelfareController {
  constructor(private readonly welfare: WelfareService) {}

  @RequireModule('STUDENTS') @TenantMember() @Get('options')
  options(@Auth() auth: AuthContext) { return this.welfare.options(auth); }

  @RequireModule('STUDENTS') @TenantMember() @Get('schemes')
  schemes(@Query(zod(z.object({ academicYearId: uuid.optional() }))) q: { academicYearId?: string }, @Auth() auth: AuthContext) { return this.welfare.schemes(auth, q.academicYearId); }

  @RequireModule('STUDENTS') @RequirePermission(PERMISSIONS.WELFARE_MANAGE) @Post('schemes')
  add(@Body(zod(welfareSchemeSchema)) b: WelfareSchemeInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.welfare.saveScheme(null, b, auth, c); }

  @RequireModule('STUDENTS') @RequirePermission(PERMISSIONS.WELFARE_MANAGE) @Put('schemes/:id')
  edit(@Param('id', ParseUUIDPipe) id: string, @Body(zod(welfareSchemeSchema)) b: WelfareSchemeInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.welfare.saveScheme(id, b, auth, c); }

  @RequireModule('STUDENTS') @TenantMember() @Get('schemes/:id/sections/:sectionId')
  section(@Param('id', ParseUUIDPipe) id: string, @Param('sectionId', ParseUUIDPipe) sectionId: string, @Auth() auth: AuthContext) { return this.welfare.section(id, sectionId, auth); }

  @RequireModule('STUDENTS') @RequirePermission(PERMISSIONS.WELFARE_GIVE) @Post('schemes/:id/give') @HttpCode(200)
  give(@Param('id', ParseUUIDPipe) id: string, @Body(zod(welfareGiveSchema)) b: WelfareGiveInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.welfare.give(id, b, auth, c); }

  @RequireModule('STUDENTS') @TenantMember() @Get('students/:id')
  student(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.welfare.student(id, auth); }
}

/** Diet scale, meal register and diet report (G3). */
@Controller('diet')
export class DietController {
  constructor(private readonly diet: DietService) {}

  @RequireModule('HOSTEL') @TenantMember() @Get('campuses')
  campuses(@Auth() auth: AuthContext) { return this.diet.campuses(auth); }

  @RequireModule('HOSTEL') @TenantMember() @Get('scale')
  scale(@Auth() auth: AuthContext) { return this.diet.scale(auth); }

  @RequireModule('HOSTEL') @RequirePermission(PERMISSIONS.DIET_MANAGE) @Post('scale')
  addScale(@Body(zod(dietScaleSchema)) b: DietScaleInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.diet.saveScale(null, b, auth, c); }

  @RequireModule('HOSTEL') @RequirePermission(PERMISSIONS.DIET_MANAGE) @Put('scale/:id')
  editScale(@Param('id', ParseUUIDPipe) id: string, @Body(zod(dietScaleSchema)) b: DietScaleInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.diet.saveScale(id, b, auth, c); }

  @RequireModule('HOSTEL') @RequirePermission(PERMISSIONS.DIET_MANAGE) @Post('scale/:id/delete') @HttpCode(200)
  removeScale(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.diet.removeScale(id, auth, c); }

  @RequireModule('HOSTEL') @TenantMember() @Get('meals')
  meals(@Query(zod(z.object({ campusId: uuid, date }))) q: { campusId: string; date: string }, @Auth() auth: AuthContext) { return this.diet.meals(q.campusId, q.date, auth); }

  @RequireModule('HOSTEL') @RequirePermission(PERMISSIONS.MEALS_RECORD) @Post('meals') @HttpCode(200)
  saveMeals(@Body(zod(mealCountsSchema)) b: MealCountsInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.diet.saveMeals(b, auth, c); }

  @RequireModule('HOSTEL') @TenantMember() @Get('report')
  report(@Query(zod(z.object({ campusId: uuid, from: date, to: date, tolerance: z.coerce.number().min(0).max(100).optional() }))) q: { campusId: string; from: string; to: string; tolerance?: number }, @Auth() auth: AuthContext) { return this.diet.report(auth, q.campusId, q.from, q.to, q.tolerance); }
}
