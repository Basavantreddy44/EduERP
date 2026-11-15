import { Injectable } from '@nestjs/common';
import { Prisma } from '@eduerp/db';
import { APPROVAL_ENTITY_LABELS, ApprovalActionInput, ApprovalEntityType, CreateApprovalRuleInput, PERMISSIONS } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { EVENTS, OutboxService } from '../../common/outbox.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';

export interface SubmitApproval {
  tenantId: string;
  requestedBy: string;
  entityType: ApprovalEntityType;
  entityId: string;
  campusId?: string | null;
  amount?: number | null;
  summary?: string | null;
}

export type Step = { levelNo: number; roleId: string };
export type CompletionHook = (tx: Tx, d: { tenantId: string; requestId: string; entityType: string; entityId: string; decision: 'APPROVED' | 'REJECTED' | 'CANCELLED'; remarks: string | null; userId: string }) => Promise<void>;

type RuleRow = { campusId: string | null; minAmount: Prisma.Decimal | null; levelNo: number; approverRoleId: string };

/**
 * Picks the route for a request (pure, unit-testable):
 *  - campus rules replace institution rules when the campus has any rule for this entity type;
 *  - a rule applies when it has no minimum or amount ≥ minimum;
 *  - per level, the applicable rule with the highest minimum wins;
 *  - levels are renumbered 1..n in ascending configured order.
 */
export function resolveRoute(rules: RuleRow[], campusId: string | null, amount: number | null): Step[] {
  const campusRules = campusId ? rules.filter((r) => r.campusId === campusId) : [];
  const pool = campusRules.length ? campusRules : rules.filter((r) => r.campusId === null);
  const applicable = pool.filter((r) => r.minAmount === null || (amount !== null && amount >= Number(r.minAmount)));
  const byLevel = new Map<number, RuleRow>();
  for (const r of applicable) {
    const cur = byLevel.get(r.levelNo);
    if (!cur || Number(r.minAmount ?? -1) > Number(cur.minAmount ?? -1)) byLevel.set(r.levelNo, r);
  }
  return [...byLevel.entries()].sort((a, b) => a[0] - b[0]).map(([, r], i) => ({ levelNo: i + 1, roleId: r.approverRoleId }));
}

/** SQL condition: the given user holds the role of the request's current step, with campus scope covering the request. */
const IS_CURRENT_APPROVER = (alias: string, userId: string) => Prisma.sql`EXISTS (
  SELECT 1 FROM user_roles ur
   WHERE ur.user_id = ${userId}::uuid
     AND ur.role_id::text = ${Prisma.raw(alias)}.steps -> (${Prisma.raw(alias)}.current_level - 1) ->> 'roleId'
     AND (ur.campus_id IS NULL OR ur.campus_id = ${Prisma.raw(alias)}.campus_id))`;

