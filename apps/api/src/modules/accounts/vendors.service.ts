import { Injectable, OnModuleInit } from '@nestjs/common';
import { BillInput, HOME_STATE_CODE, PERMISSIONS, VendorInput, financialYearOf, fromPaise, panHolder, toPaise } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { decryptField, encryptField, last4, masked } from '../../common/field-crypto';
import { ApprovalsService } from '../approvals/approvals.service';
import { NumberingService } from '../numbering/numbering.service';
import { allocateNo } from '../students/student-records';
import { reverse } from '../fees/ledger';
import { assertOpen, ensureAccountsChart, iso, ledgerAccounts, paise, postOpen, unprocessable, dec } from './books';

const pct = (amountPaise: number, rate: { toString(): string } | string) => Math.round((amountPaise * Number(dec(rate))) / 100);
const OPEN_BILL = ['APPROVED', 'PARTIAL'];

/**
 * Vendors & bills (M13.2). Vendors keep PAN and bank number encrypted (CD-84). A bill's items carry the
 * expense / asset account, cost centre and GST code; GST splits into CGST + SGST for a vendor in the
 * institution's state and IGST otherwise; input GST is booked separately only when the code says it is
 * claimable, otherwise it is part of the cost. TDS is deducted at the vendor's section rate (individual /
 * other / no-PAN) when the bill or the year's total crosses the section's threshold. A bill posts when it
 * is approved — at once when no approval rule applies.
 */
