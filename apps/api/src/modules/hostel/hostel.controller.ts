import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  AllotInput, BulkRoomsInput, CheckInInput, DecisionInput, HomeGoingInput, HostelInput, InventoryInput, MaintenanceInput, MessPlanInput, MessSubscribeInput, OutpassInput,
  PERMISSIONS, RoomChangeInput, RoomInput, SaveMenuInput, SaveRollCallInput, UpdateHostelInput, UpdateMaintenanceInput, UpdateRoomInput, VacateInput, VisitorInput,
  allotSchema, bedStatusSchema, bulkRoomsSchema, checkInSchema, decisionSchema, endSubscriptionSchema, homeGoingSchema, hostelSchema, inventorySchema, maintenanceSchema,
  messPlanSchema, messSubscribeSchema, outpassSchema, roomChangeSchema, roomSchema, saveMenuSchema, saveRollCallSchema, updateHostelSchema, updateMaintenanceSchema,
  updateMessPlanSchema, updateRoomSchema, vacateSchema, visitorSchema,
} from '@eduerp/shared';
import { z } from 'zod';
import { Auth, Client, ClientInfo, RequireModule, RequirePermission } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { HostelSetupService } from './setup.service';
import { HostelAllotService } from './allot.service';
import { HostelLifeService } from './life.service';
import { MessService } from './mess.service';

const campusQuery = z.object({ campusId: z.string().uuid().optional() });
const dateQuery = z.object({ date: z.string().date() });
const campusDate = z.object({ campusId: z.string().uuid(), date: z.string().date() });
const statusQuery = z.object({ status: z.string().max(20).optional() });
const wardenDecision = decisionSchema.extend({ parentByPhone: z.boolean().optional() });
const homeDecision = decisionSchema.extend({ confirmUnlistedPickup: z.boolean().optional() });

/** Hostel & mess (Phase 7). */
@RequireModule('HOSTEL')
@Controller('hostel')
export class HostelController {
  constructor(
    private readonly setup: HostelSetupService,
    private readonly allot: HostelAllotService,
    private readonly life: HostelLifeService,
    private readonly mess: MessService,
  ) {}

  // ───── M7.1 hostels, rooms, beds ─────
  @RequirePermission(PERMISSIONS.HOSTEL_READ) @Get('hostels')
  hostels(@Query(zod(campusQuery)) q: { campusId?: string }, @Auth() auth: AuthContext) { return this.setup.hostels(auth, q.campusId); }

  @RequirePermission(PERMISSIONS.HOSTEL_MANAGE) @Post('hostels')
  createHostel(@Body(zod(hostelSchema)) b: HostelInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.createHostel(b, auth, c); }

  @RequirePermission(PERMISSIONS.HOSTEL_MANAGE) @Patch('hostels/:id')
  updateHostel(@Param('id', ParseUUIDPipe) id: string, @Body(zod(updateHostelSchema)) b: UpdateHostelInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.updateHostel(id, b, auth, c); }

  /** Rooms with beds (and who is in each) and inventory. */
  @RequirePermission(PERMISSIONS.HOSTEL_READ) @Get('hostels/:id/rooms')
  rooms(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.setup.rooms(id, auth); }

  @RequirePermission(PERMISSIONS.HOSTEL_MANAGE) @Post('hostels/:id/rooms')
  addRoom(@Param('id', ParseUUIDPipe) id: string, @Body(zod(roomSchema)) b: RoomInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.addRoom(id, b, auth, c); }

  @RequirePermission(PERMISSIONS.HOSTEL_MANAGE) @Post('hostels/:id/rooms/bulk')
  bulkRooms(@Param('id', ParseUUIDPipe) id: string, @Body(zod(bulkRoomsSchema)) b: BulkRoomsInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.bulkRooms(id, b, auth, c); }

  @RequirePermission(PERMISSIONS.HOSTEL_MANAGE) @Patch('rooms/:id')
  updateRoom(@Param('id', ParseUUIDPipe) id: string, @Body(zod(updateRoomSchema)) b: UpdateRoomInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.updateRoom(id, b, auth, c); }

  @RequirePermission(PERMISSIONS.HOSTEL_MANAGE) @Put('rooms/:id/inventory')
  inventory(@Param('id', ParseUUIDPipe) id: string, @Body(zod(inventorySchema)) b: InventoryInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.saveInventory(id, b, auth, c); }

  @RequirePermission(PERMISSIONS.HOSTEL_MANAGE) @Patch('beds/:id')
  setBed(@Param('id', ParseUUIDPipe) id: string, @Body(zod(bedStatusSchema)) b: z.infer<typeof bedStatusSchema>, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.setBed(id, b.status, b.reason, auth, c); }

