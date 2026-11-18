import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  AssignTransportInput, CrewInput, PERMISSIONS, RouteInput, SaveStopsInput, StopTransportInput, UpdateCrewInput, UpdateRouteInput, UpdateVehicleInput, VehicleDocInput, VehicleInput,
  assignTransportSchema, crewSchema, routeSchema, saveStopsSchema, stopTransportSchema, updateCrewSchema, updateRouteSchema, updateVehicleSchema, vehicleDocSchema, vehicleSchema,
} from '@eduerp/shared';
import { z } from 'zod';
import { Auth, Client, ClientInfo, RequireModule, RequirePermission } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { TransportFleetService } from './fleet.service';
import { TransportRoutesService } from './routes.service';
import { TransportRidersService } from './riders.service';

const campusQuery = z.object({ campusId: z.string().uuid().optional() });
const campusRequired = z.object({ campusId: z.string().uuid() });

/** Transport (Phase 6): vehicles, documents, crew, routes, stops and students on buses. */
@RequireModule('TRANSPORT')
@Controller('transport')
export class TransportController {
  constructor(
    private readonly fleet: TransportFleetService,
    private readonly routes: TransportRoutesService,
    private readonly riders: TransportRidersService,
  ) {}

  // ───── Vehicles & documents (M6.1) ─────
  @RequirePermission(PERMISSIONS.TRANSPORT_READ)
  @Get('vehicles')
  vehicles(@Query(zod(campusQuery)) q: { campusId?: string }, @Auth() auth: AuthContext) {
    return this.fleet.vehicles(auth, q.campusId);
  }

  @RequirePermission(PERMISSIONS.TRANSPORT_READ)
  @Get('vehicles/:id')
  vehicle(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.fleet.vehicle(id, auth);
  }

  @RequirePermission(PERMISSIONS.TRANSPORT_MANAGE)
  @Post('vehicles')
  createVehicle(@Body(zod(vehicleSchema)) body: VehicleInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.fleet.createVehicle(body, auth, client);
  }

  @RequirePermission(PERMISSIONS.TRANSPORT_MANAGE)
  @Patch('vehicles/:id')
  updateVehicle(@Param('id', ParseUUIDPipe) id: string, @Body(zod(updateVehicleSchema)) body: UpdateVehicleInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.fleet.updateVehicle(id, body, auth, client);
  }

  /** Adds a document (a renewal is a new row; the newest per type is the one in force). */
  @RequirePermission(PERMISSIONS.TRANSPORT_MANAGE)
  @Post('vehicles/:id/documents')
  addDocument(@Param('id', ParseUUIDPipe) id: string, @Body(zod(vehicleDocSchema)) body: VehicleDocInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.fleet.addDocument(id, body, auth, client);
  }

  /** Documents and driving licences expiring within 30 days or already expired. */
  @RequirePermission(PERMISSIONS.TRANSPORT_READ)
  @Get('expiring')
  expiring(@Auth() auth: AuthContext) {
    return this.fleet.expiring(auth);
  }

  // ───── Crew (M6.1) ─────
  @RequirePermission(PERMISSIONS.TRANSPORT_READ)
  @Get('crew')
  crew(@Query(zod(campusQuery)) q: { campusId?: string }, @Auth() auth: AuthContext) {
    return this.fleet.crew(auth, q.campusId);
  }

  @RequirePermission(PERMISSIONS.TRANSPORT_MANAGE)
  @Post('crew')
  addCrew(@Body(zod(crewSchema)) body: CrewInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.fleet.addCrew(body, auth, client);
  }

  @RequirePermission(PERMISSIONS.TRANSPORT_MANAGE)
  @Patch('crew/:id')
  updateCrew(@Param('id', ParseUUIDPipe) id: string, @Body(zod(updateCrewSchema)) body: UpdateCrewInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.fleet.updateCrew(id, body, auth, client);
  }

  // ───── Routes & stops (M6.2) ─────
  @RequirePermission(PERMISSIONS.TRANSPORT_READ)
  @Get('routes')
  listRoutes(@Query(zod(campusQuery)) q: { campusId?: string }, @Auth() auth: AuthContext) {
    return this.routes.routes(auth, q.campusId);
  }

  @RequirePermission(PERMISSIONS.TRANSPORT_READ)
  @Get('routes/:id')
  route(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.routes.route(id, auth);
  }

  @RequirePermission(PERMISSIONS.TRANSPORT_MANAGE)
  @Post('routes')
  createRoute(@Body(zod(routeSchema)) body: RouteInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.routes.createRoute(body, auth, client);
  }

  @RequirePermission(PERMISSIONS.TRANSPORT_MANAGE)
  @Patch('routes/:id')
  updateRoute(@Param('id', ParseUUIDPipe) id: string, @Body(zod(updateRouteSchema)) body: UpdateRouteInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.routes.updateRoute(id, body, auth, client);
  }

  /** Replaces the stop list in pickup order. */
  @RequirePermission(PERMISSIONS.TRANSPORT_MANAGE)
  @Put('routes/:id/stops')
  saveStops(@Param('id', ParseUUIDPipe) id: string, @Body(zod(saveStopsSchema)) body: SaveStopsInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.routes.saveStops(id, body, auth, client);
  }

  /** The driver's list: every student on the route, stop by stop. */
  @RequirePermission(PERMISSIONS.TRANSPORT_READ)
  @Get('routes/:id/riders')
  routeRiders(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.riders.riders(id, auth);
  }

  // ───── Students on buses (M6.3) ─────
  @RequirePermission(PERMISSIONS.TRANSPORT_ASSIGN)
  @Get('assign-options')
  assignOptions(@Query(zod(campusRequired)) q: { campusId: string }, @Auth() auth: AuthContext) {
    return this.riders.options(auth, q.campusId);
  }

  @RequirePermission(PERMISSIONS.TRANSPORT_ASSIGN)
  @Post('assignments')
  assign(@Body(zod(assignTransportSchema)) body: AssignTransportInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.riders.assign(body, auth, client);
  }

  @RequirePermission(PERMISSIONS.TRANSPORT_ASSIGN)
  @Post('assignments/:id/stop')
  @HttpCode(200)
  stop(@Param('id', ParseUUIDPipe) id: string, @Body(zod(stopTransportSchema)) body: StopTransportInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.riders.stop(id, body, auth, client);
  }

  @RequirePermission(PERMISSIONS.TRANSPORT_READ)
  @Get('students/:id')
  student(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.riders.student(id, auth);
  }
}
