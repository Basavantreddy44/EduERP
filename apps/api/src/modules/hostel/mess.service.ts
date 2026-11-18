import { HttpStatus, Injectable } from '@nestjs/common';
import { MEALS, MessPlanInput, MessSubscribeInput, PERMISSIONS, SaveMenuInput, fromPaise, monthsLeft, toPaise } from '@eduerp/shared';
import { z } from 'zod';
import { updateMessPlanSchema } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus } from '../../common/auth-context';
import { AppError, Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { FeeBillingService } from '../fees/billing.service';
import { HostelSetupService } from './setup.service';

const MESS = PERMISSIONS.MESS_MANAGE;
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const money = (v: unknown) => fromPaise(toPaise(String(v ?? 0)));
const unprocessable = (code: string, detail: string, field: string) => new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, detail, [{ field, message: detail }]);
/** ISO weekday: 1 = Monday … 7 = Sunday. */
const weekday = (d: string) => ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

/**
 * Mess (M7.4): plans per campus (meals included; a fixed monthly amount or a price per meal), the
 * weekly menu (a new version from a date keeps the old one for history), subscriptions for students
 * (fixed plans billed through fees for the months left) and staff, and the day's meal counts for the
 * kitchen — the people whose subscription covers that day, per meal.
 */
@Injectable()
export class MessService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly setup: HostelSetupService,
    private readonly billing: FeeBillingService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  plans(auth: AuthContext, campusId?: string) {
    const s = this.setup.scope(auth);
    if (campusId && !canAccessCampus(s, campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.messPlan.findMany({ where: campusId ? { campusId } : s.all ? {} : { campusId: { in: s.campusIds } }, orderBy: [{ status: 'asc' }, { name: 'asc' }] });
      const counts = await tx.messSubscription.groupBy({ by: ['messPlanId'], where: { status: 'ACTIVE', messPlanId: { in: rows.map((r) => r.id) } }, _count: true });
      return rows.map((p) => ({ ...p, amount: money(p.amount), subscribers: counts.find((c) => c.messPlanId === p.id)?._count ?? 0 }));
    });
  }

  createPlan(input: MessPlanInput, auth: AuthContext, client: ClientInfo) {
    if (!canAccessCampus(this.setup.scope(auth, MESS), input.campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      if (await tx.messPlan.findUnique({ where: { tenantId_campusId_name: { tenantId: auth.tenantId!, campusId: input.campusId, name: input.name } }, select: { id: true } })) throw Conflict('plan-name-taken', `${input.name} already exists`);
      const order = (m: string[]) => MEALS.filter((x) => m.includes(x));
      const p = await tx.messPlan.create({ data: { ...input, mealsIncluded: order(input.mealsIncluded), tenantId: auth.tenantId!, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: p.campusId, action: 'CREATE', entityType: 'MESS_PLAN', entityId: p.id, newValues: input }, client);
      return { ...p, amount: money(p.amount) };
    });
  }

  updatePlan(id: string, input: z.infer<typeof updateMessPlanSchema>, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const p = await tx.messPlan.findUnique({ where: { id } });
      if (!p || !canAccessCampus(this.setup.scope(auth, MESS), p.campusId)) throw NotFound('Mess plan');
      if (input.status === 'INACTIVE' && (await tx.messSubscription.count({ where: { messPlanId: id, status: 'ACTIVE' } }))) throw Conflict('plan-in-use', 'People are still on this plan — end their subscriptions first');
      const after = await tx.messPlan.update({ where: { id }, data: { ...input, ...(input.mealsIncluded ? { mealsIncluded: MEALS.filter((x) => input.mealsIncluded!.includes(x)) } : {}) } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: p.campusId, action: 'UPDATE', entityType: 'MESS_PLAN', entityId: id, oldValues: p, newValues: input }, client);
      return { ...after, amount: money(after.amount) };
    });
  }

  /** The menu in force on a date (the newest version that started on or before it). */
  menu(campusId: string, date: string, auth: AuthContext) {
    if (!canAccessCampus(this.setup.scope(auth), campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), (tx) => this.menuTx(tx, campusId, date));
  }

  async menuTx(tx: Tx, campusId: string, date: string) {
    const latest = await tx.messMenu.findFirst({ where: { campusId, effectiveFrom: { lte: day(date) } }, orderBy: { effectiveFrom: 'desc' }, select: { effectiveFrom: true } });
    if (!latest) return { effectiveFrom: null, items: [] as { dayOfWeek: number; meal: string; items: string }[] };
    const rows = await tx.messMenu.findMany({ where: { campusId, effectiveFrom: latest.effectiveFrom }, orderBy: [{ dayOfWeek: 'asc' }] });
    const order = (m: string) => MEALS.indexOf(m as (typeof MEALS)[number]);
    return { effectiveFrom: iso(latest.effectiveFrom), items: rows.sort((a, b) => a.dayOfWeek - b.dayOfWeek || order(a.meal) - order(b.meal)).map((r) => ({ dayOfWeek: r.dayOfWeek, meal: r.meal, items: r.items })) };
  }

  saveMenu(input: SaveMenuInput, auth: AuthContext, client: ClientInfo) {
    if (!canAccessCampus(this.setup.scope(auth, MESS), input.campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      // Saving again for the same start date replaces that version (history of other dates kept).
      const existing = await tx.messMenu.findMany({ where: { campusId: input.campusId, effectiveFrom: day(input.effectiveFrom) }, select: { id: true, dayOfWeek: true, meal: true } });
      for (const i of input.items) {
        const e = existing.find((x) => x.dayOfWeek === i.dayOfWeek && x.meal === i.meal);
        if (e) await tx.messMenu.update({ where: { id: e.id }, data: { items: i.items } });
        else await tx.messMenu.create({ data: { tenantId: auth.tenantId!, campusId: input.campusId, dayOfWeek: i.dayOfWeek, meal: i.meal, items: i.items, effectiveFrom: day(input.effectiveFrom), createdBy: auth.userId } });
      }
      const gone = existing.filter((e) => !input.items.some((i) => i.dayOfWeek === e.dayOfWeek && i.meal === e.meal));
      for (const g of gone) await tx.messMenu.update({ where: { id: g.id }, data: { items: '—' } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: input.campusId, action: 'UPDATE', entityType: 'MESS_MENU', entityId: input.campusId, newValues: { effectiveFrom: input.effectiveFrom, items: input.items.length } }, client);
      return this.menuTx(tx, input.campusId, input.effectiveFrom);
    });
  }

  subscribe(input: MessSubscribeInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const p = await tx.messPlan.findUnique({ where: { id: input.messPlanId } });
      if (!p || p.status !== 'ACTIVE' || !canAccessCampus(this.setup.scope(auth, MESS), p.campusId)) throw NotFound('Mess plan');
      let who: { campusId: string; label: string };
      let student: { id: string; tenantId: string; campusId: string; firstName: string; lastName: string | null; admissionNo: string } | null = null;
      if (input.studentId) {
        const s = await tx.student.findUnique({ where: { id: input.studentId }, select: { id: true, tenantId: true, campusId: true, firstName: true, lastName: true, admissionNo: true, status: true } });
        if (!s) throw NotFound('Student');
        if (s.status !== 'ACTIVE') throw Conflict('student-not-active', 'Only a current student can join the mess');
        student = s; who = { campusId: s.campusId, label: `${s.firstName} ${s.lastName ?? ''}`.trim() };
      } else {
        const e = await tx.employee.findUnique({ where: { id: input.employeeId! }, select: { campusId: true, firstName: true, lastName: true, status: true } });
        if (!e) throw NotFound('Staff member');
        if (!['ACTIVE', 'ON_LEAVE'].includes(e.status)) throw Conflict('staff-left', 'This staff member has left');
        who = { campusId: e.campusId, label: `${e.firstName} ${e.lastName ?? ''}`.trim() };
      }
      if (who.campusId !== p.campusId) throw unprocessable('plan-other-campus', 'Choose a plan of the same campus', 'messPlanId');
      const open = await tx.messSubscription.findFirst({ where: { status: 'ACTIVE', ...(input.studentId ? { studentId: input.studentId } : { employeeId: input.employeeId! }) }, select: { id: true } });
      if (open) throw Conflict('already-subscribed', `${who.label} is already on a mess plan — end it first`);
      let invoiceId: string | null = null;
      let billed: string | null = null;
      if (student && input.bill && p.billingType === 'FIXED') {
        const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { name: true, startDate: true, endDate: true } });
        if (!year) throw Conflict('no-open-year', 'There is no current academic year');
        const head = await tx.feeHead.findFirst({ where: { feeType: 'MESS', status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
        if (!head) throw Conflict('no-mess-fee-head', 'Add a fee head of type Mess in Fees → Setup first, or untick "Add the mess fee to the bills"');
        const months = monthsLeft(iso(year.startDate)!, iso(year.endDate)!, input.fromDate);
        const amount = toPaise(String(p.amount)) * months;
        if (amount > 0) {
          const inv = await this.billing.chargeInTx(tx, student, { feeHeadId: head.id, amount: fromPaise(amount), dueDate: input.fromDate < todayIST() ? todayIST() : input.fromDate, description: `Mess ${year.name} · ${p.name} (${months} month${months === 1 ? '' : 's'})` }, auth.userId);
          invoiceId = inv.id; billed = fromPaise(amount);
        }
      }
      const sub = await tx.messSubscription.create({ data: { tenantId: auth.tenantId!, studentId: input.studentId ?? null, employeeId: input.employeeId ?? null, messPlanId: p.id, fromDate: day(input.fromDate), invoiceId, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: p.campusId, action: 'CREATE', entityType: 'MESS_SUBSCRIPTION', entityId: sub.id, newValues: { who: who.label, plan: p.name, fromDate: input.fromDate, billed } }, client);
      return { ...sub, fromDate: iso(sub.fromDate), billed };
    });
  }

  endSubscription(id: string, toDate: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const sub = await tx.messSubscription.findUnique({ where: { id }, include: { plan: { select: { campusId: true } } } });
      if (!sub || !canAccessCampus(this.setup.scope(auth, MESS), sub.plan.campusId)) throw NotFound('Subscription');
      if (sub.status !== 'ACTIVE') throw Conflict('subscription-ended', 'This subscription has already ended');
      if (toDate < iso(sub.fromDate)!) throw unprocessable('end-before-start', 'The last day is before the first day', 'toDate');
      const after = await tx.messSubscription.update({ where: { id }, data: { status: 'ENDED', toDate: day(toDate) } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: sub.plan.campusId, action: 'STATUS_CHANGE', entityType: 'MESS_SUBSCRIPTION', entityId: id, oldValues: { status: 'ACTIVE' }, newValues: { status: 'ENDED', toDate } }, client);
      return { ...after, fromDate: iso(after.fromDate), toDate: iso(after.toDate) };
    });
  }

  subscriptions(planId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const p = await tx.messPlan.findUnique({ where: { id: planId } });
      if (!p || !canAccessCampus(this.setup.scope(auth), p.campusId)) throw NotFound('Mess plan');
      const rows = await tx.$queryRaw<{ id: string; status: string; from_date: Date; to_date: Date | null; name: string; code: string; kind: string }[]>`
        SELECT m.id, m.status, m.from_date, m.to_date,
               coalesce(trim(s.first_name || ' ' || coalesce(s.last_name, '')), trim(e.first_name || ' ' || coalesce(e.last_name, ''))) AS name,
               coalesce(s.admission_no, e.employee_code) AS code, CASE WHEN m.student_id IS NULL THEN 'STAFF' ELSE 'STUDENT' END AS kind
          FROM mess_subscriptions m LEFT JOIN students s ON s.id = m.student_id LEFT JOIN employees e ON e.id = m.employee_id
         WHERE m.mess_plan_id = ${planId}::uuid
         ORDER BY m.status, name`;
      return { plan: { ...p, amount: money(p.amount) }, subscribers: rows.map((r) => ({ id: r.id, status: r.status, fromDate: iso(r.from_date), toDate: iso(r.to_date), name: r.name, code: r.code, kind: r.kind })) };
    });
  }

  /** How many to cook for, per meal, on a date — everyone whose subscription covers that day — and that day's menu. */
  counts(campusId: string, date: string, auth: AuthContext) {
    if (!canAccessCampus(this.setup.scope(auth), campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.$queryRaw<{ meal: string; students: number; staff: number }[]>`
        SELECT meal, count(*) FILTER (WHERE m.student_id IS NOT NULL)::int AS students, count(*) FILTER (WHERE m.employee_id IS NOT NULL)::int AS staff
          FROM mess_subscriptions m JOIN mess_plans p ON p.id = m.mess_plan_id CROSS JOIN LATERAL unnest(p.meals_included) AS meal
         WHERE p.campus_id = ${campusId}::uuid AND m.from_date <= ${date}::date AND (m.to_date IS NULL OR m.to_date >= ${date}::date) AND m.status IN ('ACTIVE', 'ENDED')
         GROUP BY meal`;
      const menu = await this.menuTx(tx, campusId, date);
      const wd = weekday(date);
      return {
        date, dayOfWeek: wd,
        meals: MEALS.map((m) => {
          const r = rows.find((x) => x.meal === m);
          return { meal: m, students: r?.students ?? 0, staff: r?.staff ?? 0, total: (r?.students ?? 0) + (r?.staff ?? 0), menu: menu.items.find((x) => x.dayOfWeek === wd && x.meal === m)?.items ?? null };
        }),
      };
    });
  }

  /** For the parent app / profile: the student's plan and today's menu. */
  async forStudentTx(tx: Tx, studentId: string) {
    const sub = await tx.messSubscription.findFirst({ where: { studentId, status: 'ACTIVE' }, include: { plan: true } });
    if (!sub) return null;
    const menu = await this.menuTx(tx, sub.plan.campusId, todayIST());
    const wd = weekday(todayIST());
    return { plan: sub.plan.name, meals: sub.plan.mealsIncluded, since: iso(sub.fromDate), today: menu.items.filter((x) => x.dayOfWeek === wd && sub.plan.mealsIncluded.includes(x.meal)) };
  }
}