@Injectable()
export class VendorsService implements OnModuleInit {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly numbering: NumberingService, private readonly approvals: ApprovalsService) {}

  onModuleInit() {
    this.approvals.onComplete('VENDOR_BILL', (tx, d) => this.billDecided(tx, d));
  }

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  private entry(auth: AuthContext, campusId: string) {
    const s = scopeFor(auth, PERMISSIONS.ACC_ENTRY);
    if (!s || !canAccessCampus(s, campusId)) throw NotFound('Campus');
  }

  // ───────────── Vendors ─────────────

  vendors(auth: AuthContext, q?: string) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.vendor.findMany({ where: q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { vendorCode: { contains: q, mode: 'insensitive' } }, { gstin: { contains: q.toUpperCase() } }] } : {}, orderBy: { name: 'asc' }, take: 500 });
      const due = await tx.$queryRaw<{ vendor_id: string; due: string }[]>`
        SELECT vendor_id, SUM(payable_amount - paid_amount)::text AS due FROM vendor_bills WHERE status IN ('APPROVED','PARTIAL') GROUP BY vendor_id`;
      const adv = await tx.$queryRaw<{ vendor_id: string; adv: string }[]>`
        SELECT vendor_id, SUM(advance_amount - advance_used)::text AS adv FROM vendor_payments WHERE status = 'PAID' GROUP BY vendor_id`;
      const dueMap = new Map(due.map((d) => [d.vendor_id, d.due]));
      const advMap = new Map(adv.map((d) => [d.vendor_id, d.adv]));
      const tds = new Map((await tx.tdsSection.findMany({ select: { id: true, sectionCode: true } })).map((s) => [s.id, s.sectionCode]));
      return rows.map((v) => ({
        id: v.id, vendorCode: v.vendorCode, name: v.name, vendorType: v.vendorType, gstin: v.gstin, pan: masked(v.panLast4), stateCode: v.stateCode, phone: v.phone, email: v.email,
        bankName: v.bankName, bankAccount: masked(v.bankAccountLast4), ifsc: v.ifsc, tdsSectionId: v.tdsSectionId, tdsSection: v.tdsSectionId ? tds.get(v.tdsSectionId) ?? null : null, status: v.status,
        due: dueMap.get(v.id) ?? '0.00', advance: advMap.get(v.id) ?? '0.00',
      }));
    });
  }

  saveVendor(id: string | null, input: VendorInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      if (input.tdsSectionId && !(await tx.tdsSection.findUnique({ where: { id: input.tdsSectionId }, select: { id: true } }))) throw NotFound('TDS section');
      if (input.gstin && (await tx.vendor.findFirst({ where: { gstin: input.gstin, ...(id ? { id: { not: id } } : {}) }, select: { name: true } }))) throw Conflict('duplicate-gstin', 'Another vendor already has this GSTIN');
      const old = id ? await tx.vendor.findUnique({ where: { id } }) : null;
      if (id && !old) throw NotFound('Vendor');
      const data = {
        name: input.name, vendorType: input.vendorType, gstin: input.gstin ?? null, stateCode: input.stateCode, phone: input.phone ?? null, email: input.email ?? null, address: input.address ?? null,
        // On an edit a blank PAN / account number keeps the stored (encrypted) one; screens never hold the full value.
        ...(input.pan || !old ? { panEnc: encryptField(input.pan), panLast4: last4(input.pan), panHolder: panHolder(input.pan) } : {}),
        ...(input.bankAccountNo || !old ? { bankAccountEnc: encryptField(input.bankAccountNo), bankAccountLast4: last4(input.bankAccountNo) } : {}),
        bankName: input.bankName ?? null, ifsc: input.ifsc ?? null,
        tdsSectionId: input.tdsSectionId ?? null, status: input.status,
      };
      const v = old
        ? await tx.vendor.update({ where: { id: old.id }, data })
        : await tx.vendor.create({ data: { tenantId: auth.tenantId!, vendorCode: await allocateNo(this.numbering, tx, 'VENDOR', '', financialYearOf(iso(new Date())).name, auth.userId), createdBy: auth.userId, ...data } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: id ? 'UPDATE' : 'CREATE', entityType: 'VENDOR', entityId: v.id, newValues: { ...input, pan: input.pan ? masked(last4(input.pan)) : undefined, bankAccountNo: input.bankAccountNo ? masked(last4(input.bankAccountNo)) : undefined } }, client);
      return { id: v.id, vendorCode: v.vendorCode };
    });
  }

  /** The full PAN or bank number — only with the reveal right, audited. */
  revealVendor(id: string, field: 'pan' | 'bankAccountNo', auth: AuthContext, client: ClientInfo) {
    if (!scopeFor(auth, PERMISSIONS.ACC_REVEAL)) throw Forbidden('cannot-reveal', 'You cannot see full PAN or account numbers');
    return this.db.run(this.ctx(auth), async (tx) => {
      const v = await tx.vendor.findUnique({ where: { id } });
      if (!v) throw NotFound('Vendor');
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'REVEAL', entityType: 'VENDOR', entityId: id, newValues: { field } }, client);
      return { value: decryptField(field === 'pan' ? v.panEnc : v.bankAccountEnc) };
    });
  }

  /** A vendor's account: bills, payments and adjustments as posted, with a running balance (credit = owed). */
  vendorLedger(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const v = await tx.vendor.findUnique({ where: { id }, select: { id: true, name: true, vendorCode: true } });
      if (!v) throw NotFound('Vendor');
      // What is owed to the vendor, less advances paid (TDS kept back is owed to the government, not the vendor).
      const chart = await ensureAccountsChart(tx, auth.tenantId!);
      const accts = [chart.get('VENDORS_PAYABLE')!, chart.get('VENDOR_ADVANCES')!];
      const rows = await tx.$queryRaw<{ entry_no: string; entry_date: Date; narration: string; source_type: string; source_id: string | null; debit: string; credit: string }[]>`
        SELECT e.entry_no, e.entry_date, e.narration, e.source_type, e.source_id, l.debit::text, l.credit::text
          FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
         WHERE l.party_type = 'VENDOR' AND l.party_id = ${id}::uuid AND l.account_id = ANY(${accts}::uuid[])
         ORDER BY e.entry_date, e.posted_at`;
      let bal = 0;
      return { vendor: v, lines: rows.map((r) => { bal += toPaise(r.credit) - toPaise(r.debit); return { entryNo: r.entry_no, date: iso(r.entry_date), narration: r.narration, sourceType: r.source_type, sourceId: r.source_id, debit: fromPaise(toPaise(r.debit)), credit: fromPaise(toPaise(r.credit)), balance: fromPaise(bal) }; }) };
    });
  }

  // ───────────── Bills ─────────────

  /** Works out GST, TDS and totals for a bill (also used for the live preview). */
  private async compute(tx: Tx, input: BillInput) {
    const vendor = await tx.vendor.findUnique({ where: { id: input.vendorId } });
    if (!vendor) throw NotFound('Vendor');
    if (vendor.status !== 'ACTIVE') throw Conflict('vendor-blocked', `${vendor.name} is blocked`);
    const accts = await ledgerAccounts(tx, input.items.map((i) => i.accountId));
    for (const i of input.items) {
      const a = accts.get(i.accountId)!;
      if (a.accountType !== 'EXPENSE' && a.accountType !== 'ASSET') throw unprocessable('bad-bill-account', `${a.name} is not an expense or asset account`, 'items');
      if (a.systemKey && ['CASH', 'PETTY_CASH', 'BANK', 'STUDENT_RECEIVABLE', 'GATEWAY_CLEARING', 'CHEQUES_IN_HAND', 'VENDOR_ADVANCES', 'INPUT_CGST', 'INPUT_SGST', 'INPUT_IGST'].includes(a.systemKey)) throw unprocessable('bad-bill-account', `${a.name} cannot be used on a bill`, 'items');
    }
    const ccIds = input.items.map((i) => i.costCentreId).filter((x): x is string => !!x);
    if (ccIds.length && (await tx.costCentre.count({ where: { id: { in: ccIds }, isActive: true } })) !== new Set(ccIds).size) throw NotFound('Cost centre');
    const billDate = new Date(`${input.billDate}T00:00:00Z`);
    const taxIds = [...new Set(input.items.map((i) => i.taxCodeId).filter((x): x is string => !!x))];
    const taxes = new Map((await tx.taxCode.findMany({ where: { id: { in: taxIds } } })).map((t) => [t.id, t]));
    const interState = vendor.stateCode !== HOME_STATE_CODE;
    const items = input.items.map((i, n) => {
      const t = i.taxCodeId ? taxes.get(i.taxCodeId) : null;
      if (i.taxCodeId && !t) throw NotFound('GST code');
      if (t && (t.effectiveFrom > billDate || (t.effectiveTo && t.effectiveTo < billDate))) throw unprocessable('tax-not-effective', `${t.name} does not apply on ${input.billDate}`, 'items');
      const amount = Math.round((toPaise(i.quantity) * toPaise(i.rate)) / 100);
      const tax = t ? pct(amount, t.ratePercent) : 0;
      const cgst = interState ? 0 : Math.floor(tax / 2);
      return { lineNo: n + 1, accountId: i.accountId, costCentreId: i.costCentreId ?? null, description: i.description, quantity: i.quantity, rate: i.rate, amount, taxCodeId: t?.id ?? null, taxRate: (t ? dec(t.ratePercent) : null) ?? '0', cgst, sgst: interState ? 0 : tax - cgst, igst: interState ? tax : 0, tax, itcClaimable: !!t?.itcClaimable };
    });
    const subTotal = items.reduce((a, i) => a + i.amount, 0);
    const taxAmount = items.reduce((a, i) => a + i.tax, 0);
    // TDS: the vendor's section in force on the bill date; deducted when this bill or the year's bills cross the threshold.
    let tds = { sectionId: null as string | null, sectionCode: null as string | null, rate: null as string | null, amount: 0, reason: 'No TDS section for this vendor' };
    if (vendor.tdsSectionId && input.applyTds) {
      const code = (await tx.tdsSection.findUniqueOrThrow({ where: { id: vendor.tdsSectionId } })).sectionCode;
      const sec = await tx.tdsSection.findFirst({ where: { sectionCode: code, effectiveFrom: { lte: billDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: billDate } }] }, orderBy: { effectiveFrom: 'desc' } });
      if (sec) {
        const fy = financialYearOf(input.billDate);
        const ytd = await tx.$queryRaw<{ s: string | null }[]>`
          SELECT SUM(sub_total)::text AS s FROM vendor_bills WHERE vendor_id = ${vendor.id}::uuid AND status NOT IN ('CANCELLED','REJECTED') AND bill_date BETWEEN ${fy.startDate}::date AND ${fy.endDate}::date`;
        const yearTotal = paise(ytd[0]?.s ?? '0') + subTotal;
        const single = sec.thresholdSingle ? subTotal > paise(sec.thresholdSingle) : false;
        const annual = sec.thresholdAnnual ? yearTotal > paise(sec.thresholdAnnual) : false;
        const crossed = (!sec.thresholdSingle && !sec.thresholdAnnual) || single || annual;
        const rate = vendor.panHolder === 'NONE' ? sec.rateNoPan : vendor.panHolder === 'INDIVIDUAL' ? sec.rateIndividual : sec.rateOthers;
        tds = crossed
          ? { sectionId: sec.id, sectionCode: sec.sectionCode, rate: dec(rate), amount: pct(subTotal, rate), reason: `${sec.sectionCode} at ${dec(rate)}%${vendor.panHolder === 'NONE' ? ' (no PAN)' : ''}` }
          : { sectionId: sec.id, sectionCode: sec.sectionCode, rate: null, amount: 0, reason: `Below the ${sec.sectionCode} threshold so far this year` };
      }
    } else if (vendor.tdsSectionId) tds = { ...tds, reason: 'TDS not applied on this bill' };
    return { vendor, items, subTotal, taxAmount, tds, total: subTotal + taxAmount, payable: subTotal + taxAmount - tds.amount, interState };
  }

  preview(input: BillInput, auth: AuthContext) {
    this.entry(auth, input.campusId);
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = await this.compute(tx, input);
      return { interState: c.interState, subTotal: fromPaise(c.subTotal), taxAmount: fromPaise(c.taxAmount), cgst: fromPaise(c.items.reduce((a, i) => a + i.cgst, 0)), sgst: fromPaise(c.items.reduce((a, i) => a + i.sgst, 0)), igst: fromPaise(c.items.reduce((a, i) => a + i.igst, 0)), tdsAmount: fromPaise(c.tds.amount), tdsNote: c.tds.reason, total: fromPaise(c.total), payable: fromPaise(c.payable) };
    });
  }

  createBill(input: BillInput, auth: AuthContext, client: ClientInfo) {
    this.entry(auth, input.campusId);
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = await this.compute(tx, input);
      const dup = await tx.$queryRaw<{ internal_no: string }[]>`SELECT internal_no FROM vendor_bills WHERE vendor_id = ${input.vendorId}::uuid AND upper(bill_no) = upper(${input.billNo}) AND status NOT IN ('CANCELLED','REJECTED') LIMIT 1`;
      if (dup.length) throw Conflict('duplicate-bill', `Bill ${input.billNo} from ${c.vendor.name} is already entered (${dup[0].internal_no})`);
      await assertOpen(tx, input.billDate);
      const internalNo = await allocateNo(this.numbering, tx, 'VENDOR_BILL', input.campusId, financialYearOf(input.billDate).name, auth.userId);
      const bill = await tx.vendorBill.create({
        data: {
          tenantId: auth.tenantId!, campusId: input.campusId, internalNo, vendorId: c.vendor.id, billNo: input.billNo, billDate: new Date(`${input.billDate}T00:00:00Z`), dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00Z`) : null,
          subTotal: fromPaise(c.subTotal), taxAmount: fromPaise(c.taxAmount), tdsSectionId: c.tds.amount ? c.tds.sectionId : null, tdsRate: c.tds.amount ? c.tds.rate : null, tdsAmount: fromPaise(c.tds.amount),
          totalAmount: fromPaise(c.total), payableAmount: fromPaise(c.payable), notes: input.notes ?? null, status: 'PENDING_APPROVAL', createdBy: auth.userId,
        },
      });
      await tx.vendorBillItem.createMany({ data: c.items.map((i) => ({ tenantId: auth.tenantId!, billId: bill.id, lineNo: i.lineNo, accountId: i.accountId, costCentreId: i.costCentreId, description: i.description, quantity: i.quantity, rate: i.rate, amount: fromPaise(i.amount), taxCodeId: i.taxCodeId, taxRate: i.taxRate, cgst: fromPaise(i.cgst), sgst: fromPaise(i.sgst), igst: fromPaise(i.igst), itcClaimable: i.itcClaimable })) });
      const req = await this.approvals.submit(tx, { tenantId: auth.tenantId!, requestedBy: auth.userId, entityType: 'VENDOR_BILL', entityId: bill.id, campusId: input.campusId, amount: c.total / 100, summary: `${internalNo} · ${c.vendor.name} bill ${input.billNo}: ₹${fromPaise(c.total)}` }, client);
      if (req) await tx.vendorBill.update({ where: { id: bill.id }, data: { approvalRequestId: req.id } });
      else await this.postBill(tx, bill.id, auth.userId);
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: input.campusId, action: 'CREATE', entityType: 'VENDOR_BILL', entityId: bill.id, newValues: { internalNo, vendor: c.vendor.name, billNo: input.billNo, total: fromPaise(c.total), tds: fromPaise(c.tds.amount), needsApproval: !!req } }, client);
      return { id: bill.id, internalNo, status: req ? 'PENDING_APPROVAL' : 'APPROVED', total: fromPaise(c.total), tdsAmount: fromPaise(c.tds.amount), payable: fromPaise(c.payable) };
    });
  }

  /** Posts an approved bill: Dr expense (+ GST when not claimable) / Dr input GST · Cr vendor, Cr TDS payable. */
  private async postBill(tx: Tx, billId: string, userId: string) {
    const b = await tx.vendorBill.findUniqueOrThrow({ where: { id: billId }, include: { items: true, vendor: { select: { name: true } } } });
    const chart = await ensureAccountsChart(tx, b.tenantId);
    const lines = b.items.flatMap((i) => {
      const tax = paise(i.cgst) + paise(i.sgst) + paise(i.igst);
      return i.itcClaimable
        ? [{ accountId: i.accountId, costCentreId: i.costCentreId, debitPaise: paise(i.amount) },
          { accountId: chart.get('INPUT_CGST')!, debitPaise: paise(i.cgst) }, { accountId: chart.get('INPUT_SGST')!, debitPaise: paise(i.sgst) }, { accountId: chart.get('INPUT_IGST')!, debitPaise: paise(i.igst) }]
        : [{ accountId: i.accountId, costCentreId: i.costCentreId, debitPaise: paise(i.amount) + tax }];
    });
    lines.push({ accountId: chart.get('VENDORS_PAYABLE')!, creditPaise: paise(b.payableAmount), partyType: 'VENDOR', partyId: b.vendorId } as never);
    if (paise(b.tdsAmount)) lines.push({ accountId: chart.get('TDS_PAYABLE')!, creditPaise: paise(b.tdsAmount), partyType: 'VENDOR', partyId: b.vendorId } as never);
    const e = await postOpen(tx, this.numbering, { tenantId: b.tenantId, campusId: b.campusId, date: iso(b.billDate), voucherType: 'PURCHASE', sourceType: 'VENDOR_BILL', sourceId: b.id, narration: `${b.internalNo} · ${b.vendor.name} bill ${b.billNo}`, userId, lines });
    await tx.vendorBill.update({ where: { id: b.id }, data: { status: 'APPROVED', journalEntryId: e.id } });
  }

  private async billDecided(tx: Tx, d: { entityId: string; decision: 'APPROVED' | 'REJECTED' | 'CANCELLED'; userId: string }) {
    const b = await tx.vendorBill.findUnique({ where: { id: d.entityId }, select: { id: true, status: true } });
    if (!b || b.status !== 'PENDING_APPROVAL') return;
    if (d.decision === 'APPROVED') await this.postBill(tx, b.id, d.userId);
    else await tx.vendorBill.update({ where: { id: b.id }, data: { status: 'REJECTED' } });
  }

  bills(auth: AuthContext, q: { vendorId?: string; status?: string }) {
    const s = scopeFor(auth, PERMISSIONS.ACC_READ)!;
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.vendorBill.findMany({
        where: { ...(q.vendorId ? { vendorId: q.vendorId } : {}), ...(q.status === 'OPEN' ? { status: { in: OPEN_BILL } } : q.status ? { status: q.status } : {}), ...(s.all ? {} : { campusId: { in: s.campusIds } }) },
        orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }], take: 300, include: { vendor: { select: { name: true } } },
      });
      const today = iso(new Date(Date.now() + 330 * 60_000));
      return rows.map((b) => ({ id: b.id, internalNo: b.internalNo, billNo: b.billNo, vendorId: b.vendorId, vendor: b.vendor.name, billDate: iso(b.billDate), dueDate: b.dueDate ? iso(b.dueDate) : null, total: dec(b.totalAmount), tds: dec(b.tdsAmount), payable: dec(b.payableAmount), paid: dec(b.paidAmount), balance: fromPaise(paise(b.payableAmount) - paise(b.paidAmount)), status: b.status, overdue: OPEN_BILL.includes(b.status) && !!b.dueDate && iso(b.dueDate) < today }));
    });
  }

  bill(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const b = await tx.vendorBill.findUnique({ where: { id }, include: { items: { orderBy: { lineNo: 'asc' } }, vendor: true, allocations: { include: { payment: { select: { paymentNo: true, paymentDate: true, mode: true, status: true } } } } } });
      const s = scopeFor(auth, PERMISSIONS.ACC_READ);
      if (!b || !s || !canAccessCampus(s, b.campusId)) throw NotFound('Bill');
      const accts = new Map((await tx.account.findMany({ where: { id: { in: b.items.map((i) => i.accountId) } }, select: { id: true, name: true } })).map((a) => [a.id, a.name]));
      const ccs = new Map((await tx.costCentre.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
      const je = b.journalEntryId ? await tx.journalEntry.findUnique({ where: { id: b.journalEntryId }, select: { entryNo: true } }) : null;
      const sec = b.tdsSectionId ? await tx.tdsSection.findUnique({ where: { id: b.tdsSectionId }, select: { sectionCode: true } }) : null;
      return {
        id: b.id, internalNo: b.internalNo, billNo: b.billNo, billDate: iso(b.billDate), dueDate: b.dueDate ? iso(b.dueDate) : null, status: b.status, notes: b.notes, cancelReason: b.cancelReason, campusId: b.campusId,
        vendor: { id: b.vendor.id, name: b.vendor.name, gstin: b.vendor.gstin, stateCode: b.vendor.stateCode, pan: masked(b.vendor.panLast4) },
        subTotal: dec(b.subTotal), taxAmount: dec(b.taxAmount), tdsAmount: dec(b.tdsAmount), tdsSection: sec?.sectionCode ?? null, tdsRate: dec(b.tdsRate) ?? null, total: dec(b.totalAmount), payable: dec(b.payableAmount), paid: dec(b.paidAmount), balance: fromPaise(paise(b.payableAmount) - paise(b.paidAmount)),
        journalEntryNo: je?.entryNo ?? null,
        items: b.items.map((i) => ({ lineNo: i.lineNo, account: accts.get(i.accountId) ?? '', costCentre: i.costCentreId ? ccs.get(i.costCentreId) ?? null : null, description: i.description, quantity: dec(i.quantity), rate: dec(i.rate), amount: dec(i.amount), taxRate: dec(i.taxRate), cgst: dec(i.cgst), sgst: dec(i.sgst), igst: dec(i.igst), itcClaimable: i.itcClaimable })),
        payments: b.allocations.map((a) => ({ paymentNo: a.payment.paymentNo, date: iso(a.payment.paymentDate), mode: a.payment.mode, amount: dec(a.amount), isAdjustment: a.isAdjustment, status: a.payment.status })),
      };
    });
  }

  /** Cancels an unpaid bill; a posted bill is reversed on the given date. */
  cancelBill(id: string, reason: string, date: string | undefined, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const b = await tx.vendorBill.findUnique({ where: { id } });
      if (!b) throw NotFound('Bill');
      this.entry(auth, b.campusId);
      if (['CANCELLED', 'REJECTED'].includes(b.status)) throw Conflict('bill-cancelled', 'This bill is already cancelled');
      if (paise(b.paidAmount) > 0) throw Conflict('bill-paid', 'Payments are applied to this bill — cancel those first');
      const on = date ?? iso(new Date(Date.now() + 330 * 60_000));
      if (b.journalEntryId) {
        await assertOpen(tx, on);
        await reverse(tx, this.numbering, b.journalEntryId, on, `Cancelled ${b.internalNo}: ${reason}`, auth.userId);
      }
      await tx.vendorBill.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason } });
      await this.audit.log(tx, { tenantId: b.tenantId, userId: auth.userId, campusId: b.campusId, action: 'CANCEL', entityType: 'VENDOR_BILL', entityId: id, newValues: { reason, on } }, client);
      return { id, status: 'CANCELLED' };
    });
  }

  /** Unpaid bills by age (not yet due, 0–30, 31–60, 61–90, over 90 days past due), per vendor. */
  ageing(auth: AuthContext) {
    const s = scopeFor(auth, PERMISSIONS.ACC_READ)!;
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.vendorBill.findMany({ where: { status: { in: OPEN_BILL }, ...(s.all ? {} : { campusId: { in: s.campusIds } }) }, include: { vendor: { select: { name: true } } } });
      const today = Date.parse(iso(new Date(Date.now() + 330 * 60_000)));
      const by = new Map<string, { vendorId: string; vendor: string; buckets: number[] }>();
      for (const b of rows) {
        const days = Math.floor((today - (b.dueDate ?? b.billDate).getTime()) / 86_400_000);
        const k = days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4;
        const v = by.get(b.vendorId) ?? { vendorId: b.vendorId, vendor: b.vendor.name, buckets: [0, 0, 0, 0, 0] };
        v.buckets[k] += paise(b.payableAmount) - paise(b.paidAmount);
        by.set(b.vendorId, v);
      }
      return [...by.values()].sort((a, b) => a.vendor.localeCompare(b.vendor)).map((v) => ({ vendorId: v.vendorId, vendor: v.vendor, notDue: fromPaise(v.buckets[0]), d30: fromPaise(v.buckets[1]), d60: fromPaise(v.buckets[2]), d90: fromPaise(v.buckets[3]), over90: fromPaise(v.buckets[4]), total: fromPaise(v.buckets.reduce((a, x) => a + x, 0)) }));
    });
  }
}
