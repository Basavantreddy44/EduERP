import { Injectable } from '@nestjs/common';
import { DietScaleInput, MealCountsInput, PERMISSIONS } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { unprocessable } from '../accounts/books';
import { addDays, day, iso, todayIST } from '../campuslife/common';

export const DEFAULT_TOLERANCE = 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export interface DietLine { itemId: string; item: string; unit: string; childDays: number; due: number; issued: number; difference: number; percent: number | null; flagged: boolean }

/**
 * Diet scale and daily meal register (improvement round G3). Head office sets the quantity of each
 * food item per child per day (for all classes or named classes, from a date); each campus records how
 * many children of each class ate each meal; the diet report compares what the scale allows for the
 * children fed with what the campus stores actually issued (kitchen issues, not transfers or welfare).
 */
@Injectable()
export class DietService {
  constructor(private readonly db: Db, private readonly audit: AuditService) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  private readers(auth: AuthContext) {
    return [PERMISSIONS.HOSTEL_READ, PERMISSIONS.MEALS_RECORD, PERMISSIONS.DIET_MANAGE, PERMISSIONS.OVERVIEW_READ].map((p) => scopeFor(auth, p)).filter((s) => !!s);
  }
  /** The campus must belong to the institution (row-level security) and be within the user's reach. */
  private async canRead(tx: Tx, auth: AuthContext, campusId: string) {
    if (!this.readers(auth).some((s) => canAccessCampus(s!, campusId))) return false;
    return !!(await tx.campus.findUnique({ where: { id: campusId }, select: { id: true } }));
  }

  // ───────────── Scale ─────────────