  // ───── M7.2 allotment ─────
  @RequirePermission(PERMISSIONS.HOSTEL_ALLOT) @Get('students/:id/free-beds')
  freeBeds(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.allot.freeBeds(id, auth); }

  @RequirePermission(PERMISSIONS.HOSTEL_READ) @Get('students/:id')
  student(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.allot.forStudent(id, auth); }

  @RequirePermission(PERMISSIONS.HOSTEL_ALLOT) @Post('allotments')
  allotBed(@Body(zod(allotSchema)) b: AllotInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.allot.allot(b, auth, c); }

  @RequirePermission(PERMISSIONS.HOSTEL_ALLOT) @Post('allotments/:id/check-in') @HttpCode(200)
  checkIn(@Param('id', ParseUUIDPipe) id: string, @Body(zod(checkInSchema)) b: CheckInInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.allot.checkIn(id, b, auth, c); }

  @RequirePermission(PERMISSIONS.HOSTEL_ALLOT) @Post('allotments/:id/vacate') @HttpCode(200)
  vacate(@Param('id', ParseUUIDPipe) id: string, @Body(zod(vacateSchema)) b: VacateInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.allot.vacate(id, b, auth, c); }

  @RequirePermission(PERMISSIONS.HOSTEL_ALLOT) @Post('allotments/:id/change-room') @HttpCode(200)
  changeRoom(@Param('id', ParseUUIDPipe) id: string, @Body(zod(roomChangeSchema)) b: RoomChangeInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.allot.changeRoom(id, b, auth, c); }

  @RequirePermission(PERMISSIONS.HOSTEL_READ) @Get('hostels/:id/residents')
  residents(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.allot.residents(id, auth); }

  // ───── M7.3 daily life ─────
  @RequirePermission(PERMISSIONS.HOSTEL_READ) @Get('hostels/:id/roll-call')
  rollCall(@Param('id', ParseUUIDPipe) id: string, @Query(zod(dateQuery)) q: { date: string }, @Auth() auth: AuthContext) { return this.life.rollCall(id, q.date, auth); }

  @RequirePermission(PERMISSIONS.HOSTEL_WARDEN) @Post('roll-call') @HttpCode(200)
  saveRollCall(@Body(zod(saveRollCallSchema)) b: SaveRollCallInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.life.saveRollCall(b, auth, c); }

  @RequirePermission(PERMISSIONS.HOSTEL_READ) @Get('hostels/:id/outpasses')
  outpasses(@Param('id', ParseUUIDPipe) id: string, @Query(zod(statusQuery)) q: { status?: string }, @Auth() auth: AuthContext) { return this.life.outpasses(id, q.status, auth); }

  @RequirePermission(PERMISSIONS.HOSTEL_WARDEN) @Post('outpasses')
  requestOutpass(@Body(zod(outpassSchema)) b: OutpassInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.life.requestOutpass(b, auth, c); }

  @RequirePermission(PERMISSIONS.HOSTEL_WARDEN) @Post('outpasses/:id/decide') @HttpCode(200)
  decideOutpass(@Param('id', ParseUUIDPipe) id: string, @Body(zod(wardenDecision)) b: DecisionInput & { parentByPhone?: boolean }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.life.wardenDecide(id, b, auth, c); }

  @RequirePermission(PERMISSIONS.HOSTEL_WARDEN) @Post('outpasses/:id/out') @HttpCode(200)
  outpassOut(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.life.gate(id, 'OUT', auth, c); }

  @RequirePermission(PERMISSIONS.HOSTEL_WARDEN) @Post('outpasses/:id/back') @HttpCode(200)
  outpassBack(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.life.gate(id, 'BACK', auth, c); }

  @RequirePermission(PERMISSIONS.HOSTEL_WARDEN) @Post('outpasses/:id/cancel') @HttpCode(200)
  cancelOutpass(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.life.cancelOutpass(id, auth, c); }

  @RequirePermission(PERMISSIONS.HOSTEL_READ) @Get('hostels/:id/home-going')
  homeGoings(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.life.homeGoings(id, auth); }

  @RequirePermission(PERMISSIONS.HOSTEL_WARDEN) @Post('home-going')
  requestHomeGoing(@Body(zod(homeGoingSchema)) b: HomeGoingInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.life.requestHomeGoing(b, auth, c); }

