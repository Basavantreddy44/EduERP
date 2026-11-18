import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  EventInput, PERMISSIONS, PostInput, PtmInput, ReportInput,
  commentSchema, eventResponseSchema, eventSchema, postSchema, ptmBookSchema, ptmFeedbackSchema, ptmOutcomeSchema, ptmSchema, reactionSchema, reportSchema,
} from '@eduerp/shared';
import { Auth, Client, ClientInfo, PortalUser, RequireModule, RequirePermission, TenantMember } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { Db } from '../../common/prisma.service';
import { NotFound } from '../../common/problem';
import type { UploadedBlob } from '../files/files.service';
import { FeedService } from './feed.service';
import { EventsService } from './events.service';
import { PtmService } from './ptm.service';
import { audiencesOf } from './audience';

const HARD_LIMIT_BYTES = 25 * 1024 * 1024;
const range = z.object({ from: z.string().date(), to: z.string().date() }).refine((v) => v.to >= v.from && Date.parse(v.to) - Date.parse(v.from) <= 100 * 86_400_000, 'Choose up to 100 days');
const stream = (res: Response, x: { file: { mimeType: string; sizeBytes: number; fileName: string }; stream: NodeJS.ReadableStream }) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const inline = x.file.mimeType.startsWith('image/');
  return new StreamableFile(x.stream as never, { type: x.file.mimeType, length: x.file.sizeBytes, disposition: `${inline ? 'inline' : 'attachment'}; filename="${x.file.fileName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(x.file.fileName)}` });
};

/** Engagement I (Phase 11) for staff: news feed, events & calendar, parent-teacher meetings. */
@Controller('engagement')
export class EngagementController {
  constructor(private readonly feed: FeedService, private readonly events: EventsService, private readonly ptm: PtmService) {}

  // ───── News feed ─────
  @RequireModule('NEWS_FEED') @RequirePermission(PERMISSIONS.FEED_READ) @Get('feed')
  list(@Query(zod(z.object({ pending: z.enum(['1']).optional(), before: z.string().datetime().optional() }))) q: { pending?: string; before?: string }, @Auth() auth: AuthContext) { return this.feed.list(auth, { pending: !!q.pending, before: q.before }); }