  scale(auth: AuthContext) {
    if (!this.readers(auth).length) throw Forbidden();
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.dietScaleItem.findMany({ orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'asc' }] });
      const items = new Map((await tx.inventoryItem.findMany({ where: { id: { in: rows.map((r) => r.inventoryItemId) } }, select: { id: true, name: true, unit: true } })).map((i) => [i.id, i]));
      const options = await tx.inventoryItem.findMany({ where: { isActive: true, itemType: 'CONSUMABLE' }, orderBy: { name: 'asc' }, select: { id: true, name: true, unit: true } });
      const levels = (await tx.programLevel.findMany({ distinct: ['name'], orderBy: [{ sequence: 'asc' }, { name: 'asc' }], select: { name: true } })).map((l) => l.name);
      const today = todayIST();
      return {
        rows: rows.map((r) => ({ id: r.id, inventoryItemId: r.inventoryItemId, item: items.get(r.inventoryItemId)?.name ?? '', unit: items.get(r.inventoryItemId)?.unit ?? '', quantityPerChild: Number(r.quantityPerChild.toString()), levelNames: r.levelNames, effectiveFrom: iso(r.effectiveFrom), effectiveTo: iso(r.effectiveTo), current: iso(r.effectiveFrom)! <= today && (!r.effectiveTo || iso(r.effectiveTo)! >= today) })),
        items: options, levels, canEdit: !!scopeFor(auth, PERMISSIONS.DIET_MANAGE)?.all,
      };
    });
  }

  private manager(auth: AuthContext) {
    if (!scopeFor(auth, PERMISSIONS.DIET_MANAGE)?.all) throw Forbidden('all-campus-only', 'The diet scale applies to every campus — only someone with this right for all campuses can change it');
  }

  saveScale(id: string | null, input: DietScaleInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      this.manager(auth);
      const item = await tx.inventoryItem.findUnique({ where: { id: input.inventoryItemId }, select: { id: true, name: true } });
      if (!item) throw NotFound('Item');
      const old = id ? await tx.dietScaleItem.findUnique({ where: { id } }) : null;
      if (id && !old) throw NotFound('Diet scale line');
      // The same item for an overlapping class group and period would be counted twice.
      const others = await tx.dietScaleItem.findMany({ where: { inventoryItemId: item.id, ...(old ? { id: { not: old.id } } : {}) } });
      const levels = [...new Set(input.levelNames)];
      for (const o of others) {
        const datesOverlap = (!o.effectiveTo || iso(o.effectiveTo)! >= input.effectiveFrom) && (!input.effectiveTo || input.effectiveTo >= iso(o.effectiveFrom)!);
        const levelsOverlap = !o.levelNames.length || !levels.length || o.levelNames.some((l) => levels.includes(l));
        if (datesOverlap && levelsOverlap) throw unprocessable('overlap', `${item.name} is already on the scale for some of these classes in this period — end that line first`, 'inventoryItemId');
      }
      const data = { inventoryItemId: item.id, quantityPerChild: String(input.quantityPerChild), levelNames: levels, effectiveFrom: day(input.effectiveFrom), effectiveTo: input.effectiveTo ? day(input.effectiveTo) : null };
      const row = old ? await tx.dietScaleItem.update({ where: { id: old.id }, data }) : await tx.dietScaleItem.create({ data: { ...data, tenantId: auth.tenantId!, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: old ? 'UPDATE' : 'CREATE', entityType: 'DIET_SCALE', entityId: row.id, oldValues: old ? { quantityPerChild: old.quantityPerChild.toString(), levelNames: old.levelNames, effectiveFrom: iso(old.effectiveFrom), effectiveTo: iso(old.effectiveTo) } : undefined, newValues: { item: item.name, ...input } }, client);
      return { id: row.id };
    });
  }

  removeScale(id: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      this.manager(auth);
      const old = await tx.dietScaleItem.findUnique({ where: { id } });
      if (!old) throw NotFound('Diet scale line');
      await tx.dietScaleItem.delete({ where: { id } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'DELETE', entityType: 'DIET_SCALE', entityId: id, oldValues: { inventoryItemId: old.inventoryItemId, quantityPerChild: old.quantityPerChild.toString(), levelNames: old.levelNames } }, client);
      return { deleted: true };
    });
  }

  // ───────────── Meal register ─────────────

  /** The register for a campus and day: one line per class, saved counts or a suggestion from the hostel roll call. */
  meals(campusId: string, date: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      if (!(await this.canRead(tx, auth, campusId))) throw NotFound('Campus');
      const levels = await tx.section.findMany({ where: { campusId, status: 'ACTIVE', academicYear: { isCurrent: true } }, distinct: ['programLevelId'], orderBy: { level: { sequence: 'asc' } }, select: { level: { select: { name: true, sequence: true } } } });
      const saved = await tx.mealCount.findMany({ where: { campusId, mealDate: day(date) } });
      const present = await tx.$queryRaw<{ level: string; n: bigint }[]>`
        SELECT pl.name AS level, COUNT(DISTINCT r.student_id) AS n
        FROM hostel_roll_calls r JOIN hostels h ON h.id = r.hostel_id
        JOIN student_enrollments e ON e.student_id = r.student_id AND e.status = 'ACTIVE'
        JOIN sections s ON s.id = e.section_id JOIN academic_years y ON y.id = s.academic_year_id AND y.is_current
        JOIN program_levels pl ON pl.id = s.program_level_id
        WHERE h.campus_id = ${campusId}::uuid AND r.attendance_date = ${day(date)}::date AND r.status = 'PRESENT'
        GROUP BY pl.name`;
      const P = new Map(present.map((p) => [p.level, Number(p.n)]));
      const names = [...new Set([...levels.map((l) => l.level.name), ...saved.map((s) => s.levelName)])];
      const rec = scopeFor(auth, PERMISSIONS.MEALS_RECORD);
      return {
        campusId, date, saved: saved.length > 0, rollCallTaken: present.length > 0,
        rows: names.map((n) => { const s = saved.find((x) => x.levelName === n); return { levelName: n, presentInHostel: P.get(n) ?? null, breakfast: s?.breakfast ?? null, lunch: s?.lunch ?? null, snacks: s?.snacks ?? null, dinner: s?.dinner ?? null }; }),
        canRecord: !!rec && canAccessCampus(rec, campusId) && date <= todayIST(),
      };
    });
  }

  saveMeals(input: MealCountsInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rec = scopeFor(auth, PERMISSIONS.MEALS_RECORD);
      if (!rec || !canAccessCampus(rec, input.campusId) || !(await tx.campus.findUnique({ where: { id: input.campusId }, select: { id: true } }))) throw NotFound('Campus');
      if (input.mealDate > todayIST()) throw unprocessable('future-date', 'Meals can only be recorded for today or earlier', 'mealDate');
      const names = input.rows.map((r) => r.levelName);
      if (new Set(names).size !== names.length) throw unprocessable('duplicate-class', 'A class is listed twice', 'rows');
      for (const r of input.rows) {
        await tx.mealCount.upsert({
          where: { tenantId_campusId_mealDate_levelName: { tenantId: auth.tenantId!, campusId: input.campusId, mealDate: day(input.mealDate), levelName: r.levelName } },
          create: { tenantId: auth.tenantId!, campusId: input.campusId, mealDate: day(input.mealDate), levelName: r.levelName, breakfast: r.breakfast, lunch: r.lunch, snacks: r.snacks, dinner: r.dinner, updatedBy: auth.userId },
          update: { breakfast: r.breakfast, lunch: r.lunch, snacks: r.snacks, dinner: r.dinner, updatedBy: auth.userId },
        });
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: input.campusId, action: 'UPDATE', entityType: 'MEAL_REGISTER', entityId: input.campusId, newValues: { date: input.mealDate, rows: input.rows } }, client);
      return { saved: input.rows.length };
    });
  }

  // ───────────── Diet report ─────────────

  /** Per campus and item: children-days, quantity due by the scale, quantity issued, difference. */
  async compute(tx: Tx, campusIds: string[], from: string, to: string, tolerance = DEFAULT_TOLERANCE): Promise<Map<string, { lines: DietLine[]; days: number; meals: { breakfast: number; lunch: number; snacks: number; dinner: number } }>> {
    const out = new Map<string, { lines: DietLine[]; days: number; meals: { breakfast: number; lunch: number; snacks: number; dinner: number } }>();
    if (!campusIds.length) return out;
    const scale = await tx.dietScaleItem.findMany({ where: { effectiveFrom: { lte: day(to) }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: day(from) } }] } });
    const counts = await tx.mealCount.findMany({ where: { campusId: { in: campusIds }, mealDate: { gte: day(from), lte: day(to) } } });
    const itemIds = [...new Set(scale.map((s) => s.inventoryItemId))];
    const items = new Map((await tx.inventoryItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true, unit: true } })).map((i) => [i.id, i]));
    const issued = itemIds.length ? await tx.$queryRaw<{ campus_id: string; item_id: string; q: string }[]>`
      SELECT st.campus_id, t.item_id, SUM(t.quantity)::text AS q FROM stock_transactions t JOIN stores st ON st.id = t.store_id
      WHERE t.txn_type = 'ISSUE_OUT' AND t.reference_type = 'ISSUE' AND t.txn_date BETWEEN ${day(from)}::date AND ${day(to)}::date
        AND st.campus_id = ANY(${campusIds}::uuid[]) AND t.item_id = ANY(${itemIds}::uuid[])
      GROUP BY st.campus_id, t.item_id` : [];
    for (const c of campusIds) {
      const cc = counts.filter((m) => m.campusId === c);
      const days = new Set(cc.map((m) => iso(m.mealDate))).size;
      const meals = { breakfast: 0, lunch: 0, snacks: 0, dinner: 0 };
      for (const m of cc) { meals.breakfast += m.breakfast; meals.lunch += m.lunch; meals.snacks += m.snacks; meals.dinner += m.dinner; }
      const lines: DietLine[] = itemIds.map((itemId) => {
        let due = 0;
        let childDays = 0;
        for (const m of cc) {
          const d = iso(m.mealDate)!;
          const fed = Math.max(m.breakfast, m.lunch, m.snacks, m.dinner);
          const rule = scale.find((s) => s.inventoryItemId === itemId && iso(s.effectiveFrom)! <= d && (!s.effectiveTo || iso(s.effectiveTo)! >= d) && (!s.levelNames.length || s.levelNames.includes(m.levelName)));
          if (!rule) continue;
          childDays += fed;
          due += fed * Number(rule.quantityPerChild.toString());
        }
        const got = Number(issued.find((x) => x.campus_id === c && x.item_id === itemId)?.q ?? 0);
        const diff = got - due;
        const percent = due > 0 ? Math.round((diff * 1000) / due) / 10 : null;
        const it = items.get(itemId);
        return { itemId, item: it?.name ?? '', unit: it?.unit ?? '', childDays, due: r3(due), issued: r3(got), difference: r3(diff), percent, flagged: due > 0 ? Math.abs(percent!) > tolerance : got > 0 };
      }).filter((l) => l.childDays > 0 || l.issued > 0).sort((a, b) => a.item.localeCompare(b.item));
      out.set(c, { lines, days, meals });
    }
    return out;
  }

  report(auth: AuthContext, campusId: string, from: string, to: string, tolerance = DEFAULT_TOLERANCE) {
    return this.db.run(this.ctx(auth), async (tx) => {
      if (!(await this.canRead(tx, auth, campusId))) throw NotFound('Campus');
      if (to < from) throw unprocessable('bad-range', 'The end is before the start', 'to');
      const res = (await this.compute(tx, [campusId], from, to, tolerance)).get(campusId)!;
      const scaleCount = await tx.dietScaleItem.count();
      return { campusId, from, to, tolerance, days: res.days, meals: res.meals, lines: res.lines, flagged: res.lines.filter((l) => l.flagged).length, scaleSet: scaleCount > 0 };
    });
  }

  /** Overview: items flagged per campus in the period. */
  async summaryByCampus(tx: Tx, campusIds: string[], from: string, to: string) {
    const res = await this.compute(tx, campusIds, from, to);
    return new Map([...res].filter(([, v]) => v.days > 0).map(([k, v]) => [k, { flagged: v.lines.filter((l) => l.flagged).length, items: v.lines.length }]));
  }

  /** Campuses the user can open the register / report for. */
  campuses(auth: AuthContext) {
    if (!this.readers(auth).length) throw Forbidden();
    return this.db.run(this.ctx(auth), async (tx) => {
      const sc = this.readers(auth);
      const all = sc.some((s) => s!.all);
      const ids = [...new Set(sc.flatMap((s) => (s!.all ? [] : s!.campusIds)))];
      const rows = await tx.campus.findMany({ where: { status: 'ACTIVE', ...(all ? {} : { id: { in: ids } }) }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
      // Campuses with a hostel first: that is where meals are served.
      const withHostel = new Set((await tx.hostel.findMany({ where: { status: 'ACTIVE' }, select: { campusId: true } })).map((h) => h.campusId));
      const campuses = [...rows.filter((r) => withHostel.has(r.id)), ...rows.filter((r) => !withHostel.has(r.id))];
      return { campuses, today: todayIST(), monthStart: `${todayIST().slice(0, 8)}01`, yesterday: addDays(todayIST(), -1), tolerance: DEFAULT_TOLERANCE };
    });
  }
}