  @RequirePermission(PERMISSIONS.HOSTEL_WARDEN) @Post('home-going/:id/decide') @HttpCode(200)
  decideHomeGoing(@Param('id', ParseUUIDPipe) id: string, @Body(zod(homeDecision)) b: DecisionInput & { confirmUnlistedPickup?: boolean }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.life.decideHomeGoing(id, b, auth, c); }

  @RequirePermission(PERMISSIONS.HOSTEL_WARDEN) @Post('home-going/:id/depart') @HttpCode(200)
  depart(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.life.homeGoingGate(id, 'DEPART', auth, c); }

  @RequirePermission(PERMISSIONS.HOSTEL_WARDEN) @Post('home-going/:id/return') @HttpCode(200)
  returned(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.life.homeGoingGate(id, 'RETURN', auth, c); }

  @RequirePermission(PERMISSIONS.HOSTEL_READ) @Get('hostels/:id/visitors')
  visitors(@Param('id', ParseUUIDPipe) id: string, @Query(zod(dateQuery)) q: { date: string }, @Auth() auth: AuthContext) { return this.life.visitors(id, q.date, auth); }

  @RequirePermission(PERMISSIONS.HOSTEL_WARDEN) @Post('visitors')
  visitorIn(@Body(zod(visitorSchema)) b: VisitorInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.life.visitorIn(b, auth, c); }

  @RequirePermission(PERMISSIONS.HOSTEL_WARDEN) @Post('visitors/:id/out') @HttpCode(200)
  visitorOut(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.life.visitorOut(id, auth); }

  @RequirePermission(PERMISSIONS.HOSTEL_READ) @Get('hostels/:id/maintenance')
  maintenance(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.life.maintenance(id, auth); }

  @RequirePermission(PERMISSIONS.HOSTEL_WARDEN) @Post('maintenance')
  raise(@Body(zod(maintenanceSchema)) b: MaintenanceInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.life.raise(b, auth, c); }

  @RequirePermission(PERMISSIONS.HOSTEL_WARDEN) @Patch('maintenance/:id')
  updateMaintenance(@Param('id', ParseUUIDPipe) id: string, @Body(zod(updateMaintenanceSchema)) b: UpdateMaintenanceInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.life.updateMaintenance(id, b, auth, c); }

  // ───── M7.4 mess ─────
  @RequirePermission(PERMISSIONS.HOSTEL_READ) @Get('mess/plans')
  plans(@Query(zod(campusQuery)) q: { campusId?: string }, @Auth() auth: AuthContext) { return this.mess.plans(auth, q.campusId); }

  @RequirePermission(PERMISSIONS.MESS_MANAGE) @Post('mess/plans')
  createPlan(@Body(zod(messPlanSchema)) b: MessPlanInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.mess.createPlan(b, auth, c); }

  @RequirePermission(PERMISSIONS.MESS_MANAGE) @Patch('mess/plans/:id')
  updatePlan(@Param('id', ParseUUIDPipe) id: string, @Body(zod(updateMessPlanSchema)) b: z.infer<typeof updateMessPlanSchema>, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.mess.updatePlan(id, b, auth, c); }

  @RequirePermission(PERMISSIONS.HOSTEL_READ) @Get('mess/plans/:id/subscribers')
  subscribers(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.mess.subscriptions(id, auth); }

  @RequirePermission(PERMISSIONS.HOSTEL_READ) @Get('mess/menu')
  menu(@Query(zod(campusDate)) q: { campusId: string; date: string }, @Auth() auth: AuthContext) { return this.mess.menu(q.campusId, q.date, auth); }

  @RequirePermission(PERMISSIONS.MESS_MANAGE) @Put('mess/menu')
  saveMenu(@Body(zod(saveMenuSchema)) b: SaveMenuInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.mess.saveMenu(b, auth, c); }

  @RequirePermission(PERMISSIONS.MESS_MANAGE) @Post('mess/subscriptions')
  subscribe(@Body(zod(messSubscribeSchema)) b: MessSubscribeInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.mess.subscribe(b, auth, c); }

  @RequirePermission(PERMISSIONS.MESS_MANAGE) @Post('mess/subscriptions/:id/end') @HttpCode(200)
  endSubscription(@Param('id', ParseUUIDPipe) id: string, @Body(zod(endSubscriptionSchema)) b: { toDate: string }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.mess.endSubscription(id, b.toDate, auth, c); }

  /** How many to cook for today, per meal, with the menu. */
  @RequirePermission(PERMISSIONS.HOSTEL_READ) @Get('mess/counts')
  counts(@Query(zod(campusDate)) q: { campusId: string; date: string }, @Auth() auth: AuthContext) { return this.mess.counts(q.campusId, q.date, auth); }
}
