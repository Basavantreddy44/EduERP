import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  ActionItemInput, CallLogInput, CommitteeInput, ComplaintCategoryInput, ComplaintInput, ComplaintUpdateInput, DeptRequestInput, DeptRequestUpdateInput,
  GatePassInput, MeetingInput, PERMISSIONS, PostalInput, RequestCategoryInput, FrontVisitorInput,
  actionItemSchema, actionStatusSchema, callLogSchema, committeeSchema, complaintCategorySchema, complaintCloseSchema, complaintSchema, complaintUpdateSchema,
  deptRequestSchema, deptRequestUpdateSchema, gatePassSchema, meetingAttendanceSchema, meetingSchema, minutesSchema, postalSchema, requestCategorySchema, rsvpSchema, frontVisitorSchema,
} from '@eduerp/shared';
import { Auth, Client, ClientInfo, PortalUser, RequireModule, RequirePermission, TenantMember } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { Db } from '../../common/prisma.service';
import { MeetingsService, staffOptions } from './meetings.service';
import { ComplaintsService } from './complaints.service';
import { FrontOfficeService } from './front-office.service';
import { DeptRequestsService } from './requests.service';

const uuid = z.string().uuid();
const day = z.object({ campusId: uuid, date: z.string().date() });
const campus = z.object({ campusId: uuid });
type Close = { close: boolean; rating?: number | null; message?: string | null };

/** Staff meetings & committees (M12.1). */
@Controller('meetings')
export class MeetingsController {
  constructor(private readonly m: MeetingsService) {}

  @RequireModule('MEETINGS') @RequirePermission(PERMISSIONS.MEETING_ATTEND) @Get('options')
  options(@Auth() auth: AuthContext) { return this.m.inviteOptions(auth); }

  @RequireModule('MEETINGS') @RequirePermission(PERMISSIONS.MEETING_ATTEND) @Get('committees')
  committees(@Auth() auth: AuthContext) { return this.m.committees(auth); }

  @RequireModule('MEETINGS') @RequirePermission(PERMISSIONS.MEETING_MANAGE) @Post('committees')
  addCommittee(@Body(zod(committeeSchema)) b: CommitteeInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.m.saveCommittee(null, b, auth, c); }

  @RequireModule('MEETINGS') @RequirePermission(PERMISSIONS.MEETING_MANAGE) @Put('committees/:id')
  editCommittee(@Param('id', ParseUUIDPipe) id: string, @Body(zod(committeeSchema)) b: CommitteeInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.m.saveCommittee(id, b, auth, c); }

  @RequireModule('MEETINGS') @RequirePermission(PERMISSIONS.MEETING_ATTEND) @Get()
  list(@Auth() auth: AuthContext) { return this.m.list(auth); }

  @RequireModule('MEETINGS') @RequirePermission(PERMISSIONS.MEETING_MANAGE) @Post()
  create(@Body(zod(meetingSchema)) b: MeetingInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.m.create(b, auth, c); }

  @RequireModule('MEETINGS') @RequirePermission(PERMISSIONS.MEETING_ATTEND) @Get('my-actions')
  myActions(@Auth() auth: AuthContext) { return this.m.myActions(auth); }

  @RequireModule('MEETINGS') @RequirePermission(PERMISSIONS.MEETING_ATTEND) @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.m.get(id, auth); }

  @RequireModule('MEETINGS') @RequirePermission(PERMISSIONS.MEETING_ATTEND) @Post(':id/rsvp') @HttpCode(200)
  rsvp(@Param('id', ParseUUIDPipe) id: string, @Body(zod(rsvpSchema)) b: { accept: boolean }, @Auth() auth: AuthContext) { return this.m.rsvp(id, b.accept, auth); }

  @RequireModule('MEETINGS') @RequirePermission(PERMISSIONS.MEETING_ATTEND) @Post(':id/attendance') @HttpCode(200)
  attendance(@Param('id', ParseUUIDPipe) id: string, @Body(zod(meetingAttendanceSchema)) b: { rows: { employeeId: string; attended: boolean }[] }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.m.attendance(id, b.rows, auth, c); }

  @RequireModule('MEETINGS') @RequirePermission(PERMISSIONS.MEETING_ATTEND) @Post(':id/minutes') @HttpCode(200)
  saveMinutes(@Param('id', ParseUUIDPipe) id: string, @Body(zod(minutesSchema)) b: { minutesText: string }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.m.minutes(id, 'SAVE', b.minutesText, auth, c); }

  @RequireModule('MEETINGS') @RequirePermission(PERMISSIONS.MEETING_ATTEND) @Post(':id/minutes/:step') @HttpCode(200)
  minutesStep(@Param('id', ParseUUIDPipe) id: string, @Param('step', zod(z.enum(['circulate', 'approve']))) step: 'circulate' | 'approve', @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.m.minutes(id, step === 'circulate' ? 'CIRCULATE' : 'APPROVE', null, auth, c); }

  @RequireModule('MEETINGS') @RequirePermission(PERMISSIONS.MEETING_ATTEND) @Post(':id/actions')
  addAction(@Param('id', ParseUUIDPipe) id: string, @Body(zod(actionItemSchema)) b: ActionItemInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.m.addAction(id, b, auth, c); }

  @RequireModule('MEETINGS') @RequirePermission(PERMISSIONS.MEETING_ATTEND) @Post('actions/:id/status') @HttpCode(200)
  actionStatus(@Param('id', ParseUUIDPipe) id: string, @Body(zod(actionStatusSchema)) b: { status: string; note?: string | null }, @Auth() auth: AuthContext) { return this.m.actionStatus(id, b.status, b.note ?? null, auth); }
}

