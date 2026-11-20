import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  AchievementInput, ActivityInput, BREAKAGE_STATUSES, BreakageInput, CompetitionInput, EquipmentInput, LabInput, LabSessionInput, MemberInput, PERMISSIONS,
  achievementSchema, activitySchema, breakageDecisionSchema, breakageSchema, competitionSchema, completeSessionSchema, equipmentSchema, labSchema, labSessionSchema, memberSchema, memberUpdateSchema, participantSchema, resultSchema, verifyAchievementSchema,
} from '@eduerp/shared';
import { Auth, Client, ClientInfo, PortalUser, RequireModule, RequirePermission, TenantMember } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { LabsService } from './labs.service';
import { SportsService } from './sports.service';

const uuid = z.string().uuid();
const date = z.string().date();
const q = z.object({ q: z.string().trim().max(80).default('') });

/** Labs (Phase 18 / B6 §2). */
@Controller('labs')
export class LabsController {
  constructor(private readonly labs: LabsService) {}

  @RequireModule('LABS') @TenantMember() @Get('options')
  options(@Auth() auth: AuthContext) { return this.labs.options(auth); }

  @RequireModule('LABS') @TenantMember() @Get()
  list(@Auth() auth: AuthContext) { return this.labs.labs(auth); }

  @RequireModule('LABS') @RequirePermission(PERMISSIONS.LAB_MANAGE) @Post()
  add(@Body(zod(labSchema)) b: LabInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.labs.saveLab(null, b, auth, c); }

  @RequireModule('LABS') @RequirePermission(PERMISSIONS.LAB_MANAGE) @Put(':id')
  edit(@Param('id', ParseUUIDPipe) id: string, @Body(zod(labSchema)) b: LabInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.labs.saveLab(id, b, auth, c); }

  @RequireModule('LABS') @TenantMember() @Get('equipment')
  equipment(@Query(zod(z.object({ labId: uuid.optional(), due: z.enum(['true', 'false']).optional() }))) x: { labId?: string; due?: string }, @Auth() auth: AuthContext) { return this.labs.equipment(auth, { labId: x.labId, due: x.due === 'true' }); }

  @RequireModule('LABS') @RequirePermission(PERMISSIONS.LAB_MANAGE) @Post('equipment')
  addEquipment(@Body(zod(equipmentSchema)) b: EquipmentInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.labs.saveEquipment(null, b, auth, c); }

  @RequireModule('LABS') @RequirePermission(PERMISSIONS.LAB_MANAGE) @Put('equipment/:id')
  editEquipment(@Param('id', ParseUUIDPipe) id: string, @Body(zod(equipmentSchema)) b: EquipmentInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.labs.saveEquipment(id, b, auth, c); }

  @RequireModule('LABS') @TenantMember() @Get('sessions')
  sessions(@Query(zod(z.object({ labId: uuid.optional(), from: date.optional(), to: date.optional(), mine: z.enum(['true', 'false']).optional() }))) x: { labId?: string; from?: string; to?: string; mine?: string }, @Auth() auth: AuthContext) { return this.labs.sessions(auth, { ...x, mine: x.mine === 'true' }); }

  @RequireModule('LABS') @RequirePermission(PERMISSIONS.LAB_SESSION) @Post('sessions')
  book(@Body(zod(labSessionSchema)) b: LabSessionInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.labs.createSession(b, auth, c); }

  @RequireModule('LABS') @TenantMember() @Post('sessions/:id/status') @HttpCode(200)
  sessionStatus(@Param('id', ParseUUIDPipe) id: string, @Body(zod(completeSessionSchema)) b: { status: 'COMPLETED' | 'CANCELLED'; studentsPresent?: number | null; remarks?: string | null }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.labs.updateSession(id, b, auth, c); }

  @RequireModule('LABS') @TenantMember() @Get('breakages')
  breakages(@Query(zod(z.object({ labId: uuid.optional(), status: z.enum(BREAKAGE_STATUSES).optional() }))) x: { labId?: string; status?: string }, @Auth() auth: AuthContext) { return this.labs.breakages(auth, x); }

  @RequireModule('LABS') @TenantMember() @Post('breakages')
  report(@Body(zod(breakageSchema)) b: BreakageInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.labs.reportBreakage(b, auth, c); }

  @RequireModule('LABS') @RequirePermission(PERMISSIONS.LAB_MANAGE) @Post('breakages/:id/decide') @HttpCode(200)
  decide(@Param('id', ParseUUIDPipe) id: string, @Body(zod(breakageDecisionSchema)) b: { action: 'CHARGE' | 'WAIVE'; reason?: string | null }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.labs.decideBreakage(id, b.action, b.reason ?? null, auth, c); }

  @RequireModule('LABS') @TenantMember() @Get('people')
  people(@Query(zod(q)) x: { q: string }, @Auth() auth: AuthContext) { return this.labs.people(auth, x.q); }
}

/** Sports & activities (Phase 18 / B6 §3). */
@Controller('activities')
export class ActivitiesController {
  constructor(private readonly sports: SportsService) {}

  @RequireModule('SPORTS') @TenantMember() @Get('options')
  options(@Auth() auth: AuthContext) { return this.sports.options(auth); }

  @RequireModule('SPORTS') @TenantMember() @Get()
  list(@Auth() auth: AuthContext) { return this.sports.activities(auth); }

  @RequireModule('SPORTS') @RequirePermission(PERMISSIONS.ACT_MANAGE) @Post()
  add(@Body(zod(activitySchema)) b: ActivityInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.sports.saveActivity(null, b, auth, c); }

