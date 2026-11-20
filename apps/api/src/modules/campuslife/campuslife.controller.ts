import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  ActionInput, AddCopiesInput, BookInput, CheckupInput, CopyInput, CounsellingInput, HealthProfileInput, IncidentInput, IncidentTypeInput, IssueInput, LibrarySettingsInput, MEMBER_TYPES, MemberType, PERMISSIONS, VaccinationInput, VisitInput,
  INCIDENT_STATUSES, actionSchema, addCopiesSchema, bookSchema, checkupSchema, closeIncidentSchema, copySchema, counsellingSchema, healthProfileSchema, incidentSchema, incidentTypeSchema, issueSchema, librarySettingsSchema, lostSchema, reserveSchema, returnSchema, vaccinationSchema, visitSchema,
} from '@eduerp/shared';
import { Auth, Client, ClientInfo, PortalUser, RequireModule, RequirePermission, TenantMember } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { LibraryService } from './library.service';
import { HealthService } from './health.service';
import { DisciplineService } from './discipline.service';

const uuid = z.string().uuid();
const q = z.object({ q: z.string().trim().max(80).default('') });
const L = 'LIBRARY';

/** Library (Phase 16 / B5 §4). */
@Controller('library')
export class LibraryController {
  constructor(private readonly lib: LibraryService) {}

  @RequireModule(L) @TenantMember() @Get('settings')
  settings(@Auth() auth: AuthContext) { return this.lib.settings(auth); }

  @RequireModule(L) @RequirePermission(PERMISSIONS.LIB_MANAGE) @Put('settings')
  saveSettings(@Body(zod(librarySettingsSchema)) b: LibrarySettingsInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.lib.saveSettings(b, auth, c); }

  @RequireModule(L) @TenantMember() @Get('books')
  books(@Query(zod(z.object({ q: z.string().trim().max(100).optional(), campusId: uuid.optional() }))) x: { q?: string; campusId?: string }, @Auth() auth: AuthContext) { return this.lib.books(auth, x.q, x.campusId); }

  @RequireModule(L) @TenantMember() @Get('books/:id')
  book(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.lib.book(id, auth); }

  @RequireModule(L) @RequirePermission(PERMISSIONS.LIB_MANAGE) @Post('books')
  addBook(@Body(zod(bookSchema)) b: BookInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.lib.saveBook(null, b, auth, c); }

  @RequireModule(L) @RequirePermission(PERMISSIONS.LIB_MANAGE) @Put('books/:id')
  editBook(@Param('id', ParseUUIDPipe) id: string, @Body(zod(bookSchema)) b: BookInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.lib.saveBook(id, b, auth, c); }

  @RequireModule(L) @RequirePermission(PERMISSIONS.LIB_MANAGE) @Post('books/:id/copies')
  addCopies(@Param('id', ParseUUIDPipe) id: string, @Body(zod(addCopiesSchema)) b: AddCopiesInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.lib.addCopies(id, b, auth, c); }

  @RequireModule(L) @RequirePermission(PERMISSIONS.LIB_MANAGE) @Put('copies/:id')
  editCopy(@Param('id', ParseUUIDPipe) id: string, @Body(zod(copySchema)) b: CopyInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.lib.editCopy(id, b, auth, c); }

  @RequireModule(L) @RequirePermission(PERMISSIONS.LIB_MANAGE) @Post('copies/:id/withdraw') @HttpCode(200)
  withdraw(@Param('id', ParseUUIDPipe) id: string, @Body(zod(lostSchema)) b: { remarks: string | null }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.lib.withdrawCopy(id, b.remarks, auth, c); }

  @RequireModule(L) @RequirePermission(PERMISSIONS.LIB_CIRCULATE) @Get('members')
  members(@Query(zod(q)) x: { q: string }, @Auth() auth: AuthContext) { return this.lib.members(x.q, auth); }

  @RequireModule(L) @RequirePermission(PERMISSIONS.LIB_CIRCULATE) @Get('members/:type/:id')
  member(@Param('type', zod(z.enum(MEMBER_TYPES))) type: MemberType, @Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.lib.memberView(type, id, auth); }

  @RequireModule(L) @RequirePermission(PERMISSIONS.LIB_CIRCULATE) @Post('issue')
  issue(@Body(zod(issueSchema)) b: IssueInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.lib.issue(b, auth, c); }

  @RequireModule(L) @RequirePermission(PERMISSIONS.LIB_CIRCULATE) @Post('return') @HttpCode(200)
  returnBook(@Body(zod(returnSchema.extend({ waive: z.boolean().default(false) }))) b: { code: string; condition: 'GOOD' | 'DAMAGED'; remarks: string | null; waive: boolean }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.lib.returnBook(b, auth, c); }

  @RequireModule(L) @TenantMember() @Post('loans/:id/renew') @HttpCode(200)
  renew(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.lib.renew(id, auth, c); }