/** Complaints & grievances for staff (M12.2). */
@Controller('complaints')
export class ComplaintsController {
  constructor(private readonly db: Db, private readonly c: ComplaintsService) {}

  @RequireModule('GRIEVANCE') @RequirePermission(PERMISSIONS.GRIEVANCE_MANAGE) @Get('staff')
  staff(@Auth() auth: AuthContext) { return this.db.run({ tenantId: auth.tenantId, userId: auth.userId }, (tx) => staffOptions(tx)); }

  @RequireModule('GRIEVANCE') @TenantMember() @Get('categories')
  categories(@Auth() auth: AuthContext) { return this.c.categories(auth); }

  @RequireModule('GRIEVANCE') @RequirePermission(PERMISSIONS.GRIEVANCE_MANAGE) @Post('categories')
  addCategory(@Body(zod(complaintCategorySchema)) b: ComplaintCategoryInput, @Auth() auth: AuthContext, @Client() cl: ClientInfo) { return this.c.saveCategory(null, b, auth, cl); }

  @RequireModule('GRIEVANCE') @RequirePermission(PERMISSIONS.GRIEVANCE_MANAGE) @Put('categories/:id')
  editCategory(@Param('id', ParseUUIDPipe) id: string, @Body(zod(complaintCategorySchema)) b: ComplaintCategoryInput, @Auth() auth: AuthContext, @Client() cl: ClientInfo) { return this.c.saveCategory(id, b, auth, cl); }

  @RequireModule('GRIEVANCE') @TenantMember() @Get()
  list(@Query(zod(z.object({ filter: z.enum(['OPEN', 'ALL', 'MINE']).default('OPEN') }))) q: { filter: 'OPEN' | 'ALL' | 'MINE' }, @Auth() auth: AuthContext) { return this.c.list(auth, q.filter); }

  @RequireModule('GRIEVANCE') @RequirePermission(PERMISSIONS.GRIEVANCE_RAISE) @Post()
  raise(@Body(zod(complaintSchema)) b: ComplaintInput, @Auth() auth: AuthContext) { return this.c.raiseAsStaff(b, auth); }

  @RequireModule('GRIEVANCE') @TenantMember() @Get(':id')
  view(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.c.view(id, auth); }

  @RequireModule('GRIEVANCE') @TenantMember() @Post(':id/updates')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zod(complaintUpdateSchema)) b: ComplaintUpdateInput, @Auth() auth: AuthContext, @Client() cl: ClientInfo) { return this.c.update(id, b, auth, cl); }

  @RequireModule('GRIEVANCE') @TenantMember() @Post(':id/close') @HttpCode(200)
  close(@Param('id', ParseUUIDPipe) id: string, @Body(zod(complaintCloseSchema)) b: Close, @Auth() auth: AuthContext) { return this.c.close(id, b.close, b.rating ?? null, b.message ?? null, auth); }
}

/** Front office (M12.3): visitors, gate passes, calls, post. */
@Controller('front-office')
export class FrontOfficeController {
  constructor(private readonly f: FrontOfficeService) {}

  @RequireModule('FRONT_OFFICE') @RequirePermission(PERMISSIONS.FRONT_DESK) @Get('campuses')
  campuses(@Auth() auth: AuthContext) { return this.f.campuses(auth); }

