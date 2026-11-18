import { Injectable } from '@nestjs/common';
import { PERMISSIONS, PostInput, ReportInput } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, scopeFor } from '../../common/auth-context';
import { Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FilesService, UploadedBlob } from '../files/files.service';
import { Audience, audiencesOf, checkTargets, familyUsers, reaches, studentsReached } from './audience';

type Viewer = { staff: true; moderator: boolean } | { staff: false; audiences: Audience[] };

/**
 * News feed (M11.1). Staff with "post" rights write posts for an audience (everyone, a campus, a
 * class or a section); posts by people who cannot moderate wait for approval when the institution's
 * setting says so. Parents and students see only published posts that reach one of their children.
 * Reactions are one per person; comments have one level of replies and can be hidden by moderators;
 * anyone who can see a post can report it or a comment.
 */
@Injectable()
export class FeedService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly files: FilesService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  private isModerator(auth: AuthContext) {
    return !!scopeFor(auth, PERMISSIONS.FEED_MODERATE);
  }
  private isStaff(auth: AuthContext) {
    return !!(scopeFor(auth, PERMISSIONS.FEED_READ) || scopeFor(auth, PERMISSIONS.FEED_POST) || scopeFor(auth, PERMISSIONS.FEED_MODERATE));
  }

  /** Who is looking: staff see every published post; parents only those reaching their children. */
  private async viewer(tx: Tx, auth: AuthContext): Promise<Viewer> {
    if (this.isStaff(auth)) return { staff: true, moderator: this.isModerator(auth) };
    return { staff: false, audiences: await audiencesOf(tx, auth.portalStudentIds ?? []) };
  }

  private async visiblePost(tx: Tx, postId: string, v: Viewer, auth: AuthContext) {
    const p = await tx.feedPost.findUnique({ where: { id: postId }, include: { targets: true } });
    if (!p) throw NotFound('Post');
    if (v.staff) {
      if (p.status === 'PUBLISHED' || v.moderator || p.authorUserId === auth.userId) return p;
      throw NotFound('Post');
    }
    if (p.status !== 'PUBLISHED' || !v.audiences.some((a) => reaches(p.targets, a))) throw NotFound('Post');
    return p;
  }

  async uploadMedia(blob: UploadedBlob | undefined, auth: AuthContext, client: ClientInfo) {
    if (!scopeFor(auth, PERMISSIONS.FEED_POST) && !this.isModerator(auth)) throw Forbidden('cannot-post', 'You cannot post to the news feed');
    return this.files.store({ entityType: 'GENERAL', docType: 'OTHER' }, blob, auth, client);
  }

  create(input: PostInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      if (!scopeFor(auth, PERMISSIONS.FEED_POST) && !this.isModerator(auth)) throw Forbidden('cannot-post', 'You cannot post to the news feed');
      const campuses = await checkTargets(tx, input.targets);
      if (input.fileIds.length) {
        const own = await tx.fileObject.count({ where: { id: { in: input.fileIds }, createdBy: auth.userId, status: 'ACTIVE' } });
        if (own !== input.fileIds.length) throw NotFound('File');
      }
      if (input.eventId && !(await tx.event.findUnique({ where: { id: input.eventId }, select: { id: true } }))) throw NotFound('Event');
      const firstCampus = campuses.find((c): c is string => !!c);
      const needsApproval = !this.isModerator(auth) && (await this.settings.effective<'ON' | 'OFF'>(tx, 'feed.teacher_posts_need_approval', firstCampus)) === 'ON';
      const p = await tx.feedPost.create({
        data: {
          tenantId: auth.tenantId!, authorUserId: auth.userId, postType: input.postType, title: input.title ?? null, body: input.body, fileIds: input.fileIds, eventId: input.eventId ?? null, allowComments: input.allowComments,
          status: needsApproval ? 'PENDING_APPROVAL' : 'PUBLISHED', publishedAt: needsApproval ? null : new Date(), approvedBy: needsApproval ? null : auth.userId,
        },
      });
      await tx.feedPostTarget.createMany({ data: input.targets.map((t) => ({ tenantId: auth.tenantId!, postId: p.id, targetType: t.targetType, targetId: t.targetId ?? null })) });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'CREATE', entityType: 'FEED_POST', entityId: p.id, newValues: { ...input, body: `${input.body.length} characters` } }, client);
      if (!needsApproval) await this.announce(tx, p.id);
      return { id: p.id, status: p.status };
    });
  }

  /** Circulars are announced to the families they reach (in-app). */
  private async announce(tx: Tx, postId: string) {
    const p = await tx.feedPost.findUniqueOrThrow({ where: { id: postId }, include: { targets: true } });
    if (p.postType !== 'CIRCULAR') return;
    const users = await familyUsers(tx, (await studentsReached(tx, p.targets)).map((a) => a.studentId));
    if (users.length) await this.notifications.notify(tx, { tenantId: p.tenantId, userIds: users, eventCode: 'FEED_POST', vars: { title: p.title ?? p.body.slice(0, 80) }, entityType: 'FEED_POST', entityId: p.id });
  }

  /** Approve, reject, hide or show again, pin or unpin. */
  moderate(postId: string, action: 'APPROVE' | 'REJECT' | 'HIDE' | 'SHOW' | 'PIN' | 'UNPIN', auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      if (!this.isModerator(auth)) throw Forbidden('cannot-moderate', 'You cannot moderate the news feed');
      const p = await tx.feedPost.findUnique({ where: { id: postId } });
      if (!p) throw NotFound('Post');
      const data =
        action === 'APPROVE' ? (p.status === 'PENDING_APPROVAL' ? { status: 'PUBLISHED', publishedAt: new Date(), approvedBy: auth.userId } : null)
        : action === 'REJECT' ? (p.status === 'PENDING_APPROVAL' ? { status: 'REJECTED' } : null)
        : action === 'HIDE' ? (p.status === 'PUBLISHED' ? { status: 'HIDDEN' } : null)
        : action === 'SHOW' ? (p.status === 'HIDDEN' ? { status: 'PUBLISHED' } : null)
        : { isPinned: action === 'PIN' };
      if (!data) throw Conflict('post-state', 'The post is not in a state for that');
      await tx.feedPost.update({ where: { id: postId }, data });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'STATUS_CHANGE', entityType: 'FEED_POST', entityId: postId, oldValues: { status: p.status, isPinned: p.isPinned }, newValues: { action } }, client);
      if (action === 'APPROVE') await this.announce(tx, postId);
      return { id: postId, ...data };
    });
  }

  /** The feed for this viewer: pinned first, then newest; with counts, my reaction and the first comments. */
  list(auth: AuthContext, opts: { pending?: boolean; limit?: number; before?: string } = {}) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const v = await this.viewer(tx, auth);
      const where = v.staff && opts.pending ? { status: 'PENDING_APPROVAL', ...(v.moderator ? {} : { authorUserId: auth.userId }) }
        : v.staff && v.moderator ? { status: { in: ['PUBLISHED', 'HIDDEN'] } } : { status: 'PUBLISHED' };
      const rows = await tx.feedPost.findMany({
        where: { ...where, ...(opts.before ? { createdAt: { lt: new Date(opts.before) } } : {}) },
        orderBy: [{ isPinned: 'desc' }, { publishedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
        take: Math.min(opts.limit ?? 30, 60) * (v.staff ? 1 : 3),
        include: { targets: true, _count: { select: { reactions: true } } },
      });
      const visible = (v.staff ? rows : rows.filter((p) => v.audiences.some((a) => reaches(p.targets, a)))).slice(0, opts.limit ?? 30);
      return this.decorate(tx, visible, auth, v);
    });
  }

  private async decorate(tx: Tx, posts: { id: string; authorUserId: string; postType: string; title: string | null; body: string; fileIds: string[]; allowComments: boolean; isPinned: boolean; status: string; publishedAt: Date | null; createdAt: Date; eventId: string | null; targets: { targetType: string; targetId: string | null }[]; _count: { reactions: number } }[], auth: AuthContext, v: Viewer) {
    const ids = posts.map((p) => p.id);
    const mine = new Map((await tx.feedReaction.findMany({ where: { postId: { in: ids }, userId: auth.userId }, select: { postId: true, reaction: true } })).map((r) => [r.postId, r.reaction]));
    const reactions = await tx.feedReaction.groupBy({ by: ['postId', 'reaction'], where: { postId: { in: ids } }, _count: true });
    const commentWhere = v.staff && v.moderator ? {} : { status: 'VISIBLE' };
    const comments = await tx.feedComment.groupBy({ by: ['postId'], where: { postId: { in: ids }, ...commentWhere }, _count: true });
    const authors = new Map((await tx.user.findMany({ where: { id: { in: posts.map((p) => p.authorUserId) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    const files = new Map((await tx.fileObject.findMany({ where: { id: { in: posts.flatMap((p) => p.fileIds) } }, select: { id: true, fileName: true, mimeType: true } })).map((f) => [f.id, f]));
    const names = await this.targetNames(tx, posts.flatMap((p) => p.targets));
    return posts.map((p) => ({
      id: p.id, postType: p.postType, title: p.title, body: p.body, allowComments: p.allowComments, isPinned: p.isPinned, status: p.status, publishedAt: p.publishedAt, createdAt: p.createdAt, eventId: p.eventId,
      author: authors.get(p.authorUserId) ?? '', mine: p.authorUserId === auth.userId,
      media: p.fileIds.map((id) => files.get(id)).filter(Boolean).map((f) => ({ id: f!.id, name: f!.fileName, kind: f!.mimeType === 'application/pdf' ? 'PDF' : 'IMAGE' })),
      audience: p.targets.map((t) => (t.targetType === 'ALL' ? 'ALL' : names.get(t.targetId!) ?? '')),
      reactions: Object.fromEntries(reactions.filter((r) => r.postId === p.id).map((r) => [r.reaction, r._count])), reactionTotal: p._count.reactions, myReaction: mine.get(p.id) ?? null,
      comments: comments.find((c) => c.postId === p.id)?._count ?? 0,
    }));
  }

  private async targetNames(tx: Tx, targets: { targetType: string; targetId: string | null }[]) {
    const m = new Map<string, string>();
    const ids = (k: string) => targets.filter((t) => t.targetType === k).map((t) => t.targetId!);
    for (const c of await tx.campus.findMany({ where: { id: { in: ids('CAMPUS') } }, select: { id: true, name: true } })) m.set(c.id, c.name);
    for (const l of await tx.programLevel.findMany({ where: { id: { in: ids('LEVEL') } }, select: { id: true, name: true } })) m.set(l.id, l.name);
    for (const s of await tx.section.findMany({ where: { id: { in: ids('SECTION') } }, select: { id: true, name: true, level: { select: { name: true } } } })) m.set(s.id, `${s.level.name} – ${s.name}`);
    return m;
  }

  react(postId: string, reaction: string | null, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const p = await this.visiblePost(tx, postId, await this.viewer(tx, auth), auth);
      if (p.status !== 'PUBLISHED') throw Conflict('post-state', 'Only published posts take reactions');
      if (!reaction) await tx.$executeRaw`DELETE FROM feed_reactions WHERE post_id = ${postId}::uuid AND user_id = ${auth.userId}::uuid`;
      else await tx.feedReaction.upsert({ where: { tenantId_postId_userId: { tenantId: auth.tenantId!, postId, userId: auth.userId } }, update: { reaction }, create: { tenantId: auth.tenantId!, postId, userId: auth.userId, reaction } });
      const total = await tx.feedReaction.count({ where: { postId } });
      return { myReaction: reaction, reactionTotal: total };
    });
  }

  comments(postId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const v = await this.viewer(tx, auth);
      await this.visiblePost(tx, postId, v, auth);
      const rows = await tx.feedComment.findMany({ where: { postId, ...(v.staff && v.moderator ? {} : { OR: [{ status: 'VISIBLE' }, { userId: auth.userId }] }) }, orderBy: { createdAt: 'asc' }, take: 300 });
      const users = new Map((await tx.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
      return rows.map((c) => ({ id: c.id, parentCommentId: c.parentCommentId, comment: c.comment, status: c.status, createdAt: c.createdAt, author: users.get(c.userId) ?? '', mine: c.userId === auth.userId }));
    });
  }

  comment(postId: string, text: string, parentCommentId: string | null, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const p = await this.visiblePost(tx, postId, await this.viewer(tx, auth), auth);
      if (p.status !== 'PUBLISHED' || !p.allowComments) throw Conflict('comments-off', 'Comments are closed on this post');
      if (parentCommentId) {
        const parent = await tx.feedComment.findUnique({ where: { id: parentCommentId } });
        if (!parent || parent.postId !== postId) throw NotFound('Comment');
        if (parent.parentCommentId) parentCommentId = parent.parentCommentId; // one level of replies
      }
      const c = await tx.feedComment.create({ data: { tenantId: auth.tenantId!, postId, userId: auth.userId, comment: text, parentCommentId } });
      return { id: c.id, status: c.status };
    });
  }

  hideComment(commentId: string, hide: boolean, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      if (!this.isModerator(auth)) throw Forbidden('cannot-moderate', 'You cannot moderate the news feed');
      const c = await tx.feedComment.findUnique({ where: { id: commentId } });
      if (!c) throw NotFound('Comment');
      await tx.feedComment.update({ where: { id: commentId }, data: { status: hide ? 'HIDDEN' : 'VISIBLE', moderatedBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'STATUS_CHANGE', entityType: 'FEED_COMMENT', entityId: commentId, oldValues: { status: c.status }, newValues: { status: hide ? 'HIDDEN' : 'VISIBLE' } }, client);
      return { id: commentId, status: hide ? 'HIDDEN' : 'VISIBLE' };
    });
  }

  report(input: ReportInput, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const v = await this.viewer(tx, auth);
      let postId = input.postId ?? null;
      if (input.commentId) {
        const c = await tx.feedComment.findUnique({ where: { id: input.commentId } });
        if (!c) throw NotFound('Comment');
        postId = c.postId;
      }
      await this.visiblePost(tx, postId!, v, auth);
      const dup = await tx.feedReport.findFirst({ where: { reportedBy: auth.userId, status: 'OPEN', ...(input.commentId ? { commentId: input.commentId } : { postId: input.postId, commentId: null }) } });
      if (dup) return { id: dup.id, status: dup.status };
      const r = await tx.feedReport.create({ data: { tenantId: auth.tenantId!, postId: input.commentId ? null : input.postId!, commentId: input.commentId ?? null, reportedBy: auth.userId, reason: input.reason, details: input.details ?? null } });
      return { id: r.id, status: r.status };
    });
  }

  reports(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      if (!this.isModerator(auth)) throw Forbidden('cannot-moderate', 'You cannot moderate the news feed');
      const rows = await tx.feedReport.findMany({ where: { status: 'OPEN' }, orderBy: { createdAt: 'asc' }, take: 200 });
      const comments = new Map((await tx.feedComment.findMany({ where: { id: { in: rows.map((r) => r.commentId).filter((x): x is string => !!x) } } })).map((c) => [c.id, c]));
      const posts = new Map((await tx.feedPost.findMany({ where: { id: { in: [...rows.map((r) => r.postId), ...[...comments.values()].map((c) => c.postId)].filter((x): x is string => !!x) } }, select: { id: true, title: true, body: true, status: true } })).map((p) => [p.id, p]));
      const users = new Map((await tx.user.findMany({ where: { id: { in: rows.map((r) => r.reportedBy) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
      return rows.map((r) => {
        const c = r.commentId ? comments.get(r.commentId) : null;
        const p = posts.get(r.postId ?? c?.postId ?? '');
        return { id: r.id, reason: r.reason, details: r.details, createdAt: r.createdAt, reportedBy: users.get(r.reportedBy) ?? '', kind: c ? 'COMMENT' : 'POST', postId: p?.id ?? null, text: c ? c.comment : `${p?.title ?? ''} ${p?.body ?? ''}`.trim().slice(0, 300), hidden: c ? c.status === 'HIDDEN' : p?.status === 'HIDDEN' };
      });
    });
  }

  /** Hide what was reported (and close the report) or dismiss it. */
  actOnReport(id: string, action: 'HIDE' | 'DISMISS', auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      if (!this.isModerator(auth)) throw Forbidden('cannot-moderate', 'You cannot moderate the news feed');
      const r = await tx.feedReport.findUnique({ where: { id } });
      if (!r || r.status !== 'OPEN') throw NotFound('Report');
      if (action === 'HIDE') {
        if (r.commentId) await tx.feedComment.update({ where: { id: r.commentId }, data: { status: 'HIDDEN', moderatedBy: auth.userId } });
        else await tx.feedPost.update({ where: { id: r.postId! }, data: { status: 'HIDDEN' } });
      }
      // Other open reports of the same item are closed with it.
      await tx.feedReport.updateMany({ where: { status: 'OPEN', ...(r.commentId ? { commentId: r.commentId } : { postId: r.postId, commentId: null }) }, data: { status: action === 'HIDE' ? 'ACTION_TAKEN' : 'DISMISSED', reviewedBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'STATUS_CHANGE', entityType: 'FEED_REPORT', entityId: id, newValues: { action } }, client);
      return { id, status: action === 'HIDE' ? 'ACTION_TAKEN' : 'DISMISSED' };
    });
  }

  /** A post's photo or PDF, for anyone who can see the post. */
  async media(postId: string, fileId: string, auth: AuthContext) {
    await this.db.run(this.ctx(auth), async (tx) => {
      const p = await this.visiblePost(tx, postId, await this.viewer(tx, auth), auth);
      if (!p.fileIds.includes(fileId)) throw NotFound('File');
    });
    return this.files.openChecked(fileId, auth);
  }
}
