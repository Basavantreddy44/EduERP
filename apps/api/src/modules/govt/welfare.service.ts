import { Injectable } from '@nestjs/common';
import { PERMISSIONS, WelfareGiveInput, WelfareSchemeInput, fromPaise, toPaise } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { EntitlementsService } from '../platform/entitlements.service';
import { unprocessable } from '../accounts/books';
import { move } from '../inventory/stock';
import { day, fullName, iso, scopeCampuses } from '../campuslife/common';

type Scheme = { id: string; academicYearId: string; name: string; kind: string; inventoryItemId: string | null; quantityPerStudent: { toString(): string } | null; amountPerStudent: { toString(): string } | null; levelNames: string[]; gender: string; status: string };
/** Hundredths of a unit (quantities) or paise (amounts) — both 2 decimals. */
const h = (v: { toString(): string } | null | undefined) => (v == null ? 0 : toPaise(v.toString()));
const entitlement = (s: Scheme) => h(s.kind === 'ITEM' ? s.quantityPerStudent : s.amountPerStudent);
const applies = (s: Scheme, levelName: string, gender: string) => (!s.levelNames.length || s.levelNames.includes(levelName)) && (s.gender === 'ALL' || s.gender === gender);

/** Students of current-year sections (optionally one section / campus list) with their class name. */
async function enrolled(tx: Tx, o: { campusIds?: string[] | null; sectionId?: string; academicYearId?: string }) {
  return tx.studentEnrollment.findMany({
    where: {
      status: 'ACTIVE', student: { status: 'ACTIVE' },
      ...(o.sectionId ? { sectionId: o.sectionId } : {}),
      ...(o.academicYearId ? { academicYearId: o.academicYearId } : { academicYear: { isCurrent: true } }),
      ...(o.campusIds ? { section: { campusId: { in: o.campusIds } } } : {}),
    },
    select: { studentId: true, rollNo: true, section: { select: { id: true, name: true, campusId: true, level: { select: { name: true } } } }, student: { select: { firstName: true, lastName: true, admissionNo: true, gender: true } } },
    orderBy: [{ student: { firstName: 'asc' } }],
  });
}
async function givenMap(tx: Tx, schemeIds: string[], studentIds?: string[]) {
  const rows = await tx.welfareDistribution.groupBy({ by: ['schemeId', 'studentId'], where: { schemeId: { in: schemeIds }, ...(studentIds ? { studentId: { in: studentIds } } : {}) }, _sum: { quantity: true, amount: true }, _max: { givenOn: true } });
  return new Map(rows.map((r) => [`${r.schemeId}:${r.studentId}`, { given: h(r._sum.quantity) + h(r._sum.amount), last: r._max.givenOn }]));
}

/** Report rows (WELFARE_STATUS): who is entitled, how much they received, what is pending. */
export async function welfareStatusRows(tx: Tx, campuses: string[] | null, f: { campusId?: string; sectionId?: string; schemeId?: string }) {
  const schemes = (await tx.welfareScheme.findMany({ where: { status: 'ACTIVE', ...(f.schemeId ? { id: f.schemeId } : {}) }, orderBy: { name: 'asc' } })) as Scheme[];
  const current = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
  const list = schemes.filter((s) => f.schemeId || s.academicYearId === current?.id);
  if (!list.length) return [];
  const cs = f.campusId ? (campuses && !campuses.includes(f.campusId) ? [] : [f.campusId]) : campuses;
  const rows: Record<string, string | number | null>[] = [];
  const years = [...new Set(list.map((s) => s.academicYearId))];
  for (const y of years) {
    const en = await enrolled(tx, { campusIds: cs, sectionId: f.sectionId, academicYearId: y });
    const ys = list.filter((s) => s.academicYearId === y);
    const given = await givenMap(tx, ys.map((s) => s.id), en.map((e) => e.studentId));
    for (const s of ys) for (const e of en) {
      if (!applies(s, e.section.level.name, e.student.gender)) continue;
      const g = given.get(`${s.id}:${e.studentId}`);
      const due = entitlement(s);
      rows.push({ scheme: s.name, kind: s.kind === 'ITEM' ? 'Item' : 'Allowance', student: fullName(e.student), admissionNo: e.student.admissionNo, className: `${e.section.level.name} ${e.section.name}`, entitled: fromPaise(due), received: fromPaise(g?.given ?? 0), pending: fromPaise(Math.max(0, due - (g?.given ?? 0))), lastGiven: iso(g?.last) });
    }
  }
  return rows;
}

