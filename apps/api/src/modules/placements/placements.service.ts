import { Injectable } from '@nestjs/common';
import { CompanyInput, DriveInput, OfferInput, PERMISSIONS, PlacementProfileInput, fromPaise, toPaise } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, CampusScope, canAccessCampus, scopeFor } from '../../common/auth-context';
import { Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { FilesService, UploadedBlob } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { dec, unprocessable } from '../accounts/books';
import { day, fullName, iso, prettyDate, todayIST } from '../campuslife/common';

type Perm = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
const READ = PERMISSIONS.PLACE_READ, MANAGE = PERMISSIONS.PLACE_MANAGE;
const STATUS_TEXT: Record<string, string> = { SHORTLISTED: 'shortlisted', IN_PROCESS: 'in process', SELECTED: 'selected', REJECTED: 'not selected', WITHDRAWN: 'withdrawn' };

interface StudentRow { id: string; name: string; admissionNo: string; campusId: string; userId: string | null; programId: string | null; program: string | null; programType: string | null; className: string | null }
interface Profile { isOptedIn: boolean; isPlaced: boolean; passingYear: number | null; scoreType: string | null; score: { toString(): string } | null; backlogs: number | null; scoreVerifiedAt: Date | null }

/**
 * Placements (M19.1–M19.3): companies, the placement cell's profile per student (CGPA or percentage
 * and backlogs entered and verified by the officer until CBCS exists — owner decision 2026-11-21),
 * drives with eligibility rules, applications round by round, offers and statistics.
 */
@Injectable()
export class PlacementsService {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly files: FilesService, private readonly notifications: NotificationsService) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  can(auth: AuthContext, perm: Perm, campusId: string) {
    const s = scopeFor(auth, perm);
    return !!s && canAccessCampus(s, campusId);
  }
  private readable(auth: AuthContext): string[] | null {
    const scopes = [READ, MANAGE].map((p) => scopeFor(auth, p)).filter((s): s is CampusScope => !!s);
    if (scopes.some((s) => s.all)) return null;
    return [...new Set(scopes.flatMap((s) => (s.all ? [] : s.campusIds)))];
  }
  private campusWhere(auth: AuthContext, campusId?: string) {
    const c = this.readable(auth);
    if (campusId && c && !c.includes(campusId)) return { campusId: '00000000-0000-0000-0000-000000000000' };
    return campusId ? { campusId } : c ? { campusId: { in: c } } : {};
  }

  /** Current students with their programme and class (from the active enrolment). */
  private async students(tx: Tx, where: { ids?: string[]; campusId?: { in: string[] } | string; q?: string }, take = 2000): Promise<StudentRow[]> {
    const words = (where.q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 3);
    const rows = await tx.student.findMany({
      where: {
        ...(where.ids ? { id: { in: where.ids } } : { status: 'ACTIVE' }),
        ...(where.campusId ? { campusId: where.campusId as string } : {}),
        AND: words.map((w) => ({ OR: [{ firstName: { contains: w, mode: 'insensitive' as const } }, { lastName: { contains: w, mode: 'insensitive' as const } }, { admissionNo: { contains: w, mode: 'insensitive' as const } }] })),
      },
      orderBy: [{ firstName: 'asc' }], take,
      select: { id: true, firstName: true, lastName: true, admissionNo: true, campusId: true, userId: true, enrollments: { where: { status: 'ACTIVE' }, orderBy: { enrolledOn: 'desc' }, take: 1, select: { section: { select: { name: true, level: { select: { name: true, program: { select: { id: true, name: true, programType: true } } } } } } } } },
    });
    return rows.map((s) => {
      const sec = s.enrollments[0]?.section;
      return { id: s.id, name: fullName(s), admissionNo: s.admissionNo, campusId: s.campusId, userId: s.userId, programId: sec?.level.program.id ?? null, program: sec?.level.program.name ?? null, programType: sec?.level.program.programType ?? null, className: sec ? `${sec.level.name} ${sec.name}` : null };
    });
  }

  /** Why a student can or cannot apply to a drive (empty = eligible). */
  private reasons(d: { eligibleProgramIds: string[]; passingYear: number; scoreType: string; minScore: unknown; maxBacklogs: number | null; allowPlaced: boolean; campusId: string }, s: StudentRow, p: Profile | null): string[] {
    const r: string[] = [];
    if (s.campusId !== d.campusId) r.push('OTHER_CAMPUS');
    if (!p || !p.isOptedIn) r.push('NOT_OPTED_IN');
    if (d.eligibleProgramIds.length && (!s.programId || !d.eligibleProgramIds.includes(s.programId))) r.push('PROGRAMME');
    if (!p?.passingYear || p.passingYear !== d.passingYear) r.push('PASSING_YEAR');
    if (d.minScore != null) {
      if (!p?.score || !p.scoreVerifiedAt) r.push('NO_SCORE');
      else if (p.scoreType !== d.scoreType) r.push('SCORE_TYPE');
      else if (Number(p.score) < Number(d.minScore)) r.push('SCORE');
    }
    if (d.maxBacklogs != null && (p?.backlogs == null || p.backlogs > d.maxBacklogs)) r.push('BACKLOGS');
    if (p?.isPlaced && !d.allowPlaced) r.push('PLACED');
    return r;
  }

  // ───────────── Set-up: options, companies ─────────────

  options(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = this.readable(auth);
      const [campuses, programs, companies] = await Promise.all([
        tx.campus.findMany({ where: { ...(c ? { id: { in: c } } : {}), campusType: { not: 'SCHOOL' } }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
        tx.program.findMany({ where: { status: 'ACTIVE', programType: { not: 'SCHOOL' }, ...(c ? { campusId: { in: c } } : {}) }, orderBy: { name: 'asc' }, select: { id: true, name: true, campusId: true } }),
        tx.company.findMany({ where: { status: 'ACTIVE' }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      ]);
      const y = Number(todayIST().slice(0, 4));
      return { campuses, programs, companies, years: [y - 1, y, y + 1, y + 2], can: { manage: !!scopeFor(auth, MANAGE) } };
    });
  }

  companies(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.company.findMany({ orderBy: [{ status: 'asc' }, { name: 'asc' }] });
      const drives = await tx.placementDrive.groupBy({ by: ['companyId'], where: { companyId: { in: rows.map((r) => r.id) }, status: { not: 'CANCELLED' } }, _count: { _all: true } });
      const offers = await tx.$queryRaw<{ company_id: string; n: number }[]>`
        SELECT d.company_id, count(*)::int AS n FROM placement_offers o JOIN placement_applications a ON a.id = o.application_id JOIN placement_drives d ON d.id = a.drive_id
         WHERE o.status IN ('OFFERED','ACCEPTED') GROUP BY d.company_id`;
      return rows.map((r) => ({ id: r.id, name: r.name, industry: r.industry, website: r.website, hrName: r.hrName, hrEmail: r.hrEmail, hrPhone: r.hrPhone, address: r.address, status: r.status, blacklistReason: r.blacklistReason, drives: drives.find((d) => d.companyId === r.id)?._count._all ?? 0, offers: offers.find((o) => o.company_id === r.id)?.n ?? 0 }));
    });
  }

  saveCompany(id: string | null, input: CompanyInput, auth: AuthContext, client: ClientInfo) {
    if (!scopeFor(auth, MANAGE)) throw NotFound('Company');
    return this.db.run(this.ctx(auth), async (tx) => {
      const old = id ? await tx.company.findUnique({ where: { id } }) : null;
      if (id && !old) throw NotFound('Company');
      if (await tx.company.findFirst({ where: { name: { equals: input.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) }, select: { id: true } })) throw Conflict('duplicate-name', `${input.name} already exists`);
      const data = { ...input, blacklistReason: input.status === 'BLACKLISTED' ? input.blacklistReason : null };
      const row = old ? await tx.company.update({ where: { id: old.id }, data }) : await tx.company.create({ data: { ...data, tenantId: auth.tenantId!, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: old ? 'UPDATE' : 'CREATE', entityType: 'COMPANY', entityId: row.id, oldValues: old ?? undefined, newValues: data }, client);
      return { id: row.id };
    });
  }

  // ───────────── Student placement profiles ─────────────

  profiles(auth: AuthContext, o: { campusId?: string; programId?: string; passingYear?: number; q?: string }) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = this.readable(auth);
      const campus = o.campusId ? (c && !c.includes(o.campusId) ? '00000000-0000-0000-0000-000000000000' : o.campusId) : undefined;
      let rows = (await this.students(tx, { campusId: campus ?? (c ? { in: c } : undefined), q: o.q })).filter((s) => s.programType && s.programType !== 'SCHOOL');
      if (o.programId) rows = rows.filter((s) => s.programId === o.programId);
      const profiles = new Map((await tx.studentPlacementProfile.findMany({ where: { studentId: { in: rows.map((r) => r.id) } } })).map((p) => [p.studentId, p]));
      const out = rows.map((s) => {
        const p = profiles.get(s.id);
        return { ...s, userId: undefined, hasLogin: !!s.userId, profile: p ? { isOptedIn: p.isOptedIn, isPlaced: p.isPlaced, passingYear: p.passingYear, scoreType: p.scoreType, score: p.score == null ? null : dec(p.score), backlogs: p.backlogs, skills: p.skills, preferredLocations: p.preferredLocations, resumeFileId: p.resumeFileId, verifiedAt: p.scoreVerifiedAt } : null };
      });
      return o.passingYear ? out.filter((s) => s.profile?.passingYear === o.passingYear) : out;
    });
  }

  saveProfile(studentId: string, input: PlacementProfileInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.student.findUnique({ where: { id: studentId }, select: { id: true, campusId: true } });
      if (!s || !this.can(auth, MANAGE, s.campusId)) throw NotFound('Student');
      const old = await tx.studentPlacementProfile.findUnique({ where: { tenantId_studentId: { tenantId: auth.tenantId!, studentId } } });
      const scoreChanged = !old || String(old.score ?? '') !== String(input.score ?? '') || old.scoreType !== (input.scoreType ?? null) || old.backlogs !== (input.backlogs ?? null);
      const data = {
        isOptedIn: input.isOptedIn, passingYear: input.passingYear ?? null, scoreType: input.score ? input.scoreType ?? null : null, score: input.score ?? null, backlogs: input.backlogs ?? null,
        skills: input.skills, preferredLocations: input.preferredLocations, updatedBy: auth.userId,
        ...(scoreChanged ? { scoreVerifiedBy: input.score || input.backlogs != null ? auth.userId : null, scoreVerifiedAt: input.score || input.backlogs != null ? new Date() : null } : {}),
      };
      const row = old ? await tx.studentPlacementProfile.update({ where: { id: old.id }, data }) : await tx.studentPlacementProfile.create({ data: { ...data, tenantId: auth.tenantId!, studentId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: s.campusId, action: old ? 'UPDATE' : 'CREATE', entityType: 'PLACEMENT_PROFILE', entityId: row.id, oldValues: old ? { score: old.score, scoreType: old.scoreType, backlogs: old.backlogs, passingYear: old.passingYear, isOptedIn: old.isOptedIn } : undefined, newValues: { score: input.score, scoreType: input.scoreType, backlogs: input.backlogs, passingYear: input.passingYear, isOptedIn: input.isOptedIn, verified: scoreChanged } }, client);
      return { id: row.id };
    });
  }

  async uploadResume(studentId: string, blob: UploadedBlob | undefined, auth: AuthContext, client: ClientInfo) {
    const s = await this.db.run(this.ctx(auth), (tx) => tx.student.findUnique({ where: { id: studentId }, select: { campusId: true } }));
    if (!s || !this.can(auth, MANAGE, s.campusId)) throw NotFound('Student');
    const f = await this.files.store({ entityType: 'STUDENT', entityId: studentId, docType: 'OTHER', campusId: s.campusId }, blob, auth, client);
    if (f.mimeType !== 'application/pdf') throw unprocessable('pdf-only', 'The resume must be a PDF', 'file');
    await this.db.run(this.ctx(auth), async (tx) => {
      const old = await tx.studentPlacementProfile.findUnique({ where: { tenantId_studentId: { tenantId: auth.tenantId!, studentId } } });
      if (old) await tx.studentPlacementProfile.update({ where: { id: old.id }, data: { resumeFileId: f.id, updatedBy: auth.userId } });
      else await tx.studentPlacementProfile.create({ data: { tenantId: auth.tenantId!, studentId, resumeFileId: f.id, updatedBy: auth.userId } });
    });
    return { fileId: f.id };
  }

  // ───────────── Drives ─────────────

  drives(auth: AuthContext, o: { status?: string; campusId?: string }) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.placementDrive.findMany({ where: { ...this.campusWhere(auth, o.campusId), ...(o.status ? { status: o.status } : {}) }, orderBy: [{ lastDateToApply: 'desc' }, { createdAt: 'desc' }], take: 300 });
      const companies = new Map((await tx.company.findMany({ where: { id: { in: rows.map((r) => r.companyId) } }, select: { id: true, name: true, status: true } })).map((c) => [c.id, c]));
      const apps = await tx.placementApplication.groupBy({ by: ['driveId', 'status'], where: { driveId: { in: rows.map((r) => r.id) } }, _count: { _all: true } });
      const n = (id: string, st?: string) => apps.filter((a) => a.driveId === id && (!st || a.status === st)).reduce((t, a) => t + a._count._all, 0);
      return rows.map((d) => ({ id: d.id, title: d.title, company: companies.get(d.companyId)?.name ?? '', companyId: d.companyId, campusId: d.campusId, jobType: d.jobType, ctcMin: d.ctcMin == null ? null : dec(d.ctcMin), ctcMax: d.ctcMax == null ? null : dec(d.ctcMax), passingYear: d.passingYear, lastDateToApply: iso(d.lastDateToApply), driveDate: iso(d.driveDate), status: d.status, applications: n(d.id) - n(d.id, 'WITHDRAWN'), selected: n(d.id, 'SELECTED') }));
    });
  }

  drive(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const d = await this.findDrive(tx, id, auth);
      const company = await tx.company.findUniqueOrThrow({ where: { id: d.companyId } });
      const programs = await tx.program.findMany({ where: { id: { in: d.eligibleProgramIds } }, select: { id: true, name: true } });
      const apps = await tx.placementApplication.findMany({ where: { driveId: d.id }, orderBy: { appliedAt: 'asc' } });
      const st = new Map((await this.students(tx, { ids: apps.map((a) => a.studentId) })).map((s) => [s.id, s]));
      const offers = new Map((await tx.placementOffer.findMany({ where: { applicationId: { in: apps.map((a) => a.id) } } })).map((o) => [o.applicationId, o]));
      return {
        id: d.id, title: d.title, campusId: d.campusId, companyId: d.companyId, jobType: d.jobType, ctcMin: d.ctcMin == null ? null : dec(d.ctcMin), ctcMax: d.ctcMax == null ? null : dec(d.ctcMax),
        eligibleProgramIds: d.eligibleProgramIds, programs: programs.map((p) => p.name), passingYear: d.passingYear, scoreType: d.scoreType, minScore: d.minScore == null ? null : dec(d.minScore), maxBacklogs: d.maxBacklogs, allowPlaced: d.allowPlaced,
        lastDateToApply: iso(d.lastDateToApply), driveDate: iso(d.driveDate), rounds: d.rounds, description: d.description, status: d.status,
        company: { id: company.id, name: company.name, industry: company.industry, website: company.website, status: company.status },
        can: { manage: this.can(auth, MANAGE, d.campusId) },
        applications: apps.map((a) => {
          const s = st.get(a.studentId);
          const o = offers.get(a.id);
          return { id: a.id, studentId: a.studentId, name: s?.name ?? '', admissionNo: s?.admissionNo ?? '', program: s?.program ?? null, className: s?.className ?? null, appliedAt: a.appliedAt, status: a.status, currentRound: a.currentRound, remarks: a.remarks, snapshot: a.eligibilitySnapshot,
            offer: o ? { id: o.id, ctc: dec(o.ctc), offerDate: iso(o.offerDate), joiningDate: iso(o.joiningDate), status: o.status, hasLetter: !!o.offerLetterFileId } : null };
        }),
      };
    });
  }

  private async findDrive(tx: Tx, id: string, auth: AuthContext, perm?: Perm) {
    const d = await tx.placementDrive.findUnique({ where: { id } });
    const c = this.readable(auth);
    if (!d || (c && !c.includes(d.campusId)) || (perm && !this.can(auth, perm, d.campusId))) throw NotFound('Drive');
    return d;
  }

  saveDrive(id: string | null, input: DriveInput, auth: AuthContext, client: ClientInfo) {
    if (!this.can(auth, MANAGE, input.campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      const old = id ? await this.findDrive(tx, id, auth, MANAGE) : null;
      if (old && ['COMPLETED', 'CANCELLED'].includes(old.status)) throw Conflict('drive-closed', 'A completed or cancelled drive cannot be changed');
      const company = await tx.company.findUnique({ where: { id: input.companyId } });
      if (!company) throw unprocessable('not-found', 'Company not found', 'companyId');
      if (company.status === 'BLACKLISTED' && (!old || old.companyId !== company.id)) throw Conflict('company-blacklisted', `${company.name} is blacklisted: ${company.blacklistReason ?? ''}`.trim());
      if (input.eligibleProgramIds.length) {
        const ps = await tx.program.findMany({ where: { id: { in: input.eligibleProgramIds } }, select: { campusId: true } });
        if (ps.length !== input.eligibleProgramIds.length || ps.some((p) => p.campusId !== input.campusId)) throw unprocessable('program-campus', 'Choose programmes of this campus', 'eligibleProgramIds');
      }
      const data = {
        campusId: input.campusId, companyId: company.id, title: input.title, jobType: input.jobType, ctcMin: input.ctcMin ?? null, ctcMax: input.ctcMax ?? null, eligibleProgramIds: input.eligibleProgramIds,
        passingYear: input.passingYear, scoreType: input.scoreType, minScore: input.minScore ?? null, maxBacklogs: input.maxBacklogs ?? null, allowPlaced: input.allowPlaced,
        lastDateToApply: day(input.lastDateToApply), driveDate: input.driveDate ? day(input.driveDate) : null, rounds: input.rounds, description: input.description,
      };
      const row = old ? await tx.placementDrive.update({ where: { id: old.id }, data }) : await tx.placementDrive.create({ data: { ...data, tenantId: auth.tenantId!, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: input.campusId, action: old ? 'UPDATE' : 'CREATE', entityType: 'PLACEMENT_DRIVE', entityId: row.id, oldValues: old ?? undefined, newValues: input }, client);
      return { id: row.id };
    });
  }

  setDriveStatus(id: string, status: 'OPEN' | 'CLOSED' | 'COMPLETED' | 'CANCELLED', auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const d = await this.findDrive(tx, id, auth, MANAGE);
      const allowed: Record<string, string[]> = { DRAFT: ['OPEN', 'CANCELLED'], OPEN: ['CLOSED', 'CANCELLED'], CLOSED: ['OPEN', 'COMPLETED', 'CANCELLED'], COMPLETED: [], CANCELLED: [] };
      if (!allowed[d.status].includes(status)) throw Conflict('drive-status', `A ${d.status.toLowerCase()} drive cannot be marked ${status.toLowerCase()}`);
      if (status === 'OPEN' && iso(d.lastDateToApply)! < todayIST()) throw Conflict('last-date-passed', 'The last date to apply has passed — change it first');
      const company = await tx.company.findUniqueOrThrow({ where: { id: d.companyId } });
      if (status === 'OPEN' && company.status === 'BLACKLISTED') throw Conflict('company-blacklisted', `${company.name} is blacklisted`);
      await tx.placementDrive.update({ where: { id }, data: { status, ...(status === 'OPEN' && !d.openedAt ? { openedAt: new Date() } : {}) } });
      let told = 0;
      if (status === 'OPEN' && !d.openedAt) {
        // Eligible students with their own login hear about it once (the first time the drive opens).
        const st = await this.students(tx, { campusId: d.campusId });
        const profiles = new Map((await tx.studentPlacementProfile.findMany({ where: { studentId: { in: st.map((s) => s.id) } } })).map((p) => [p.studentId, p]));
        const users = st.filter((s) => s.userId && !this.reasons(d, s, profiles.get(s.id) ?? null).length).map((s) => s.userId!);
        if (users.length) await this.notifications.notify(tx, { tenantId: d.tenantId, userIds: users, eventCode: 'PLACEMENT_DRIVE', vars: { company: company.name, role: d.title, lastDate: prettyDate(iso(d.lastDateToApply)!) }, entityType: 'PLACEMENT_DRIVE', entityId: d.id });
        told = users.length;
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: d.campusId, action: 'STATUS_CHANGE', entityType: 'PLACEMENT_DRIVE', entityId: id, oldValues: { status: d.status }, newValues: { status, told } }, client);
      return { status, told };
    });
  }

  /** Students of the drive's campus with whether they are eligible and why not. */
  eligible(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const d = await this.findDrive(tx, id, auth);
      const st = (await this.students(tx, { campusId: d.campusId })).filter((s) => s.programType && s.programType !== 'SCHOOL');
      const profiles = new Map((await tx.studentPlacementProfile.findMany({ where: { studentId: { in: st.map((s) => s.id) } } })).map((p) => [p.studentId, p]));
      const applied = new Set((await tx.placementApplication.findMany({ where: { driveId: d.id }, select: { studentId: true } })).map((a) => a.studentId));
      return st.map((s) => {
        const p = profiles.get(s.id) ?? null;
        return { studentId: s.id, name: s.name, admissionNo: s.admissionNo, program: s.program, className: s.className, score: p?.score == null ? null : dec(p.score), scoreType: p?.scoreType ?? null, backlogs: p?.backlogs ?? null, reasons: this.reasons(d, s, p), applied: applied.has(s.id) };
      }).filter((x) => x.reasons.length === 0 || x.applied || !x.reasons.includes('NOT_OPTED_IN'))
        .sort((a, b) => a.reasons.length - b.reasons.length || a.name.localeCompare(b.name));
    });
  }

  private async applyInTx(tx: Tx, d: { id: string; tenantId: string; campusId: string; eligibleProgramIds: string[]; passingYear: number; scoreType: string; minScore: unknown; maxBacklogs: number | null; allowPlaced: boolean }, studentId: string, userId: string) {
    const [s] = await this.students(tx, { ids: [studentId] });
    if (!s) throw NotFound('Student');
    const p = await tx.studentPlacementProfile.findUnique({ where: { tenantId_studentId: { tenantId: d.tenantId, studentId } } });
    const why = this.reasons(d, s, p);
    if (why.length) throw Conflict('not-eligible', `${s.name} is not eligible: ${why.map((w) => w.toLowerCase().replace(/_/g, ' ')).join(', ')}`);
    if (await tx.placementApplication.findFirst({ where: { driveId: d.id, studentId }, select: { id: true } })) return null;
    return tx.placementApplication.create({ data: { tenantId: d.tenantId, driveId: d.id, studentId, appliedBy: userId, eligibilitySnapshot: { program: s.program, passingYear: p?.passingYear ?? null, scoreType: p?.scoreType ?? null, score: p?.score == null ? null : dec(p.score), backlogs: p?.backlogs ?? null, at: new Date().toISOString() } } });
  }

  /** The placement officer enrols eligible students (while the drive is open or closed). */
  enrol(driveId: string, studentIds: string[], auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const d = await this.findDrive(tx, driveId, auth, MANAGE);
      if (!['OPEN', 'CLOSED'].includes(d.status)) throw Conflict('drive-not-open', 'Open the drive first');
      let added = 0, already = 0;
      for (const sid of studentIds) { const a = await this.applyInTx(tx, d, sid, auth.userId!); if (a) added++; else already++; }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: d.campusId, action: 'CREATE', entityType: 'PLACEMENT_APPLICATION', entityId: d.id, newValues: { added, already } }, client);
      return { added, already };
    });
  }

  updateApplication(id: string, input: { status: string; currentRound?: string | null; remarks?: string | null }, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const a = await tx.placementApplication.findUnique({ where: { id } });
      if (!a) throw NotFound('Application');
      const d = await this.findDrive(tx, a.driveId, auth, MANAGE);
      if (['WITHDRAWN'].includes(a.status)) throw Conflict('application-closed', 'The student withdrew this application');
      if (input.status !== 'SELECTED' && (await tx.placementOffer.findFirst({ where: { applicationId: a.id, status: { in: ['OFFERED', 'ACCEPTED'] } }, select: { id: true } }))) throw Conflict('has-offer', 'An offer is open on this application — revoke it first');
      if (input.currentRound && d.rounds.length && !d.rounds.includes(input.currentRound)) throw unprocessable('round', 'Choose one of the drive’s rounds', 'currentRound');
      await tx.placementApplication.update({ where: { id }, data: { status: input.status, currentRound: input.currentRound ?? a.currentRound, remarks: input.remarks ?? a.remarks } });
      if (a.status !== input.status && ['SHORTLISTED', 'SELECTED', 'REJECTED'].includes(input.status)) await this.tellStudent(tx, a.studentId, d, input.status, a.id);
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: d.campusId, action: 'UPDATE', entityType: 'PLACEMENT_APPLICATION', entityId: id, oldValues: { status: a.status, currentRound: a.currentRound }, newValues: input }, client);
      return { status: input.status };
    });
  }

  private async tellStudent(tx: Tx, studentId: string, d: { tenantId: string; companyId: string; title: string }, status: string, entityId: string) {
    const s = await tx.student.findUnique({ where: { id: studentId }, select: { userId: true } });
    if (!s?.userId) return;
    const c = await tx.company.findUniqueOrThrow({ where: { id: d.companyId }, select: { name: true } });
    await this.notifications.notify(tx, { tenantId: d.tenantId, userIds: [s.userId], eventCode: 'PLACEMENT_UPDATE', vars: { company: c.name, role: d.title, status: STATUS_TEXT[status] ?? status.toLowerCase() }, entityType: 'PLACEMENT_APPLICATION', entityId });
  }

  // ───────────── Offers ─────────────

  makeOffer(applicationId: string, input: OfferInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const a = await tx.placementApplication.findUnique({ where: { id: applicationId } });
      if (!a) throw NotFound('Application');
      const d = await this.findDrive(tx, a.driveId, auth, MANAGE);
      if (a.status !== 'SELECTED') throw Conflict('not-selected', 'Mark the student as selected first');
      const old = await tx.placementOffer.findUnique({ where: { tenantId_applicationId: { tenantId: auth.tenantId!, applicationId } } });
      if (old && old.status !== 'REVOKED' && old.status !== 'DECLINED') throw Conflict('offer-exists', 'An offer is already recorded for this application');
      const data = { ctc: input.ctc, offerDate: day(input.offerDate), joiningDate: input.joiningDate ? day(input.joiningDate) : null, remarks: input.remarks, status: 'OFFERED', decidedAt: null };
      const row = old ? await tx.placementOffer.update({ where: { id: old.id }, data }) : await tx.placementOffer.create({ data: { ...data, tenantId: auth.tenantId!, applicationId, studentId: a.studentId, createdBy: auth.userId } });
      await this.tellStudent(tx, a.studentId, d, 'SELECTED', a.id);
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: d.campusId, action: 'CREATE', entityType: 'PLACEMENT_OFFER', entityId: row.id, newValues: input }, client);
      return { id: row.id };
    });
  }

  private async decideOffer(tx: Tx, offerId: string, status: 'ACCEPTED' | 'DECLINED' | 'REVOKED', remarks: string | null) {
    await tx.$queryRaw`SELECT id FROM placement_offers WHERE id = ${offerId}::uuid FOR UPDATE`;
    const o = await tx.placementOffer.findUniqueOrThrow({ where: { id: offerId } });
    const a = await tx.placementApplication.findUniqueOrThrow({ where: { id: o.applicationId } });
    const d = await tx.placementDrive.findUniqueOrThrow({ where: { id: a.driveId } });
    if (status === 'REVOKED' ? !['OFFERED', 'ACCEPTED'].includes(o.status) : o.status !== 'OFFERED') throw Conflict('offer-state', `This offer is already ${o.status.toLowerCase()}`);
    if (status === 'ACCEPTED' && d.jobType === 'FULL_TIME') {
      // One accepted full-time offer per student unless the drive allows placed students (lock per student).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`placed:${o.studentId}`}))`;
      const other = await tx.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM placement_offers x JOIN placement_applications xa ON xa.id = x.application_id JOIN placement_drives xd ON xd.id = xa.drive_id
         WHERE x.student_id = ${o.studentId}::uuid AND x.status = 'ACCEPTED' AND xd.job_type = 'FULL_TIME' AND x.id <> ${o.id}::uuid`;
      if (other[0].n > 0 && !d.allowPlaced) throw Conflict('already-placed', 'The student has already accepted a full-time offer');
    }
    await tx.placementOffer.update({ where: { id: o.id }, data: { status, decidedAt: new Date(), remarks: remarks ?? o.remarks } });
    // Placed = has an accepted full-time offer.
    const placed = await tx.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM placement_offers x JOIN placement_applications xa ON xa.id = x.application_id JOIN placement_drives xd ON xd.id = xa.drive_id
       WHERE x.student_id = ${o.studentId}::uuid AND x.status = 'ACCEPTED' AND xd.job_type = 'FULL_TIME'`;
    const p = await tx.studentPlacementProfile.findUnique({ where: { tenantId_studentId: { tenantId: o.tenantId, studentId: o.studentId } } });
    if (p) await tx.studentPlacementProfile.update({ where: { id: p.id }, data: { isPlaced: placed[0].n > 0 } });
    else if (placed[0].n > 0) await tx.studentPlacementProfile.create({ data: { tenantId: o.tenantId, studentId: o.studentId, isPlaced: true } });
    return { o, d };
  }

  offerStatus(offerId: string, status: 'ACCEPTED' | 'DECLINED' | 'REVOKED', remarks: string | null, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const o0 = await tx.placementOffer.findUnique({ where: { id: offerId }, select: { applicationId: true } });
      if (!o0) throw NotFound('Offer');
      const a = await tx.placementApplication.findUniqueOrThrow({ where: { id: o0.applicationId }, select: { driveId: true } });
      await this.findDrive(tx, a.driveId, auth, MANAGE);
      const { o, d } = await this.decideOffer(tx, offerId, status, remarks);
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: d.campusId, action: 'STATUS_CHANGE', entityType: 'PLACEMENT_OFFER', entityId: o.id, oldValues: { status: o.status }, newValues: { status, remarks } }, client);
      return { status };
    });
  }

  async uploadOfferLetter(offerId: string, blob: UploadedBlob | undefined, auth: AuthContext, client: ClientInfo) {
    const o = await this.db.run(this.ctx(auth), async (tx) => {
      const x = await tx.placementOffer.findUnique({ where: { id: offerId } });
      if (!x) throw NotFound('Offer');
      const a = await tx.placementApplication.findUniqueOrThrow({ where: { id: x.applicationId } });
      const d = await this.findDrive(tx, a.driveId, auth, MANAGE);
      return { ...x, campusId: d.campusId };
    });
    const f = await this.files.store({ entityType: 'STUDENT', entityId: o.studentId, docType: 'OTHER', campusId: o.campusId }, blob, auth, client);
    if (f.mimeType !== 'application/pdf') throw unprocessable('pdf-only', 'The offer letter must be a PDF', 'file');
    await this.db.run(this.ctx(auth), (tx) => tx.placementOffer.update({ where: { id: offerId }, data: { offerLetterFileId: f.id } }));
    return { fileId: f.id };
  }

  // ───────────── Statistics ─────────────

  stats(auth: AuthContext, o: { passingYear?: number; campusId?: string }) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const where = this.campusWhere(auth, o.campusId);
      const drives = await tx.placementDrive.findMany({ where: { ...where, ...(o.passingYear ? { passingYear: o.passingYear } : {}), status: { not: 'CANCELLED' } }, select: { id: true, companyId: true, jobType: true, campusId: true } });
      const apps = await tx.placementApplication.findMany({ where: { driveId: { in: drives.map((d) => d.id) } }, select: { id: true, driveId: true, studentId: true, status: true } });
      const offers = await tx.placementOffer.findMany({ where: { applicationId: { in: apps.map((a) => a.id) }, status: { in: ['OFFERED', 'ACCEPTED'] } } });
      const studs = await this.students(tx, { campusId: (where as { campusId?: string | { in: string[] } }).campusId as never });
      const profiles = await tx.studentPlacementProfile.findMany({ where: { studentId: { in: studs.map((s) => s.id) }, isOptedIn: true, ...(o.passingYear ? { passingYear: o.passingYear } : {}) } });
      const optedIds = new Set(profiles.map((p) => p.studentId));
      const ft = new Set(drives.filter((d) => d.jobType === 'FULL_TIME').map((d) => d.id));
      const appOf = new Map(apps.map((a) => [a.id, a]));
      const accepted = offers.filter((x) => x.status === 'ACCEPTED' && ft.has(appOf.get(x.applicationId)!.driveId));
      const placedIds = new Set(accepted.map((x) => x.studentId));
      const ctcs = offers.filter((x) => ft.has(appOf.get(x.applicationId)!.driveId)).map((x) => toPaise(dec(x.ctc))).sort((a, b) => a - b);
      const median = ctcs.length ? (ctcs.length % 2 ? ctcs[(ctcs.length - 1) / 2] : Math.round((ctcs[ctcs.length / 2 - 1] + ctcs[ctcs.length / 2]) / 2)) : 0;
      const st = new Map(studs.map((s) => [s.id, s]));
      const byProgram = new Map<string, { program: string; opted: number; placed: number }>();
      for (const id of optedIds) { const pr = st.get(id)?.program ?? '—'; const r = byProgram.get(pr) ?? { program: pr, opted: 0, placed: 0 }; r.opted++; if (placedIds.has(id)) r.placed++; byProgram.set(pr, r); }
      const companies = new Map((await tx.company.findMany({ where: { id: { in: drives.map((d) => d.companyId) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
      const byCompany = new Map<string, { company: string; offers: number; accepted: number; highestPaise: number }>();
      for (const x of offers) {
        const dId = appOf.get(x.applicationId)!.driveId;
        const name = companies.get(drives.find((d) => d.id === dId)!.companyId) ?? '';
        const r = byCompany.get(name) ?? { company: name, offers: 0, accepted: 0, highestPaise: 0 };
        r.offers++; if (x.status === 'ACCEPTED') r.accepted++; r.highestPaise = Math.max(r.highestPaise, toPaise(dec(x.ctc)));
        byCompany.set(name, r);
      }
      return {
        optedIn: optedIds.size, placed: [...placedIds].filter((id) => optedIds.has(id)).length, offers: offers.length, drives: drives.length, applications: apps.filter((a) => a.status !== 'WITHDRAWN').length,
        placedPercent: optedIds.size ? Math.round(([...placedIds].filter((id) => optedIds.has(id)).length * 1000) / optedIds.size) / 10 : 0,
        highestCtc: ctcs.length ? fromPaise(ctcs[ctcs.length - 1]) : null, averageCtc: ctcs.length ? fromPaise(Math.round(ctcs.reduce((t, x) => t + x, 0) / ctcs.length)) : null, medianCtc: ctcs.length ? fromPaise(median) : null,
        byProgram: [...byProgram.values()].sort((a, b) => b.placed - a.placed || a.program.localeCompare(b.program)),
        byCompany: [...byCompany.values()].sort((a, b) => b.offers - a.offers).map((r) => ({ company: r.company, offers: r.offers, accepted: r.accepted, highestCtc: fromPaise(r.highestPaise) })),
      };
    });
  }

  // ───────────── Student app ─────────────

  forChild(studentId: string, auth: AuthContext) {
    if (!(auth.portalStudentIds ?? []).includes(studentId)) throw NotFound('Student');
    return this.db.run(this.ctx(auth), async (tx) => {
      const [s] = await this.students(tx, { ids: [studentId] });
      if (!s) throw NotFound('Student');
      const p = await tx.studentPlacementProfile.findUnique({ where: { tenantId_studentId: { tenantId: auth.tenantId!, studentId } } });
      const apps = await tx.placementApplication.findMany({ where: { studentId }, orderBy: { appliedAt: 'desc' } });
      const drives = await tx.placementDrive.findMany({ where: { OR: [{ campusId: s.campusId, status: 'OPEN' }, { id: { in: apps.map((a) => a.driveId) } }] }, orderBy: { lastDateToApply: 'asc' } });
      const companies = new Map((await tx.company.findMany({ where: { id: { in: drives.map((d) => d.companyId) } }, select: { id: true, name: true, status: true } })).map((c) => [c.id, c]));
      const offers = new Map((await tx.placementOffer.findMany({ where: { studentId } })).map((o) => [o.applicationId, o]));
      const today = todayIST();
      const self = s.userId === auth.userId;
      return {
        self,
        profile: p ? { isOptedIn: p.isOptedIn, isPlaced: p.isPlaced, passingYear: p.passingYear, scoreType: p.scoreType, score: p.score == null ? null : dec(p.score), backlogs: p.backlogs, verified: !!p.scoreVerifiedAt } : null,
        openDrives: drives.filter((d) => d.status === 'OPEN' && companies.get(d.companyId)?.status === 'ACTIVE' && !apps.some((a) => a.driveId === d.id)).map((d) => {
          const why = this.reasons(d, s, p);
          return { id: d.id, title: d.title, company: companies.get(d.companyId)?.name ?? '', jobType: d.jobType, ctcMin: d.ctcMin == null ? null : dec(d.ctcMin), ctcMax: d.ctcMax == null ? null : dec(d.ctcMax), lastDateToApply: iso(d.lastDateToApply), driveDate: iso(d.driveDate), description: d.description, eligible: !why.length && iso(d.lastDateToApply)! >= today, reasons: why };
        }),
        applications: apps.map((a) => {
          const d = drives.find((x) => x.id === a.driveId)!;
          const o = offers.get(a.id);
          return { id: a.id, title: d.title, company: companies.get(d.companyId)?.name ?? '', jobType: d.jobType, appliedAt: a.appliedAt, status: a.status, currentRound: a.currentRound, rounds: d.rounds, driveDate: iso(d.driveDate),
            offer: o ? { id: o.id, ctc: dec(o.ctc), offerDate: iso(o.offerDate), joiningDate: iso(o.joiningDate), status: o.status } : null };
        }),
      };
    });
  }

  /** The student's own login applies (parents can follow but not apply). */
  childApply(studentId: string, driveId: string, auth: AuthContext) {
    if (!(auth.portalStudentIds ?? []).includes(studentId)) throw NotFound('Student');
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.student.findUnique({ where: { id: studentId }, select: { userId: true } });
      if (s?.userId !== auth.userId) throw Conflict('student-only', 'Only the student can apply, from their own login');
      const d = await tx.placementDrive.findUnique({ where: { id: driveId } });
      if (!d) throw NotFound('Drive');
      if (d.status !== 'OPEN') throw Conflict('drive-not-open', 'This drive is not taking applications');
      if (iso(d.lastDateToApply)! < todayIST()) throw Conflict('last-date-passed', 'The last date to apply has passed');
      const company = await tx.company.findUniqueOrThrow({ where: { id: d.companyId }, select: { status: true } });
      if (company.status !== 'ACTIVE') throw Conflict('drive-not-open', 'This drive is not taking applications');
      const a = await this.applyInTx(tx, d, studentId, auth.userId!);
      if (!a) throw Conflict('already-applied', 'You have already applied');
      return { id: a.id };
    });
  }

  childWithdraw(studentId: string, applicationId: string, auth: AuthContext) {
    if (!(auth.portalStudentIds ?? []).includes(studentId)) throw NotFound('Student');
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.student.findUnique({ where: { id: studentId }, select: { userId: true } });
      if (s?.userId !== auth.userId) throw Conflict('student-only', 'Only the student can withdraw, from their own login');
      const a = await tx.placementApplication.findUnique({ where: { id: applicationId } });
      if (!a || a.studentId !== studentId) throw NotFound('Application');
      if (['SELECTED', 'REJECTED', 'WITHDRAWN'].includes(a.status)) throw Conflict('application-closed', 'This application can no longer be withdrawn');
      await tx.placementApplication.update({ where: { id: a.id }, data: { status: 'WITHDRAWN' } });
      return { status: 'WITHDRAWN' };
    });
  }

  childOffer(studentId: string, offerId: string, status: 'ACCEPTED' | 'DECLINED', auth: AuthContext) {
    if (!(auth.portalStudentIds ?? []).includes(studentId)) throw NotFound('Student');
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.student.findUnique({ where: { id: studentId }, select: { userId: true } });
      if (s?.userId !== auth.userId) throw Conflict('student-only', 'Only the student can answer an offer, from their own login');
      const o = await tx.placementOffer.findUnique({ where: { id: offerId } });
      if (!o || o.studentId !== studentId) throw NotFound('Offer');
      await this.decideOffer(tx, offerId, status, null);
      return { status };
    });
  }

  people(auth: AuthContext, q: string) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = this.readable(auth);
      return (await this.students(tx, { campusId: c ? { in: c } : undefined, q }, 40)).filter((s) => s.programType && s.programType !== 'SCHOOL').slice(0, 15).map((s) => ({ type: 'STUDENT', id: s.id, name: s.name, code: s.admissionNo, campusId: s.campusId, detail: [s.className, s.program].filter(Boolean).join(' · ') || null }));
    });
  }
}
