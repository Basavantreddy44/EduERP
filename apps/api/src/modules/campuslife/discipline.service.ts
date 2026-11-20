import { Injectable, OnModuleInit } from '@nestjs/common';
import { ActionInput, CounsellingInput, IncidentInput, IncidentTypeInput, PERMISSIONS, STARTER_INCIDENT_TYPES, fromPaise, toPaise } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { decryptField, encryptField } from '../../common/field-crypto';
import { ApprovalsService } from '../approvals/approvals.service';
import { FeeBillingService } from '../fees/billing.service';
import { NotificationsService } from '../notifications/notifications.service';
import { dec, unprocessable } from '../accounts/books';
import { day, fullName, iso, prettyDate, scopeCampuses, searchPeople, tellParents, todayIST } from './common';

const MANAGE = PERMISSIONS.DISC_MANAGE;
const REPORT = PERMISSIONS.DISC_REPORT;
const CLASS = PERMISSIONS.DISC_CLASS;
const COUNSEL = PERMISSIONS.COUNSEL;
const ACTION_TEXT: Record<string, string> = { WARNING: 'warning', PARENT_MEETING: 'parent meeting', SUSPENSION: 'suspension', FINE: 'fine', COUNSELLING: 'counselling', OTHER: 'action' };

/**
 * Discipline & counselling (M16.4). Any teacher with the report right records an incident; managers
 * review, take action and close it; class teachers read their own class's incidents. Parents are told
 * for incident types that say so. A fine is billed to fees (after approval where a rule exists).
 * Counselling notes are stored encrypted and only the counsellor who wrote them can read them.
 */