  @RequireModule('NEWS_FEED') @TenantMember() @Post('feed/files')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: HARD_LIMIT_BYTES, files: 1, fields: 2 } }))
  upload(@UploadedFile() file: UploadedBlob | undefined, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.feed.uploadMedia(file, auth, c); }

  @RequireModule('NEWS_FEED') @TenantMember() @Post('feed')
  post(@Body(zod(postSchema)) b: PostInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.feed.create(b, auth, c); }

  @RequireModule('NEWS_FEED') @RequirePermission(PERMISSIONS.FEED_MODERATE) @Post('feed/:id/moderate') @HttpCode(200)
  moderate(@Param('id', ParseUUIDPipe) id: string, @Body(zod(z.object({ action: z.enum(['APPROVE', 'REJECT', 'HIDE', 'SHOW', 'PIN', 'UNPIN']) }))) b: { action: 'APPROVE' | 'REJECT' | 'HIDE' | 'SHOW' | 'PIN' | 'UNPIN' }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.feed.moderate(id, b.action, auth, c); }

  @RequireModule('NEWS_FEED') @RequirePermission(PERMISSIONS.FEED_READ) @Post('feed/:id/react') @HttpCode(200)
  react(@Param('id', ParseUUIDPipe) id: string, @Body(zod(reactionSchema)) b: { reaction: string | null }, @Auth() auth: AuthContext) { return this.feed.react(id, b.reaction, auth); }

  @RequireModule('NEWS_FEED') @RequirePermission(PERMISSIONS.FEED_READ) @Get('feed/:id/comments')
  comments(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.feed.comments(id, auth); }

  @RequireModule('NEWS_FEED') @RequirePermission(PERMISSIONS.FEED_READ) @Post('feed/:id/comments')
  comment(@Param('id', ParseUUIDPipe) id: string, @Body(zod(commentSchema)) b: { comment: string; parentCommentId?: string | null }, @Auth() auth: AuthContext) { return this.feed.comment(id, b.comment, b.parentCommentId ?? null, auth); }

  @RequireModule('NEWS_FEED') @RequirePermission(PERMISSIONS.FEED_MODERATE) @Post('feed/comments/:id/hide') @HttpCode(200)
  hideComment(@Param('id', ParseUUIDPipe) id: string, @Body(zod(z.object({ hide: z.boolean() }))) b: { hide: boolean }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.feed.hideComment(id, b.hide, auth, c); }

  @RequireModule('NEWS_FEED') @RequirePermission(PERMISSIONS.FEED_READ) @Post('feed/reports')
  report(@Body(zod(reportSchema)) b: ReportInput, @Auth() auth: AuthContext) { return this.feed.report(b, auth); }

  @RequireModule('NEWS_FEED') @RequirePermission(PERMISSIONS.FEED_MODERATE) @Get('feed/reports')
  reports(@Auth() auth: AuthContext) { return this.feed.reports(auth); }

  @RequireModule('NEWS_FEED') @RequirePermission(PERMISSIONS.FEED_MODERATE) @Post('feed/reports/:id') @HttpCode(200)
  actReport(@Param('id', ParseUUIDPipe) id: string, @Body(zod(z.object({ action: z.enum(['HIDE', 'DISMISS']) }))) b: { action: 'HIDE' | 'DISMISS' }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.feed.actOnReport(id, b.action, auth, c); }

  @RequireModule('NEWS_FEED') @RequirePermission(PERMISSIONS.FEED_READ) @Get('feed/:id/files/:fileId')
  async media(@Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @Auth() auth: AuthContext, @Res({ passthrough: true }) res: Response) { return stream(res, await this.feed.media(id, fileId, auth)); }

  // ───── Events & calendar ─────
  @RequireModule('EVENTS') @RequirePermission(PERMISSIONS.EVENT_READ) @Get('events')
  eventsList(@Auth() auth: AuthContext) { return this.events.list(auth); }

  @RequireModule('EVENTS') @RequirePermission(PERMISSIONS.EVENT_MANAGE) @Post('events')
  createEvent(@Body(zod(eventSchema)) b: EventInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.events.create(b, auth, c); }

  @RequireModule('EVENTS') @RequirePermission(PERMISSIONS.EVENT_READ) @Get('events/:id')
  event(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.events.get(id, auth); }

  @RequireModule('EVENTS') @RequirePermission(PERMISSIONS.EVENT_MANAGE) @Post('events/:id/status') @HttpCode(200)
  eventStatus(@Param('id', ParseUUIDPipe) id: string, @Body(zod(z.object({ status: z.enum(['PUBLISHED', 'CANCELLED']) }))) b: { status: 'PUBLISHED' | 'CANCELLED' }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.events.setStatus(id, b.status, auth, c); }

  @RequireModule('EVENTS') @RequirePermission(PERMISSIONS.EVENT_MANAGE) @Post('events/:id/students/:studentId') @HttpCode(200)
  officeRespond(@Param('id', ParseUUIDPipe) id: string, @Param('studentId', ParseUUIDPipe) sid: string, @Body(zod(eventResponseSchema)) b: { going: boolean }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.events.respondAsOffice(id, sid, b.going, auth, c); }

  @RequireModule('EVENTS') @RequirePermission(PERMISSIONS.EVENT_MANAGE) @Post('events/:id/attendance') @HttpCode(200)
  attendance(@Param('id', ParseUUIDPipe) id: string, @Body(zod(z.object({ rows: z.array(z.object({ studentId: z.string().uuid(), attended: z.boolean() })).max(5000) }))) b: { rows: { studentId: string; attended: boolean }[] }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.events.markAttendance(id, b.rows, auth, c); }

  @RequireModule('EVENTS') @RequirePermission(PERMISSIONS.EVENT_READ) @Get('calendar')
  calendar(@Query(zod(range)) q: { from: string; to: string }, @Auth() auth: AuthContext) { return this.events.calendar(q.from, q.to, auth); }

  // ───── Parent-teacher meetings ─────
  @RequireModule('MEETINGS') @TenantMember() @Get('ptm')
  ptmList(@Auth() auth: AuthContext) { return this.ptm.list(auth); }

  @RequireModule('MEETINGS') @RequirePermission(PERMISSIONS.PTM_MANAGE) @Post('ptm')
  ptmCreate(@Body(zod(ptmSchema)) b: PtmInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.ptm.create(b, auth, c); }

  @RequireModule('MEETINGS') @TenantMember() @Get('ptm/:id')
  ptmGet(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.ptm.get(id, auth); }

  @RequireModule('MEETINGS') @TenantMember() @Post('ptm/slots/:id') @HttpCode(200)
  ptmBlock(@Param('id', ParseUUIDPipe) id: string, @Body(zod(z.object({ blocked: z.boolean(), room: z.string().trim().max(30).optional().nullable() }))) b: { blocked: boolean; room?: string | null }, @Auth() auth: AuthContext) { return this.ptm.block(id, b.blocked, b.room, auth); }

  @RequireModule('MEETINGS') @TenantMember() @Post('ptm/bookings/:id/outcome') @HttpCode(200)
  ptmOutcome(@Param('id', ParseUUIDPipe) id: string, @Body(zod(ptmOutcomeSchema)) b: { status: 'ATTENDED' | 'NO_SHOW'; notes?: string | null }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.ptm.outcome(id, b.status, b.notes ?? null, auth, c); }
}