  @RequireModule(L) @RequirePermission(PERMISSIONS.LIB_CIRCULATE) @Post('loans/:id/lost') @HttpCode(200)
  lost(@Param('id', ParseUUIDPipe) id: string, @Body(zod(lostSchema)) b: { remarks: string | null }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.lib.markLost(id, b.remarks, auth, c); }

  @RequireModule(L) @RequirePermission(PERMISSIONS.LIB_CIRCULATE) @Get('loans')
  loans(@Query(zod(z.object({ campusId: uuid.optional(), overdue: z.enum(['true', 'false']).optional(), q: z.string().trim().max(80).optional() }))) x: { campusId?: string; overdue?: string; q?: string }, @Auth() auth: AuthContext) { return this.lib.loans(auth, { campusId: x.campusId, overdue: x.overdue === 'true', q: x.q }); }

  @RequireModule(L) @TenantMember() @Post('reservations')
  reserve(@Body(zod(reserveSchema)) b: { memberType: MemberType; memberId: string; bookId: string; campusId: string }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.lib.reserve(b, auth, c); }

  @RequireModule(L) @TenantMember() @Post('reservations/:id/cancel') @HttpCode(200)
  cancelReservation(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.lib.cancelReservation(id, auth, c); }

  @RequireModule(L) @TenantMember() @Get('my')
  my(@Auth() auth: AuthContext) { return this.lib.my(auth); }

  @RequireModule(L) @PortalUser() @Get('children/:id')
  child(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.lib.child(id, auth); }

  @RequireModule(L) @RequirePermission(PERMISSIONS.LIB_MANAGE) @Get('stock-check')
  stockCheck(@Query(zod(z.object({ campusId: uuid }))) x: { campusId: string }, @Auth() auth: AuthContext) { return this.lib.stockCheck(x.campusId, auth); }

  @RequireModule(L) @RequirePermission(PERMISSIONS.LIB_MANAGE) @Post('stock-check')
  startCheck(@Body(zod(z.object({ campusId: uuid }))) b: { campusId: string }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.lib.startCheck(b.campusId, auth, c); }

  @RequireModule(L) @RequirePermission(PERMISSIONS.LIB_MANAGE) @Post('stock-check/:id/scan') @HttpCode(200)
  scan(@Param('id', ParseUUIDPipe) id: string, @Body(zod(z.object({ code: z.string().trim().min(1).max(50) }))) b: { code: string }, @Auth() auth: AuthContext) { return this.lib.scan(id, b.code, auth); }

  @RequireModule(L) @RequirePermission(PERMISSIONS.LIB_MANAGE) @Post('stock-check/:id/close') @HttpCode(200)
  closeCheck(@Param('id', ParseUUIDPipe) id: string, @Body(zod(z.object({ markLost: z.boolean().default(false) }))) b: { markLost: boolean }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.lib.closeCheck(id, b.markLost, auth, c); }
}

/** Health & infirmary (Phase 16 / B5 §5). */
@Controller('health')
export class InfirmaryController {
  constructor(private readonly health: HealthService) {}

  @RequireModule('HEALTH') @TenantMember() @Get('people')
  people(@Query(zod(q)) x: { q: string }, @Auth() auth: AuthContext) { return this.health.people(x.q, auth); }

  @RequireModule('HEALTH') @TenantMember() @Get('students/:id')
  record(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.health.record(id, auth); }

  @RequireModule('HEALTH') @RequirePermission(PERMISSIONS.HEALTH_MANAGE) @Put('students/:id/profile')
  profile(@Param('id', ParseUUIDPipe) id: string, @Body(zod(healthProfileSchema)) b: HealthProfileInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.health.saveProfile(id, b, auth, c); }

  @RequireModule('HEALTH') @RequirePermission(PERMISSIONS.HEALTH_MANAGE) @Post('students/:id/checkups')
  checkup(@Param('id', ParseUUIDPipe) id: string, @Body(zod(checkupSchema)) b: CheckupInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.health.addCheckup(id, b, auth, c); }

  @RequireModule('HEALTH') @RequirePermission(PERMISSIONS.HEALTH_MANAGE) @Delete('students/:id/checkups/:cid')
  removeCheckup(@Param('id', ParseUUIDPipe) id: string, @Param('cid', ParseUUIDPipe) cid: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.health.remove('checkup', id, cid, auth, c); }

  @RequireModule('HEALTH') @RequirePermission(PERMISSIONS.HEALTH_MANAGE) @Post('students/:id/vaccinations')
  vaccination(@Param('id', ParseUUIDPipe) id: string, @Body(zod(vaccinationSchema)) b: VaccinationInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.health.addVaccination(id, b, auth, c); }

  @RequireModule('HEALTH') @RequirePermission(PERMISSIONS.HEALTH_MANAGE) @Delete('students/:id/vaccinations/:vid')
  removeVaccination(@Param('id', ParseUUIDPipe) id: string, @Param('vid', ParseUUIDPipe) vid: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.health.remove('vaccination', id, vid, auth, c); }

