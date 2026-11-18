import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  CalculateInput, CoGradesInput, ExamInput, ExamScheduleInput, GradeScaleInput, MarksInput, PERMISSIONS, ResultRemarksInput, SchemeInput,
  calculateSchema, coGradesSchema, examScheduleSchema, examSchema, gradeScaleSchema, marksSchema, resultRemarksSchema, schemeSchema,
} from '@eduerp/shared';
import { z } from 'zod';
import { Auth, Client, ClientInfo, RequireModule, RequirePermission, TenantMember } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { ExamSetupService } from './exam-setup.service';
import { ExamsService } from './exams.service';
import { ResultsService } from './results.service';

const levelsBody = z.object({ programLevelIds: z.array(z.string().uuid()).max(40).default([]) });
const verifyBody = z.object({ accept: z.boolean(), note: z.string().trim().max(300).optional().nullable() });
const campusQuery = z.object({ campusId: z.string().uuid().optional() });
const termQuery = z.object({ termCode: z.string().trim().min(1).max(20) });

/** Exams & report cards (Phase 9): grading, schemes, exams, marks, results. */
@RequireModule('EXAMS')
@Controller('exams')
export class ExamsController {
  constructor(private readonly setup: ExamSetupService, private readonly exams: ExamsService, private readonly results: ResultsService) {}

  // ───── M9.1 ─────
  @RequirePermission(PERMISSIONS.EXAM_READ) @Get('scales')
  scales(@Auth() auth: AuthContext) { return this.setup.scales(auth); }

  @RequirePermission(PERMISSIONS.EXAM_SETUP) @Post('scales')
  createScale(@Body(zod(gradeScaleSchema)) b: GradeScaleInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.createScale(b, auth, c); }

  @RequirePermission(PERMISSIONS.EXAM_READ) @Get('schemes')
  schemes(@Auth() auth: AuthContext) { return this.setup.schemes(auth); }

  @RequirePermission(PERMISSIONS.EXAM_SETUP) @Post('schemes')
  createScheme(@Body(zod(schemeSchema)) b: SchemeInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.createScheme(b, auth, c); }

  @RequirePermission(PERMISSIONS.EXAM_SETUP) @Put('schemes/:id')
  updateScheme(@Param('id', ParseUUIDPipe) id: string, @Body(zod(schemeSchema)) b: SchemeInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.updateScheme(id, b, auth, c); }

  /** Copies a ready-made pattern (CBSE, KA_STATE, KA_PU) as an editable scheme. */
  @RequirePermission(PERMISSIONS.EXAM_SETUP) @Post('presets/:code')
  preset(@Param('code') code: string, @Body(zod(levelsBody)) b: { programLevelIds: string[] }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.applyPreset(code, b.programLevelIds, auth, c); }

  // ───── M9.2 ─────
  @RequirePermission(PERMISSIONS.EXAM_READ) @Get()
  list(@Query(zod(campusQuery)) q: { campusId?: string }, @Auth() auth: AuthContext) { return this.exams.list(auth, q.campusId); }

  @RequirePermission(PERMISSIONS.EXAM_SETUP) @Post()
  create(@Body(zod(examSchema)) b: ExamInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.exams.create(b, auth, c); }

  /** Mark sheets this user can work on (their subjects, or all for set-up staff, or waiting for verification). */
  @TenantMember() @Get('my-sheets')
  mySheets(@Auth() auth: AuthContext) { return this.exams.mySheets(auth); }

  @RequirePermission(PERMISSIONS.EXAM_READ) @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.exams.get(id, auth); }

  @RequirePermission(PERMISSIONS.EXAM_SETUP) @Put(':id/schedule')
  schedule(@Param('id', ParseUUIDPipe) id: string, @Body(zod(examScheduleSchema)) b: ExamScheduleInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.exams.saveSchedule(id, b, auth, c); }

  @TenantMember() @Get('papers/:paperId/sections/:sectionId')
  sheet(@Param('paperId', ParseUUIDPipe) p: string, @Param('sectionId', ParseUUIDPipe) s: string, @Auth() auth: AuthContext) { return this.exams.sheet(p, s, auth); }

  @TenantMember() @Put('papers/:paperId/sections/:sectionId')
  marks(@Param('paperId', ParseUUIDPipe) p: string, @Param('sectionId', ParseUUIDPipe) s: string, @Body(zod(marksSchema)) b: MarksInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.exams.saveMarks(p, s, b, auth, c); }

  @TenantMember() @Post('papers/:paperId/sections/:sectionId/submit') @HttpCode(200)
  submit(@Param('paperId', ParseUUIDPipe) p: string, @Param('sectionId', ParseUUIDPipe) s: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.exams.submit(p, s, auth, c); }

  @RequirePermission(PERMISSIONS.EXAM_VERIFY) @Post('papers/:paperId/sections/:sectionId/verify') @HttpCode(200)
  verify(@Param('paperId', ParseUUIDPipe) p: string, @Param('sectionId', ParseUUIDPipe) s: string, @Body(zod(verifyBody)) b: { accept: boolean; note?: string | null }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.exams.verify(p, s, b.accept, b.note ?? null, auth, c); }

  // ───── M9.3 ─────
  @RequirePermission(PERMISSIONS.EXAM_PUBLISH) @Post('results/calculate') @HttpCode(200)
  calculate(@Body(zod(calculateSchema)) b: CalculateInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.results.calculate(b, auth, c); }

  @RequirePermission(PERMISSIONS.EXAM_READ) @Get('results/sections/:sectionId')
  sectionResults(@Param('sectionId', ParseUUIDPipe) id: string, @Query(zod(termQuery)) q: { termCode: string }, @Auth() auth: AuthContext) { return this.results.results(id, q.termCode, auth); }

  @TenantMember() @Patch('results/:id')
  remarks(@Param('id', ParseUUIDPipe) id: string, @Body(zod(resultRemarksSchema)) b: ResultRemarksInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.results.setRemarks(id, b, auth, c); }

  @RequirePermission(PERMISSIONS.EXAM_PUBLISH) @Post('results/publications/:id/publish') @HttpCode(200)
  publish(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.results.publish(id, auth, c); }

  @RequirePermission(PERMISSIONS.EXAM_READ) @Get('results/:id/card')
  card(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.results.card(id, auth); }

  @TenantMember() @Get('co-scholastic/sections/:sectionId')
  co(@Param('sectionId', ParseUUIDPipe) id: string, @Query(zod(termQuery)) q: { termCode: string }, @Auth() auth: AuthContext) { return this.results.coGrades(id, q.termCode, auth); }

  @TenantMember() @Put('co-scholastic')
  saveCo(@Body(zod(coGradesSchema)) b: CoGradesInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.results.saveCoGrades(b, auth, c); }
}