@Injectable()
export class DisciplineService implements OnModuleInit {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly approvals: ApprovalsService, private readonly billing: FeeBillingService, private readonly notifications: NotificationsService) {}

  onModuleInit() {
    this.approvals.onComplete('DISCIPLINE_FINE', (tx, d) => this.fineDecided(tx, d));
  }

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  private can(auth: AuthContext, perm: string, campusId: string) {
    const s = scopeFor(auth, perm as typeof MANAGE);
    return !!s && canAccessCampus(s, campusId);
  }

  private async ensureTypes(tx: Tx, tenantId: string) {
    if (await tx.disciplineIncidentType.count()) return;
    await tx.disciplineIncidentType.createMany({ data: STARTER_INCIDENT_TYPES.map((t) => ({ tenantId, ...t })), skipDuplicates: true });
  }

  types(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await this.ensureTypes(tx, auth.tenantId!);
      const rows = await tx.disciplineIncidentType.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
      return rows.map((t) => ({ id: t.id, name: t.name, severity: t.severity, notifyParent: t.notifyParent, isActive: t.isActive }));
    });
  }

  saveType(id: string | null, input: IncidentTypeInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const old = id ? await tx.disciplineIncidentType.findUnique({ where: { id } }) : null;
      if (id && !old) throw NotFound('Incident type');
      if (await tx.disciplineIncidentType.findFirst({ where: { name: { equals: input.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) }, select: { id: true } })) throw Conflict('duplicate-name', `${input.name} already exists`);
      const row = old ? await tx.disciplineIncidentType.update({ where: { id: old.id }, data: input }) : await tx.disciplineIncidentType.create({ data: { ...input, tenantId: auth.tenantId! } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: old ? 'UPDATE' : 'CREATE', entityType: 'DISCIPLINE_TYPE', entityId: row.id, oldValues: old ?? undefined, newValues: input }, client);
      return { id: row.id };
    });
  }

  students(q: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), (tx) => searchPeople(tx, q, scopeCampuses(scopeFor(auth, REPORT) ?? scopeFor(auth, MANAGE) ?? scopeFor(auth, COUNSEL)), ['STUDENT']));
  }

  /** Students whose class teacher the user is (current enrolments). */
  private async myClassStudents(tx: Tx, auth: AuthContext) {
    if (!scopeFor(auth, CLASS)) return new Set<string>();
    const me = await tx.employee.findFirst({ where: { userId: auth.userId }, select: { id: true } });
    if (!me) return new Set<string>();
    const rows = await tx.studentEnrollment.findMany({ where: { status: 'ACTIVE', section: { classTeacherId: me.id } }, select: { studentId: true } });
    return new Set(rows.map((r) => r.studentId));
  }

  private async canSee(tx: Tx, auth: AuthContext, i: { campusId: string; studentId: string; reportedBy: string }) {
    if (this.can(auth, MANAGE, i.campusId) || i.reportedBy === auth.userId) return true;
    return (await this.myClassStudents(tx, auth)).has(i.studentId);
  }

  report(input: IncidentInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.student.findUnique({ where: { id: input.studentId }, select: { id: true, firstName: true, lastName: true, admissionNo: true, campusId: true, status: true } });
      if (!s || !(this.can(auth, REPORT, s.campusId) || this.can(auth, MANAGE, s.campusId))) throw NotFound('Student');
      const type = await tx.disciplineIncidentType.findUnique({ where: { id: input.typeId } });
      if (!type || !type.isActive) throw NotFound('Incident type');
      const at = new Date(input.incidentAt);
      if (at.getTime() > Date.now() + 5 * 60_000) throw unprocessable('future', 'The incident time is in the future', 'incidentAt');
      const i = await tx.disciplineIncident.create({ data: { tenantId: auth.tenantId!, campusId: s.campusId, studentId: s.id, typeId: type.id, incidentAt: at, location: input.location, description: input.description, witnesses: input.witnesses, reportedBy: auth.userId } });
      let told = false;
      if (type.notifyParent) {
        const name = fullName(s);
        const date = prettyDate(at.toISOString().slice(0, 10));
        told = await tellParents(tx, this.notifications, {
          tenantId: auth.tenantId!, senderUserId: auth.userId, studentId: s.id, eventCode: 'DISCIPLINE_INCIDENT', entityType: 'DISCIPLINE_INCIDENT', entityId: i.id,
          vars: { student: name, type: type.name, date },
          emailSubject: `Behaviour note about ${name}`, emailBody: `Dear parent,\n\nAn incident (${type.name}) involving ${name} was recorded on ${date}.\n\nThe class teacher will be in touch. You are welcome to contact the school.`,
        });
        if (told) await tx.disciplineIncident.update({ where: { id: i.id }, data: { parentNotified: true } });
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: s.campusId, action: 'CREATE', entityType: 'DISCIPLINE_INCIDENT', entityId: i.id, newValues: { student: s.admissionNo, type: type.name, severity: type.severity, parentTold: told } }, client);
      return { id: i.id, parentNotified: told };
    });
  }

  list(auth: AuthContext, o: { status?: string; campusId?: string; studentId?: string }) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const m = scopeFor(auth, MANAGE);
      const mine = await this.myClassStudents(tx, auth);
      const rows = await tx.disciplineIncident.findMany({
        where: {
          ...(o.status ? { status: o.status } : {}), ...(o.campusId ? { campusId: o.campusId } : {}), ...(o.studentId ? { studentId: o.studentId } : {}),
          // An unrestricted manager sees everything (an empty condition inside OR would match nothing).
          ...(m?.all ? {} : { OR: [...(m ? [{ campusId: { in: m.campusIds } }] : []), { reportedBy: auth.userId }, ...(mine.size ? [{ studentId: { in: [...mine] } }] : [])] }),
        },
        orderBy: { incidentAt: 'desc' }, take: 300, include: { actions: { select: { actionType: true } } },
      });
      const types = new Map((await tx.disciplineIncidentType.findMany()).map((t) => [t.id, t]));
      const st = new Map((await tx.student.findMany({ where: { id: { in: rows.map((r) => r.studentId) } }, select: { id: true, firstName: true, lastName: true, admissionNo: true } })).map((s) => [s.id, s]));
      return rows.map((i) => {
        const s = st.get(i.studentId)!;
        const t = types.get(i.typeId)!;
        return { id: i.id, studentId: i.studentId, student: fullName(s), admissionNo: s.admissionNo, type: t.name, severity: t.severity, incidentAt: i.incidentAt, location: i.location, status: i.status, parentNotified: i.parentNotified, actions: i.actions.map((a) => a.actionType), mineAsReporter: i.reportedBy === auth.userId };
      });
    });
  }

  get(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const i = await tx.disciplineIncident.findUnique({ where: { id }, include: { actions: { orderBy: { createdAt: 'asc' } } } });
      if (!i || !(await this.canSee(tx, auth, i))) throw NotFound('Incident');
      const t = await tx.disciplineIncidentType.findUniqueOrThrow({ where: { id: i.typeId } });
      const s = await tx.student.findUniqueOrThrow({ where: { id: i.studentId }, select: { id: true, firstName: true, lastName: true, admissionNo: true } });
      const users = new Map((await tx.user.findMany({ where: { id: { in: [i.reportedBy, i.closedBy, ...i.actions.map((a) => a.createdBy)].filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
      const sec = await tx.studentEnrollment.findFirst({ where: { studentId: s.id, status: 'ACTIVE' }, select: { section: { select: { name: true, level: { select: { name: true } } } } } });
      const earlier = await tx.disciplineIncident.count({ where: { studentId: s.id, id: { not: i.id } } });
      const manage = this.can(auth, MANAGE, i.campusId);
      return {
        id: i.id, status: i.status, incidentAt: i.incidentAt, location: i.location, description: i.description, witnesses: i.witnesses, parentNotified: i.parentNotified,
        type: { id: t.id, name: t.name, severity: t.severity, notifyParent: t.notifyParent },
        student: { id: s.id, name: fullName(s), admissionNo: s.admissionNo, className: sec ? `${sec.section.level.name} ${sec.section.name}` : null, otherIncidents: earlier },
        reportedBy: users.get(i.reportedBy) ?? null, closedBy: i.closedBy ? users.get(i.closedBy) ?? null : null, closedAt: i.closedAt, closingNote: i.closingNote,
        actions: i.actions.map((a) => ({ id: a.id, actionType: a.actionType, description: a.description, fromDate: iso(a.fromDate), toDate: iso(a.toDate), fineAmount: dec(a.fineAmount), fineStatus: a.fineStatus, by: users.get(a.createdBy) ?? null, at: a.createdAt })),
        can: { manage, counsel: this.can(auth, COUNSEL, i.campusId) },
      };
    });
  }

  private async managed(tx: Tx, id: string, auth: AuthContext) {
    await tx.$queryRaw`SELECT id FROM discipline_incidents WHERE id = ${id}::uuid FOR UPDATE`;
    const i = await tx.disciplineIncident.findUnique({ where: { id } });
    if (!i || !this.can(auth, MANAGE, i.campusId)) throw NotFound('Incident');
    if (i.status === 'CLOSED') throw Conflict('incident-closed', 'This incident is closed');
    return i;
  }

  review(id: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const i = await this.managed(tx, id, auth);
      if (i.status !== 'REPORTED') throw Conflict('already-reviewing', 'This incident is already being reviewed');
      await tx.disciplineIncident.update({ where: { id }, data: { status: 'UNDER_REVIEW' } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: i.campusId, action: 'STATUS_CHANGE', entityType: 'DISCIPLINE_INCIDENT', entityId: id, oldValues: { status: i.status }, newValues: { status: 'UNDER_REVIEW' } }, client);
      return { status: 'UNDER_REVIEW' };
    });
  }

  addAction(id: string, input: ActionInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const i = await this.managed(tx, id, auth);
      const a = await tx.disciplineAction.create({
        data: {
          tenantId: auth.tenantId!, incidentId: i.id, actionType: input.actionType, description: input.description, fromDate: input.fromDate ? day(input.fromDate) : null, toDate: input.toDate ? day(input.toDate) : null,
          fineAmount: input.actionType === 'FINE' ? input.fineAmount! : null, fineStatus: input.actionType === 'FINE' ? 'PENDING_APPROVAL' : 'NONE', createdBy: auth.userId,
        },
      });
      let fineStatus = a.fineStatus;
      if (input.actionType === 'FINE') {
        const s = await tx.student.findUniqueOrThrow({ where: { id: i.studentId }, select: { firstName: true, lastName: true, admissionNo: true } });
        const req = await this.approvals.submit(tx, { tenantId: auth.tenantId!, requestedBy: auth.userId, entityType: 'DISCIPLINE_FINE', entityId: a.id, campusId: i.campusId, amount: Number(input.fineAmount), summary: `Fine ₹${input.fineAmount} for ${fullName(s)} (${s.admissionNo}): ${input.description}`.slice(0, 300) }, client);
        if (req) await tx.disciplineAction.update({ where: { id: a.id }, data: { approvalRequestId: req.id } });
        else { await this.chargeFine(tx, a.id, auth.userId); fineStatus = 'CHARGED'; }
      }
      await tx.disciplineIncident.update({ where: { id: i.id }, data: { status: 'ACTION_TAKEN' } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: i.campusId, action: 'CREATE', entityType: 'DISCIPLINE_ACTION', entityId: a.id, newValues: { incident: i.id, action: input.actionType, from: input.fromDate ?? null, to: input.toDate ?? null, fine: input.fineAmount ?? null } }, client);
      return { id: a.id, fineStatus };
    });
  }

  private async chargeFine(tx: Tx, actionId: string, userId: string) {
    const a = await tx.disciplineAction.findUniqueOrThrow({ where: { id: actionId }, include: { incident: true } });
    const head = await tx.feeHead.findFirst({ where: { feeType: 'FINE', status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!head) throw Conflict('no-fine-head', 'Add a fee head of type Fine in Fees → Setup first');
    const s = await tx.student.findUniqueOrThrow({ where: { id: a.incident.studentId }, select: { id: true, tenantId: true, campusId: true, firstName: true, lastName: true, admissionNo: true } });
    const inv = await this.billing.chargeInTx(tx, s, { feeHeadId: head.id, amount: fromPaise(toPaise(dec(a.fineAmount)!)), dueDate: todayIST(), description: `Discipline fine · ${a.description}`.slice(0, 200) }, userId);
    await tx.disciplineAction.update({ where: { id: a.id }, data: { fineStatus: 'CHARGED', invoiceId: inv.id } });
  }

  private async fineDecided(tx: Tx, d: { entityId: string; decision: 'APPROVED' | 'REJECTED' | 'CANCELLED'; userId: string }) {
    const a = await tx.disciplineAction.findUnique({ where: { id: d.entityId } });
    if (!a || a.fineStatus !== 'PENDING_APPROVAL') return;
    if (d.decision === 'APPROVED') await this.chargeFine(tx, a.id, d.userId);
    else await tx.disciplineAction.update({ where: { id: a.id }, data: { fineStatus: 'WAIVED' } });
  }

  close(id: string, closingNote: string | null, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const i = await this.managed(tx, id, auth);
      await tx.disciplineIncident.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date(), closedBy: auth.userId, closingNote } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: i.campusId, action: 'CLOSE', entityType: 'DISCIPLINE_INCIDENT', entityId: id, oldValues: { status: i.status }, newValues: { status: 'CLOSED', closingNote } }, client);
      return { status: 'CLOSED' };
    });
  }

  /** A student's behaviour record (managers, class teacher, counsellors). */
  studentRecord(studentId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.student.findUnique({ where: { id: studentId }, select: { id: true, firstName: true, lastName: true, admissionNo: true, campusId: true } });
      if (!s) throw NotFound('Student');
      const ok = this.can(auth, MANAGE, s.campusId) || this.can(auth, COUNSEL, s.campusId) || (await this.myClassStudents(tx, auth)).has(s.id);
      if (!ok) throw NotFound('Student');
      const rows = await tx.disciplineIncident.findMany({ where: { studentId }, orderBy: { incidentAt: 'desc' }, include: { actions: true } });
      const types = new Map((await tx.disciplineIncidentType.findMany()).map((t) => [t.id, t]));
      return {
        student: { id: s.id, name: fullName(s), admissionNo: s.admissionNo },
        incidents: rows.map((i) => ({ id: i.id, type: types.get(i.typeId)!.name, severity: types.get(i.typeId)!.severity, incidentAt: i.incidentAt, status: i.status, actions: i.actions.map((a) => ACTION_TEXT[a.actionType]) })),
      };
    });
  }

  // ───────────── Counselling ─────────────

  sessions(auth: AuthContext, studentId?: string) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = scopeFor(auth, COUNSEL);
      if (!c) throw NotFound('Sessions');
      const rows = await tx.counsellingSession.findMany({ where: { ...(studentId ? { studentId } : {}), ...(c.all ? {} : { campusId: { in: c.campusIds } }) }, orderBy: { sessionAt: 'desc' }, take: 300 });
      const st = new Map((await tx.student.findMany({ where: { id: { in: rows.map((r) => r.studentId) } }, select: { id: true, firstName: true, lastName: true, admissionNo: true } })).map((s) => [s.id, s]));
      const users = new Map((await tx.user.findMany({ where: { id: { in: rows.map((r) => r.counsellorId) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
      return rows.map((r) => {
        const s = st.get(r.studentId)!;
        return { id: r.id, studentId: r.studentId, student: fullName(s), admissionNo: s.admissionNo, sessionAt: r.sessionAt, referralSource: r.referralSource, incidentId: r.incidentId, followUpDate: iso(r.followUpDate), counsellor: users.get(r.counsellorId) ?? null, mine: r.counsellorId === auth.userId, hasNotes: !!r.notesEnc, isConfidential: r.isConfidential };
      });
    });
  }

  session(id: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await tx.counsellingSession.findUnique({ where: { id } });
      if (!r || !this.can(auth, COUNSEL, r.campusId)) throw NotFound('Session');
      const mine = r.counsellorId === auth.userId;
      const readable = mine || !r.isConfidential;
      if (readable && r.notesEnc && !mine) await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: r.campusId, action: 'REVEAL', entityType: 'COUNSELLING_SESSION', entityId: r.id, newValues: { notesRead: true } }, client);
      const s = await tx.student.findUniqueOrThrow({ where: { id: r.studentId }, select: { firstName: true, lastName: true, admissionNo: true } });
      const counsellor = await tx.user.findUnique({ where: { id: r.counsellorId }, select: { fullName: true } });
      return {
        id: r.id, studentId: r.studentId, student: fullName(s), admissionNo: s.admissionNo, sessionAt: r.sessionAt, referralSource: r.referralSource, incidentId: r.incidentId, followUpDate: iso(r.followUpDate),
        counsellor: counsellor?.fullName ?? null, mine, isConfidential: r.isConfidential, notes: readable && r.notesEnc ? decryptField(r.notesEnc) : null, notesHidden: !readable && !!r.notesEnc,
      };
    });
  }

  saveSession(id: string | null, input: CounsellingInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.student.findUnique({ where: { id: input.studentId }, select: { id: true, campusId: true, admissionNo: true } });
      if (!s || !this.can(auth, COUNSEL, s.campusId)) throw NotFound('Student');
      if (input.incidentId) {
        const i = await tx.disciplineIncident.findUnique({ where: { id: input.incidentId }, select: { studentId: true } });
        if (!i || i.studentId !== s.id) throw NotFound('Incident');
      }
      const old = id ? await tx.counsellingSession.findUnique({ where: { id } }) : null;
      if (id && (!old || old.studentId !== s.id)) throw NotFound('Session');
      if (old && old.counsellorId !== auth.userId) throw Conflict('not-your-session', 'Only the counsellor who held the session can change it');
      const data = { sessionAt: new Date(input.sessionAt), referralSource: input.referralSource, incidentId: input.incidentId ?? null, notesEnc: input.notes ? encryptField(input.notes) : null, followUpDate: input.followUpDate ? day(input.followUpDate) : null, isConfidential: input.isConfidential };
      const r = old ? await tx.counsellingSession.update({ where: { id: old.id }, data }) : await tx.counsellingSession.create({ data: { ...data, tenantId: auth.tenantId!, campusId: s.campusId, studentId: s.id, counsellorId: auth.userId } });
      // Notes never go into the audit log.
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: s.campusId, action: old ? 'UPDATE' : 'CREATE', entityType: 'COUNSELLING_SESSION', entityId: r.id, newValues: { student: s.admissionNo, referralSource: input.referralSource, followUpDate: input.followUpDate ?? null, hasNotes: !!input.notes } }, client);
      return { id: r.id };
    });
  }
}