/** Engagement in the parent & student app: news, the child's events and calendar, PTM booking. */
@Controller('portal')
export class PortalEngagementController {
  constructor(private readonly db: Db, private readonly feed: FeedService, private readonly events: EventsService, private readonly ptm: PtmService) {}

  private run<T>(auth: AuthContext, child: string | null, fn: Parameters<Db['run']>[1] extends (tx: infer X) => unknown ? (tx: X) => Promise<T> : never) {
    if (child && !(auth.portalStudentIds ?? []).includes(child)) throw NotFound('Student');
    return this.db.run({ tenantId: auth.tenantId, userId: auth.userId }, fn as never) as Promise<T>;
  }

  @PortalUser() @RequireModule('NEWS_FEED') @Get('feed')
  feedList(@Query(zod(z.object({ before: z.string().datetime().optional() }))) q: { before?: string }, @Auth() auth: AuthContext) { return this.feed.list(auth, { before: q.before }); }

  @PortalUser() @RequireModule('NEWS_FEED') @Post('feed/:id/react') @HttpCode(200)
  react(@Param('id', ParseUUIDPipe) id: string, @Body(zod(reactionSchema)) b: { reaction: string | null }, @Auth() auth: AuthContext) { return this.feed.react(id, b.reaction, auth); }

  @PortalUser() @RequireModule('NEWS_FEED') @Get('feed/:id/comments')
  comments(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.feed.comments(id, auth); }

  @PortalUser() @RequireModule('NEWS_FEED') @Post('feed/:id/comments')
  comment(@Param('id', ParseUUIDPipe) id: string, @Body(zod(commentSchema)) b: { comment: string; parentCommentId?: string | null }, @Auth() auth: AuthContext) { return this.feed.comment(id, b.comment, b.parentCommentId ?? null, auth); }

  @PortalUser() @RequireModule('NEWS_FEED') @Post('feed/reports')
  report(@Body(zod(reportSchema)) b: ReportInput, @Auth() auth: AuthContext) { return this.feed.report(b, auth); }

  @PortalUser() @RequireModule('NEWS_FEED') @Get('feed/:id/files/:fileId')
  async media(@Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @Auth() auth: AuthContext, @Res({ passthrough: true }) res: Response) { return stream(res, await this.feed.media(id, fileId, auth)); }

  @PortalUser() @RequireModule('EVENTS') @Get('children/:id/events')
  childEvents(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.run(auth, id, (tx) => this.events.forStudentTx(tx, id)); }

  @PortalUser() @RequireModule('EVENTS') @Post('children/:id/events/:eventId') @HttpCode(200)
  respond(@Param('id', ParseUUIDPipe) id: string, @Param('eventId', ParseUUIDPipe) eventId: string, @Body(zod(eventResponseSchema)) b: { going: boolean }, @Auth() auth: AuthContext) {
    return this.run(auth, id, async (tx) => {
      const [a] = await audiencesOf(tx, [id]);
      if (!a) throw NotFound('Event');
      return this.events.respondTx(tx, eventId, id, b.going, auth.userId, a);
    });
  }

  @PortalUser() @RequireModule('EVENTS') @Get('children/:id/calendar')
  childCalendar(@Param('id', ParseUUIDPipe) id: string, @Query(zod(range)) q: { from: string; to: string }, @Auth() auth: AuthContext) {
    return this.run(auth, id, async (tx) => {
      const [a] = await audiencesOf(tx, [id]);
      return a ? this.events.calendarTx(tx, q.from, q.to, { audience: a }) : [];
    });
  }

  @PortalUser() @RequireModule('MEETINGS') @Get('children/:id/ptm')
  childPtm(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.run(auth, id, (tx) => this.ptm.forStudentTx(tx, id)); }

  @PortalUser() @RequireModule('MEETINGS') @Post('children/:id/ptm/book')
  book(@Param('id', ParseUUIDPipe) id: string, @Body(zod(ptmBookSchema)) b: { slotId: string }, @Auth() auth: AuthContext) { return this.run(auth, id, (tx) => this.ptm.bookTx(tx, id, b.slotId, auth)); }

  @PortalUser() @RequireModule('MEETINGS') @Post('children/:id/ptm/bookings/:bookingId/cancel') @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Param('bookingId', ParseUUIDPipe) bid: string, @Auth() auth: AuthContext) { return this.run(auth, id, (tx) => this.ptm.cancelTx(tx, id, bid)); }

  @PortalUser() @RequireModule('MEETINGS') @Post('children/:id/ptm/bookings/:bookingId/feedback') @HttpCode(200)
  feedback(@Param('id', ParseUUIDPipe) id: string, @Param('bookingId', ParseUUIDPipe) bid: string, @Body(zod(ptmFeedbackSchema)) b: { feedback: string }, @Auth() auth: AuthContext) { return this.run(auth, id, (tx) => this.ptm.feedbackTx(tx, id, bid, b.feedback)); }
}
