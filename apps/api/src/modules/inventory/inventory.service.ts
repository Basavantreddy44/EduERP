import { Injectable, OnModuleInit } from '@nestjs/common';
import { InventoryItemInput, OpeningStockInput, PERMISSIONS, STARTER_ITEM_CATEGORIES, StockCountInput, StockIssueInput, StoreInput, financialYearOf, fromPaise, toPaise } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, CampusScope, canAccessCampus, scopeFor } from '../../common/auth-context';
import { Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { ApprovalsService } from '../approvals/approvals.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NumberingService } from '../numbering/numbering.service';
import { allocateNo } from '../students/student-records';
import { ensureAccountsChart, ledgerAccounts, unprocessable, dec } from '../accounts/books';
import { fromQh, lockBalance, move, qh } from './stock';

type Perm = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const name = (e: { firstName: string; lastName: string | null }) => `${e.firstName} ${e.lastName ?? ''}`.trim();
export const READERS: Perm[] = [PERMISSIONS.INV_READ, PERMISSIONS.INV_SETUP, PERMISSIONS.INV_ISSUE, PERMISSIONS.INV_RECEIVE, PERMISSIONS.INV_COUNT, PERMISSIONS.INV_PURCHASE];

/**
 * Inventory (M17.1, M17.4): categories, items, stores, opening stock, stock by store and the item
 * ledger; issues to departments and transfers between stores; physical counts adjusted after approval;
 * low-stock list and a daily notice to store keepers; stock and consumption reports. Stock is kept for
 * quantities and weighted-average value only — purchases are expensed on the vendor bill (CD-105).
 */
@Injectable()
export class InventoryService implements OnModuleInit {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly numbering: NumberingService, private readonly approvals: ApprovalsService, private readonly notifications: NotificationsService) {}

  onModuleInit() {
    this.approvals.onComplete('STOCK_ADJUSTMENT', (tx, d) => this.countDecided(tx, d));
  }

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  can(auth: AuthContext, perm: Perm, campusId: string) {
    const s = scopeFor(auth, perm);
    return !!s && canAccessCampus(s, campusId);
  }
  /** Campuses the user may see inventory for (null = all). */
  readable(auth: AuthContext): string[] | null {
    const scopes = READERS.map((p) => scopeFor(auth, p)).filter((s): s is CampusScope => !!s);
    if (scopes.some((s) => s.all)) return null;
    return [...new Set(scopes.flatMap((s) => (s.all ? [] : s.campusIds)))];
  }
  private campusWhere(auth: AuthContext, campusId?: string) {
    const c = this.readable(auth);
    if (campusId && c && !c.includes(campusId)) return { campusId: '00000000-0000-0000-0000-000000000000' };
    return campusId ? { campusId } : c ? { campusId: { in: c } } : {};
  }
  async store(tx: Tx, id: string, auth: AuthContext, perm: Perm) {
    const s = await tx.store.findUnique({ where: { id } });
    if (!s || !this.can(auth, perm, s.campusId)) throw NotFound('Store');
    return s;
  }

  private async ensureCategories(tx: Tx, tenantId: string) {
    if (await tx.itemCategory.count()) return;
    await tx.itemCategory.createMany({ data: STARTER_ITEM_CATEGORIES.map((n) => ({ tenantId, name: n })), skipDuplicates: true });
  }

  // ───────────── Set-up ─────────────

  options(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await this.ensureCategories(tx, auth.tenantId!);
      const where = this.campusWhere(auth);
      const [categories, stores, departments, staff, campuses, taxCodes, vendors] = await Promise.all([
        tx.itemCategory.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
        tx.store.findMany({ where: { ...where, isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, campusId: true } }),
        tx.department.findMany({ where: { status: 'ACTIVE' }, orderBy: { name: 'asc' }, select: { id: true, name: true, campusId: true } }),
        tx.employee.findMany({ where: { ...where, status: { notIn: ['RESIGNED', 'TERMINATED'] } }, orderBy: { firstName: 'asc' }, take: 1000, select: { id: true, firstName: true, lastName: true, employeeCode: true, campusId: true } }),
        tx.campus.findMany({ where: this.readable(auth) ? { id: { in: this.readable(auth)! } } : {}, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
        tx.taxCode.findMany({ where: { effectiveTo: null }, orderBy: { ratePercent: 'asc' }, select: { id: true, code: true, name: true, ratePercent: true } }),
        tx.vendor.findMany({ where: { status: 'ACTIVE' }, orderBy: { name: 'asc' }, select: { id: true, name: true, vendorCode: true } }),
      ]);
      return {
        categories, stores, departments, campuses, vendors,
        staff: staff.map((e) => ({ id: e.id, name: `${name(e)} (${e.employeeCode})`, campusId: e.campusId })),
        taxCodes: taxCodes.map((t) => ({ id: t.id, code: t.code, name: t.name, rate: dec(t.ratePercent) })),
      };
    });
  }

  saveCategory(id: string | null, input: { name: string; parentId?: string | null; isActive: boolean }, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const old = id ? await tx.itemCategory.findUnique({ where: { id } }) : null;
      if (id && !old) throw NotFound('Category');
      if (await tx.itemCategory.findFirst({ where: { name: { equals: input.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) }, select: { id: true } })) throw Conflict('duplicate-name', `${input.name} already exists`);
      const data = { name: input.name, parentId: input.parentId ?? null, isActive: input.isActive };
      const row = old ? await tx.itemCategory.update({ where: { id: old.id }, data }) : await tx.itemCategory.create({ data: { ...data, tenantId: auth.tenantId! } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: old ? 'UPDATE' : 'CREATE', entityType: 'ITEM_CATEGORY', entityId: row.id, oldValues: old ?? undefined, newValues: data }, client);
      return { id: row.id };
    });
  }

  items(auth: AuthContext, o: { q?: string; categoryId?: string; storeId?: string; low?: boolean }) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await this.ensureCategories(tx, auth.tenantId!);
      const words = (o.q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 4);
      const rows = await tx.inventoryItem.findMany({
        where: { ...(o.categoryId ? { categoryId: o.categoryId } : {}), AND: words.map((w) => ({ OR: [{ name: { contains: w, mode: 'insensitive' as const } }, { itemCode: { contains: w, mode: 'insensitive' as const } }] })) },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }], take: 1000,
      });
      const storeIds = (await tx.store.findMany({ where: { ...this.campusWhere(auth), ...(o.storeId ? { id: o.storeId } : {}) }, select: { id: true } })).map((s) => s.id);
      const bal = await tx.stockBalance.groupBy({ by: ['itemId'], where: { storeId: { in: storeIds } }, _sum: { quantity: true, value: true } });
      const cats = new Map((await tx.itemCategory.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
      return rows
        .map((i) => {
          const b = bal.find((x) => x.itemId === i.id);
          const quantity = qh(b?._sum.quantity ?? 0);
          return { id: i.id, itemCode: i.itemCode, name: i.name, categoryId: i.categoryId, category: cats.get(i.categoryId) ?? '', unit: i.unit, itemType: i.itemType, hsnCode: i.hsnCode, taxCodeId: i.taxCodeId, reorderLevel: dec(i.reorderLevel), expenseAccountId: i.expenseAccountId, description: i.description, isActive: i.isActive, quantity: fromQh(quantity), value: dec(b?._sum.value ?? 0), low: i.isActive && quantity <= qh(i.reorderLevel) && qh(i.reorderLevel) > 0 };
        })
        .filter((i) => !o.low || i.low);
    });
  }

  saveItem(id: string | null, input: InventoryItemInput, auth: AuthContext, client: ClientInfo) {
    if (!scopeFor(auth, PERMISSIONS.INV_SETUP)) throw NotFound('Item');
    return this.db.run(this.ctx(auth), async (tx) => {
      const old = id ? await tx.inventoryItem.findUnique({ where: { id } }) : null;
      if (id && !old) throw NotFound('Item');
      if (!(await tx.itemCategory.findUnique({ where: { id: input.categoryId }, select: { id: true } }))) throw NotFound('Category');
      if (input.expenseAccountId) {
        const a = (await ledgerAccounts(tx, [input.expenseAccountId])).get(input.expenseAccountId)!;
        if (a.accountType !== 'EXPENSE') throw unprocessable('account-type', 'Choose an expense account', 'expenseAccountId');
      }
      if (input.taxCodeId && !(await tx.taxCode.findUnique({ where: { id: input.taxCodeId }, select: { id: true } }))) throw NotFound('GST code');
      let itemCode = input.itemCode ?? old?.itemCode ?? null;
      if (!itemCode) {
        const n = await tx.inventoryItem.count();
        for (let k = n + 1; ; k++) { const c = `ITM-${String(k).padStart(4, '0')}`; if (!(await tx.inventoryItem.findFirst({ where: { itemCode: c }, select: { id: true } }))) { itemCode = c; break; } }
      }
      if (await tx.inventoryItem.findFirst({ where: { itemCode, ...(id ? { id: { not: id } } : {}) }, select: { id: true } })) throw Conflict('duplicate-code', `Item code ${itemCode} is already used`);
      const data = { itemCode: itemCode!, name: input.name, categoryId: input.categoryId, unit: input.unit, itemType: input.itemType, hsnCode: input.hsnCode ?? null, taxCodeId: input.taxCodeId ?? null, reorderLevel: input.reorderLevel, expenseAccountId: input.expenseAccountId ?? null, description: input.description, isActive: input.isActive };
      const row = old ? await tx.inventoryItem.update({ where: { id: old.id }, data }) : await tx.inventoryItem.create({ data: { ...data, tenantId: auth.tenantId!, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: old ? 'UPDATE' : 'CREATE', entityType: 'INVENTORY_ITEM', entityId: row.id, oldValues: old ?? undefined, newValues: data }, client);
      return { id: row.id, itemCode: row.itemCode };
    });
  }

  stores(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.store.findMany({ where: this.campusWhere(auth), orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
      const campus = new Map((await tx.campus.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
      const keepers = new Map((await tx.employee.findMany({ where: { id: { in: rows.map((r) => r.storeKeeperId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } })).map((e) => [e.id, name(e)]));
      const sums = await tx.stockBalance.groupBy({ by: ['storeId'], where: { storeId: { in: rows.map((r) => r.id) }, quantity: { gt: 0 } }, _sum: { value: true }, _count: { _all: true } });
      return rows.map((s) => ({ id: s.id, name: s.name, campusId: s.campusId, campus: campus.get(s.campusId) ?? '', storeKeeperId: s.storeKeeperId, storeKeeper: s.storeKeeperId ? keepers.get(s.storeKeeperId) ?? null : null, isActive: s.isActive, items: sums.find((x) => x.storeId === s.id)?._count._all ?? 0, value: dec(sums.find((x) => x.storeId === s.id)?._sum.value ?? 0) }));
    });
  }

  saveStore(id: string | null, input: StoreInput, auth: AuthContext, client: ClientInfo) {
    if (!this.can(auth, PERMISSIONS.INV_SETUP, input.campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      const old = id ? await this.store(tx, id, auth, PERMISSIONS.INV_SETUP) : null;
      if (old && old.campusId !== input.campusId && (await tx.stockBalance.findFirst({ where: { storeId: old.id, quantity: { gt: 0 } }, select: { id: true } }))) throw Conflict('store-has-stock', 'A store with stock cannot move to another campus');
      if (input.storeKeeperId) { const e = await tx.employee.findUnique({ where: { id: input.storeKeeperId }, select: { campusId: true } }); if (!e) throw NotFound('Staff member'); }
      if (await tx.store.findFirst({ where: { campusId: input.campusId, name: { equals: input.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) }, select: { id: true } })) throw Conflict('duplicate-name', `${input.name} already exists at this campus`);
      const data = { campusId: input.campusId, name: input.name, storeKeeperId: input.storeKeeperId ?? null, isActive: input.isActive };
      const row = old ? await tx.store.update({ where: { id: old.id }, data }) : await tx.store.create({ data: { ...data, tenantId: auth.tenantId! } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: input.campusId, action: old ? 'UPDATE' : 'CREATE', entityType: 'STORE', entityId: row.id, oldValues: old ?? undefined, newValues: data }, client);
      return { id: row.id };
    });
  }

  opening(input: OpeningStockInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.store(tx, input.storeId, auth, PERMISSIONS.INV_SETUP);
      const items = new Map((await tx.inventoryItem.findMany({ where: { id: { in: input.lines.map((l) => l.itemId) } } })).map((i) => [i.id, i]));
      for (const l of input.lines) {
        const it = items.get(l.itemId);
        if (!it) throw NotFound('Item');
        if (await tx.stockTransaction.findFirst({ where: { storeId: s.id, itemId: it.id }, select: { id: true } })) throw Conflict('has-movements', `${it.name} already has stock movements in ${s.name} — use a stock count to correct it`);
        await move(tx, { tenantId: auth.tenantId!, storeId: s.id, itemId: it.id, quantityH: qh(l.quantity), ratePaise: toPaise(l.rate), date: input.date, txnType: 'OPENING', refType: 'OPENING', refId: null, userId: auth.userId, remarks: 'Opening stock' }, it.name);
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: s.campusId, action: 'CREATE', entityType: 'OPENING_STOCK', entityId: s.id, newValues: { store: s.name, lines: input.lines.length } }, client);
      return { lines: input.lines.length };
    });
  }

  /** Stock by store (quantity, average rate, value, below reorder level). */
  stock(auth: AuthContext, o: { storeId?: string; campusId?: string; low?: boolean }) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const stores = await tx.store.findMany({ where: { ...this.campusWhere(auth, o.campusId), ...(o.storeId ? { id: o.storeId } : {}) }, select: { id: true, name: true, campusId: true } });
      const rows = await tx.stockBalance.findMany({ where: { storeId: { in: stores.map((s) => s.id) } } });
      const items = new Map((await tx.inventoryItem.findMany({ where: { id: { in: rows.map((r) => r.itemId) } } })).map((i) => [i.id, i]));
      const cats = new Map((await tx.itemCategory.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
      const st = new Map(stores.map((s) => [s.id, s]));
      const out = rows.map((b) => {
        const i = items.get(b.itemId)!;
        const low = qh(i.reorderLevel) > 0 && qh(b.quantity) <= qh(i.reorderLevel);
        return { storeId: b.storeId, store: st.get(b.storeId)?.name ?? '', itemId: b.itemId, itemCode: i.itemCode, item: i.name, category: cats.get(i.categoryId) ?? '', unit: i.unit, quantity: dec(b.quantity), avgCost: Number(b.avgCost).toFixed(2), value: dec(b.value), reorderLevel: dec(i.reorderLevel), low };
      }).filter((r) => (o.low ? r.low : qh(r.quantity) > 0 || r.low)).sort((a, b) => a.item.localeCompare(b.item) || a.store.localeCompare(b.store));
      return { rows: out, totalValue: fromPaise(out.reduce((t, r) => t + toPaise(r.value), 0)) };
    });
  }

  ledger(itemId: string, auth: AuthContext, storeId?: string) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const i = await tx.inventoryItem.findUnique({ where: { id: itemId } });
      if (!i) throw NotFound('Item');
      const stores = await tx.store.findMany({ where: { ...this.campusWhere(auth), ...(storeId ? { id: storeId } : {}) }, select: { id: true, name: true } });
      const rows = await tx.stockTransaction.findMany({ where: { itemId, storeId: { in: stores.map((s) => s.id) } }, orderBy: [{ txnAt: 'asc' }], take: 2000 });
      const st = new Map(stores.map((s) => [s.id, s.name]));
      const bal = await tx.stockBalance.findMany({ where: { itemId, storeId: { in: stores.map((s) => s.id) } } });
      return {
        item: { id: i.id, itemCode: i.itemCode, name: i.name, unit: i.unit, reorderLevel: dec(i.reorderLevel) },
        balances: bal.map((b) => ({ store: st.get(b.storeId) ?? '', quantity: dec(b.quantity), avgCost: Number(b.avgCost).toFixed(2), value: dec(b.value) })),
        rows: rows.map((r) => ({ id: r.id, date: iso(r.txnDate), at: r.txnAt, store: st.get(r.storeId) ?? '', txnType: r.txnType, quantity: dec(r.quantity), rate: Number(r.rate).toFixed(2), value: dec(r.value), balanceAfter: dec(r.balanceAfter), valueAfter: dec(r.valueAfter), referenceType: r.referenceType, referenceId: r.referenceId, remarks: r.remarks })),
      };
    });
  }

  // ───────────── Issues & transfers ─────────────

  issue(input: StockIssueInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const from = await this.store(tx, input.fromStoreId, auth, PERMISSIONS.INV_ISSUE);
      const to = input.toStoreId ? await this.store(tx, input.toStoreId, auth, PERMISSIONS.INV_ISSUE) : null;
      if (input.toDepartmentId && !(await tx.department.findUnique({ where: { id: input.toDepartmentId }, select: { id: true } }))) throw NotFound('Department');
      if (input.issuedToEmployeeId && !(await tx.employee.findUnique({ where: { id: input.issuedToEmployeeId }, select: { id: true } }))) throw NotFound('Staff member');
      if (input.departmentRequestId && !(await tx.departmentRequest.findUnique({ where: { id: input.departmentRequestId }, select: { id: true } }))) throw NotFound('Department request');
      const ids = input.items.map((i) => i.itemId);
      if (new Set(ids).size !== ids.length) throw unprocessable('duplicate-item', 'An item is listed twice', 'items');
      const items = new Map((await tx.inventoryItem.findMany({ where: { id: { in: ids } } })).map((i) => [i.id, i]));
      const issueNo = await allocateNo(this.numbering, tx, 'STOCK_ISSUE', from.campusId, financialYearOf(input.issueDate).name, auth.userId);
      const transfer = input.issueType === 'TRANSFER';
      const doc = await tx.stockIssue.create({
        data: {
          tenantId: auth.tenantId!, campusId: from.campusId, issueNo, issueType: input.issueType, fromStoreId: from.id, toStoreId: to?.id ?? null, toDepartmentId: transfer ? null : input.toDepartmentId ?? null,
          issuedToEmployeeId: transfer ? null : input.issuedToEmployeeId ?? null, departmentRequestId: input.departmentRequestId ?? null, issueDate: new Date(`${input.issueDate}T00:00:00Z`), remarks: input.remarks, createdBy: auth.userId,
        },
      });
      let total = 0;
      for (const l of input.items) {
        const it = items.get(l.itemId);
        if (!it) throw NotFound('Item');
        const out = await move(tx, { tenantId: auth.tenantId!, storeId: from.id, itemId: it.id, quantityH: qh(l.quantity), date: input.issueDate, txnType: transfer ? 'TRANSFER_OUT' : 'ISSUE_OUT', refType: transfer ? 'TRANSFER' : 'ISSUE', refId: doc.id, userId: auth.userId, remarks: transfer ? `To ${to!.name}` : null }, it.name);
        if (transfer) await move(tx, { tenantId: auth.tenantId!, storeId: to!.id, itemId: it.id, quantityH: qh(l.quantity), valuePaise: out.valuePaise, date: input.issueDate, txnType: 'TRANSFER_IN', refType: 'TRANSFER', refId: doc.id, userId: auth.userId, remarks: `From ${from.name}` }, it.name);
        await tx.stockIssueItem.create({ data: { tenantId: auth.tenantId!, issueId: doc.id, itemId: it.id, quantity: l.quantity, rate: out.rate, value: fromPaise(out.valuePaise), returnable: l.returnable } });
        total += out.valuePaise;
      }
      await tx.stockIssue.update({ where: { id: doc.id }, data: { totalValue: fromPaise(total) } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: from.campusId, action: 'CREATE', entityType: 'STOCK_ISSUE', entityId: doc.id, newValues: { issueNo, type: input.issueType, from: from.name, to: to?.name ?? null, items: input.items.length, value: fromPaise(total) } }, client);
      return { id: doc.id, issueNo, totalValue: fromPaise(total) };
    });
  }

  issues(auth: AuthContext, o: { from?: string; to?: string; type?: string }) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.stockIssue.findMany({
        where: { ...this.campusWhere(auth), ...(o.type ? { issueType: o.type } : {}), ...(o.from || o.to ? { issueDate: { ...(o.from ? { gte: new Date(`${o.from}T00:00:00Z`) } : {}), ...(o.to ? { lte: new Date(`${o.to}T00:00:00Z`) } : {}) } } : {}) },
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }], take: 300, include: { items: true },
      });
      const stores = new Map((await tx.store.findMany({ select: { id: true, name: true } })).map((s) => [s.id, s.name]));
      const depts = new Map((await tx.department.findMany({ select: { id: true, name: true } })).map((d) => [d.id, d.name]));
      const staff = new Map((await tx.employee.findMany({ where: { id: { in: rows.map((r) => r.issuedToEmployeeId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } })).map((e) => [e.id, name(e)]));
      const items = new Map((await tx.inventoryItem.findMany({ where: { id: { in: rows.flatMap((r) => r.items.map((i) => i.itemId)) } }, select: { id: true, name: true, unit: true } })).map((i) => [i.id, i]));
      return rows.map((r) => ({
        id: r.id, issueNo: r.issueNo, issueType: r.issueType, issueDate: iso(r.issueDate), from: stores.get(r.fromStoreId) ?? '', to: r.toStoreId ? stores.get(r.toStoreId) ?? '' : [r.toDepartmentId ? depts.get(r.toDepartmentId) : null, r.issuedToEmployeeId ? staff.get(r.issuedToEmployeeId) : null].filter(Boolean).join(' · '),
        totalValue: dec(r.totalValue), remarks: r.remarks, items: r.items.map((i) => ({ item: items.get(i.itemId)?.name ?? '', unit: items.get(i.itemId)?.unit ?? '', quantity: dec(i.quantity), value: dec(i.value), returnable: i.returnable })),
      }));
    });
  }

  // ───────────── Stock counts ─────────────

  count(input: StockCountInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.store(tx, input.storeId, auth, PERMISSIONS.INV_COUNT);
      const ids = input.lines.map((l) => l.itemId);
      if (new Set(ids).size !== ids.length) throw unprocessable('duplicate-item', 'An item is listed twice', 'lines');
      if (await tx.stockCount.findFirst({ where: { storeId: s.id, status: 'PENDING_APPROVAL' }, select: { id: true } })) throw Conflict('count-pending', `A count for ${s.name} is already waiting for approval`);
      const items = new Map((await tx.inventoryItem.findMany({ where: { id: { in: ids } } })).map((i) => [i.id, i]));
      const bal = new Map((await tx.stockBalance.findMany({ where: { storeId: s.id, itemId: { in: ids } } })).map((b) => [b.itemId, b]));
      const c = await tx.stockCount.create({ data: { tenantId: auth.tenantId!, campusId: s.campusId, storeId: s.id, countDate: new Date(`${input.countDate}T00:00:00Z`), status: 'PENDING_APPROVAL', remarks: input.remarks, createdBy: auth.userId } });
      let diffValue = 0;
      let changed = 0;
      for (const l of input.lines) {
        const it = items.get(l.itemId);
        if (!it) throw NotFound('Item');
        const b = bal.get(it.id);
        const sys = qh(b?.quantity ?? 0);
        const diff = qh(l.countedQty) - sys;
        if (diff) changed++;
        const rate = b ? Number(b.avgCost) : 0;
        diffValue += Math.abs(Math.round((diff * rate * 100) / 100));
        await tx.stockCountLine.create({ data: { tenantId: auth.tenantId!, countId: c.id, itemId: it.id, systemQty: fromQh(sys), countedQty: l.countedQty, difference: fromQh(diff), rate: rate.toFixed(4), remarks: l.remarks } });
      }
      const req = changed ? await this.approvals.submit(tx, { tenantId: auth.tenantId!, requestedBy: auth.userId, entityType: 'STOCK_ADJUSTMENT', entityId: c.id, campusId: s.campusId, amount: diffValue / 100, summary: `Stock count ${s.name} on ${input.countDate}: ${changed} item(s) differ (₹${fromPaise(diffValue)})` }, client) : null;
      if (req) await tx.stockCount.update({ where: { id: c.id }, data: { approvalRequestId: req.id } });
      else await this.adjust(tx, c.id, auth.userId);
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: s.campusId, action: 'CREATE', entityType: 'STOCK_COUNT', entityId: c.id, newValues: { store: s.name, lines: input.lines.length, differing: changed, needsApproval: !!req } }, client);
      return { id: c.id, differing: changed, status: req ? 'PENDING_APPROVAL' : 'ADJUSTED' };
    });
  }

  /** Applies a count's differences (relative to the stock at approval time). */
  private async adjust(tx: Tx, countId: string, userId: string) {
    const c = await tx.stockCount.findUniqueOrThrow({ where: { id: countId }, include: { lines: true } });
    const items = new Map((await tx.inventoryItem.findMany({ where: { id: { in: c.lines.map((l) => l.itemId) } }, select: { id: true, name: true } })).map((i) => [i.id, i.name]));
    const day = iso(c.countDate)!;
    for (const l of c.lines) {
      const diff = qh(l.difference);
      if (!diff) continue;
      if (diff > 0) {
        const b = await lockBalance(tx, c.tenantId, c.storeId, l.itemId);
        const rate = b.quantityH > 0 ? Math.round((b.valuePaise * 100) / b.quantityH) : Math.round(Number(l.rate) * 100);
        await move(tx, { tenantId: c.tenantId, storeId: c.storeId, itemId: l.itemId, quantityH: diff, ratePaise: rate, date: day, txnType: 'ADJUST_IN', refType: 'COUNT', refId: c.id, userId, remarks: 'Found more at the stock count' }, items.get(l.itemId));
      } else {
        await move(tx, { tenantId: c.tenantId, storeId: c.storeId, itemId: l.itemId, quantityH: -diff, date: day, txnType: 'ADJUST_OUT', refType: 'COUNT', refId: c.id, userId, remarks: 'Short at the stock count' }, items.get(l.itemId));
      }
    }
    await tx.stockCount.update({ where: { id: c.id }, data: { status: 'ADJUSTED', adjustedAt: new Date() } });
  }

  private async countDecided(tx: Tx, d: { entityId: string; decision: 'APPROVED' | 'REJECTED' | 'CANCELLED'; userId: string }) {
    const c = await tx.stockCount.findUnique({ where: { id: d.entityId } });
    if (!c || c.status !== 'PENDING_APPROVAL') return;
    if (d.decision === 'APPROVED') await this.adjust(tx, c.id, d.userId);
    else await tx.stockCount.update({ where: { id: c.id }, data: { status: 'REJECTED' } });
  }

  counts(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.stockCount.findMany({ where: this.campusWhere(auth), orderBy: { createdAt: 'desc' }, take: 100, include: { lines: true } });
      const stores = new Map((await tx.store.findMany({ select: { id: true, name: true } })).map((s) => [s.id, s.name]));
      const items = new Map((await tx.inventoryItem.findMany({ where: { id: { in: rows.flatMap((r) => r.lines.map((l) => l.itemId)) } }, select: { id: true, name: true, unit: true } })).map((i) => [i.id, i]));
      return rows.map((c) => ({
        id: c.id, store: stores.get(c.storeId) ?? '', countDate: iso(c.countDate), status: c.status, remarks: c.remarks,
        lines: c.lines.filter((l) => qh(l.difference) !== 0).map((l) => ({ item: items.get(l.itemId)?.name ?? '', unit: items.get(l.itemId)?.unit ?? '', systemQty: dec(l.systemQty), countedQty: dec(l.countedQty), difference: dec(l.difference), value: fromPaise(Math.round(qh(l.difference) * Number(l.rate))) })),
        counted: c.lines.length,
      }));
    });
  }

  // ───────────── Reports & alerts ─────────────

  consumption(auth: AuthContext, o: { from?: string; to?: string; campusId?: string }) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const from = o.from ?? `${todayIST().slice(0, 7)}-01`;
      const to = o.to ?? todayIST();
      const rows = await tx.stockIssue.findMany({ where: { ...this.campusWhere(auth, o.campusId), issueType: 'ISSUE', status: 'ISSUED', issueDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } }, include: { items: true } });
      const depts = new Map((await tx.department.findMany({ select: { id: true, name: true } })).map((d) => [d.id, d.name]));
      const items = new Map((await tx.inventoryItem.findMany({ where: { id: { in: rows.flatMap((r) => r.items.map((i) => i.itemId)) } }, select: { id: true, name: true, unit: true } })).map((i) => [i.id, i]));
      const agg = new Map<string, { department: string; item: string; unit: string; quantityH: number; valuePaise: number }>();
      for (const r of rows) for (const i of r.items) {
        const dept = r.toDepartmentId ? depts.get(r.toDepartmentId) ?? '' : '—';
        const k = `${dept}|${i.itemId}`;
        const a = agg.get(k) ?? { department: dept, item: items.get(i.itemId)?.name ?? '', unit: items.get(i.itemId)?.unit ?? '', quantityH: 0, valuePaise: 0 };
        a.quantityH += qh(i.quantity); a.valuePaise += toPaise(dec(i.value));
        agg.set(k, a);
      }
      const list = [...agg.values()].sort((a, b) => a.department.localeCompare(b.department) || b.valuePaise - a.valuePaise);
      return { from, to, rows: list.map((a) => ({ department: a.department, item: a.item, unit: a.unit, quantity: fromQh(a.quantityH), value: fromPaise(a.valuePaise) })), totalValue: fromPaise(list.reduce((t, a) => t + a.valuePaise, 0)) };
    });
  }

  /** Daily: tell each store keeper about items at or below their reorder level (once a day per item and store). */
  async alertAll() {
    const tenants = await this.db.run({ isPlatform: true }, (tx) => tx.tenant.findMany({ where: { status: { in: ['ACTIVE', 'TRIAL', 'GRACE'] } }, select: { id: true } }));
    let n = 0;
    for (const t of tenants) {
      n += await this.db.run({ tenantId: t.id, userId: null }, async (tx) => {
        const today = todayIST();
        const stores = await tx.store.findMany({ where: { isActive: true, storeKeeperId: { not: null } } });
        let sent = 0;
        for (const s of stores) {
          const keeper = await tx.employee.findUnique({ where: { id: s.storeKeeperId! }, select: { userId: true } });
          if (!keeper?.userId) continue;
          const rows = await tx.$queryRaw<{ id: string; name: string; quantity: string; unit: string }[]>`
            SELECT b.id, i.name, b.quantity::text, i.unit FROM stock_balances b JOIN inventory_items i ON i.id = b.item_id
             WHERE b.store_id = ${s.id}::uuid AND i.is_active AND i.reorder_level > 0 AND b.quantity <= i.reorder_level
               AND (b.last_low_alert IS NULL OR b.last_low_alert < ${today}::date)`;
          if (!rows.length) continue;
          await tx.stockBalance.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { lastLowAlert: new Date(`${today}T00:00:00Z`) } });
          await this.notifications.notify(tx, { tenantId: t.id, userIds: [keeper.userId], eventCode: 'INVENTORY_LOW', vars: { store: s.name, count: rows.length, items: rows.slice(0, 5).map((r) => `${r.name} (${Number(r.quantity)} ${r.unit})`).join(', ') }, entityType: 'STORE', entityId: s.id });
          sent++;
        }
        return sent;
      });
    }
    return n;
  }

  /** Expense accounts an item can be booked to (for the item form). */
  expenseAccounts(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await ensureAccountsChart(tx, auth.tenantId!);
      return tx.account.findMany({ where: { accountType: 'EXPENSE', isGroup: false, isActive: true }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true } });
    });
  }
}
