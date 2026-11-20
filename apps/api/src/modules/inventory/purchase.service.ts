import { Injectable, OnModuleInit } from '@nestjs/common';
import { BillFromReceiptInput, GoodsReceiptInput, PERMISSIONS, PurchaseOrderInput, PurchaseRequestInput, QuotationInput, RECEIPT_TOLERANCE, financialYearOf, fromPaise, toPaise } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, scopeFor } from '../../common/auth-context';
import { Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { ApprovalsService } from '../approvals/approvals.service';
import { NumberingService } from '../numbering/numbering.service';
import { allocateNo } from '../students/student-records';
import { VendorsService } from '../accounts/vendors.service';
import { ensureAccountsChart, unprocessable, dec } from '../accounts/books';
import { InventoryService } from './inventory.service';
import { fromQh, move, qh } from './stock';

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const pctOf = (paise: number, pct: number) => Math.round((paise * Math.round(pct * 100)) / 10000);
const lineAmount = (quantity: string, rate: string) => Math.round((qh(quantity) * toPaise(rate)) / 100);

/**
 * Purchasing (M17.2, M17.3): purchase requests from departments (approved where a rule exists),
 * quotations and the comparative statement, purchase orders (approved by amount), goods receipts with
 * accepted / rejected quantities posted into stock at the order rate, and the vendor bill made from a
 * receipt (3-way match: never more than accepted less already billed). The bill is posted as in Phase 13.
 */
@Injectable()
export class PurchaseService implements OnModuleInit {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly numbering: NumberingService, private readonly approvals: ApprovalsService, private readonly vendors: VendorsService, private readonly inv: InventoryService) {}

  onModuleInit() {
    this.approvals.onComplete('PURCHASE_REQUEST', (tx, d) => this.prDecided(tx, d));
    this.approvals.onComplete('PURCHASE_ORDER', (tx, d) => this.poDecided(tx, d));
  }

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  private need(auth: AuthContext, perm: (typeof PERMISSIONS)[keyof typeof PERMISSIONS], campusId: string) {
    if (!this.inv.can(auth, perm, campusId)) throw NotFound('Campus');
  }
  private seeable(auth: AuthContext, campusId: string) {
    const c = this.inv.readable(auth);
    return (c === null || c.includes(campusId)) || this.inv.can(auth, PERMISSIONS.INV_REQUEST, campusId);
  }

  // ───────────── Purchase requests ─────────────

  createRequest(input: PurchaseRequestInput, auth: AuthContext, client: ClientInfo) {
    this.need(auth, PERMISSIONS.INV_REQUEST, input.campusId);
    return this.db.run(this.ctx(auth), async (tx) => {
      const dept = await tx.department.findUnique({ where: { id: input.departmentId } });
      if (!dept || (dept.campusId && dept.campusId !== input.campusId)) throw NotFound('Department');
      if (input.departmentRequestId && !(await tx.departmentRequest.findUnique({ where: { id: input.departmentRequestId }, select: { id: true } }))) throw NotFound('Department request');
      const ids = input.items.map((i) => i.itemId);
      if (new Set(ids).size !== ids.length) throw unprocessable('duplicate-item', 'An item is listed twice', 'items');
      const items = await tx.inventoryItem.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });
      if (items.length !== ids.length) throw NotFound('Item');
      const total = input.items.reduce((t, i) => t + lineAmount(i.quantity, i.estimatedRate), 0);
      const prNo = await allocateNo(this.numbering, tx, 'PURCHASE_REQUEST', input.campusId, financialYearOf(new Date().toISOString().slice(0, 10)).name, auth.userId);
      const pr = await tx.purchaseRequest.create({
        data: { tenantId: auth.tenantId!, campusId: input.campusId, prNo, departmentId: dept.id, departmentRequestId: input.departmentRequestId ?? null, requestedBy: auth.userId, requiredBy: input.requiredBy ? day(input.requiredBy) : null, justification: input.justification, estimatedTotal: fromPaise(total), status: 'SUBMITTED' },
      });
      await tx.purchaseRequestItem.createMany({ data: input.items.map((i) => ({ tenantId: auth.tenantId!, prId: pr.id, itemId: i.itemId, quantity: i.quantity, estimatedRate: i.estimatedRate, remarks: i.remarks })) });
      const req = await this.approvals.submit(tx, { tenantId: auth.tenantId!, requestedBy: auth.userId, entityType: 'PURCHASE_REQUEST', entityId: pr.id, campusId: input.campusId, amount: total / 100, summary: `${prNo} · ${dept.name}: ${input.items.length} item(s), about ₹${fromPaise(total)}` }, client);
      if (req) await tx.purchaseRequest.update({ where: { id: pr.id }, data: { approvalRequestId: req.id } });
      else await tx.purchaseRequest.update({ where: { id: pr.id }, data: { status: 'APPROVED' } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: input.campusId, action: 'CREATE', entityType: 'PURCHASE_REQUEST', entityId: pr.id, newValues: { prNo, department: dept.name, items: input.items.length, estimate: fromPaise(total), needsApproval: !!req } }, client);
      return { id: pr.id, prNo, status: req ? 'SUBMITTED' : 'APPROVED' };
    });
  }

  private async prDecided(tx: Tx, d: { entityId: string; decision: 'APPROVED' | 'REJECTED' | 'CANCELLED' }) {
    const pr = await tx.purchaseRequest.findUnique({ where: { id: d.entityId }, select: { id: true, status: true } });
    if (!pr || pr.status !== 'SUBMITTED') return;
    await tx.purchaseRequest.update({ where: { id: pr.id }, data: { status: d.decision === 'APPROVED' ? 'APPROVED' : d.decision === 'REJECTED' ? 'REJECTED' : 'CANCELLED' } });
  }

  requests(auth: AuthContext, status?: string) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.purchaseRequest.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 300, include: { items: true } });
      const visible = rows.filter((r) => this.seeable(auth, r.campusId));
      const depts = new Map((await tx.department.findMany({ select: { id: true, name: true } })).map((x) => [x.id, x.name]));
      const users = new Map((await tx.user.findMany({ where: { id: { in: visible.map((r) => r.requestedBy) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
      const q = await tx.quotation.groupBy({ by: ['prId'], where: { prId: { in: visible.map((r) => r.id) } }, _count: { _all: true } });
      return visible.map((r) => ({ id: r.id, prNo: r.prNo, campusId: r.campusId, department: depts.get(r.departmentId) ?? '', requestedBy: users.get(r.requestedBy) ?? '', requiredBy: iso(r.requiredBy), justification: r.justification, estimatedTotal: dec(r.estimatedTotal), status: r.status, items: r.items.length, quotations: q.find((x) => x.prId === r.id)?._count._all ?? 0, createdAt: r.createdAt }));
    });
  }

  request(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await tx.purchaseRequest.findUnique({ where: { id }, include: { items: true } });
      if (!r || !this.seeable(auth, r.campusId)) throw NotFound('Purchase request');
      const items = new Map((await tx.inventoryItem.findMany({ where: { id: { in: r.items.map((i) => i.itemId) } } })).map((i) => [i.id, i]));
      const quotes = await tx.quotation.findMany({ where: { prId: r.id }, include: { items: true }, orderBy: { totalAmount: 'asc' } });
      const vendors = new Map((await tx.vendor.findMany({ where: { id: { in: quotes.map((q) => q.vendorId) } }, select: { id: true, name: true } })).map((v) => [v.id, v.name]));
      const dept = await tx.department.findUnique({ where: { id: r.departmentId }, select: { name: true } });
      const po = await tx.purchaseOrder.findFirst({ where: { prId: r.id, status: { notIn: ['CANCELLED', 'REJECTED'] } }, select: { id: true, poNo: true, status: true } });
      const complete = quotes.filter((q) => r.items.every((pi) => q.items.some((qi) => qi.prItemId === pi.id)));
      const lowestTotal = complete.length ? complete.reduce((a, b) => (toPaise(dec(b.totalAmount)) < toPaise(dec(a.totalAmount)) ? b : a)).id : null;
      return {
        id: r.id, prNo: r.prNo, campusId: r.campusId, department: dept?.name ?? '', requiredBy: iso(r.requiredBy), justification: r.justification, estimatedTotal: dec(r.estimatedTotal), status: r.status, po,
        can: { purchase: this.inv.can(auth, PERMISSIONS.INV_PURCHASE, r.campusId) },
        items: r.items.map((pi) => {
          const it = items.get(pi.itemId)!;
          const offers = quotes.map((q) => ({ quotationId: q.id, qi: q.items.find((x) => x.prItemId === pi.id) })).filter((x) => x.qi);
          const best = offers.length ? offers.reduce((a, b) => (toPaise(dec(b.qi!.rate)) < toPaise(dec(a.qi!.rate)) ? b : a)).quotationId : null;
          return { id: pi.id, itemId: pi.itemId, item: it.name, itemCode: it.itemCode, unit: it.unit, quantity: dec(pi.quantity), estimatedRate: dec(pi.estimatedRate), remarks: pi.remarks, lowestQuotationId: best };
        }),
        quotations: quotes.map((q) => ({
          id: q.id, vendorId: q.vendorId, vendor: vendors.get(q.vendorId) ?? '', quotationNo: q.quotationNo, quotationDate: iso(q.quotationDate), validTill: iso(q.validTill), deliveryDays: q.deliveryDays, paymentTerms: q.paymentTerms,
          subTotal: dec(q.subTotal), taxAmount: dec(q.taxAmount), totalAmount: dec(q.totalAmount), isSelected: q.isSelected, selectionReason: q.selectionReason, coversAll: complete.some((c) => c.id === q.id), lowestTotal: q.id === lowestTotal,
          items: q.items.map((i) => ({ prItemId: i.prItemId, rate: dec(i.rate), taxPercent: Number(i.taxPercent), amount: dec(i.amount) })),
        })),
      };
    });
  }

  cancelRequest(id: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await tx.purchaseRequest.findUnique({ where: { id } });
      if (!r || !(r.requestedBy === auth.userId || this.inv.can(auth, PERMISSIONS.INV_PURCHASE, r.campusId))) throw NotFound('Purchase request');
      if (!['SUBMITTED', 'APPROVED'].includes(r.status)) throw Conflict('pr-closed', r.status === 'ORDERED' ? 'An order has been placed for this request' : 'This request is already closed');
      if (r.status === 'SUBMITTED' && r.approvalRequestId) throw Conflict('pr-waiting', 'The request is waiting for approval — ask the approver to reject it');
      await tx.purchaseRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: r.campusId, action: 'CANCEL', entityType: 'PURCHASE_REQUEST', entityId: id, oldValues: { status: r.status } }, client);
      return { status: 'CANCELLED' };
    });
  }

  addQuotation(prId: string, input: QuotationInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await tx.purchaseRequest.findUnique({ where: { id: prId }, include: { items: true } });
      if (!r) throw NotFound('Purchase request');
      this.need(auth, PERMISSIONS.INV_PURCHASE, r.campusId);
      if (r.status !== 'APPROVED') throw Conflict('pr-not-approved', r.status === 'SUBMITTED' ? 'The request is not approved yet' : 'This request is closed');
      const v = await tx.vendor.findUnique({ where: { id: input.vendorId } });
      if (!v || v.status !== 'ACTIVE') throw NotFound('Vendor');
      if (await tx.quotation.findFirst({ where: { prId, vendorId: v.id }, select: { id: true } })) throw Conflict('duplicate-quotation', `${v.name} has already quoted for this request`);
      let sub = 0, tax = 0;
      const lines = input.items.map((qi) => {
        const pi = r.items.find((x) => x.id === qi.prItemId);
        if (!pi) throw unprocessable('not-in-request', 'A quoted item is not in the request', 'items');
        const amount = lineAmount(dec(pi.quantity), qi.rate);
        sub += amount; tax += pctOf(amount, qi.taxPercent);
        return { tenantId: auth.tenantId!, prItemId: pi.id, rate: qi.rate, taxPercent: qi.taxPercent, amount: fromPaise(amount) };
      });
      const q = await tx.quotation.create({
        data: { tenantId: auth.tenantId!, prId, vendorId: v.id, quotationNo: input.quotationNo, quotationDate: day(input.quotationDate), validTill: input.validTill ? day(input.validTill) : null, deliveryDays: input.deliveryDays ?? null, paymentTerms: input.paymentTerms, subTotal: fromPaise(sub), taxAmount: fromPaise(tax), totalAmount: fromPaise(sub + tax), createdBy: auth.userId },
      });
      await tx.quotationItem.createMany({ data: lines.map((l) => ({ ...l, quotationId: q.id })) });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: r.campusId, action: 'CREATE', entityType: 'QUOTATION', entityId: q.id, newValues: { pr: r.prNo, vendor: v.name, total: fromPaise(sub + tax) } }, client);
      return { id: q.id, totalAmount: fromPaise(sub + tax) };
    });
  }

  selectQuotation(quotationId: string, reason: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const q = await tx.quotation.findUnique({ where: { id: quotationId } });
      if (!q) throw NotFound('Quotation');
      const r = await tx.purchaseRequest.findUniqueOrThrow({ where: { id: q.prId } });
      this.need(auth, PERMISSIONS.INV_PURCHASE, r.campusId);
      if (r.status !== 'APPROVED') throw Conflict('pr-closed', 'This request is closed');
      await tx.quotation.updateMany({ where: { prId: q.prId, isSelected: true }, data: { isSelected: false } });
      await tx.quotation.update({ where: { id: q.id }, data: { isSelected: true, selectionReason: reason } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: r.campusId, action: 'UPDATE', entityType: 'QUOTATION', entityId: q.id, newValues: { selected: true, reason } }, client);
      return { selected: q.id };
    });
  }

  // ───────────── Purchase orders ─────────────

  private async createPoInTx(tx: Tx, input: PurchaseOrderInput, auth: AuthContext, client: ClientInfo, taxPercents?: Map<string, number>) {
    const v = await tx.vendor.findUnique({ where: { id: input.vendorId } });
    if (!v || v.status !== 'ACTIVE') throw NotFound('Vendor');
    const store = await this.inv.store(tx, input.storeId, auth, PERMISSIONS.INV_PURCHASE).catch(async () => { throw NotFound('Store'); });
    if (store.campusId !== input.campusId) throw unprocessable('store-campus', 'Choose a store of this campus', 'storeId');
    const ids = input.items.map((i) => i.itemId);
    if (new Set(ids).size !== ids.length) throw unprocessable('duplicate-item', 'An item is listed twice', 'items');
    const items = new Map((await tx.inventoryItem.findMany({ where: { id: { in: ids }, isActive: true } })).map((i) => [i.id, i]));
    const codes = new Map((await tx.taxCode.findMany()).map((t) => [t.id, Number(t.ratePercent)]));
    let sub = 0, tax = 0;
    const lines = input.items.map((l, n) => {
      const it = items.get(l.itemId);
      if (!it) throw NotFound('Item');
      const taxCodeId = l.taxCodeId ?? it.taxCodeId ?? null;
      const pct = taxPercents?.get(l.itemId) ?? (taxCodeId ? codes.get(taxCodeId) ?? 0 : 0);
      const amount = lineAmount(l.quantity, l.rate);
      const t = pctOf(amount, pct);
      sub += amount; tax += t;
      return { tenantId: auth.tenantId!, lineNo: n + 1, itemId: it.id, quantity: l.quantity, rate: l.rate, taxCodeId, taxPercent: pct, amount: fromPaise(amount), taxAmount: fromPaise(t) };
    });
    const poNo = await allocateNo(this.numbering, tx, 'PURCHASE_ORDER', input.campusId, financialYearOf(input.poDate).name, auth.userId);
    const po = await tx.purchaseOrder.create({
      data: { tenantId: auth.tenantId!, campusId: input.campusId, poNo, vendorId: v.id, prId: input.prId ?? null, quotationId: input.quotationId ?? null, poDate: day(input.poDate), deliveryDate: input.deliveryDate ? day(input.deliveryDate) : null, storeId: store.id, subTotal: fromPaise(sub), taxAmount: fromPaise(tax), totalAmount: fromPaise(sub + tax), terms: input.terms, status: 'PENDING_APPROVAL', createdBy: auth.userId },
    });
    await tx.purchaseOrderItem.createMany({ data: lines.map((l) => ({ ...l, poId: po.id })) });
    const req = await this.approvals.submit(tx, { tenantId: auth.tenantId!, requestedBy: auth.userId, entityType: 'PURCHASE_ORDER', entityId: po.id, campusId: input.campusId, amount: (sub + tax) / 100, summary: `${poNo} · ${v.name}: ₹${fromPaise(sub + tax)}` }, client);
    if (req) await tx.purchaseOrder.update({ where: { id: po.id }, data: { approvalRequestId: req.id } });
    else await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: 'APPROVED' } });
    if (input.prId) await tx.purchaseRequest.update({ where: { id: input.prId }, data: { status: 'ORDERED' } });
    await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: input.campusId, action: 'CREATE', entityType: 'PURCHASE_ORDER', entityId: po.id, newValues: { poNo, vendor: v.name, total: fromPaise(sub + tax), lines: lines.length, needsApproval: !!req } }, client);
    return { id: po.id, poNo, status: req ? 'PENDING_APPROVAL' : 'APPROVED', totalAmount: fromPaise(sub + tax) };
  }

  createOrder(input: PurchaseOrderInput, auth: AuthContext, client: ClientInfo) {
    this.need(auth, PERMISSIONS.INV_PURCHASE, input.campusId);
    return this.db.run(this.ctx(auth), async (tx) => {
      if (input.prId) {
        const r = await tx.purchaseRequest.findUnique({ where: { id: input.prId } });
        if (!r || r.campusId !== input.campusId) throw NotFound('Purchase request');
        if (r.status !== 'APPROVED') throw Conflict('pr-not-approved', 'The request must be approved and not yet ordered');
      }
      return this.createPoInTx(tx, { ...input, quotationId: null }, auth, client);
    });
  }

  orderFromQuotation(quotationId: string, o: { storeId: string; poDate: string; deliveryDate?: string | null; terms?: string | null }, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const q = await tx.quotation.findUnique({ where: { id: quotationId }, include: { items: true } });
      if (!q) throw NotFound('Quotation');
      const r = await tx.purchaseRequest.findUniqueOrThrow({ where: { id: q.prId }, include: { items: true } });
      this.need(auth, PERMISSIONS.INV_PURCHASE, r.campusId);
      if (!q.isSelected) throw Conflict('not-selected', 'Select this quotation first (with the reason)');
      if (r.status !== 'APPROVED') throw Conflict('pr-not-approved', 'The request is not open for ordering');
      const taxPercents = new Map<string, number>();
      const items = q.items.map((qi) => { const pi = r.items.find((x) => x.id === qi.prItemId)!; taxPercents.set(pi.itemId, Number(qi.taxPercent)); return { itemId: pi.itemId, quantity: dec(pi.quantity), rate: dec(qi.rate), taxCodeId: null }; });
      return this.createPoInTx(tx, { campusId: r.campusId, vendorId: q.vendorId, storeId: o.storeId, prId: r.id, quotationId: q.id, poDate: o.poDate, deliveryDate: o.deliveryDate ?? null, terms: o.terms ?? q.paymentTerms ?? null, items }, auth, client, taxPercents);
    });
  }

  private async poDecided(tx: Tx, d: { entityId: string; decision: 'APPROVED' | 'REJECTED' | 'CANCELLED' }) {
    const po = await tx.purchaseOrder.findUnique({ where: { id: d.entityId }, select: { id: true, status: true, prId: true } });
    if (!po || po.status !== 'PENDING_APPROVAL') return;
    if (d.decision === 'APPROVED') { await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: 'APPROVED' } }); return; }
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: d.decision === 'REJECTED' ? 'REJECTED' : 'CANCELLED' } });
    if (po.prId) await tx.purchaseRequest.update({ where: { id: po.prId }, data: { status: 'APPROVED' } });
  }

  orders(auth: AuthContext, status?: string) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = this.inv.readable(auth);
      const rows = await tx.purchaseOrder.findMany({ where: { ...(status ? { status } : {}), ...(c ? { campusId: { in: c } } : {}) }, orderBy: [{ poDate: 'desc' }, { createdAt: 'desc' }], take: 300 });
      const vendors = new Map((await tx.vendor.findMany({ where: { id: { in: rows.map((r) => r.vendorId) } }, select: { id: true, name: true } })).map((v) => [v.id, v.name]));
      const stores = new Map((await tx.store.findMany({ select: { id: true, name: true } })).map((s) => [s.id, s.name]));
      return rows.map((p) => ({ id: p.id, poNo: p.poNo, vendor: vendors.get(p.vendorId) ?? '', store: stores.get(p.storeId) ?? '', poDate: iso(p.poDate), deliveryDate: iso(p.deliveryDate), totalAmount: dec(p.totalAmount), status: p.status }));
    });
  }

  order(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const p = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: { orderBy: { lineNo: 'asc' } } } });
      const c = this.inv.readable(auth);
      if (!p || (c && !c.includes(p.campusId))) throw NotFound('Purchase order');
      const v = await tx.vendor.findUniqueOrThrow({ where: { id: p.vendorId } });
      const items = new Map((await tx.inventoryItem.findMany({ where: { id: { in: p.items.map((i) => i.itemId) } } })).map((i) => [i.id, i]));
      const store = await tx.store.findUniqueOrThrow({ where: { id: p.storeId } });
      const campus = await tx.campus.findUnique({ where: { id: p.campusId }, select: { name: true, address: true, city: true } });
      const tenant = await tx.tenant.findUnique({ where: { id: p.tenantId }, select: { name: true } });
      const grns = await tx.goodsReceipt.findMany({ where: { poId: p.id }, include: { items: true }, orderBy: { receiptDate: 'asc' } });
      const bills = await tx.vendorBill.findMany({ where: { purchaseOrderId: p.id }, select: { id: true, internalNo: true, billNo: true, status: true, totalAmount: true, goodsReceiptId: true } });
      const billed = await tx.$queryRaw<{ grn_item: string; q: string }[]>`
        SELECT bi.goods_receipt_item_id AS grn_item, sum(bi.quantity)::text AS q FROM vendor_bill_items bi JOIN vendor_bills b ON b.id = bi.bill_id
         WHERE bi.goods_receipt_item_id = ANY(${grns.flatMap((g) => g.items.map((i) => i.id))}::uuid[]) AND b.status NOT IN ('CANCELLED','REJECTED') GROUP BY bi.goods_receipt_item_id`;
      const users = new Map((await tx.user.findMany({ where: { id: { in: [p.createdBy, ...grns.map((g) => g.receivedBy)] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
      return {
        id: p.id, poNo: p.poNo, status: p.status, poDate: iso(p.poDate), deliveryDate: iso(p.deliveryDate), terms: p.terms, subTotal: dec(p.subTotal), taxAmount: dec(p.taxAmount), totalAmount: dec(p.totalAmount), cancelReason: p.cancelReason,
        institution: tenant?.name ?? '', campus: campus?.name ?? '', campusAddress: [campus?.address, campus?.city].filter(Boolean).join(', ') || null,
        vendor: { id: v.id, name: v.name, gstin: v.gstin, address: v.address }, store: { id: store.id, name: store.name }, createdBy: users.get(p.createdBy) ?? null, prId: p.prId,
        can: { receive: this.inv.can(auth, PERMISSIONS.INV_RECEIVE, p.campusId), purchase: this.inv.can(auth, PERMISSIONS.INV_PURCHASE, p.campusId), bill: this.inv.can(auth, PERMISSIONS.INV_RECEIVE, p.campusId) || !!scopeFor(auth, PERMISSIONS.ACC_ENTRY) },
        items: p.items.map((i) => { const it = items.get(i.itemId)!; return { id: i.id, lineNo: i.lineNo, itemId: i.itemId, item: it.name, itemCode: it.itemCode, unit: it.unit, hsnCode: it.hsnCode, quantity: dec(i.quantity), rate: dec(i.rate), taxPercent: Number(i.taxPercent), amount: dec(i.amount), taxAmount: dec(i.taxAmount), receivedQty: dec(i.receivedQty), pendingQty: fromQh(Math.max(0, qh(i.quantity) - qh(i.receivedQty))) }; }),
        receipts: grns.map((g) => ({ id: g.id, grnNo: g.grnNo, receiptDate: iso(g.receiptDate), vendorChallanNo: g.vendorChallanNo, receivedBy: users.get(g.receivedBy) ?? null, remarks: g.remarks,
          items: g.items.map((i) => { const pi = p.items.find((x) => x.id === i.poItemId)!; const b = qh(billed.find((x) => x.grn_item === i.id)?.q ?? 0); return { id: i.id, item: items.get(i.itemId)?.name ?? '', unit: items.get(i.itemId)?.unit ?? '', receivedQty: dec(i.receivedQty), acceptedQty: dec(i.acceptedQty), rejectedQty: dec(i.rejectedQty), rejectionReason: i.rejectionReason, rate: dec(i.rate), taxPercent: Number(pi.taxPercent), billedQty: fromQh(b), unbilledQty: fromQh(Math.max(0, qh(i.acceptedQty) - b)) }; }) })),
        bills: bills.map((b) => ({ id: b.id, internalNo: b.internalNo, billNo: b.billNo, status: b.status, totalAmount: dec(b.totalAmount), goodsReceiptId: b.goodsReceiptId })),
      };
    });
  }

  cancelOrder(id: string, reason: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${id}::uuid FOR UPDATE`;
      const p = await tx.purchaseOrder.findUnique({ where: { id } });
      if (!p) throw NotFound('Purchase order');
      this.need(auth, PERMISSIONS.INV_PURCHASE, p.campusId);
      if (p.status === 'PENDING_APPROVAL') throw Conflict('po-waiting', 'The order is waiting for approval — ask the approver to reject it');
      if (!['APPROVED', 'PARTIAL'].includes(p.status)) throw Conflict('po-closed', 'This order is already closed');
      const partial = p.status === 'PARTIAL';
      await tx.purchaseOrder.update({ where: { id }, data: { status: partial ? 'CLOSED' : 'CANCELLED', cancelReason: reason } });
      if (!partial && p.prId) await tx.purchaseRequest.update({ where: { id: p.prId }, data: { status: 'APPROVED' } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: p.campusId, action: partial ? 'CLOSE' : 'CANCEL', entityType: 'PURCHASE_ORDER', entityId: id, oldValues: { status: p.status }, newValues: { reason } }, client);
      return { status: partial ? 'CLOSED' : 'CANCELLED' };
    });
  }

  // ───────────── Goods receipts & bills ─────────────

  receive(poId: string, input: GoodsReceiptInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${poId}::uuid FOR UPDATE`;
      const p = await tx.purchaseOrder.findUnique({ where: { id: poId }, include: { items: true } });
      if (!p) throw NotFound('Purchase order');
      this.need(auth, PERMISSIONS.INV_RECEIVE, p.campusId);
      if (!['APPROVED', 'PARTIAL'].includes(p.status)) throw Conflict('po-not-open', p.status === 'PENDING_APPROVAL' ? 'The order is not approved yet' : 'This order is closed');
      if (input.receiptDate < iso(p.poDate)!) throw unprocessable('before-order', 'Goods cannot arrive before the order date', 'receiptDate');
      const ids = input.lines.map((l) => l.poItemId);
      if (new Set(ids).size !== ids.length) throw unprocessable('duplicate-line', 'An order line is listed twice', 'lines');
      const items = new Map((await tx.inventoryItem.findMany({ where: { id: { in: p.items.map((i) => i.itemId) } }, select: { id: true, name: true } })).map((i) => [i.id, i.name]));
      const grnNo = await allocateNo(this.numbering, tx, 'GRN', p.campusId, financialYearOf(input.receiptDate).name, auth.userId);
      const g = await tx.goodsReceipt.create({ data: { tenantId: auth.tenantId!, campusId: p.campusId, grnNo, poId: p.id, storeId: p.storeId, receiptDate: day(input.receiptDate), vendorChallanNo: input.vendorChallanNo, receivedBy: auth.userId, remarks: input.remarks } });
      for (const l of input.lines) {
        const pi = p.items.find((x) => x.id === l.poItemId);
        if (!pi) throw unprocessable('not-in-order', 'A line is not in this order', 'lines');
        const rec = qh(l.receivedQty), rej = qh(l.rejectedQty);
        if (rej > rec) throw unprocessable('rejected-more', 'Rejected cannot be more than received', 'lines');
        if (rej > 0 && !l.rejectionReason) throw unprocessable('reason-needed', 'Say why goods were rejected', 'lines');
        const acc = rec - rej;
        const after = qh(pi.receivedQty) + acc;
        if (after > Math.floor(qh(pi.quantity) * (1 + RECEIPT_TOLERANCE))) throw Conflict('over-receipt', `${items.get(pi.itemId)}: ordered ${dec(pi.quantity)}, already received ${dec(pi.receivedQty)} — at most ${fromQh(Math.max(0, Math.floor(qh(pi.quantity) * (1 + RECEIPT_TOLERANCE)) - qh(pi.receivedQty)))} more can be accepted`);
        await tx.goodsReceiptItem.create({ data: { tenantId: auth.tenantId!, grnId: g.id, poItemId: pi.id, itemId: pi.itemId, receivedQty: l.receivedQty, acceptedQty: fromQh(acc), rejectedQty: l.rejectedQty, rejectionReason: l.rejectionReason, rate: pi.rate } });
        await tx.purchaseOrderItem.update({ where: { id: pi.id }, data: { receivedQty: fromQh(after) } });
        if (acc > 0) await move(tx, { tenantId: auth.tenantId!, storeId: p.storeId, itemId: pi.itemId, quantityH: acc, ratePaise: toPaise(dec(pi.rate)), date: input.receiptDate, txnType: 'GRN_IN', refType: 'GRN', refId: g.id, userId: auth.userId, remarks: `${grnNo} · ${p.poNo}` }, items.get(pi.itemId));
      }
      const fresh = await tx.purchaseOrderItem.findMany({ where: { poId: p.id } });
      const done = fresh.every((i) => qh(i.receivedQty) >= qh(i.quantity));
      await tx.purchaseOrder.update({ where: { id: p.id }, data: { status: done ? 'RECEIVED' : 'PARTIAL' } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: p.campusId, action: 'CREATE', entityType: 'GOODS_RECEIPT', entityId: g.id, newValues: { grnNo, poNo: p.poNo, lines: input.lines.length, orderStatus: done ? 'RECEIVED' : 'PARTIAL' } }, client);
      return { id: g.id, grnNo, orderStatus: done ? 'RECEIVED' : 'PARTIAL' };
    });
  }

  /** Vendor bill from a goods receipt (3-way match): accepted less already billed, at the order rate and GST code. */
  billFromReceipt(grnId: string, input: BillFromReceiptInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await tx.$queryRaw`SELECT id FROM goods_receipts WHERE id = ${grnId}::uuid FOR UPDATE`;
      const g = await tx.goodsReceipt.findUnique({ where: { id: grnId }, include: { items: true } });
      if (!g) throw NotFound('Goods receipt');
      if (!(this.inv.can(auth, PERMISSIONS.INV_RECEIVE, g.campusId) || this.inv.can(auth, PERMISSIONS.ACC_ENTRY as never, g.campusId))) throw NotFound('Goods receipt');
      const p = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: g.poId }, include: { items: true } });
      const items = new Map((await tx.inventoryItem.findMany({ where: { id: { in: g.items.map((i) => i.itemId) } } })).map((i) => [i.id, i]));
      const chart = await ensureAccountsChart(tx, auth.tenantId!);
      const ids = input.lines.map((l) => l.grnItemId);
      if (new Set(ids).size !== ids.length) throw unprocessable('duplicate-line', 'A receipt line is listed twice', 'lines');
      const billed = await tx.$queryRaw<{ grn_item: string; q: string }[]>`
        SELECT bi.goods_receipt_item_id AS grn_item, sum(bi.quantity)::text AS q FROM vendor_bill_items bi JOIN vendor_bills b ON b.id = bi.bill_id
         WHERE bi.goods_receipt_item_id = ANY(${ids}::uuid[]) AND b.status NOT IN ('CANCELLED','REJECTED') GROUP BY bi.goods_receipt_item_id`;
      const billItems = input.lines.map((l) => {
        const gi = g.items.find((x) => x.id === l.grnItemId);
        if (!gi) throw unprocessable('not-in-receipt', 'A line is not in this receipt', 'lines');
        const it = items.get(gi.itemId)!;
        const left = qh(gi.acceptedQty) - qh(billed.find((b) => b.grn_item === gi.id)?.q ?? 0);
        if (qh(l.quantity) > left) throw Conflict('over-billing', `${it.name}: only ${fromQh(Math.max(0, left))} accepted and not yet billed`);
        const pi = p.items.find((x) => x.id === gi.poItemId)!;
        return { accountId: it.expenseAccountId ?? chart.get('EXP_MISC')!, description: `${it.name} (${g.grnNo})`.slice(0, 300), quantity: l.quantity, rate: dec(gi.rate), taxCodeId: pi.taxCodeId ?? null, costCentreId: null };
      });
      return this.vendors.createBillInTx(tx, { campusId: g.campusId, vendorId: p.vendorId, billNo: input.billNo, billDate: input.billDate, dueDate: input.dueDate ?? null, items: billItems, applyTds: input.applyTds, notes: `From ${g.grnNo} against ${p.poNo}` }, auth, client, { purchaseOrderId: p.id, goodsReceiptId: g.id, grnItemIds: input.lines.map((l) => l.grnItemId) });
    });
  }

  /** Purchase register: orders in a period with what was received and billed. */
  register(auth: AuthContext, o: { from?: string; to?: string; campusId?: string }) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = this.inv.readable(auth);
      const from = o.from ?? `${new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7)}-01`;
      const to = o.to ?? new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
      const rows = await tx.purchaseOrder.findMany({ where: { ...(o.campusId ? { campusId: o.campusId } : c ? { campusId: { in: c } } : {}), poDate: { gte: day(from), lte: day(to) }, status: { notIn: ['CANCELLED', 'REJECTED'] } }, orderBy: { poDate: 'asc' } });
      const vendors = new Map((await tx.vendor.findMany({ where: { id: { in: rows.map((r) => r.vendorId) } }, select: { id: true, name: true } })).map((v) => [v.id, v.name]));
      const bills = await tx.vendorBill.groupBy({ by: ['purchaseOrderId'], where: { purchaseOrderId: { in: rows.map((r) => r.id) }, status: { notIn: ['CANCELLED', 'REJECTED'] } }, _sum: { totalAmount: true } });
      const list = rows.map((p) => ({ poNo: p.poNo, poDate: iso(p.poDate), vendor: vendors.get(p.vendorId) ?? '', status: p.status, ordered: dec(p.totalAmount), billed: dec(bills.find((b) => b.purchaseOrderId === p.id)?._sum.totalAmount ?? 0) }));
      return { from, to, rows: list, totalOrdered: fromPaise(list.reduce((t, r) => t + toPaise(r.ordered), 0)), totalBilled: fromPaise(list.reduce((t, r) => t + toPaise(r.billed), 0)) };
    });
  }
}
