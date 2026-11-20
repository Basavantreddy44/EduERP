import { z } from 'zod';
import { money } from './fees';

/** Phase 17: inventory & purchase (B6 §1). Stock is kept in quantities and weighted-average value; purchases are expensed on the vendor bill (owner decision 2026-11-20). */

const uuid = z.string().uuid();
const date = z.string().date();
const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const qty = money.refine((v) => Number(v) > 0, 'Enter a quantity above zero');
const rate = money;

export const ITEM_TYPES = ['CONSUMABLE', 'ASSET', 'LAB_EQUIPMENT'] as const;
export const UNITS = ['PCS', 'BOX', 'PKT', 'REAM', 'KG', 'LTR', 'MTR', 'SET', 'PAIR', 'DOZEN', 'BOTTLE', 'ROLL'] as const;
export const PR_STATUSES = ['SUBMITTED', 'APPROVED', 'REJECTED', 'ORDERED', 'CANCELLED'] as const;
export const PO_STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'PARTIAL', 'RECEIVED', 'CLOSED', 'CANCELLED', 'REJECTED'] as const;
/** Goods receipts may exceed the ordered quantity by up to this share. */
export const RECEIPT_TOLERANCE = 0.05;

export const STARTER_ITEM_CATEGORIES = ['Stationery', 'Cleaning & housekeeping', 'Lab consumables', 'IT & electronics', 'Furniture', 'Kitchen & mess', 'Sports equipment', 'Electrical & maintenance'];

export const itemCategorySchema = z.object({ name: z.string().trim().min(2).max(100), parentId: uuid.nullable().optional(), isActive: z.boolean().default(true) });
export const inventoryItemSchema = z.object({
  itemCode: z.string().trim().toUpperCase().max(30).optional().nullable().transform((v) => (v ? v.replace(/\s+/g, '-') : null)).pipe(z.string().regex(/^[A-Z0-9][A-Z0-9/_-]*$/, 'Letters, digits, - / _').nullable()),
  name: z.string().trim().min(2).max(200),
  categoryId: uuid,
  unit: z.enum(UNITS),
  itemType: z.enum(ITEM_TYPES).default('CONSUMABLE'),
  hsnCode: z.string().trim().regex(/^\d{4,8}$/, 'HSN is 4 to 8 digits').optional().nullable().or(z.literal('').transform(() => null)),
  taxCodeId: uuid.nullable().optional(),
  reorderLevel: money.default('0'),
  expenseAccountId: uuid.nullable().optional(),
  description: optText(300),
  isActive: z.boolean().default(true),
});
export type InventoryItemInput = z.infer<typeof inventoryItemSchema>;

export const storeSchema = z.object({ campusId: uuid, name: z.string().trim().min(2).max(100), storeKeeperId: uuid.nullable().optional(), isActive: z.boolean().default(true) });
export type StoreInput = z.infer<typeof storeSchema>;

export const openingStockSchema = z.object({
  storeId: uuid,
  date,
  lines: z.array(z.object({ itemId: uuid, quantity: qty, rate })).min(1).max(200),
});
export type OpeningStockInput = z.infer<typeof openingStockSchema>;

// ───────────── Purchase requests & quotations ─────────────

export const purchaseRequestSchema = z.object({
  campusId: uuid,
  departmentId: uuid,
  departmentRequestId: uuid.nullable().optional(),
  requiredBy: date.nullable().optional(),
  justification: z.string().trim().min(5, 'Why is this needed?').max(500),
  items: z.array(z.object({ itemId: uuid, quantity: qty, estimatedRate: rate.default('0'), remarks: optText(200) })).min(1, 'Add at least one item').max(100),
});
export type PurchaseRequestInput = z.infer<typeof purchaseRequestSchema>;