  @RequireModule('FRONT_OFFICE') @RequirePermission(PERMISSIONS.FRONT_DESK) @Get('staff')
  staff(@Auth() auth: AuthContext) { return this.f.staff(auth); }

  @RequireModule('FRONT_OFFICE') @RequirePermission(PERMISSIONS.FRONT_DESK) @Get('students')
  students(@Query(zod(z.object({ campusId: uuid, q: z.string().trim().min(2).max(60) }))) q: { campusId: string; q: string }, @Auth() auth: AuthContext) { return this.f.findStudents(q.campusId, q.q, auth); }

  @RequireModule('FRONT_OFFICE') @RequirePermission(PERMISSIONS.FRONT_DESK) @Get('visitors')
  visitors(@Query(zod(day)) q: { campusId: string; date: string }, @Auth() auth: AuthContext) { return this.f.visitors(q.campusId, q.date, auth); }

  @RequireModule('FRONT_OFFICE') @RequirePermission(PERMISSIONS.FRONT_DESK) @Post('visitors')
  visitorIn(@Body(zod(frontVisitorSchema)) b: FrontVisitorInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.f.visitorIn(b, auth, c); }

  @RequireModule('FRONT_OFFICE') @RequirePermission(PERMISSIONS.FRONT_DESK) @Post('visitors/:id/out') @HttpCode(200)
  visitorOut(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.f.visitorOut(id, auth); }

  @RequireModule('FRONT_OFFICE') @RequirePermission(PERMISSIONS.FRONT_DESK) @Get('gate-passes')
  gatePasses(@Query(zod(day)) q: { campusId: string; date: string }, @Auth() auth: AuthContext) { return this.f.gatePasses(q.campusId, q.date, auth); }

  @RequireModule('FRONT_OFFICE') @RequirePermission(PERMISSIONS.FRONT_DESK) @Get('students/:id/guardians')
  guardians(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.f.guardians(id, auth); }

  @RequireModule('FRONT_OFFICE') @RequirePermission(PERMISSIONS.FRONT_DESK) @Post('gate-passes')
  gatePass(@Body(zod(gatePassSchema)) b: GatePassInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.f.gatePass(b, auth, c); }

  @RequireModule('FRONT_OFFICE') @RequirePermission(PERMISSIONS.FRONT_APPROVE) @Post('gate-passes/:id/decide') @HttpCode(200)
  decide(@Param('id', ParseUUIDPipe) id: string, @Body(zod(z.object({ approve: z.boolean() }))) b: { approve: boolean }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.f.decide(id, b.approve, auth, c); }

  @RequireModule('FRONT_OFFICE') @RequirePermission(PERMISSIONS.FRONT_DESK) @Post('gate-passes/:id/:move') @HttpCode(200)
  movement(@Param('id', ParseUUIDPipe) id: string, @Param('move', zod(z.enum(['out', 'return']))) move: 'out' | 'return', @Auth() auth: AuthContext) { return this.f.movement(id, move === 'out' ? 'OUT' : 'RETURNED', auth); }

  @RequireModule('FRONT_OFFICE') @RequirePermission(PERMISSIONS.FRONT_DESK) @Get('calls')
  calls(@Query(zod(campus)) q: { campusId: string }, @Auth() auth: AuthContext) { return this.f.calls(q.campusId, auth); }

  @RequireModule('FRONT_OFFICE') @RequirePermission(PERMISSIONS.FRONT_DESK) @Post('calls')
  call(@Body(zod(callLogSchema)) b: CallLogInput, @Auth() auth: AuthContext) { return this.f.call(b, auth); }

  @RequireModule('FRONT_OFFICE') @RequirePermission(PERMISSIONS.FRONT_DESK) @Post('calls/:id/done') @HttpCode(200)
  followUpDone(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.f.followUpDone(id, auth); }

  @RequireModule('FRONT_OFFICE') @RequirePermission(PERMISSIONS.FRONT_DESK) @Get('postal')
  postal(@Query(zod(campus)) q: { campusId: string }, @Auth() auth: AuthContext) { return this.f.postal(q.campusId, auth); }

  @RequireModule('FRONT_OFFICE') @RequirePermission(PERMISSIONS.FRONT_DESK) @Post('postal')
  post(@Body(zod(postalSchema)) b: PostalInput, @Auth() auth: AuthContext) { return this.f.post(b, auth); }

  @RequireModule('FRONT_OFFICE') @RequirePermission(PERMISSIONS.FRONT_DESK) @Post('postal/:id/handed-over') @HttpCode(200)
  handOver(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.f.handOver(id, auth); }
}