/**
 * Approvals engine (G-04). Business modules call `submit` inside their own transaction; approvers act
 * through the API. The requester can never act on their own request (checked here and by a DB trigger).
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  // ───────────── Rules ─────────────

  listRules(auth: AuthContext) {
    return this.db.run(this.ctx(auth), (tx) =>
      tx.approvalRule.findMany({
        where: { isActive: true },
        orderBy: [{ entityType: 'asc' }, { campusId: 'asc' }, { levelNo: 'asc' }],
        include: { approverRole: { select: { code: true, name: true } } },
      }),
    );
  }

  async createRule(input: CreateApprovalRuleInput, auth: AuthContext, client: ClientInfo) {
    const scope = scopeFor(auth, PERMISSIONS.APPROVALS_RULE_MANAGE)!;
    const campusId = input.campusId ?? null;
    if (campusId ? !canAccessCampus(scope, campusId) : !scope.all) {
      if (campusId) throw NotFound('Campus');
      throw Forbidden('scope-insufficient', 'Only institution-wide users can set institution-wide rules');
    }
    return this.db.run(this.ctx(auth), async (tx) => {
      const tenantId = auth.tenantId!;
      if (!(await tx.role.findUnique({ where: { id: input.approverRoleId }, select: { id: true } }))) throw NotFound('Role');
      if (campusId && !(await tx.campus.findUnique({ where: { id: campusId }, select: { id: true } }))) throw NotFound('Campus');
      const minAmount = input.minAmount ?? null;
      const dup = await tx.approvalRule.findFirst({ where: { entityType: input.entityType, campusId, levelNo: input.levelNo, minAmount, isActive: true }, select: { id: true } });
      if (dup) throw Conflict('approval-rule-exists', 'An identical rule already exists');
      const rule = await tx.approvalRule.create({
        data: { tenantId, campusId, entityType: input.entityType, minAmount, levelNo: input.levelNo, approverRoleId: input.approverRoleId, createdBy: auth.userId },
      });
      await this.audit.log(tx, { tenantId, userId: auth.userId, campusId, action: 'CREATE', entityType: 'APPROVAL_RULE', entityId: rule.id, newValues: rule }, client);
      return rule;
    });
  }

  async deactivateRule(id: string, auth: AuthContext, client: ClientInfo) {
    const scope = scopeFor(auth, PERMISSIONS.APPROVALS_RULE_MANAGE)!;
    return this.db.run(this.ctx(auth), async (tx) => {
      const rule = await tx.approvalRule.findUnique({ where: { id } });
      if (!rule || (rule.campusId ? !canAccessCampus(scope, rule.campusId) : !scope.all)) throw NotFound('Approval rule');
      if (!rule.isActive) return rule;
      const updated = await tx.approvalRule.update({ where: { id }, data: { isActive: false, updatedBy: auth.userId } });
      await this.audit.log(tx, { tenantId: rule.tenantId, userId: auth.userId, campusId: rule.campusId, action: 'STATUS_CHANGE', entityType: 'APPROVAL_RULE', entityId: id, oldValues: { isActive: true }, newValues: { isActive: false } }, client);
      return updated;
    });
  }

  /**
   * Business modules react to a final decision inside the same transaction (e.g. a concession becomes
   * APPROVED at the moment the last approver approves), so the record never lags behind the request.
   */
  private readonly hooks = new Map<string, CompletionHook>();
  onComplete(entityType: ApprovalEntityType, hook: CompletionHook) {
    this.hooks.set(entityType, hook);
  }
  private async completed(tx: Tx, d: { tenantId: string; requestId: string; entityType: string; entityId: string; decision: 'APPROVED' | 'REJECTED' | 'CANCELLED'; remarks: string | null; userId: string }) {
    await this.hooks.get(d.entityType)?.(tx, d);
  }

  // ───────────── Requests ─────────────

  /**
   * Starts an approval inside the caller's transaction. Returns null when no rule applies
   * (the caller proceeds without approval). One open request per business record.
   */
  async submit(tx: Tx, req: SubmitApproval, client?: ClientInfo) {
    const rules = await tx.approvalRule.findMany({
      where: { entityType: req.entityType, isActive: true, OR: [{ campusId: null }, ...(req.campusId ? [{ campusId: req.campusId }] : [])] },
      select: { campusId: true, minAmount: true, levelNo: true, approverRoleId: true },
    });
    const steps = resolveRoute(rules, req.campusId ?? null, req.amount ?? null);
    if (!steps.length) return null;

    const open = await tx.approvalRequest.findFirst({ where: { entityType: req.entityType, entityId: req.entityId, status: 'PENDING' }, select: { id: true } });
    if (open) throw Conflict('approval-already-open', 'This record already has an approval in progress');

    const request = await tx.approvalRequest.create({
      data: {
        tenantId: req.tenantId,
        campusId: req.campusId ?? null,
        entityType: req.entityType,
        entityId: req.entityId,
        amount: req.amount ?? null,
        summary: req.summary?.slice(0, 300) ?? null,
        requestedBy: req.requestedBy,
        totalLevels: steps.length,
        steps: steps as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.log(tx, { tenantId: req.tenantId, userId: req.requestedBy, campusId: request.campusId, action: 'SUBMIT', entityType: 'APPROVAL_REQUEST', entityId: request.id, newValues: { entityType: req.entityType, entityId: req.entityId, amount: req.amount ?? null, steps } }, client);
    await this.pendingEvent(tx, request.tenantId, request.id, 1);
    return request;
  }

  private pendingEvent(tx: Tx, tenantId: string, requestId: string, levelNo: number) {
    return this.outbox.add(tx, { tenantId, eventType: EVENTS.APPROVAL_PENDING, aggregateType: 'APPROVAL_REQUEST', aggregateId: requestId, payload: { requestId, levelNo }, dedupeKey: `approval:${requestId}:pending:${levelNo}` });
  }

  /** Requests waiting for the current user's decision. */
  inbox(auth: AuthContext) {
    return this.db.run(this.ctx(auth), (tx) =>
      tx.$queryRaw<unknown[]>`
        SELECT r.id, r.entity_type AS "entityType", r.entity_id AS "entityId", r.campus_id AS "campusId", r.amount::float8 AS amount,
               r.summary, r.requested_by AS "requestedBy", u.full_name AS "requesterName", r.current_level AS "currentLevel",
               r.total_levels AS "totalLevels", r.created_at AS "createdAt"
          FROM approval_requests r
          JOIN users u ON u.id = r.requested_by
         WHERE r.status = 'PENDING' AND r.requested_by <> ${auth.userId}::uuid AND ${IS_CURRENT_APPROVER('r', auth.userId)}
         ORDER BY r.created_at`,
    );
  }

  /** All requests (admin view), filtered by campus scope. */
  list(auth: AuthContext, status?: string, entityType?: string) {
    const scope = scopeFor(auth, PERMISSIONS.APPROVALS_REQUEST_READ)!;
    return this.db.run(this.ctx(auth), (tx) =>
      tx.approvalRequest.findMany({
        where: { ...(status ? { status } : {}), ...(entityType ? { entityType } : {}), ...(scope.all ? {} : { campusId: { in: scope.campusIds } }) },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
  }

  /** Visible to the requester, anyone on the route, and holders of approvals.request.read. */
  async get(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await tx.approvalRequest.findUnique({ where: { id }, include: { actions: { orderBy: { levelNo: 'asc' } } } });
      if (!r) throw NotFound('Approval request');
      const read = scopeFor(auth, PERMISSIONS.APPROVALS_REQUEST_READ);
      const canRead = read && (r.campusId ? canAccessCampus(read, r.campusId) : read.all);
      const steps = r.steps as unknown as Step[];
      const myRoles = canRead || r.requestedBy === auth.userId ? [] : await tx.userRole.findMany({ where: { userId: auth.userId }, select: { roleId: true, campusId: true } });
      const onRoute = myRoles.some((m) => steps.some((s) => s.roleId === m.roleId) && (m.campusId === null || m.campusId === r.campusId));
      if (!canRead && r.requestedBy !== auth.userId && !onRoute) throw NotFound('Approval request');
      return { ...r, amount: r.amount === null ? null : Number(r.amount) };
    });
  }

  async act(id: string, input: ApprovalActionInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      // Lock the request so two approvers cannot decide the same level at once.
      const locked = await tx.$queryRaw<{ id: string; status: string; requested_by: string; current_level: number; total_levels: number; campus_id: string | null; tenant_id: string; approver: boolean }[]>`
        SELECT r.id, r.status, r.requested_by, r.current_level, r.total_levels, r.campus_id, r.tenant_id, ${IS_CURRENT_APPROVER('r', auth.userId)} AS approver
          FROM approval_requests r WHERE r.id = ${id}::uuid FOR UPDATE`;
      const r = locked[0];
      if (!r) throw NotFound('Approval request');
      if (r.status !== 'PENDING') throw Conflict('approval-closed', `This request is already ${r.status.toLowerCase()}`);
      if (r.requested_by === auth.userId) throw Forbidden('sod-violation', 'You cannot approve or reject your own request');
      if (!r.approver) throw Forbidden('not-approver', 'This request is not waiting for your decision');

      await tx.approvalAction.create({ data: { tenantId: r.tenant_id, approvalRequestId: id, levelNo: r.current_level, actionBy: auth.userId, action: input.action, remarks: input.remarks ?? null } });

      const last = r.current_level >= r.total_levels;
      const status = input.action === 'REJECT' ? 'REJECTED' : last ? 'APPROVED' : 'PENDING';
      const updated = await tx.approvalRequest.update({
        where: { id },
        data: status === 'PENDING' ? { currentLevel: r.current_level + 1 } : { status, completedAt: new Date() },
      });
      await this.audit.log(tx, { tenantId: r.tenant_id, userId: auth.userId, campusId: r.campus_id, action: input.action === 'APPROVE' ? 'APPROVE' : 'REJECT', entityType: 'APPROVAL_REQUEST', entityId: id, oldValues: { status: 'PENDING', level: r.current_level }, newValues: { status, level: updated.currentLevel }, reason: input.remarks ?? null }, client);

      if (status === 'PENDING') await this.pendingEvent(tx, r.tenant_id, id, updated.currentLevel);
      else {
        await this.completed(tx, { tenantId: r.tenant_id, requestId: id, entityType: updated.entityType, entityId: updated.entityId, decision: status as 'APPROVED' | 'REJECTED', remarks: input.remarks ?? null, userId: auth.userId });
        await this.outbox.add(tx, {
          tenantId: r.tenant_id,
          eventType: EVENTS.APPROVAL_COMPLETED,
          aggregateType: 'APPROVAL_REQUEST',
          aggregateId: id,
          payload: { requestId: id, entityType: updated.entityType, entityId: updated.entityId, decision: status, remarks: input.remarks ?? null },
          dedupeKey: `approval:${id}:completed`,
        });
      }
      return { ...updated, amount: updated.amount === null ? null : Number(updated.amount) };
    });
  }

  async cancel(id: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await tx.approvalRequest.findUnique({ where: { id } });
      if (!r || r.requestedBy !== auth.userId) throw NotFound('Approval request');
      if (r.status !== 'PENDING') throw Conflict('approval-closed', `This request is already ${r.status.toLowerCase()}`);
      const updated = await tx.approvalRequest.update({ where: { id }, data: { status: 'CANCELLED', completedAt: new Date() } });
      await this.audit.log(tx, { tenantId: r.tenantId, userId: auth.userId, campusId: r.campusId, action: 'STATUS_CHANGE', entityType: 'APPROVAL_REQUEST', entityId: id, oldValues: { status: 'PENDING' }, newValues: { status: 'CANCELLED' } }, client);
      await this.completed(tx, { tenantId: r.tenantId, requestId: id, entityType: r.entityType, entityId: r.entityId, decision: 'CANCELLED', remarks: null, userId: auth.userId });
      await this.outbox.add(tx, { tenantId: r.tenantId, eventType: EVENTS.APPROVAL_COMPLETED, aggregateType: 'APPROVAL_REQUEST', aggregateId: id, payload: { requestId: id, entityType: r.entityType, entityId: r.entityId, decision: 'CANCELLED', remarks: null }, dedupeKey: `approval:${id}:completed` });
      return { ...updated, amount: updated.amount === null ? null : Number(updated.amount) };
    });
  }

  /** For the notifier: active members who can act on the given level. */
  async approversFor(tx: Tx, requestId: string, levelNo: number): Promise<string[]> {
    const r = await tx.approvalRequest.findUnique({ where: { id: requestId }, select: { steps: true, campusId: true, requestedBy: true } });
    if (!r) return [];
    const step = (r.steps as unknown as Step[]).find((s) => s.levelNo === levelNo);
    if (!step) return [];
    const holders = await tx.userRole.findMany({
      where: { roleId: step.roleId, OR: [{ campusId: null }, ...(r.campusId ? [{ campusId: r.campusId }] : [])], userId: { not: r.requestedBy } },
      select: { userId: true },
    });
    const active = await tx.userTenant.findMany({ where: { userId: { in: holders.map((h) => h.userId) }, status: 'ACTIVE' }, select: { userId: true } });
    return [...new Set(active.map((a) => a.userId))];
  }
}

export const entityLabel = (t: string) => APPROVAL_ENTITY_LABELS[t as ApprovalEntityType] ?? t;