  @RequireModule('SPORTS') @TenantMember() @Get('people')
  people(@Query(zod(q.extend({ kind: z.enum(['STUDENT', 'EMPLOYEE', 'ANY']).default('STUDENT') }))) x: { q: string; kind: 'STUDENT' | 'EMPLOYEE' | 'ANY' }, @Auth() auth: AuthContext) { return this.sports.people(auth, x.q, x.kind === 'ANY' ? ['STUDENT', 'EMPLOYEE'] : [x.kind]); }

  @RequireModule('SPORTS') @TenantMember() @Get('report')
  report(@Query(zod(z.object({ from: date.optional(), to: date.optional() }))) x: { from?: string; to?: string }, @Auth() auth: AuthContext) { return this.sports.report(auth, x); }

  @RequireModule('SPORTS') @TenantMember() @Get('achievements')
  achievements(@Query(zod(z.object({ status: z.enum(['PENDING', 'VERIFIED']).optional(), studentId: uuid.optional() }))) x: { status?: 'PENDING' | 'VERIFIED'; studentId?: string }, @Auth() auth: AuthContext) { return this.sports.achievements(auth, x); }

  @RequireModule('SPORTS') @TenantMember() @Post('achievements')
  addAchievement(@Body(zod(achievementSchema)) b: AchievementInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.sports.addAchievement(b, auth, c); }

  @RequireModule('SPORTS') @RequirePermission(PERMISSIONS.ACT_MANAGE) @Post('achievements/:id/verify') @HttpCode(200)
  verify(@Param('id', ParseUUIDPipe) id: string, @Body(zod(verifyAchievementSchema)) b: { postToFeed: boolean }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.sports.verify(id, b.postToFeed, auth, c); }

  @RequireModule('SPORTS') @TenantMember() @Delete('achievements/:id')
  removeAchievement(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.sports.removeAchievement(id, auth, c); }

  @RequireModule('SPORTS') @TenantMember() @Get('students/:id')
  student(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.sports.forStudent(id, auth); }

  @RequireModule('SPORTS') @PortalUser() @Get('children/:id')
  child(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.sports.forChild(id, auth); }

  @RequireModule('SPORTS') @RequirePermission(PERMISSIONS.ACT_MANAGE) @Post('competitions')
  addCompetition(@Body(zod(competitionSchema)) b: CompetitionInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.sports.saveCompetition(null, b, auth, c); }

  @RequireModule('SPORTS') @RequirePermission(PERMISSIONS.ACT_MANAGE) @Put('competitions/:id')
  editCompetition(@Param('id', ParseUUIDPipe) id: string, @Body(zod(competitionSchema)) b: CompetitionInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.sports.saveCompetition(id, b, auth, c); }

  @RequireModule('SPORTS') @TenantMember() @Get('competitions/:id')
  competition(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.sports.competition(id, auth); }

  @RequireModule('SPORTS') @RequirePermission(PERMISSIONS.ACT_MANAGE) @Post('competitions/:id/participants')
  addParticipants(@Param('id', ParseUUIDPipe) id: string, @Body(zod(participantSchema)) b: { studentIds: string[]; category: string }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.sports.addParticipants(id, b.studentIds, b.category, auth, c); }

  @RequireModule('SPORTS') @RequirePermission(PERMISSIONS.ACT_MANAGE) @Put('participants/:id')
  result(@Param('id', ParseUUIDPipe) id: string, @Body(zod(resultSchema)) b: { result: string; remarks?: string | null }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.sports.setResult(id, b.result, b.remarks ?? null, auth, c); }

  @RequireModule('SPORTS') @RequirePermission(PERMISSIONS.ACT_MANAGE) @Delete('participants/:id')
  removeParticipant(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.sports.removeParticipant(id, auth, c); }

  @RequireModule('SPORTS') @RequirePermission(PERMISSIONS.ACT_MANAGE) @Post('participants/:id/achievement')
  fromResult(@Param('id', ParseUUIDPipe) id: string, @Body(zod(verifyAchievementSchema)) b: { postToFeed: boolean }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.sports.achievementFromResult(id, b.postToFeed, auth, c); }

  @RequireModule('SPORTS') @RequirePermission(PERMISSIONS.ACT_MANAGE) @Put('members/:id')
  updateMember(@Param('id', ParseUUIDPipe) id: string, @Body(zod(memberUpdateSchema)) b: { teamName?: string | null; memberRole: string }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.sports.updateMember(id, b, auth, c); }

  @RequireModule('SPORTS') @RequirePermission(PERMISSIONS.ACT_MANAGE) @Delete('members/:id')
  removeMember(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.sports.removeMember(id, auth, c); }

  @RequireModule('SPORTS') @TenantMember() @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string, @Query(zod(z.object({ yearId: uuid.optional() }))) x: { yearId?: string }, @Auth() auth: AuthContext) { return this.sports.detail(id, auth, x.yearId); }

  @RequireModule('SPORTS') @RequirePermission(PERMISSIONS.ACT_MANAGE) @Put(':id')
  edit(@Param('id', ParseUUIDPipe) id: string, @Body(zod(activitySchema)) b: ActivityInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.sports.saveActivity(id, b, auth, c); }

  @RequireModule('SPORTS') @RequirePermission(PERMISSIONS.ACT_MANAGE) @Post(':id/members')
  addMembers(@Param('id', ParseUUIDPipe) id: string, @Body(zod(memberSchema)) b: MemberInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.sports.addMembers(id, b, auth, c); }
}