/**
 * Welfare items and allowances (improvement round G2): schemes per academic year set by head office,
 * hand-outs to a class that never exceed each student's entitlement (serialised per scheme), stock
 * leaving the store as a welfare movement, cash allowances with their payment reference.
 */
@Injectable()
export class WelfareService {
  constructor(private readonly db: Db, private readonly audit: AuditService) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  private allCampuses(auth: AuthContext) {
    const s = scopeFor(auth, PERMISSIONS.WELFARE_MANAGE);
    if (!s?.all) throw Forbidden('all-campus-only', 'Welfare schemes apply to every campus — only someone with this right for all campuses can change them');
  }
  private out(s: Scheme, item?: { name: string; unit: string } | null) {
    return { id: s.id, academicYearId: s.academicYearId, name: s.name, kind: s.kind, inventoryItemId: s.inventoryItemId, item: item?.name ?? null, unit: item?.unit ?? null, quantityPerStudent: s.quantityPerStudent ? Number(s.quantityPerStudent.toString()) : null, amountPerStudent: s.amountPerStudent ? fromPaise(h(s.amountPerStudent)) : null, levelNames: s.levelNames, gender: s.gender, status: s.status };
  }

  /** Campuses the user may see welfare for (null = all). */
  private reach(auth: AuthContext): string[] | null {
    const sc = [PERMISSIONS.WELFARE_READ, PERMISSIONS.WELFARE_GIVE, PERMISSIONS.WELFARE_MANAGE].map((p) => scopeFor(auth, p)).filter((x) => !!x);
    if (sc.some((x) => x!.all)) return null;
    return [...new Set(sc.flatMap((x) => scopeCampuses(x)!))];
  }
  private reader(auth: AuthContext) {
    if (![PERMISSIONS.WELFARE_READ, PERMISSIONS.WELFARE_GIVE, PERMISSIONS.WELFARE_MANAGE].some((p) => scopeFor(auth, p))) throw Forbidden();
  }