/** Department requests (M12.4). */
@Controller('dept-requests')
export class DeptRequestsController {
  constructor(private readonly r: DeptRequestsService) {}

  @RequireModule('DEPT_REQUESTS') @TenantMember() @Get('categories')
  categories(@Auth() auth: AuthContext) { return this.r.categories(auth); }

  @RequireModule('DEPT_REQUESTS') @RequirePermission(PERMISSIONS.DEPT_REQ_SETUP) @Post('categories')
  addCategory(@Body(zod(requestCategorySchema)) b: RequestCategoryInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.r.saveCategory(b, auth, c); }

  @RequireModule('DEPT_REQUESTS') @RequirePermission(PERMISSIONS.DEPT_REQ_SETUP) @Put('categories/:id')
  editCategory(@Param('id', ParseUUIDPipe) id: string, @Body(zod(requestCategorySchema.extend({ isActive: z.boolean().optional() }))) b: RequestCategoryInput & { isActive?: boolean }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.r.saveCategory({ ...b, id }, auth, c); }

  @RequireModule('DEPT_REQUESTS') @TenantMember() @Get('form')
  form(@Auth() auth: AuthContext) { return this.r.formData(auth); }

  @RequireModule('DEPT_REQUESTS') @TenantMember() @Get()
  list(@Query(zod(z.object({ box: z.enum(['mine', 'dept', 'all']).default('mine'), status: z.string().max(20).optional() }))) q: { box: 'mine' | 'dept' | 'all'; status?: string }, @Auth() auth: AuthContext) { return this.r.list(q.box, q.status, auth); }

  @RequireModule('DEPT_REQUESTS') @RequirePermission(PERMISSIONS.DEPT_REQ_RAISE) @Post()
  create(@Body(zod(deptRequestSchema)) b: DeptRequestInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.r.create(b, auth, c); }

  @RequireModule('DEPT_REQUESTS') @TenantMember() @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.r.get(id, auth); }

  @RequireModule('DEPT_REQUESTS') @TenantMember() @Post(':id/updates')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zod(deptRequestUpdateSchema)) b: DeptRequestUpdateInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.r.update(id, b, auth, c); }

  @RequireModule('DEPT_REQUESTS') @TenantMember() @Post(':id/close') @HttpCode(200)
  close(@Param('id', ParseUUIDPipe) id: string, @Body(zod(z.object({ accept: z.boolean(), message: z.string().trim().max(1000).optional().nullable() }).refine((v) => v.accept || !!v.message, { message: 'Say what is still needed', path: ['message'] }))) b: { accept: boolean; message?: string | null }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.r.close(id, b.accept, b.message ?? null, auth, c); }
}

/** Complaints in the parent app: raise for own child, follow, confirm or reopen. */
@Controller('portal/complaints')
export class PortalComplaintsController {
  constructor(private readonly db: Db, private readonly c: ComplaintsService) {}

  private run<T>(auth: AuthContext, fn: Parameters<Db['run']>[1] extends (tx: infer X) => unknown ? (tx: X) => Promise<T> : never) {
    return this.db.run({ tenantId: auth.tenantId, userId: auth.userId }, fn as never) as Promise<T>;
  }

  @PortalUser() @RequireModule('GRIEVANCE') @Get('categories')
  async categories(@Auth() auth: AuthContext) { return (await this.c.categories(auth)).map((x) => ({ id: x.id, name: x.name, slaHours: x.slaHours })); }

  @PortalUser() @RequireModule('GRIEVANCE') @Get()
  mine(@Auth() auth: AuthContext) { return this.run(auth, (tx) => this.c.mineTx(tx, auth)); }

  @PortalUser() @RequireModule('GRIEVANCE') @Post()
  raise(@Body(zod(complaintSchema)) b: ComplaintInput, @Auth() auth: AuthContext) { return this.run(auth, (tx) => this.c.raiseTx(tx, b, auth, 'PARENT')); }

  @PortalUser() @RequireModule('GRIEVANCE') @Get(':id')
  view(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.run(auth, (tx) => this.c.viewTx(tx, id, auth, true)); }

  @PortalUser() @RequireModule('GRIEVANCE') @Post(':id/close') @HttpCode(200)
  close(@Param('id', ParseUUIDPipe) id: string, @Body(zod(complaintCloseSchema)) b: Close, @Auth() auth: AuthContext) { return this.run(auth, (tx) => this.c.closeTx(tx, id, b.close, b.rating ?? null, b.message ?? null, auth)); }
}