  @RequireModule('HEALTH') @TenantMember() @Get('visits')
  visits(@Query(zod(z.object({ campusId: uuid.optional(), from: z.string().date().optional(), to: z.string().date().optional() }))) x: { campusId?: string; from?: string; to?: string }, @Auth() auth: AuthContext) { return this.health.visits(auth, x); }

  @RequireModule('HEALTH') @RequirePermission(PERMISSIONS.HEALTH_MANAGE) @Post('visits')
  addVisit(@Body(zod(visitSchema)) b: VisitInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.health.addVisit(b, auth, c); }

  @RequireModule('HEALTH') @TenantMember() @Get('vaccinations/due')
  due(@Query(zod(z.object({ days: z.coerce.number().int().min(0).max(365).default(30), campusId: uuid.optional() }))) x: { days: number; campusId?: string }, @Auth() auth: AuthContext) { return this.health.due(auth, x.days, x.campusId); }
}

/** Discipline & counselling (Phase 16 / B5 §6). */
@Controller('discipline')
export class DisciplineController {
  constructor(private readonly disc: DisciplineService) {}

  @RequireModule('DISCIPLINE') @TenantMember() @Get('types')
  types(@Auth() auth: AuthContext) { return this.disc.types(auth); }

  @RequireModule('DISCIPLINE') @RequirePermission(PERMISSIONS.DISC_MANAGE) @Post('types')
  addType(@Body(zod(incidentTypeSchema)) b: IncidentTypeInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.disc.saveType(null, b, auth, c); }

  @RequireModule('DISCIPLINE') @RequirePermission(PERMISSIONS.DISC_MANAGE) @Put('types/:id')
  editType(@Param('id', ParseUUIDPipe) id: string, @Body(zod(incidentTypeSchema)) b: IncidentTypeInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.disc.saveType(id, b, auth, c); }

  @RequireModule('DISCIPLINE') @TenantMember() @Get('students')
  students(@Query(zod(q)) x: { q: string }, @Auth() auth: AuthContext) { return this.disc.students(x.q, auth); }

  @RequireModule('DISCIPLINE') @TenantMember() @Get('students/:id/record')
  record(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.disc.studentRecord(id, auth); }

  @RequireModule('DISCIPLINE') @TenantMember() @Post('incidents')
  report(@Body(zod(incidentSchema)) b: IncidentInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.disc.report(b, auth, c); }

  @RequireModule('DISCIPLINE') @TenantMember() @Get('incidents')
  list(@Query(zod(z.object({ status: z.enum(INCIDENT_STATUSES).optional(), campusId: uuid.optional(), studentId: uuid.optional() }))) x: { status?: string; campusId?: string; studentId?: string }, @Auth() auth: AuthContext) { return this.disc.list(auth, x); }

  @RequireModule('DISCIPLINE') @TenantMember() @Get('incidents/:id')
  get(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.disc.get(id, auth); }

  @RequireModule('DISCIPLINE') @RequirePermission(PERMISSIONS.DISC_MANAGE) @Post('incidents/:id/review') @HttpCode(200)
  review(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.disc.review(id, auth, c); }

  @RequireModule('DISCIPLINE') @RequirePermission(PERMISSIONS.DISC_MANAGE) @Post('incidents/:id/actions')
  action(@Param('id', ParseUUIDPipe) id: string, @Body(zod(actionSchema)) b: ActionInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.disc.addAction(id, b, auth, c); }

  @RequireModule('DISCIPLINE') @RequirePermission(PERMISSIONS.DISC_MANAGE) @Post('incidents/:id/close') @HttpCode(200)
  close(@Param('id', ParseUUIDPipe) id: string, @Body(zod(closeIncidentSchema)) b: { closingNote: string | null }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.disc.close(id, b.closingNote, auth, c); }

  @RequireModule('DISCIPLINE') @RequirePermission(PERMISSIONS.COUNSEL) @Get('counselling')
  sessions(@Query(zod(z.object({ studentId: uuid.optional() }))) x: { studentId?: string }, @Auth() auth: AuthContext) { return this.disc.sessions(auth, x.studentId); }

  @RequireModule('DISCIPLINE') @RequirePermission(PERMISSIONS.COUNSEL) @Get('counselling/:id')
  session(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.disc.session(id, auth, c); }

  @RequireModule('DISCIPLINE') @RequirePermission(PERMISSIONS.COUNSEL) @Post('counselling')
  addSession(@Body(zod(counsellingSchema)) b: CounsellingInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.disc.saveSession(null, b, auth, c); }

  @RequireModule('DISCIPLINE') @RequirePermission(PERMISSIONS.COUNSEL) @Put('counselling/:id')
  editSession(@Param('id', ParseUUIDPipe) id: string, @Body(zod(counsellingSchema)) b: CounsellingInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.disc.saveSession(id, b, auth, c); }
}