export const quotationSchema = z.object({
  vendorId: uuid,
  quotationNo: optText(50),
  quotationDate: date,
  validTill: date.nullable().optional(),
  deliveryDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
  paymentTerms: optText(200),
  items: z.array(z.object({ prItemId: uuid, rate, taxPercent: z.coerce.number().min(0).max(100).default(0) })).min(1).max(100),
}).refine((v) => !v.validTill || v.validTill >= v.quotationDate, { path: ['validTill'], message: 'Valid till is before the quotation date' });
export type QuotationInput = z.infer<typeof quotationSchema>;
export const selectQuotationSchema = z.object({ reason: z.string().trim().min(3, 'Say why this one was chosen').max(300) });

// ───────────── Purchase orders, receipts, bills ─────────────

export const purchaseOrderSchema = z.object({
  campusId: uuid,
  vendorId: uuid,
  storeId: uuid,
  prId: uuid.nullable().optional(),
  quotationId: uuid.nullable().optional(),
  poDate: date,
  deliveryDate: date.nullable().optional(),
  terms: optText(2000),
  items: z.array(z.object({ itemId: uuid, quantity: qty, rate, taxCodeId: uuid.nullable().optional() })).min(1).max(100),
}).refine((v) => !v.deliveryDate || v.deliveryDate >= v.poDate, { path: ['deliveryDate'], message: 'Delivery is before the order date' });
export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;
export const fromQuotationSchema = z.object({ storeId: uuid, poDate: date, deliveryDate: date.nullable().optional(), terms: optText(2000) });

export const goodsReceiptSchema = z.object({
  receiptDate: date,
  vendorChallanNo: optText(50),
  remarks: optText(300),
  lines: z.array(z.object({ poItemId: uuid, receivedQty: qty, rejectedQty: money.default('0'), rejectionReason: optText(200) })).min(1).max(100),
});
export type GoodsReceiptInput = z.infer<typeof goodsReceiptSchema>;

export const billFromReceiptSchema = z.object({
  billNo: z.string().trim().min(1).max(50),
  billDate: date,
  dueDate: date.nullable().optional(),
  applyTds: z.boolean().default(true),
  lines: z.array(z.object({ grnItemId: uuid, quantity: qty })).min(1).max(100),
});
export type BillFromReceiptInput = z.infer<typeof billFromReceiptSchema>;

// ───────────── Issues, transfers, counts ─────────────

export const stockIssueSchema = z.object({
  issueType: z.enum(['ISSUE', 'TRANSFER']),
  fromStoreId: uuid,
  toStoreId: uuid.nullable().optional(),
  toDepartmentId: uuid.nullable().optional(),
  issuedToEmployeeId: uuid.nullable().optional(),
  departmentRequestId: uuid.nullable().optional(),
  issueDate: date,
  remarks: optText(300),
  items: z.array(z.object({ itemId: uuid, quantity: qty, returnable: z.boolean().default(false) })).min(1).max(100),
}).superRefine((v, ctx) => {
  if (v.issueType === 'TRANSFER' && !v.toStoreId) ctx.addIssue({ code: 'custom', path: ['toStoreId'], message: 'Choose the store it goes to' });
  if (v.issueType === 'TRANSFER' && v.toStoreId === v.fromStoreId) ctx.addIssue({ code: 'custom', path: ['toStoreId'], message: 'Choose a different store' });
  if (v.issueType === 'ISSUE' && !v.toDepartmentId && !v.issuedToEmployeeId) ctx.addIssue({ code: 'custom', path: ['toDepartmentId'], message: 'Choose the department or the person' });
});
export type StockIssueInput = z.infer<typeof stockIssueSchema>;

export const stockCountSchema = z.object({
  storeId: uuid,
  countDate: date,
  remarks: optText(300),
  lines: z.array(z.object({ itemId: uuid, countedQty: money, remarks: optText(200) })).min(1).max(500),
});
export type StockCountInput = z.infer<typeof stockCountSchema>;

export const inventoryReportSchema = z.object({ storeId: uuid.optional(), campusId: uuid.optional(), from: date.optional(), to: date.optional(), itemId: uuid.optional() });