  options(auth: AuthContext) {
    this.reader(auth);
    return this.db.run(this.ctx(auth), async (tx) => {
      const on = await EntitlementsService.enabledModules(tx);
      const campuses = this.reach(auth);
      const [years, levels, items, sections, stores] = await Promise.all([
        tx.academicYear.findMany({ orderBy: { startDate: 'desc' }, select: { id: true, name: true, isCurrent: true } }),
        tx.programLevel.findMany({ distinct: ['name'], orderBy: [{ sequence: 'asc' }, { name: 'asc' }], select: { name: true } }),
        on.has('INVENTORY') ? tx.inventoryItem.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, unit: true, itemCode: true } }) : Promise.resolve([]),
        tx.section.findMany({ where: { status: 'ACTIVE', academicYear: { isCurrent: true }, ...(campuses ? { campusId: { in: campuses } } : {}) }, orderBy: [{ level: { sequence: 'asc' } }, { name: 'asc' }], select: { id: true, name: true, campusId: true, level: { select: { name: true } } } }),
        on.has('INVENTORY') ? tx.store.findMany({ where: { isActive: true, ...(campuses ? { campusId: { in: campuses } } : {}) }, orderBy: { name: 'asc' }, select: { id: true, name: true, campusId: true } }) : Promise.resolve([]),
      ]);
      const camp = await tx.campus.findMany({ where: campuses ? { id: { in: campuses } } : {}, orderBy: { name: 'asc' }, select: { id: true, name: true } });
      return { years, levels: levels.map((l) => l.name), items, stores, campuses: camp, sections: sections.map((s) => ({ id: s.id, name: `${s.level.name} ${s.name}`, levelName: s.level.name, campusId: s.campusId })), inventory: on.has('INVENTORY'), canManage: !!scopeFor(auth, PERMISSIONS.WELFARE_MANAGE)?.all };
    });
  }

  schemes(auth: AuthContext, academicYearId?: string) {
    this.reader(auth);
    return this.db.run(this.ctx(auth), async (tx) => {
      const year = academicYearId ?? (await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } }))?.id;
      const rows = (await tx.welfareScheme.findMany({ where: year ? { academicYearId: year } : {}, orderBy: [{ status: 'asc' }, { name: 'asc' }] })) as Scheme[];
      const items = new Map((await tx.inventoryItem.findMany({ where: { id: { in: rows.map((r) => r.inventoryItemId).filter((x): x is string => !!x) } }, select: { id: true, name: true, unit: true } })).map((i) => [i.id, i]));
      const campuses = this.reach(auth);
      const en = await enrolled(tx, { campusIds: campuses, academicYearId: year });
      const given = await givenMap(tx, rows.map((r) => r.id), en.map((e) => e.studentId));
      return rows.map((s) => {
        const eligible = en.filter((e) => applies(s, e.section.level.name, e.student.gender));
        const due = entitlement(s);
        const done = eligible.filter((e) => (given.get(`${s.id}:${e.studentId}`)?.given ?? 0) >= due).length;
        return { ...this.out(s, s.inventoryItemId ? items.get(s.inventoryItemId) : null), eligible: eligible.length, fullyGiven: done };
      });
    });
  }

  saveScheme(id: string | null, input: WelfareSchemeInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      this.allCampuses(auth);
      if (!(await tx.academicYear.findUnique({ where: { id: input.academicYearId }, select: { id: true } }))) throw NotFound('Academic year');
      if (input.inventoryItemId && !(await tx.inventoryItem.findUnique({ where: { id: input.inventoryItemId }, select: { id: true } }))) throw NotFound('Item');
      const old = id ? ((await tx.welfareScheme.findUnique({ where: { id } })) as Scheme | null) : null;
      if (id && !old) throw NotFound('Welfare scheme');
      const clash = await tx.welfareScheme.findFirst({ where: { academicYearId: input.academicYearId, name: { equals: input.name, mode: 'insensitive' }, ...(old ? { id: { not: old.id } } : {}) }, select: { id: true } });
      if (clash) throw Conflict('duplicate-name', 'A scheme with this name already exists for the year');
      if (old) {
        const given = await tx.welfareDistribution.groupBy({ by: ['studentId'], where: { schemeId: old.id }, _sum: { quantity: true, amount: true } });
        if (given.length) {
          if (old.kind !== input.kind || old.inventoryItemId !== input.inventoryItemId || old.academicYearId !== input.academicYearId) throw Conflict('scheme-in-use', 'Some students have already received this — the kind, the item and the year can no longer change');
          const most = Math.max(...given.map((g) => h(g._sum.quantity) + h(g._sum.amount)));
          const now = toPaise(String(input.kind === 'ITEM' ? input.quantityPerStudent : input.amountPerStudent));
          if (now < most) throw unprocessable('below-given', `A student has already received ${fromPaise(most)} — the entitlement cannot be lower`, input.kind === 'ITEM' ? 'quantityPerStudent' : 'amountPerStudent');
        }
      }
      const data = {
        academicYearId: input.academicYearId, name: input.name, kind: input.kind, inventoryItemId: input.kind === 'ITEM' ? input.inventoryItemId : null,
        quantityPerStudent: input.kind === 'ITEM' ? String(input.quantityPerStudent) : null, amountPerStudent: input.kind === 'CASH' ? String(input.amountPerStudent) : null,
        levelNames: [...new Set(input.levelNames)], gender: input.gender, status: input.status,
      };
      const row = old ? await tx.welfareScheme.update({ where: { id: old.id }, data }) : await tx.welfareScheme.create({ data: { ...data, tenantId: auth.tenantId!, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: old ? 'UPDATE' : 'CREATE', entityType: 'WELFARE_SCHEME', entityId: row.id, oldValues: old ? this.out(old) : undefined, newValues: input }, client);
      return { id: row.id };
    });
  }

  /** The students of a class for a scheme: entitled, received, pending. */
  section(schemeId: string, sectionId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const { s, sec } = await this.load(tx, schemeId, sectionId, auth, false);
      const en = await enrolled(tx, { sectionId: sec.id, academicYearId: s.academicYearId });
      const given = await givenMap(tx, [s.id], en.map((e) => e.studentId));
      const due = entitlement(s);
      const item = s.inventoryItemId ? await tx.inventoryItem.findUnique({ where: { id: s.inventoryItemId }, select: { name: true, unit: true } }) : null;
      const gv = scopeFor(auth, PERMISSIONS.WELFARE_GIVE);
      return {
        scheme: this.out(s, item), section: { id: sec.id, name: `${sec.level.name} ${sec.name}`, campusId: sec.campusId },
        students: en.map((e) => {
          const g = given.get(`${s.id}:${e.studentId}`)?.given ?? 0;
          const ok = applies(s, e.section.level.name, e.student.gender);
          return { studentId: e.studentId, name: fullName(e.student), admissionNo: e.student.admissionNo, rollNo: e.rollNo, gender: e.student.gender, eligible: ok, entitled: ok ? fromPaise(due) : '0.00', received: fromPaise(g), pending: ok ? fromPaise(Math.max(0, due - g)) : '0.00', lastGiven: iso(given.get(`${s.id}:${e.studentId}`)?.last) };
        }),
        canGive: !!gv && canAccessCampus(gv, sec.campusId) && s.status === 'ACTIVE',
      };
    });
  }

  private async load(tx: Tx, schemeId: string, sectionId: string, auth: AuthContext, give: boolean) {
    const s = (await tx.welfareScheme.findUnique({ where: { id: schemeId } })) as Scheme | null;
    if (!s) throw NotFound('Welfare scheme');
    const sec = await tx.section.findUnique({ where: { id: sectionId }, select: { id: true, name: true, campusId: true, academicYearId: true, level: { select: { name: true } } } });
    const gv = scopeFor(auth, PERMISSIONS.WELFARE_GIVE);
    const reach = this.reach(auth);
    const ok = !!sec && (give ? !!gv && canAccessCampus(gv, sec.campusId) : (reach === null || reach.includes(sec.campusId)) && [PERMISSIONS.WELFARE_READ, PERMISSIONS.WELFARE_GIVE, PERMISSIONS.WELFARE_MANAGE].some((p) => scopeFor(auth, p)));
    if (!sec || !ok) throw NotFound('Class');
    if (sec.academicYearId !== s.academicYearId) throw unprocessable('other-year', 'This class belongs to another academic year than the scheme', 'sectionId');
    return { s, sec };
  }

  give(schemeId: string, input: WelfareGiveInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      // One hand-out per scheme at a time, so two people never give the same student twice.
      await tx.$queryRaw`SELECT id FROM welfare_schemes WHERE id = ${schemeId}::uuid FOR UPDATE`;
      const { s, sec } = await this.load(tx, schemeId, input.sectionId, auth, true);
      if (s.status !== 'ACTIVE') throw Conflict('scheme-closed', 'This scheme is closed');
      if (s.kind === 'CASH' && !input.reference) throw unprocessable('reference-required', 'Enter the payment reference (cheque, transfer or DBT number)', 'reference');
      const on = await EntitlementsService.enabledModules(tx);
      const stocked = s.kind === 'ITEM' && !!s.inventoryItemId && on.has('INVENTORY');
      let store: { id: string; name: string } | null = null;
      if (stocked) {
        if (!input.storeId) throw unprocessable('store-required', 'Choose the store the items leave from', 'storeId');
        const st = await tx.store.findUnique({ where: { id: input.storeId }, select: { id: true, name: true, campusId: true, isActive: true } });
        if (!st || !st.isActive || st.campusId !== sec.campusId) throw unprocessable('store-other-campus', 'Choose a store of this class’s campus', 'storeId');
        store = st;
      }
      const en = await enrolled(tx, { sectionId: sec.id, academicYearId: s.academicYearId });
      const pick = input.studentIds.length ? new Set(input.studentIds) : null;
      if (pick) for (const id of pick) if (!en.some((e) => e.studentId === id)) throw unprocessable('not-in-class', 'A chosen student is not in this class', 'studentIds');
      const given = await givenMap(tx, [s.id], en.map((e) => e.studentId));
      const due = entitlement(s);
      const lines = en
        .filter((e) => (!pick || pick.has(e.studentId)) && applies(s, e.section.level.name, e.student.gender))
        .map((e) => ({ e, left: due - (given.get(`${s.id}:${e.studentId}`)?.given ?? 0) }))
        .filter((l) => l.left > 0);
      const skipped = (pick ? pick.size : en.length) - lines.length;
      if (!lines.length) return { given: 0, skipped, total: '0.00' };
      const total = lines.reduce((t, l) => t + l.left, 0);
      if (stocked) {
        const item = await tx.inventoryItem.findUnique({ where: { id: s.inventoryItemId! }, select: { name: true } });
        await move(tx, { tenantId: auth.tenantId!, storeId: store!.id, itemId: s.inventoryItemId!, quantityH: total, date: input.givenOn, txnType: 'ISSUE_OUT', refType: 'WELFARE', refId: s.id, userId: auth.userId, remarks: `Welfare: ${s.name} — ${sec.level.name} ${sec.name} (${lines.length} students)`.slice(0, 200) }, item?.name);
      }
      await tx.welfareDistribution.createMany({
        data: lines.map((l) => ({
          tenantId: auth.tenantId!, schemeId: s.id, studentId: l.e.studentId, campusId: sec.campusId, givenOn: day(input.givenOn),
          quantity: s.kind === 'ITEM' ? fromPaise(l.left) : null, amount: s.kind === 'CASH' ? fromPaise(l.left) : null,
          storeId: store?.id ?? null, reference: input.reference, remarks: input.remarks, createdBy: auth.userId!,
        })),
      });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: sec.campusId, action: 'CREATE', entityType: 'WELFARE_HANDOUT', entityId: s.id, newValues: { scheme: s.name, class: `${sec.level.name} ${sec.name}`, students: lines.length, total: fromPaise(total), store: store?.name ?? null, reference: input.reference } }, client);
      return { given: lines.length, skipped, total: fromPaise(total) };
    });
  }

  /** What one student received (student profile). */
  student(studentId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const st = await tx.student.findUnique({ where: { id: studentId }, select: { campusId: true } });
      const sc = scopeFor(auth, PERMISSIONS.WELFARE_READ) ?? scopeFor(auth, PERMISSIONS.STU_STUDENT_READ);
      if (!st || !sc || !canAccessCampus(sc, st.campusId)) throw NotFound('Student');
      const rows = await tx.welfareDistribution.findMany({ where: { studentId }, orderBy: { givenOn: 'desc' } });
      const schemes = new Map((await tx.welfareScheme.findMany({ where: { id: { in: rows.map((r) => r.schemeId) } }, select: { id: true, name: true, kind: true, inventoryItemId: true } })).map((s) => [s.id, s]));
      const items = new Map((await tx.inventoryItem.findMany({ where: { id: { in: [...schemes.values()].map((s) => s.inventoryItemId).filter((x): x is string => !!x) } }, select: { id: true, unit: true } })).map((i) => [i.id, i.unit]));
      return rows.map((r) => { const s = schemes.get(r.schemeId); return { id: r.id, scheme: s?.name ?? '', kind: s?.kind ?? 'ITEM', givenOn: iso(r.givenOn), quantity: r.quantity ? Number(r.quantity.toString()) : null, unit: s?.inventoryItemId ? items.get(s.inventoryItemId) ?? null : null, amount: r.amount ? fromPaise(h(r.amount)) : null, reference: r.reference }; });
    });
  }

  /** Overview: per campus, entitlements due this year and how many were fully given. */
  async summaryByCampus(tx: Tx, campusIds: string[]) {
    const out = new Map<string, { due: number; given: number }>();
    const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
    if (!year || !campusIds.length) return out;
    const schemes = (await tx.welfareScheme.findMany({ where: { academicYearId: year.id, status: 'ACTIVE' } })) as Scheme[];
    if (!schemes.length) return out;
    const en = await enrolled(tx, { campusIds, academicYearId: year.id });
    const given = await givenMap(tx, schemes.map((s) => s.id));
    for (const e of en) {
      const c = out.get(e.section.campusId) ?? { due: 0, given: 0 };
      for (const s of schemes) {
        if (!applies(s, e.section.level.name, e.student.gender)) continue;
        c.due++;
        if ((given.get(`${s.id}:${e.studentId}`)?.given ?? 0) >= entitlement(s)) c.given++;
      }
      out.set(e.section.campusId, c);
    }
    return out;
  }
}
